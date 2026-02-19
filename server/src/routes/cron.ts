/**
 * Aether OS — /api/v1/cron and /api/v1/triggers route handlers
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  matchRoute,
  getErrorMessage,
} from './helpers.js';

export function createCronHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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

  return async function combinedHandler(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    if (await handleCron(req, res, url, user)) return true;
    if (await handleTriggers(req, res, url, user)) return true;
    return false;
  };
}
