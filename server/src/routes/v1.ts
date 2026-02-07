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

  // ----- Main handler -----

  return async function v1Handler(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    // Try each handler in order
    if (await handleAgents(req, res, url, user)) return true;
    if (await handleFilesystem(req, res, url, user)) return true;
    if (await handleTemplates(req, res, url, user)) return true;
    if (await handleSystem(req, res, url, user)) return true;
    if (await handleEvents(req, res, url, user)) return true;
    if (await handleCron(req, res, url, user)) return true;
    if (await handleTriggers(req, res, url, user)) return true;

    return false;
  };
}
