/**
 * Aether OS - REST API v1 Router
 *
 * Versioned public REST API at /api/v1/. All endpoints follow a consistent
 * response format:
 *   Success: { data: T }
 *   Success (list): { data: T[], meta: { total, limit, offset } }
 *   Error:   { error: { code: string, message: string } }
 *
 * Every response includes the X-Aether-Version header.
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import * as os from 'node:os';
import { verifySlackSignature, parseSlashCommand } from '@aether/kernel';
import { generateOpenApiSpec } from '../openapi.js';

const API_VERSION = '0.4.0';

// ---------------------------------------------------------------------------
// Types — we avoid importing @aether/* packages directly to keep
// this module decoupled. All dependencies are injected via createV1Router.
// ---------------------------------------------------------------------------

interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

interface AgentConfig {
  role: string;
  goal: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
  sandbox?: any;
}

type AuthenticateRequest = (req: IncomingMessage) => UserInfo | null;
type ReadBody = (req: IncomingMessage) => Promise<string>;
type RunAgentLoop = (kernel: any, pid: number, config: AgentConfig, opts: any) => Promise<void>;
type V1Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  user: UserInfo,
) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function setVersionHeader(res: ServerResponse): void {
  res.setHeader('X-Aether-Version', API_VERSION);
}

function jsonOk(res: ServerResponse, data: unknown, status = 200): void {
  setVersionHeader(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data }));
}

function jsonList(
  res: ServerResponse,
  items: unknown[],
  total: number,
  limit: number,
  offset: number,
): void {
  setVersionHeader(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: items, meta: { total, limit, offset } }));
}

function jsonError(res: ServerResponse, status: number, code: string, message: string): void {
  setVersionHeader(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

// ---------------------------------------------------------------------------
// Route matching helpers
// ---------------------------------------------------------------------------

function matchRoute(
  pathname: string,
  method: string,
  expectedMethod: string,
  pattern: string,
): Record<string, string> | null {
  if (method !== expectedMethod) return null;

  // Convert pattern like '/api/v1/agents/:uid' into a regex
  const paramNames: string[] = [];
  let regexStr = '^';
  const parts = pattern.split('/');
  for (const part of parts) {
    if (part.startsWith(':')) {
      paramNames.push(part.slice(1));
      regexStr += '/([^/]+)';
    } else if (part === '*path') {
      paramNames.push('path');
      regexStr += '/(.+)';
    } else {
      regexStr += part === '' ? '' : '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  regexStr += '$';

  const regex = new RegExp(regexStr);
  const match = pathname.match(regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}

// ---------------------------------------------------------------------------
// createV1Router
// ---------------------------------------------------------------------------

export interface V1RouterDeps {
  kernel: any;
  authenticateRequest: AuthenticateRequest;
  readBody: ReadBody;
  runAgentLoop: RunAgentLoop;
  agentTemplates: any[];
}

export function createV1Router(
  kernel: any,
  _authenticateRequest: AuthenticateRequest,
  readBody: ReadBody,
  runAgentLoop?: RunAgentLoop,
  agentTemplates?: any[],
): V1Handler {
  const templates = agentTemplates || [];
  // ----- Agents -----

  async function handleAgents(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/agents — Spawn agent
    if (pathname === '/api/v1/agents' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config: AgentConfig = JSON.parse(body);
        if (!config.role || !config.goal) {
          jsonError(res, 400, 'INVALID_INPUT', 'role and goal are required');
          return true;
        }

        const proc = kernel.processes.spawn(config, 0, user.id);
        const pid = proc.info.pid;

        // Create home directory
        await kernel.fs.createHome(proc.info.uid);

        // Open terminal
        const tty = kernel.pty.open(pid, {
          cwd: kernel.fs.getRealRoot() + proc.info.cwd,
          env: proc.info.env,
        });
        proc.info.ttyId = tty.id;

        // Mark as running
        kernel.processes.setState(pid, 'running', 'booting');

        // Start agent loop
        if (runAgentLoop && proc.agentConfig) {
          const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
          runAgentLoop(kernel, pid, proc.agentConfig, {
            apiKey,
            signal: proc.abortController.signal,
          }).catch((err: any) => {
            console.error(`[API v1] Agent loop error for PID ${pid}:`, err);
            kernel.processes.setState(pid, 'stopped', 'failed');
          });
        }

        jsonOk(res, { pid, uid: proc.info.uid, ttyId: tty.id }, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/agents — List agents
    if (pathname === '/api/v1/agents' && method === 'GET') {
      const status = url.searchParams.get('status');
      const limit = parseInt(url.searchParams.get('limit') || '20', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const isAdmin = user.role === 'admin';

      const activeProcesses = kernel.processes
        .getActiveByOwner(user.id, isAdmin)
        .map((p) => ({ ...p.info }));

      // Also include historical processes from StateStore
      const historicalProcesses = kernel.state.getAllProcesses();

      // Merge: prefer active process info, fill in from historical
      const seenPids = new Set(activeProcesses.map((p) => p.pid));
      const allAgents = [...activeProcesses];
      for (const hp of historicalProcesses) {
        if (!seenPids.has(hp.pid)) {
          allAgents.push(hp as any);
        }
      }

      // Filter by status if requested
      let filtered = allAgents;
      if (status === 'active') {
        filtered = allAgents.filter(
          (a: any) => a.state === 'running' || a.state === 'sleeping' || a.state === 'created',
        );
      } else if (status) {
        filtered = allAgents.filter((a: any) => a.state === status);
      }

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);
      jsonList(res, paged, total, limit, offset);
      return true;
    }

    // GET /api/v1/agents/:uid — Get agent details
    let params = matchRoute(pathname, method, 'GET', '/api/v1/agents/:uid');
    if (params) {
      const uid = params.uid;
      const all = kernel.processes.getAll();
      const proc = all.find((p) => p.info.uid === uid);
      if (proc) {
        jsonOk(res, { ...proc.info });
      } else {
        // Try historical
        const historical = kernel.state.getAllProcesses();
        const record = historical.find((r: any) => r.uid === uid);
        if (record) {
          jsonOk(res, record);
        } else {
          jsonError(res, 404, 'NOT_FOUND', `Agent ${uid} not found`);
        }
      }
      return true;
    }

    // DELETE /api/v1/agents/:uid — Kill agent
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/agents/:uid');
    if (params) {
      const uid = params.uid;
      const all = kernel.processes.getAll();
      const proc = all.find((p) => p.info.uid === uid);
      if (!proc) {
        jsonError(res, 404, 'NOT_FOUND', `Agent ${uid} not found`);
        return true;
      }
      kernel.processes.signal(proc.info.pid, 'SIGTERM');
      jsonOk(res, { pid: proc.info.pid, signal: 'SIGTERM' });
      return true;
    }

    // POST /api/v1/agents/:pid/pause — Pause agent for human takeover
    params = matchRoute(pathname, method, 'POST', '/api/v1/agents/:pid/pause');
    if (params) {
      const pid = parseInt(params.pid, 10);
      if (isNaN(pid)) {
        jsonError(res, 400, 'INVALID_INPUT', 'pid must be a number');
        return true;
      }
      const proc = kernel.processes.get(pid);
      if (!proc) {
        jsonError(res, 404, 'NOT_FOUND', `Process ${pid} not found`);
        return true;
      }
      const ok = kernel.processes.pause(pid);
      if (ok) {
        jsonOk(res, { pid, state: 'paused' });
      } else {
        jsonError(
          res,
          409,
          'INVALID_STATE',
          `Process ${pid} cannot be paused (state: ${proc.info.state})`,
        );
      }
      return true;
    }

    // POST /api/v1/agents/:pid/resume — Resume a paused agent
    params = matchRoute(pathname, method, 'POST', '/api/v1/agents/:pid/resume');
    if (params) {
      const pid = parseInt(params.pid, 10);
      if (isNaN(pid)) {
        jsonError(res, 400, 'INVALID_INPUT', 'pid must be a number');
        return true;
      }
      const proc = kernel.processes.get(pid);
      if (!proc) {
        jsonError(res, 404, 'NOT_FOUND', `Process ${pid} not found`);
        return true;
      }
      const ok = kernel.processes.resume(pid);
      if (ok) {
        jsonOk(res, { pid, state: 'running' });
      } else {
        jsonError(
          res,
          409,
          'INVALID_STATE',
          `Process ${pid} is not paused (state: ${proc.info.state})`,
        );
      }
      return true;
    }

    // POST /api/v1/agents/:uid/message — Send message to agent
    params = matchRoute(pathname, method, 'POST', '/api/v1/agents/:uid/message');
    if (params) {
      const uid = params.uid;
      const all = kernel.processes.getAll();
      const proc = all.find((p) => p.info.uid === uid);
      if (!proc) {
        jsonError(res, 404, 'NOT_FOUND', `Agent ${uid} not found`);
        return true;
      }
      try {
        const body = await readBody(req);
        const { content } = JSON.parse(body);
        kernel.bus.emit('ipc.message', {
          fromPid: 0,
          toPid: proc.info.pid,
          channel: 'user.message',
          payload: content,
          timestamp: Date.now(),
        });
        jsonOk(res, { delivered: true });
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/agents/:uid/timeline — Agent action history
    params = matchRoute(pathname, method, 'GET', '/api/v1/agents/:uid/timeline');
    if (params) {
      const uid = params.uid;
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      // Find PID by uid
      const all = kernel.processes.getAll();
      const proc = all.find((p) => p.info.uid === uid);
      const pid = proc?.info.pid;

      if (pid === undefined) {
        // Try historical
        const historical = kernel.state.getAllProcesses();
        const record = historical.find((r: any) => r.uid === uid);
        if (!record) {
          jsonError(res, 404, 'NOT_FOUND', `Agent ${uid} not found`);
          return true;
        }
        const logs = kernel.state.getAgentLogs(record.pid);
        const total = logs.length;
        const paged = logs.slice(offset, offset + limit);
        jsonList(res, paged, total, limit, offset);
        return true;
      }

      const logs = kernel.state.getAgentLogs(pid);
      const total = logs.length;
      const paged = logs.slice(offset, offset + limit);
      jsonList(res, paged, total, limit, offset);
      return true;
    }

    // GET /api/v1/agents/:uid/memory — Search agent memories
    params = matchRoute(pathname, method, 'GET', '/api/v1/agents/:uid/memory');
    if (params) {
      const uid = params.uid;
      const query = url.searchParams.get('q') || undefined;
      const layer = (url.searchParams.get('layer') as any) || undefined;
      const limit = parseInt(url.searchParams.get('limit') || '10', 10);

      const memories = kernel.memory.recall({
        agent_uid: uid,
        query,
        layer,
        limit,
      });
      jsonOk(res, memories);
      return true;
    }

    // GET /api/v1/agents/:uid/plan — Get agent's current plan
    params = matchRoute(pathname, method, 'GET', '/api/v1/agents/:uid/plan');
    if (params) {
      const uid = params.uid;
      const all = kernel.processes.getAll();
      const proc = all.find((p) => p.info.uid === uid);

      if (proc) {
        const plan = kernel.state.getActivePlanByPid(proc.info.pid);
        if (plan) {
          jsonOk(res, {
            ...plan,
            root_nodes: JSON.parse(plan.plan_tree || '[]'),
          });
        } else {
          jsonOk(res, null);
        }
      } else {
        jsonOk(res, null);
      }
      return true;
    }

    // GET /api/v1/agents/:uid/profile — Get agent profile
    params = matchRoute(pathname, method, 'GET', '/api/v1/agents/:uid/profile');
    if (params) {
      const uid = params.uid;
      const profile = kernel.memory.getProfile(uid);
      jsonOk(res, profile);
      return true;
    }

    return false;
  }

  // ----- Filesystem -----

  async function handleFilesystem(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // Match /api/v1/fs/... — extract path after /api/v1/fs/
    const fsPrefix = '/api/v1/fs/';
    if (!pathname.startsWith(fsPrefix)) return false;

    const fsPath = '/' + pathname.slice(fsPrefix.length);

    // GET /api/v1/fs/*path — Read file or list directory
    if (method === 'GET') {
      try {
        const stat = await kernel.fs.stat(fsPath);
        if (stat.type === 'directory') {
          const entries = await kernel.fs.ls(fsPath);
          jsonOk(res, entries);
        } else {
          const content = await kernel.fs.readFile(fsPath);
          jsonOk(res, content);
        }
      } catch (err: any) {
        if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
          jsonError(res, 404, 'NOT_FOUND', `Path not found: ${fsPath}`);
        } else {
          jsonError(res, 500, 'FS_ERROR', err.message);
        }
      }
      return true;
    }

    // PUT /api/v1/fs/*path — Write file
    if (method === 'PUT') {
      try {
        const body = await readBody(req);
        await kernel.fs.writeFile(fsPath, body);
        jsonOk(res, { path: fsPath, written: true });
      } catch (err: any) {
        jsonError(res, 500, 'FS_ERROR', err.message);
      }
      return true;
    }

    // DELETE /api/v1/fs/*path — Delete file or directory
    if (method === 'DELETE') {
      try {
        await kernel.fs.rm(fsPath, true);
        jsonOk(res, { path: fsPath, deleted: true });
      } catch (err: any) {
        if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
          jsonError(res, 404, 'NOT_FOUND', `Path not found: ${fsPath}`);
        } else {
          jsonError(res, 500, 'FS_ERROR', err.message);
        }
      }
      return true;
    }

    return false;
  }

  // ----- Templates -----

  async function handleTemplates(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method !== 'GET') return false;

    // GET /api/v1/templates
    if (pathname === '/api/v1/templates') {
      jsonOk(res, templates);
      return true;
    }

    // GET /api/v1/templates/:id
    const params = matchRoute(pathname, method, 'GET', '/api/v1/templates/:id');
    if (params) {
      const template = templates.find((t: any) => t.id === params.id);
      if (template) {
        jsonOk(res, template);
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Template ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  // ----- System -----

  async function handleSystem(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method !== 'GET') return false;

    // GET /api/v1/system/status
    if (pathname === '/api/v1/system/status') {
      const counts = kernel.processes.getCounts();
      jsonOk(res, {
        version: API_VERSION,
        uptime: kernel.getUptime(),
        processes: counts,
        docker: kernel.containers.isDockerAvailable(),
        containers: kernel.containers.getAll().length,
        gpu: kernel.containers.isGPUAvailable(),
        gpuCount: kernel.containers.getGPUs().length,
      });
      return true;
    }

    // GET /api/v1/system/metrics
    if (pathname === '/api/v1/system/metrics') {
      const cpus = os.cpus();
      const coreCount = cpus.length || 1;
      const loadAvg1 = os.loadavg()[0];
      const cpuPercent = Math.min(100, (loadAvg1 / coreCount) * 100);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      const counts = kernel.processes.getCounts();
      const agentCount = counts.running + counts.sleeping + counts.created;

      jsonOk(res, {
        cpu: { percent: parseFloat(cpuPercent.toFixed(1)), cores: coreCount },
        memory: {
          usedMB: Math.round(usedMem / (1024 * 1024)),
          totalMB: Math.round(totalMem / (1024 * 1024)),
          percent: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
        },
        agents: agentCount,
        containers: kernel.containers.getAll().length,
        timestamp: Date.now(),
      });
      return true;
    }

    return false;
  }

  // ----- SSE Events -----

  async function handleEvents(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (pathname !== '/api/v1/events' || method !== 'GET') return false;

    const filterParam = url.searchParams.get('filter');
    const filters = filterParam ? filterParam.split(',').map((f) => f.trim()) : [];

    setVersionHeader(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial heartbeat
    res.write('data: {"type":"connected"}\n\n');

    const unsubscribers: (() => void)[] = [];

    // Subscribe to kernel events
    const EVENT_TYPES = [
      'process.spawned',
      'process.stateChange',
      'process.exit',
      'agent.thought',
      'agent.action',
      'agent.observation',
      'agent.phaseChange',
      'agent.progress',
      'fs.changed',
      'cron.fired',
      'trigger.fired',
      'kernel.metrics',
    ];

    for (const eventType of EVENT_TYPES) {
      // Check filter
      if (filters.length > 0) {
        const matches = filters.some((f) => {
          if (f.endsWith('.*')) {
            return eventType.startsWith(f.slice(0, -1));
          }
          return eventType === f;
        });
        if (!matches) continue;
      }

      const unsub = kernel.bus.on(eventType, (data: any) => {
        try {
          res.write(`data: ${JSON.stringify({ type: eventType, ...data })}\n\n`);
        } catch {
          // Connection closed
        }
      });
      unsubscribers.push(unsub);
    }

    // Clean up on close
    req.on('close', () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    });

    return true;
  }

  // ----- Cron & Triggers -----

  async function handleCron(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/cron — List cron jobs
    if (pathname === '/api/v1/cron' && method === 'GET') {
      const jobs = kernel.cron.listJobs();
      jsonOk(res, jobs);
      return true;
    }

    // POST /api/v1/cron — Create cron job
    if (pathname === '/api/v1/cron' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { name, cron_expression, agent_config } = JSON.parse(body);
        if (!name || !cron_expression || !agent_config) {
          jsonError(
            res,
            400,
            'INVALID_INPUT',
            'name, cron_expression, and agent_config are required',
          );
          return true;
        }
        const job = kernel.cron.createJob(name, cron_expression, agent_config, user.id);
        jsonOk(res, job, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/cron/:id
    let params = matchRoute(pathname, method, 'DELETE', '/api/v1/cron/:id');
    if (params) {
      const deleted = kernel.cron.deleteJob(params.id);
      if (deleted) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Cron job ${params.id} not found`);
      }
      return true;
    }

    // PATCH /api/v1/cron/:id — Enable/disable cron job
    params = matchRoute(pathname, method, 'PATCH', '/api/v1/cron/:id');
    if (params) {
      try {
        const body = await readBody(req);
        const { enabled } = JSON.parse(body);
        if (typeof enabled !== 'boolean') {
          jsonError(res, 400, 'INVALID_INPUT', 'enabled (boolean) is required');
          return true;
        }
        const result = enabled
          ? kernel.cron.enableJob(params.id)
          : kernel.cron.disableJob(params.id);
        if (result) {
          jsonOk(res, { id: params.id, enabled });
        } else {
          jsonError(res, 404, 'NOT_FOUND', `Cron job ${params.id} not found`);
        }
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    return false;
  }

  async function handleTriggers(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/triggers — List event triggers
    if (pathname === '/api/v1/triggers' && method === 'GET') {
      const triggers = kernel.cron.listTriggers();
      jsonOk(res, triggers);
      return true;
    }

    // POST /api/v1/triggers — Create event trigger
    if (pathname === '/api/v1/triggers' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { name, event_type, agent_config, cooldown_ms, event_filter } = JSON.parse(body);
        if (!name || !event_type || !agent_config) {
          jsonError(res, 400, 'INVALID_INPUT', 'name, event_type, and agent_config are required');
          return true;
        }
        const trigger = kernel.cron.createTrigger(
          name,
          event_type,
          agent_config,
          user.id,
          cooldown_ms,
          event_filter,
        );
        jsonOk(res, trigger, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/triggers/:id
    const params = matchRoute(pathname, method, 'DELETE', '/api/v1/triggers/:id');
    if (params) {
      const deleted = kernel.cron.deleteTrigger(params.id);
      if (deleted) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Trigger ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  // ----- Integrations -----

  async function handleIntegrations(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/integrations — List integrations
    if (pathname === '/api/v1/integrations' && method === 'GET') {
      const list = kernel.integrations.list();
      jsonOk(res, list);
      return true;
    }

    // POST /api/v1/integrations — Register integration
    if (pathname === '/api/v1/integrations' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config = JSON.parse(body);
        if (!config.type || !config.name) {
          jsonError(res, 400, 'INVALID_INPUT', 'type and name are required');
          return true;
        }
        const info = kernel.integrations.register(config, user.id);
        jsonOk(res, info, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/integrations/:id
    let params = matchRoute(pathname, method, 'GET', '/api/v1/integrations/:id');
    if (params) {
      const info = kernel.integrations.get(params.id);
      if (info) {
        jsonOk(res, info);
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Integration ${params.id} not found`);
      }
      return true;
    }

    // DELETE /api/v1/integrations/:id
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/integrations/:id');
    if (params) {
      kernel.integrations.unregister(params.id);
      jsonOk(res, { deleted: true });
      return true;
    }

    // POST /api/v1/integrations/:id/test
    params = matchRoute(pathname, method, 'POST', '/api/v1/integrations/:id/test');
    if (params) {
      const result = await kernel.integrations.test(params.id);
      jsonOk(res, result);
      return true;
    }

    // POST /api/v1/integrations/:id/execute
    params = matchRoute(pathname, method, 'POST', '/api/v1/integrations/:id/execute');
    if (params) {
      try {
        const body = await readBody(req);
        const { action, params: actionParams } = JSON.parse(body);
        if (!action) {
          jsonError(res, 400, 'INVALID_INPUT', 'action is required');
          return true;
        }
        const result = await kernel.integrations.execute(params!.id, action, actionParams);
        jsonOk(res, result);
      } catch (err: any) {
        jsonError(res, 400, 'EXECUTION_ERROR', err.message);
      }
      return true;
    }

    // PATCH /api/v1/integrations/:id — Enable/disable
    params = matchRoute(pathname, method, 'PATCH', '/api/v1/integrations/:id');
    if (params) {
      try {
        const body = await readBody(req);
        const { enabled } = JSON.parse(body);
        if (typeof enabled !== 'boolean') {
          jsonError(res, 400, 'INVALID_INPUT', 'enabled (boolean) is required');
          return true;
        }
        if (enabled) {
          kernel.integrations.enable(params.id);
        } else {
          kernel.integrations.disable(params.id);
        }
        jsonOk(res, { id: params.id, enabled });
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    return false;
  }

  // ----- Slack Webhooks (public — verified by Slack signing secret) -----

  async function handleSlackWebhooks(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/integrations/slack/commands — Slash command receiver
    if (pathname === '/api/v1/integrations/slack/commands' && method === 'POST') {
      const body = await readBody(req);

      // Find a registered Slack integration to get signing_secret
      const allIntegrations = kernel.integrations.list();
      const slackIntegration = allIntegrations.find((i: any) => i.type === 'slack' && i.enabled);
      if (!slackIntegration) {
        jsonError(res, 404, 'NOT_FOUND', 'No active Slack integration found');
        return true;
      }

      // Get credentials from the integration row
      const row = kernel.state.getIntegration(slackIntegration.id);
      const credentials = row?.credentials ? JSON.parse(row.credentials) : {};

      // Verify Slack signature
      const timestamp = (req.headers['x-slack-request-timestamp'] as string) || '';
      const signature = (req.headers['x-slack-signature'] as string) || '';
      if (
        !credentials.signing_secret ||
        !verifySlackSignature(credentials.signing_secret, timestamp, body, signature)
      ) {
        jsonError(res, 401, 'INVALID_SIGNATURE', 'Slack signature verification failed');
        return true;
      }

      // Parse URL-encoded slash command payload
      const params = new URLSearchParams(body);
      const commandText = params.get('text') || '';
      const userId = params.get('user_id') || '';
      const userName = params.get('user_name') || '';
      const channelId = params.get('channel_id') || '';
      const responseUrl = params.get('response_url') || '';

      const parsed = parseSlashCommand(commandText);

      // Emit event on the kernel bus for other subsystems to react
      kernel.bus.emit('slack.command', {
        integrationId: slackIntegration.id,
        command: parsed.command,
        args: parsed.args,
        user_id: userId,
        user_name: userName,
        channel_id: channelId,
        response_url: responseUrl,
        raw_text: commandText,
      });

      // Return immediate acknowledgement to Slack
      jsonOk(res, {
        response_type: 'ephemeral',
        text: `Processing command: ${parsed.command} ${parsed.args.join(' ')}`,
      });
      return true;
    }

    // POST /api/v1/integrations/slack/events — Events API receiver
    if (pathname === '/api/v1/integrations/slack/events' && method === 'POST') {
      const body = await readBody(req);

      let payload: any;
      try {
        payload = JSON.parse(body);
      } catch {
        jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
        return true;
      }

      // Handle Slack URL verification challenge
      if (payload.type === 'url_verification') {
        setVersionHeader(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: payload.challenge }));
        return true;
      }

      // Find a registered Slack integration
      const allIntegrations = kernel.integrations.list();
      const slackIntegration = allIntegrations.find((i: any) => i.type === 'slack' && i.enabled);
      if (!slackIntegration) {
        jsonError(res, 404, 'NOT_FOUND', 'No active Slack integration found');
        return true;
      }

      // Get credentials
      const row = kernel.state.getIntegration(slackIntegration.id);
      const credentials = row?.credentials ? JSON.parse(row.credentials) : {};

      // Verify Slack signature
      const timestamp = (req.headers['x-slack-request-timestamp'] as string) || '';
      const signature = (req.headers['x-slack-signature'] as string) || '';
      if (
        !credentials.signing_secret ||
        !verifySlackSignature(credentials.signing_secret, timestamp, body, signature)
      ) {
        jsonError(res, 401, 'INVALID_SIGNATURE', 'Slack signature verification failed');
        return true;
      }

      // Emit event on kernel bus
      if (payload.event) {
        kernel.bus.emit('slack.event', {
          integrationId: slackIntegration.id,
          event_type: payload.event.type,
          event: payload.event,
          team_id: payload.team_id,
        });
      }

      // Acknowledge receipt to Slack (must respond within 3s)
      jsonOk(res, { ok: true });
      return true;
    }

    return false;
  }

  // ----- Marketplace (Plugin Registry + Template Marketplace) -----

  async function handleMarketplace(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/marketplace/plugins — List plugins
    if (pathname === '/api/v1/marketplace/plugins' && method === 'GET') {
      const category = url.searchParams.get('category') || undefined;
      const search = url.searchParams.get('q') || undefined;
      let plugins;
      if (search) {
        plugins = kernel.pluginRegistry.search(search);
      } else if (category) {
        plugins = kernel.pluginRegistry.list().filter((p: any) => p.category === category);
      } else {
        plugins = kernel.pluginRegistry.list();
      }
      jsonOk(res, plugins);
      return true;
    }

    // POST /api/v1/marketplace/plugins — Install plugin
    if (pathname === '/api/v1/marketplace/plugins' && method === 'POST') {
      try {
        const body = await readBody(req);
        const manifest = JSON.parse(body);
        const plugin = kernel.pluginRegistry.install(manifest);
        jsonOk(res, plugin, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/marketplace/plugins/:id
    let params = matchRoute(pathname, method, 'DELETE', '/api/v1/marketplace/plugins/:id');
    if (params) {
      kernel.pluginRegistry.uninstall(params.id);
      jsonOk(res, { deleted: true });
      return true;
    }

    // GET /api/v1/marketplace/templates — List templates
    if (pathname === '/api/v1/marketplace/templates' && method === 'GET') {
      const category = url.searchParams.get('category') || undefined;
      const entries = kernel.templateMarketplace.list(category);
      jsonOk(res, entries);
      return true;
    }

    // POST /api/v1/marketplace/templates — Publish template
    if (pathname === '/api/v1/marketplace/templates' && method === 'POST') {
      try {
        const body = await readBody(req);
        const entry = JSON.parse(body);
        const published = kernel.templateMarketplace.publish(entry);
        jsonOk(res, published, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/marketplace/templates/:id
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/marketplace/templates/:id');
    if (params) {
      kernel.templateMarketplace.unpublish(params.id);
      jsonOk(res, { deleted: true });
      return true;
    }

    return false;
  }

  // ----- Organizations (v0.5 RBAC) -----

  async function handleOrgs(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/orgs — Create org
    if (pathname === '/api/v1/orgs' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { name, displayName } = JSON.parse(body);
        if (!name) {
          jsonError(res, 400, 'INVALID_INPUT', 'name is required');
          return true;
        }
        const org = kernel.auth.createOrg(name, user.id, displayName);
        jsonOk(res, org, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/orgs — List user's orgs
    if (pathname === '/api/v1/orgs' && method === 'GET') {
      const orgs = kernel.auth.listOrgs(user.id);
      jsonOk(res, orgs);
      return true;
    }

    // GET /api/v1/orgs/:orgId
    let params = matchRoute(pathname, method, 'GET', '/api/v1/orgs/:orgId');
    if (params) {
      const org = kernel.auth.getOrg(params.orgId);
      if (org) {
        jsonOk(res, org);
      } else {
        jsonError(res, 404, 'NOT_FOUND', 'Organization not found');
      }
      return true;
    }

    // DELETE /api/v1/orgs/:orgId
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/orgs/:orgId');
    if (params) {
      try {
        kernel.auth.deleteOrg(params.orgId, user.id);
        jsonOk(res, { deleted: true });
      } catch (err: any) {
        jsonError(res, 403, 'FORBIDDEN', err.message);
      }
      return true;
    }

    // PATCH /api/v1/orgs/:orgId — Update org settings
    params = matchRoute(pathname, method, 'PATCH', '/api/v1/orgs/:orgId');
    if (params) {
      try {
        const body = await readBody(req);
        const { settings, displayName } = JSON.parse(body);
        const org = kernel.auth.updateOrg(params.orgId, { settings, displayName }, user.id);
        jsonOk(res, org);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/orgs/:orgId/members — List members
    params = matchRoute(pathname, method, 'GET', '/api/v1/orgs/:orgId/members');
    if (params) {
      const members = kernel.auth.listMembers(params.orgId);
      jsonOk(res, members);
      return true;
    }

    // POST /api/v1/orgs/:orgId/members — Invite member
    params = matchRoute(pathname, method, 'POST', '/api/v1/orgs/:orgId/members');
    if (params) {
      try {
        const body = await readBody(req);
        const { userId, role } = JSON.parse(body);
        if (!userId || !role) {
          jsonError(res, 400, 'INVALID_INPUT', 'userId and role are required');
          return true;
        }
        kernel.auth.inviteMember(params.orgId, userId, role, user.id);
        jsonOk(res, { invited: true }, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/orgs/:orgId/members/:userId — Remove member
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/orgs/:orgId/members/:userId');
    if (params) {
      try {
        kernel.auth.removeMember(params.orgId, params.userId, user.id);
        jsonOk(res, { removed: true });
      } catch (err: any) {
        jsonError(res, 403, 'FORBIDDEN', err.message);
      }
      return true;
    }

    // PATCH /api/v1/orgs/:orgId/members/:userId — Update role
    params = matchRoute(pathname, method, 'PATCH', '/api/v1/orgs/:orgId/members/:userId');
    if (params) {
      try {
        const body = await readBody(req);
        const { role } = JSON.parse(body);
        if (!role) {
          jsonError(res, 400, 'INVALID_INPUT', 'role is required');
          return true;
        }
        kernel.auth.updateMemberRole(params.orgId, params.userId, role, user.id);
        jsonOk(res, { updated: true });
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // POST /api/v1/orgs/:orgId/teams — Create team
    params = matchRoute(pathname, method, 'POST', '/api/v1/orgs/:orgId/teams');
    if (params) {
      try {
        const body = await readBody(req);
        const { name, description } = JSON.parse(body);
        if (!name) {
          jsonError(res, 400, 'INVALID_INPUT', 'name is required');
          return true;
        }
        const team = kernel.auth.createTeam(params.orgId, name, user.id, description);
        jsonOk(res, team, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/orgs/:orgId/teams — List teams
    params = matchRoute(pathname, method, 'GET', '/api/v1/orgs/:orgId/teams');
    if (params) {
      const teams = kernel.auth.listTeams(params.orgId);
      jsonOk(res, teams);
      return true;
    }

    // DELETE /api/v1/orgs/:orgId/teams/:teamId — Delete team
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/orgs/:orgId/teams/:teamId');
    if (params) {
      try {
        kernel.auth.deleteTeam(params.teamId, user.id);
        jsonOk(res, { deleted: true });
      } catch (err: any) {
        jsonError(res, 403, 'FORBIDDEN', err.message);
      }
      return true;
    }

    // POST /api/v1/orgs/:orgId/teams/:teamId/members — Add to team
    params = matchRoute(pathname, method, 'POST', '/api/v1/orgs/:orgId/teams/:teamId/members');
    if (params) {
      try {
        const body = await readBody(req);
        const { userId, role } = JSON.parse(body);
        if (!userId) {
          jsonError(res, 400, 'INVALID_INPUT', 'userId is required');
          return true;
        }
        kernel.auth.addToTeam(params.teamId, userId, user.id, role || 'member');
        jsonOk(res, { added: true }, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/orgs/:orgId/teams/:teamId/members/:userId — Remove from team
    params = matchRoute(
      pathname,
      method,
      'DELETE',
      '/api/v1/orgs/:orgId/teams/:teamId/members/:userId',
    );
    if (params) {
      try {
        kernel.auth.removeFromTeam(params.teamId, params.userId, user.id);
        jsonOk(res, { removed: true });
      } catch (err: any) {
        jsonError(res, 403, 'FORBIDDEN', err.message);
      }
      return true;
    }

    return false;
  }

  // ----- Skills -----

  async function handleSkills(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/skills — List skills
    if (pathname === '/api/v1/skills' && method === 'GET') {
      const category = url.searchParams.get('category') || undefined;
      const skills = kernel.skills.list(category);
      jsonOk(res, skills);
      return true;
    }

    // POST /api/v1/skills — Register skill
    if (pathname === '/api/v1/skills' && method === 'POST') {
      try {
        const body = await readBody(req);
        const definition = JSON.parse(body);
        const skill = kernel.skills.register(definition);
        jsonOk(res, skill, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/skills/:id — Get skill
    let params = matchRoute(pathname, method, 'GET', '/api/v1/skills/:id');
    if (params) {
      const skill = kernel.skills.get(params.id);
      if (skill) {
        jsonOk(res, skill);
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Skill ${params.id} not found`);
      }
      return true;
    }

    // DELETE /api/v1/skills/:id — Unregister skill
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/skills/:id');
    if (params) {
      const removed = kernel.skills.unregister(params.id);
      if (removed) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Skill ${params.id} not found`);
      }
      return true;
    }

    // POST /api/v1/skills/:id/execute — Execute skill
    params = matchRoute(pathname, method, 'POST', '/api/v1/skills/:id/execute');
    if (params) {
      try {
        const body = await readBody(req);
        const { inputs, context } = JSON.parse(body);
        const result = await kernel.skills.execute(
          params.id,
          inputs || {},
          context || { agentUid: 'api', pid: 0, fsRoot: kernel.fs.getRealRoot() },
        );
        jsonOk(res, result);
      } catch (err: any) {
        jsonError(res, 400, 'EXECUTION_ERROR', err.message);
      }
      return true;
    }

    return false;
  }

  // ----- Remote Access -----

  async function handleRemoteAccess(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/remote/tunnels — List tunnels
    if (pathname === '/api/v1/remote/tunnels' && method === 'GET') {
      const tunnels = kernel.remoteAccess.listTunnels();
      jsonOk(res, tunnels);
      return true;
    }

    // POST /api/v1/remote/tunnels — Create tunnel
    if (pathname === '/api/v1/remote/tunnels' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config = JSON.parse(body);
        const tunnel = kernel.remoteAccess.createTunnel(config);
        jsonOk(res, tunnel, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/remote/tunnels/:id — Destroy tunnel
    let params = matchRoute(pathname, method, 'DELETE', '/api/v1/remote/tunnels/:id');
    if (params) {
      const destroyed = kernel.remoteAccess.destroyTunnel(params.id);
      if (destroyed) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Tunnel ${params.id} not found`);
      }
      return true;
    }

    // GET /api/v1/remote/tailscale/status — Tailscale status
    if (pathname === '/api/v1/remote/tailscale/status' && method === 'GET') {
      const status = kernel.remoteAccess.tailscaleStatus();
      jsonOk(res, status);
      return true;
    }

    // POST /api/v1/remote/tailscale/up — Tailscale up
    if (pathname === '/api/v1/remote/tailscale/up' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config = body ? JSON.parse(body) : undefined;
        const result = await kernel.remoteAccess.tailscaleUp(config);
        jsonOk(res, result);
      } catch (err: any) {
        jsonError(res, 400, 'EXECUTION_ERROR', err.message);
      }
      return true;
    }

    // POST /api/v1/remote/tailscale/down — Tailscale down
    if (pathname === '/api/v1/remote/tailscale/down' && method === 'POST') {
      try {
        const result = await kernel.remoteAccess.tailscaleDown();
        jsonOk(res, result);
      } catch (err: any) {
        jsonError(res, 400, 'EXECUTION_ERROR', err.message);
      }
      return true;
    }

    // GET /api/v1/remote/tailscale/devices — List tailnet devices
    if (pathname === '/api/v1/remote/tailscale/devices' && method === 'GET') {
      const devices = kernel.remoteAccess.tailscaleDevices();
      jsonOk(res, devices);
      return true;
    }

    // POST /api/v1/remote/tailscale/serve — Expose port via Tailscale Serve
    if (pathname === '/api/v1/remote/tailscale/serve' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { port, ...opts } = JSON.parse(body);
        if (!port) {
          jsonError(res, 400, 'INVALID_INPUT', 'port is required');
          return true;
        }
        const result = await kernel.remoteAccess.tailscaleServe(port, opts);
        jsonOk(res, result);
      } catch (err: any) {
        jsonError(res, 400, 'EXECUTION_ERROR', err.message);
      }
      return true;
    }

    // GET /api/v1/remote/keys — List authorized keys
    if (pathname === '/api/v1/remote/keys' && method === 'GET') {
      const keys = kernel.remoteAccess.listAuthorizedKeys();
      jsonOk(res, keys);
      return true;
    }

    // POST /api/v1/remote/keys — Add authorized key
    if (pathname === '/api/v1/remote/keys' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { key, label } = JSON.parse(body);
        if (!key || !label) {
          jsonError(res, 400, 'INVALID_INPUT', 'key and label are required');
          return true;
        }
        const added = kernel.remoteAccess.addAuthorizedKey(key, label);
        jsonOk(res, added, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/remote/keys/:id — Remove authorized key
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/remote/keys/:id');
    if (params) {
      const removed = kernel.remoteAccess.removeAuthorizedKey(params.id);
      if (removed) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Key ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  // ----- Resources (v0.5) -----

  async function handleResources(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method !== 'GET') return false;

    // GET /api/v1/resources/summary — Get summary of all agent resource usage
    if (pathname === '/api/v1/resources/summary') {
      const summary = kernel.resources.getSummary();
      jsonOk(res, summary);
      return true;
    }

    // GET /api/v1/resources/:pid — Get usage for a specific agent
    const params = matchRoute(pathname, method, 'GET', '/api/v1/resources/:pid');
    if (params) {
      const pid = parseInt(params.pid, 10);
      if (isNaN(pid)) {
        jsonError(res, 400, 'INVALID_INPUT', 'pid must be a number');
        return true;
      }
      const usage = kernel.resources.getUsage(pid);
      if (usage) {
        const quota = kernel.resources.getQuota(pid);
        jsonOk(res, { usage, quota });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `No resource usage data for PID ${pid}`);
      }
      return true;
    }

    return false;
  }

  // ----- Audit Log (v0.5) -----

  async function handleAudit(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/audit — Paginated, filterable audit log
    if (pathname === '/api/v1/audit' && method === 'GET') {
      const pid = url.searchParams.get('pid');
      const action = url.searchParams.get('action');
      const event_type = url.searchParams.get('event_type');
      const start = url.searchParams.get('start');
      const end = url.searchParams.get('end');
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);

      const filters: Record<string, any> = {};
      if (pid) filters.pid = parseInt(pid, 10);
      if (action) filters.action = action;
      if (event_type) filters.event_type = event_type;
      if (start) filters.startTime = parseInt(start, 10);
      if (end) filters.endTime = parseInt(end, 10);

      const result = kernel.audit.query({ ...filters, limit, offset });
      jsonList(res, result.entries, result.total, limit, offset);
      return true;
    }

    return false;
  }

  // ----- Webhook DLQ (v0.5 Phase 3) -----

  async function handleWebhookDlq(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/webhooks/dlq — List DLQ entries
    if (pathname === '/api/v1/webhooks/dlq' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const entries = kernel.webhooks.getDlqEntries(limit, offset);
      jsonOk(res, entries);
      return true;
    }

    // POST /api/v1/webhooks/dlq/:id/retry — Retry a DLQ entry
    let params = matchRoute(pathname, method, 'POST', '/api/v1/webhooks/dlq/:id/retry');
    if (params) {
      const success = await kernel.webhooks.retryDlqEntry(params.id);
      jsonOk(res, { success });
      return true;
    }

    // DELETE /api/v1/webhooks/dlq/:id — Purge a single DLQ entry
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/webhooks/dlq/:id');
    if (params) {
      const purged = kernel.webhooks.purgeDlqEntry(params.id);
      if (purged) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `DLQ entry ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  // ----- Permissions (v0.5 Phase 4) -----

  async function handlePermissions(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/permissions — List policies
    if (pathname === '/api/v1/permissions' && method === 'GET') {
      const subject = url.searchParams.get('subject') || undefined;
      const policies = kernel.auth.listPolicies(subject);
      jsonOk(res, policies);
      return true;
    }

    // POST /api/v1/permissions — Create a policy
    if (pathname === '/api/v1/permissions' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { subject, action, resource, effect } = JSON.parse(body);
        if (!subject || !action || !resource || !effect) {
          jsonError(
            res,
            400,
            'INVALID_INPUT',
            'subject, action, resource, and effect are required',
          );
          return true;
        }
        if (effect !== 'allow' && effect !== 'deny') {
          jsonError(res, 400, 'INVALID_INPUT', 'effect must be "allow" or "deny"');
          return true;
        }
        const policy = kernel.auth.grantPermission({
          subject,
          action,
          resource,
          effect,
          created_by: user.id,
        });
        jsonOk(res, policy, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // DELETE /api/v1/permissions/:id — Revoke a policy
    const params = matchRoute(pathname, method, 'DELETE', '/api/v1/permissions/:id');
    if (params) {
      const deleted = kernel.auth.revokePermission(params.id);
      if (deleted) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Permission policy ${params.id} not found`);
      }
      return true;
    }

    // POST /api/v1/permissions/check — Check a permission
    if (pathname === '/api/v1/permissions/check' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { userId, action, resource } = JSON.parse(body);
        if (!userId || !action || !resource) {
          jsonError(res, 400, 'INVALID_INPUT', 'userId, action, and resource are required');
          return true;
        }
        const allowed = kernel.auth.checkPermission(userId, action, resource);
        jsonOk(res, { allowed });
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    return false;
  }

  // ----- Main handler -----

  // ----- Tools (v0.5 Phase 4 — Tool Compatibility Layer) -----

  async function handleTools(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/tools/import — Import tools in LangChain or OpenAI format
    if (pathname === '/api/v1/tools/import' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { tools: toolDefs, format } = JSON.parse(body);
        if (!toolDefs || !Array.isArray(toolDefs)) {
          jsonError(res, 400, 'INVALID_INPUT', 'tools (array) is required');
          return true;
        }
        if (format !== 'langchain' && format !== 'openai') {
          jsonError(res, 400, 'INVALID_INPUT', 'format must be "langchain" or "openai"');
          return true;
        }
        const imported = kernel.toolCompat.importTools(toolDefs, format);
        jsonOk(res, imported, 201);
      } catch (err: any) {
        jsonError(res, 400, 'INVALID_INPUT', err.message);
      }
      return true;
    }

    // GET /api/v1/tools/export?format=langchain|openai — Export tools
    if (pathname === '/api/v1/tools/export' && method === 'GET') {
      const format = url.searchParams.get('format');
      if (format !== 'langchain' && format !== 'openai') {
        jsonError(res, 400, 'INVALID_INPUT', 'format query param must be "langchain" or "openai"');
        return true;
      }
      const exported = kernel.toolCompat.exportTools(format);
      jsonOk(res, exported);
      return true;
    }

    // GET /api/v1/tools — List all tools (native + imported)
    if (pathname === '/api/v1/tools' && method === 'GET') {
      const tools = kernel.toolCompat.listTools();
      jsonOk(res, tools);
      return true;
    }

    return false;
  }

  // ----- Main handler -----

  return async function v1Handler(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    // GET /api/v1/openapi.json — OpenAPI spec
    if (url.pathname === '/api/v1/openapi.json' && (req.method || 'GET') === 'GET') {
      jsonOk(res, generateOpenApiSpec());
      return true;
    }

    // Try each handler in order
    if (await handleAgents(req, res, url, user)) return true;
    if (await handleFilesystem(req, res, url, user)) return true;
    if (await handleTemplates(req, res, url, user)) return true;
    if (await handleSystem(req, res, url, user)) return true;
    if (await handleEvents(req, res, url, user)) return true;
    if (await handleCron(req, res, url, user)) return true;
    if (await handleTriggers(req, res, url, user)) return true;
    if (await handleIntegrations(req, res, url, user)) return true;
    if (await handleSlackWebhooks(req, res, url, user)) return true;
    if (await handleMarketplace(req, res, url, user)) return true;
    if (await handleOrgs(req, res, url, user)) return true;
    if (await handlePermissions(req, res, url, user)) return true;
    if (await handleSkills(req, res, url, user)) return true;
    if (await handleRemoteAccess(req, res, url, user)) return true;
    if (await handleResources(req, res, url, user)) return true;
    if (await handleAudit(req, res, url, user)) return true;
    if (await handleWebhookDlq(req, res, url, user)) return true;
    if (await handleTools(req, res, url, user)) return true;

    return false;
  };
}
