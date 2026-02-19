/**
 * Aether OS -- Resources & Audit route handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonList,
  jsonError,
  matchRoute,
} from './helpers.js';

export function createResourcesHandler(deps: V1RouterDeps): V1Handler {
  const { kernel } = deps;

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

  return async (req, res, url, user) => {
    if (await handleResources(req, res, url, user)) return true;
    if (await handleAudit(req, res, url, user)) return true;
    return false;
  };
}
