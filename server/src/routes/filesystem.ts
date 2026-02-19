/**
 * Aether OS — /api/v1/fs route handler
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  getErrorMessage,
  isNotFoundError,
} from './helpers.js';

export function createFilesystemHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

  async function handleFilesystem(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // Match /api/v1/fs/... — extract path after /api/v1/fs/
    const fsPrefix = '/api/v1/fs/';
    if (!pathname.startsWith(fsPrefix)) return false;

    const fsPath = '/' + pathname.slice(fsPrefix.length);

    // GET /api/v1/fs/*path — Read file or list directory
    if (method === 'GET') {
      try {
        const stat = await kernel.fs.stat(fsPath);
        if (stat.type === 'directory') {
          const entries = await kernel.fs.ls(fsPath);
          jsonOk(res, entries);
        } else {
          const content = await kernel.fs.readFile(fsPath);
          jsonOk(res, content);
        }
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          jsonError(res, 404, 'NOT_FOUND', `Path not found: ${fsPath}`);
        } else {
          jsonError(res, 500, 'FS_ERROR', getErrorMessage(err));
        }
      }
      return true;
    }

    // PUT /api/v1/fs/*path — Write file
    if (method === 'PUT') {
      try {
        const body = await readBody(req);
        await kernel.fs.writeFile(fsPath, body);
        jsonOk(res, { path: fsPath, written: true });
      } catch (err: unknown) {
        jsonError(res, 500, 'FS_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // DELETE /api/v1/fs/*path — Delete file or directory
    if (method === 'DELETE') {
      try {
        await kernel.fs.rm(fsPath, true);
        jsonOk(res, { path: fsPath, deleted: true });
      } catch (err: unknown) {
        if (isNotFoundError(err)) {
          jsonError(res, 404, 'NOT_FOUND', `Path not found: ${fsPath}`);
        } else {
          jsonError(res, 500, 'FS_ERROR', getErrorMessage(err));
        }
      }
      return true;
    }

    return false;
  }

  return handleFilesystem;
}
