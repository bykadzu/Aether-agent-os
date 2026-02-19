/**
 * Aether OS -- MCP, OpenClaw & Aether MCP route handler
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

export function createMcpHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

  async function handleMCP(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/mcp/servers — List all MCP server configs + status
    if (pathname === '/api/v1/mcp/servers' && method === 'GET') {
      const servers = kernel.mcp.getAllServers();
      jsonOk(res, servers);
      return true;
    }

    // POST /api/v1/mcp/servers — Add a new MCP server config
    if (pathname === '/api/v1/mcp/servers' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config = JSON.parse(body);
        if (!config.id || !config.name || !config.transport) {
          jsonError(res, 400, 'INVALID_INPUT', 'id, name, and transport are required');
          return true;
        }
        const info = kernel.mcp.addServer(config);
        jsonOk(res, info, 201);
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    // DELETE /api/v1/mcp/servers/:id — Remove an MCP server config
    let params = matchRoute(pathname, method, 'DELETE', '/api/v1/mcp/servers/:id');
    if (params) {
      try {
        kernel.mcp.removeServer(params.id);
        jsonOk(res, { deleted: true });
      } catch (err: unknown) {
        jsonError(res, 404, 'NOT_FOUND', getErrorMessage(err));
      }
      return true;
    }

    // POST /api/v1/mcp/servers/:id/connect — Connect to an MCP server
    params = matchRoute(pathname, method, 'POST', '/api/v1/mcp/servers/:id/connect');
    if (params) {
      try {
        const config = kernel.mcp.getServerConfig(params.id);
        if (!config) {
          jsonError(res, 404, 'NOT_FOUND', `MCP server ${params.id} not found`);
          return true;
        }
        const info = await kernel.mcp.connect(config);
        jsonOk(res, info);
      } catch (err: unknown) {
        jsonError(res, 500, 'CONNECTION_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // POST /api/v1/mcp/servers/:id/disconnect — Disconnect from an MCP server
    params = matchRoute(pathname, method, 'POST', '/api/v1/mcp/servers/:id/disconnect');
    if (params) {
      try {
        await kernel.mcp.disconnect(params.id);
        jsonOk(res, { disconnected: true });
      } catch (err: unknown) {
        jsonError(res, 500, 'DISCONNECT_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // GET /api/v1/mcp/tools — List all available MCP tools
    if (pathname === '/api/v1/mcp/tools' && method === 'GET') {
      const tools = kernel.mcp.getTools();
      jsonOk(res, tools);
      return true;
    }

    // GET /api/v1/mcp/tools/:serverId — List tools from a specific server
    params = matchRoute(pathname, method, 'GET', '/api/v1/mcp/tools/:serverId');
    if (params) {
      const tools = kernel.mcp.getTools(params.serverId);
      jsonOk(res, tools);
      return true;
    }

    return false;
  }

  async function handleOpenClaw(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/openclaw/skills — List imported OpenClaw skills
    if (pathname === '/api/v1/openclaw/skills' && method === 'GET') {
      const skills = kernel.openClaw.listImported();
      jsonOk(res, skills);
      return true;
    }

    // POST /api/v1/openclaw/import — Import a single SKILL.md
    if (pathname === '/api/v1/openclaw/import' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { path: skillPath } = JSON.parse(body);
        if (!skillPath) {
          jsonError(res, 400, 'INVALID_INPUT', 'path is required');
          return true;
        }
        const result = await kernel.openClaw.importSkill(skillPath);
        jsonOk(res, result, 201);
      } catch (err: unknown) {
        jsonError(res, 400, 'IMPORT_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // POST /api/v1/openclaw/import-directory — Batch import from directory
    if (pathname === '/api/v1/openclaw/import-directory' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { dirPath } = JSON.parse(body);
        if (!dirPath) {
          jsonError(res, 400, 'INVALID_INPUT', 'dirPath is required');
          return true;
        }
        const result = await kernel.openClaw.importDirectory(dirPath);
        jsonOk(res, result);
      } catch (err: unknown) {
        jsonError(res, 400, 'IMPORT_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // GET /api/v1/openclaw/skills/:skillId/instructions — Get skill instructions
    let params = matchRoute(
      pathname,
      method,
      'GET',
      '/api/v1/openclaw/skills/:skillId/instructions',
    );
    if (params) {
      const instructions = kernel.openClaw.getInstructions(params.skillId);
      if (instructions !== undefined) {
        jsonOk(res, { skillId: params.skillId, instructions });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Skill ${params.skillId} not found`);
      }
      return true;
    }

    // DELETE /api/v1/openclaw/skills/:skillId — Remove imported skill
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/openclaw/skills/:skillId');
    if (params) {
      const removed = kernel.openClaw.removeImport(params.skillId);
      if (removed) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Skill ${params.skillId} not found`);
      }
      return true;
    }

    return false;
  }

  async function handleAetherMCP(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/mcp/aether/tools — List Aether MCP tools (for bridge)
    if (pathname === '/api/v1/mcp/aether/tools' && method === 'GET') {
      try {
        const schemas = kernel.aetherMcp.getToolSchemas();
        jsonOk(res, schemas);
      } catch (err: unknown) {
        jsonError(res, 500, 'MCP_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // POST /api/v1/mcp/aether/call — Call an Aether MCP tool (for bridge)
    if (pathname === '/api/v1/mcp/aether/call' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { tool, args, pid: callerPid, uid } = JSON.parse(body);
        if (!tool) {
          jsonError(res, 400, 'INVALID_INPUT', 'tool is required');
          return true;
        }
        const result = await kernel.aetherMcp.callTool(tool, args || {}, {
          pid: callerPid || 0,
          uid: uid || 'agent',
        });
        jsonOk(res, result);
      } catch (err: unknown) {
        jsonError(res, 400, 'MCP_CALL_ERROR', getErrorMessage(err));
      }
      return true;
    }

    return false;
  }

  return async (req, res, url, user) => {
    if (await handleMCP(req, res, url, user)) return true;
    if (await handleOpenClaw(req, res, url, user)) return true;
    if (await handleAetherMCP(req, res, url, user)) return true;
    return false;
  };
}
