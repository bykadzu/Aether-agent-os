/**
 * Aether OS — /api/v1/agents route handler
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonList,
  jsonError,
  matchRoute,
  getErrorMessage,
} from './helpers.js';

export function createAgentsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody, runAgentLoop } = deps;

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
        const config = JSON.parse(body);
        if (!config.role || !config.goal) {
          jsonError(res, 400, 'INVALID_INPUT', 'role and goal are required');
          return true;
        }

        const proc = kernel.processes.spawn(config, 0, user.id);
        const pid = proc.info.pid;

        // Create home directory
        await kernel.fs.createHome(proc.info.uid);

        // Check runtime — external runtimes use AgentSubprocess instead of builtin loop
        const runtime = config.runtime || 'builtin';

        if (runtime !== 'builtin' && kernel.subprocess) {
          // External runtime (claude-code / openclaw) — spawn as real OS subprocess
          const workDir = kernel.fs.getRealRoot() + '/home/' + proc.info.uid;
          config.runtime = runtime;
          await kernel.subprocess.start(pid, config, workDir);
          kernel.processes.setState(pid, 'running', 'executing');
          jsonOk(res, { pid, uid: proc.info.uid, runtime }, 201);
        } else {
          // Builtin runtime — open PTY and run agent loop
          const tty = kernel.pty.open(pid, {
            cwd: kernel.fs.getRealRoot() + proc.info.cwd,
            env: proc.info.env,
          });
          proc.info.ttyId = tty.id;

          kernel.processes.setState(pid, 'running', 'booting');

          if (runAgentLoop && proc.agentConfig) {
            const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
            runAgentLoop(kernel, pid, proc.agentConfig, {
              apiKey,
              signal: proc.abortController.signal,
            }).catch((err: unknown) => {
              console.error(`[API v1] Agent loop error for PID ${pid}:`, err);
              kernel.processes.setState(pid, 'stopped', 'failed');
            });
          }

          jsonOk(res, { pid, uid: proc.info.uid, ttyId: tty.id }, 201);
        }
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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

    // POST /api/v1/agents/:pid/message — Send user message to agent's chat queue
    params = matchRoute(pathname, method, 'POST', '/api/v1/agents/:pid/message');
    if (params) {
      const pid = parseInt(params.pid, 10);
      if (!isNaN(pid)) {
        const proc = kernel.processes.get(pid);
        if (!proc) {
          jsonError(res, 404, 'NOT_FOUND', `Process ${pid} not found`);
          return true;
        }
        try {
          const body = await readBody(req);
          const { content } = JSON.parse(body);
          if (!content || typeof content !== 'string') {
            jsonError(res, 400, 'INVALID_INPUT', 'content (string) is required');
            return true;
          }
          kernel.processes.queueUserMessage(pid, content);
          kernel.bus.emit('agent.userMessage', { pid, content, timestamp: Date.now() });
          jsonOk(res, { delivered: true, queued: true });
        } catch (err: unknown) {
          jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
        }
        return true;
      }
      // Not a numeric PID — fall through to the :uid/message handler below
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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

  return handleAgents;
}
