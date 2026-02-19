/**
 * Aether OS -- Tools (Tool Compatibility Layer) route handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  getErrorMessage,
} from './helpers.js';

export function createToolsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

  async function handleTools(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/tools/import — Import tools in LangChain or OpenAI format
    if (pathname === '/api/v1/tools/import' && method === 'POST') {
      try {
        const body = await readBody(req);
        const { tools: toolDefs, format } = JSON.parse(body);
        if (!toolDefs || !Array.isArray(toolDefs)) {
          jsonError(res, 400, 'INVALID_INPUT', 'tools (array) is required');
          return true;
        }
        if (format !== 'langchain' && format !== 'openai') {
          jsonError(res, 400, 'INVALID_INPUT', 'format must be "langchain" or "openai"');
          return true;
        }
        const imported = kernel.toolCompat.importTools(toolDefs, format);
        jsonOk(res, imported, 201);
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    // GET /api/v1/tools/export?format=langchain|openai — Export tools
    if (pathname === '/api/v1/tools/export' && method === 'GET') {
      const format = url.searchParams.get('format');
      if (format !== 'langchain' && format !== 'openai') {
        jsonError(res, 400, 'INVALID_INPUT', 'format query param must be "langchain" or "openai"');
        return true;
      }
      const exported = kernel.toolCompat.exportTools(format);
      jsonOk(res, exported);
      return true;
    }

    // GET /api/v1/tools — List all tools (native + imported)
    if (pathname === '/api/v1/tools' && method === 'GET') {
      const tools = kernel.toolCompat.listTools();
      jsonOk(res, tools);
      return true;
    }

    return false;
  }

  return handleTools;
}
