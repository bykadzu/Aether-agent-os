/**
 * Aether OS -- Permissions route handler
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

export function createPermissionsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    return false;
  }

  return handlePermissions;
}
