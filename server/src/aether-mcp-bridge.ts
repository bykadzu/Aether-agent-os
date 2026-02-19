#!/usr/bin/env node
/**
 * Aether OS — MCP stdio bridge
 *
 * A standalone Node.js script that speaks MCP JSON-RPC 2.0 over stdio.
 * Claude Code / OpenClaw spawn this as a subprocess MCP server.
 * It proxies tool calls to the Aether kernel via HTTP.
 *
 * Usage:
 *   node aether-mcp-bridge.js --port 3001 --pid 1
 */

import * as http from 'node:http';
import * as readline from 'node:readline';
import { getErrorMessage } from './errors.js';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let port = 3001;
let pid = 0;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--pid' && args[i + 1]) {
    pid = parseInt(args[i + 1], 10);
    i++;
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers (native node:http, no external deps)
// ---------------------------------------------------------------------------

function httpGet(path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path, headers: { Accept: 'application/json' } },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON from kernel: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
  });
}

function httpPost(path: string, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON from kernel: ${body}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC response helpers
// ---------------------------------------------------------------------------

function writeResponse(id: string | number | null, result: unknown): void {
  const msg = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(msg + '\n');
}

function writeError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  const msg = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  });
  process.stdout.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// MCP method handlers
// ---------------------------------------------------------------------------

async function handleInitialize(id: string | number | null): Promise<void> {
  writeResponse(id, {
    protocolVersion: '2024-11-05',
    serverInfo: {
      name: 'aether-os',
      version: '0.6.0',
    },
    capabilities: {
      tools: {},
    },
  });
}

async function handleToolsList(id: string | number | null): Promise<void> {
  try {
    const resp = await httpGet(`/api/v1/mcp/aether/tools?pid=${pid}`);
    const tools = resp.data || resp;
    writeResponse(id, { tools });
  } catch (err: unknown) {
    writeError(id, -32603, `Failed to list tools: ${getErrorMessage(err)}`);
  }
}

async function handleToolsCall(
  id: string | number | null,
  params: { name: string; arguments?: Record<string, unknown> },
): Promise<void> {
  try {
    const resp = await httpPost('/api/v1/mcp/aether/call', {
      tool: params.name,
      args: params.arguments || {},
      pid,
    });
    const result = resp.data || resp;
    // MCP tools/call expects { content: [...] }
    if (result && result.content) {
      writeResponse(id, result);
    } else {
      writeResponse(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      });
    }
  } catch (err: unknown) {
    writeResponse(id, {
      content: [{ type: 'text', text: `Error: ${getErrorMessage(err)}` }],
      isError: true,
    });
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function dispatch(msg: any): Promise<void> {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      await handleInitialize(id);
      break;

    case 'notifications/initialized':
      // No response needed for notifications
      break;

    case 'tools/list':
      await handleToolsList(id);
      break;

    case 'tools/call':
      await handleToolsCall(id, params || {});
      break;

    default:
      if (id !== undefined && id !== null) {
        writeError(id, -32601, `Method not found: ${method}`);
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// stdin reader — newline-delimited JSON-RPC
// ---------------------------------------------------------------------------

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  // Skip Content-Length headers (some clients use HTTP-style framing)
  if (trimmed.startsWith('Content-Length:')) return;

  try {
    const msg = JSON.parse(trimmed);
    dispatch(msg).catch((err) => {
      process.stderr.write(`[aether-mcp-bridge] dispatch error: ${err}\n`);
    });
  } catch {
    // Not valid JSON — ignore (could be a blank line or header)
  }
});

rl.on('close', () => {
  process.exit(0);
});

process.stderr.write(`[aether-mcp-bridge] started pid=${pid} port=${port}\n`);
