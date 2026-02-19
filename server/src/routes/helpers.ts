/**
 * Aether OS — Shared route types & utilities
 *
 * Provides the common types and helper functions used by every route module.
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
export { getErrorMessage, getErrorCode, isNotFoundError } from '../errors.js';

// ---------------------------------------------------------------------------
// Shared Types
// ---------------------------------------------------------------------------

export const API_VERSION = '0.4.0';

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export interface AgentConfig {
  role: string;
  goal: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
  sandbox?: any;
  runtime?: string;
  skills?: string[];
}

export type AuthenticateRequest = (req: IncomingMessage) => UserInfo | null;
export type ReadBody = (req: IncomingMessage) => Promise<string>;
export type RunAgentLoop = (
  kernel: any,
  pid: number,
  config: AgentConfig,
  opts: any,
) => Promise<void>;

export type V1Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  user: UserInfo,
) => Promise<boolean>;

export interface V1RouterDeps {
  kernel: any;
  authenticateRequest: AuthenticateRequest;
  readBody: ReadBody;
  runAgentLoop: RunAgentLoop;
  agentTemplates: any[];
}

// ---------------------------------------------------------------------------
// Response Helpers
// ---------------------------------------------------------------------------

export function setVersionHeader(res: ServerResponse): void {
  res.setHeader('X-Aether-Version', API_VERSION);
}

export function jsonOk(res: ServerResponse, data: unknown, status = 200): void {
  setVersionHeader(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data }));
}

export function jsonList(
  res: ServerResponse,
  items: unknown[],
  total: number,
  limit: number,
  offset: number,
): void {
  setVersionHeader(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: items, meta: { total, limit, offset } }));
}

export function jsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
): void {
  setVersionHeader(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

// ---------------------------------------------------------------------------
// Route Matching
// ---------------------------------------------------------------------------

export function matchRoute(
  pathname: string,
  method: string,
  expectedMethod: string,
  pattern: string,
): Record<string, string> | null {
  if (method !== expectedMethod) return null;

  const paramNames: string[] = [];
  let regexStr = '^';
  const parts = pattern.split('/');
  for (const part of parts) {
    if (part.startsWith(':')) {
      paramNames.push(part.slice(1));
      regexStr += '/([^/]+)';
    } else if (part === '*path') {
      paramNames.push('path');
      regexStr += '/(.+)';
    } else {
      regexStr += part === '' ? '' : '/' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  regexStr += '$';

  const regex = new RegExp(regexStr);
  const match = pathname.match(regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}
