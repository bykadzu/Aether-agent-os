/**
 * Aether OS — /api/v1/marketplace route handler
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

export function createMarketplaceHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
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

  return handleMarketplace;
}
