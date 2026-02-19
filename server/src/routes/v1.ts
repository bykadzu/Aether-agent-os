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
import { generateOpenApiSpec } from '../openapi.js';
import {
  type V1Handler,
  type V1RouterDeps,
  type AuthenticateRequest,
  type ReadBody,
  type RunAgentLoop,
  type UserInfo,
  jsonOk,
} from './helpers.js';

// Route module factory imports
import { createAgentsHandler } from './agents.js';
import { createFilesystemHandler } from './filesystem.js';
import { createSystemHandler } from './system.js';
import { createEventsHandler } from './events.js';
import { createCronHandler } from './cron.js';
import { createIntegrationsHandler } from './integrations.js';
import { createMarketplaceHandler } from './marketplace.js';
import { createOrgsHandler } from './orgs.js';
import { createPermissionsHandler } from './permissions.js';
import { createSkillsHandler } from './skills.js';
import { createRemoteHandler } from './remote.js';
import { createResourcesHandler } from './resources.js';
import { createWebhooksHandler } from './webhooks.js';
import { createToolsHandler } from './tools.js';
import { createMcpHandler } from './mcp.js';

// Re-export for external consumers (e.g. tests)
export type { V1RouterDeps, V1Handler };

export function createV1Router(
  kernel: any,
  _authenticateRequest: AuthenticateRequest,
  readBody: ReadBody,
  runAgentLoop?: RunAgentLoop,
  agentTemplates?: any[],
): V1Handler {
  const deps: V1RouterDeps = {
    kernel,
    authenticateRequest: _authenticateRequest,
    readBody,
    runAgentLoop: runAgentLoop!,
    agentTemplates: agentTemplates || [],
  };

  const handlers: V1Handler[] = [
    createAgentsHandler(deps),
    createFilesystemHandler(deps),
    createSystemHandler(deps),
    createEventsHandler(deps),
    createCronHandler(deps),
    createIntegrationsHandler(deps),
    createMarketplaceHandler(deps),
    createOrgsHandler(deps),
    createPermissionsHandler(deps),
    createSkillsHandler(deps),
    createRemoteHandler(deps),
    createResourcesHandler(deps),
    createWebhooksHandler(deps),
    createToolsHandler(deps),
    createMcpHandler(deps),
  ];

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
    for (const handler of handlers) {
      if (await handler(req, res, url, user)) return true;
    }

    return false;
  };
}
