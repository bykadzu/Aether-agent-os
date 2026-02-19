/**
 * Aether OS -- Remote Access route handler
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

export function createRemoteHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'EXECUTION_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // POST /api/v1/remote/tailscale/down — Tailscale down
    if (pathname === '/api/v1/remote/tailscale/down' && method === 'POST') {
      try {
        const result = await kernel.remoteAccess.tailscaleDown();
        jsonOk(res, result);
      } catch (err: unknown) {
        jsonError(res, 400, 'EXECUTION_ERROR', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'EXECUTION_ERROR', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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

  return handleRemoteAccess;
}
