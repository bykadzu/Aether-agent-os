/**
 * Aether OS — /api/v1/orgs route handler
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

export function createOrgsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 403, 'FORBIDDEN', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    // DELETE /api/v1/orgs/:orgId/members/:userId — Remove member
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/orgs/:orgId/members/:userId');
    if (params) {
      try {
        kernel.auth.removeMember(params.orgId, params.userId, user.id);
        jsonOk(res, { removed: true });
      } catch (err: unknown) {
        jsonError(res, 403, 'FORBIDDEN', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 403, 'FORBIDDEN', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 403, 'FORBIDDEN', getErrorMessage(err));
      }
      return true;
    }

    return false;
  }

  return handleOrgs;
}
