/**
 * Aether OS -- Skills route handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  matchRoute,
  getErrorMessage,
} from './helpers.js';

export function createSkillsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'EXECUTION_ERROR', getErrorMessage(err));
      }
      return true;
    }

    return false;
  }

  return handleSkills;
}
