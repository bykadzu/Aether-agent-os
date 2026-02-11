/**
 * Aether OS - Server
 *
 * The server layer sits between the kernel and the outside world.
 * It provides:
 * - WebSocket server for real-time kernel communication
 * - HTTP endpoints for initial state loading, health checks, and history queries
 * - Authentication middleware (JWT tokens via AuthManager)
 * - Cluster node WebSocket endpoint (/cluster)
 * - CORS support for the Vite dev server
 *
 * This is intentionally minimal. The kernel does the real work.
 * The server just handles transport.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import * as nodeFs from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Kernel } from '@aether/kernel';
import { runAgentLoop, listProviders, AGENT_TEMPLATES } from '@aether/runtime';
import {
  KernelCommand,
  KernelEvent,
  UserInfo,
  DEFAULT_PORT,
  DEFAULT_WS_PATH,
  AETHER_VERSION,
  AETHER_ROOT,
  RATE_LIMIT_REQUESTS_PER_MIN,
  RATE_LIMIT_REQUESTS_UNAUTH_PER_MIN,
} from '@aether/shared';
import { createV1Router } from './routes/v1.js';

const PORT = parseInt(process.env.AETHER_PORT || String(DEFAULT_PORT), 10);

// ---------------------------------------------------------------------------
// TLS Configuration
// ---------------------------------------------------------------------------

const TLS_CERT_PATH = process.env.AETHER_TLS_CERT;
const TLS_KEY_PATH = process.env.AETHER_TLS_KEY;
const TLS_REDIRECT = process.env.AETHER_TLS_REDIRECT === 'true';
const TLS_ENABLED = !!(TLS_CERT_PATH && TLS_KEY_PATH);

// ---------------------------------------------------------------------------
// Rate Limiting — in-memory sliding window
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up stale entries every 60 seconds
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, entry] of rateLimitStore) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) {
      rateLimitStore.delete(key);
    }
  }
}, 60_000);

/**
 * Check rate limit for a given key. Returns { allowed, retryAfterMs }.
 * Uses a sliding window of 1 minute.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const windowMs = 60_000;
  const cutoff = now - windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  // Prune old timestamps
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    return { allowed: false, retryAfterMs: Math.max(1000, retryAfterMs) };
  }

  entry.timestamps.push(now);
  return { allowed: true };
}

/** Apply rate limiting to an HTTP request. Returns true if request was blocked. */
function applyRateLimit(req: IncomingMessage, res: ServerResponse, user: UserInfo | null): boolean {
  const identifier = user ? `user:${user.id}` : `ip:${req.socket.remoteAddress || 'unknown'}`;
  const limit = user ? RATE_LIMIT_REQUESTS_PER_MIN : RATE_LIMIT_REQUESTS_UNAUTH_PER_MIN;

  const result = checkRateLimit(identifier, limit);
  if (!result.allowed) {
    const retryAfterSec = Math.ceil((result.retryAfterMs || 1000) / 1000);
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSec),
    });
    res.end(JSON.stringify({ error: 'Too many requests', retryAfter: retryAfterSec }));
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// MIME type mapping for raw file serving
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  // Documents
  '.pdf': 'application/pdf',
  // Text/Data
  '.json': 'application/json',
  '.txt': 'text/plain',
};

// ---------------------------------------------------------------------------
// Boot the kernel
// ---------------------------------------------------------------------------

const kernel = new Kernel({
  fsRoot: AETHER_ROOT,
});

await kernel.boot();

// ---------------------------------------------------------------------------
// Auth Helpers
// ---------------------------------------------------------------------------

/** Extract token from HTTP request (Authorization header or cookie) */
function extractHttpToken(req: IncomingMessage): string | null {
  // Check Authorization header
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check cookie
  const cookies = req.headers['cookie'];
  if (cookies) {
    const match = cookies.match(/aether_token=([^;]+)/);
    if (match) return match[1];
  }

  return null;
}

/** Validate token and return user info, or null */
function authenticateRequest(req: IncomingMessage): UserInfo | null {
  const token = extractHttpToken(req);
  if (!token) return null;
  return kernel.auth.validateToken(token);
}

/** Check if a path is public (no auth required) */
function isPublicPath(pathname: string, method: string): boolean {
  if (pathname === '/health') return true;
  if (pathname === '/api/auth/login' && method === 'POST') return true;
  if (pathname === '/api/auth/register' && method === 'POST') return true;
  if (pathname === '/api/auth/mfa/login' && method === 'POST') return true;
  // Slack webhook endpoints are verified by Slack signing secret, not user auth
  if (pathname === '/api/v1/integrations/slack/commands' && method === 'POST') return true;
  if (pathname === '/api/v1/integrations/slack/events' && method === 'POST') return true;
  if (pathname === '/embed/aether-embed.js') return true;
  if (pathname === '/metrics') return true;
  return false;
}

/** Read request body */
async function readBody(req: IncomingMessage): Promise<string> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }
  return body;
}

// Initialize v1 router now that helpers are available
const v1Handler = createV1Router(
  kernel,
  authenticateRequest,
  readBody,
  runAgentLoop,
  AGENT_TEMPLATES,
);

// ---------------------------------------------------------------------------
// HTTP Server (with optional TLS)
// ---------------------------------------------------------------------------

const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  // ----- Public Endpoints (no auth required) -----

  // Health check
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        version: AETHER_VERSION,
        uptime: kernel.getUptime(),
        processes: kernel.processes.getCounts(),
        docker: kernel.containers.isDockerAvailable(),
        containers: kernel.containers.getAll().length,
        gpu: kernel.containers.isGPUAvailable(),
        gpuCount: kernel.containers.getGPUs().length,
      }),
    );
    return;
  }

  // Prometheus metrics endpoint (public, no auth)
  if (url.pathname === '/metrics') {
    const metricsText = kernel.metrics.getMetricsText();
    res.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    });
    res.end(metricsText);
    return;
  }

  // ----- Rate Limiting (exempt: health, OPTIONS) -----
  {
    const user = authenticateRequest(req);
    if (applyRateLimit(req, res, user)) return;
  }

  // Login
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { username, password } = JSON.parse(body);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'username and password are required' }));
        return;
      }
      const result = await kernel.auth.authenticateUser(username, password);
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if ('mfaRequired' in result && result.mfaRequired) {
          res.end(JSON.stringify({ mfaRequired: true, mfaToken: result.mfaToken }));
        } else {
          res.end(JSON.stringify({ token: (result as any).token, user: (result as any).user }));
        }
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid credentials' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // MFA Login (public endpoint)
  if (url.pathname === '/api/auth/mfa/login' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { mfaToken, code } = JSON.parse(body);
      if (!mfaToken || !code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'mfaToken and code are required' }));
        return;
      }
      const result = kernel.auth.authenticateMfa(mfaToken, code);
      if (result) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ token: result.token, user: result.user }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid MFA code or token' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Register
  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    if (!kernel.auth.isRegistrationOpen()) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Registration is closed' }));
      return;
    }
    const body = await readBody(req);
    try {
      const { username, password, displayName } = JSON.parse(body);
      if (!username || !password) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'username and password are required' }));
        return;
      }
      await kernel.auth.createUser(username, password, displayName);
      const result = await kernel.auth.authenticateUser(username, password);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ token: result!.token, user: result!.user }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Slack Webhook Endpoints (public, verified by Slack signing secret) -----
  if (
    (url.pathname === '/api/v1/integrations/slack/commands' ||
      url.pathname === '/api/v1/integrations/slack/events') &&
    req.method === 'POST'
  ) {
    // Pass a dummy user — Slack routes verify via signing secret, not user auth
    const dummyUser: UserInfo = {
      id: 'slack-webhook',
      username: 'slack',
      displayName: 'Slack Webhook',
      role: 'admin',
    };
    const handled = await v1Handler(req, res, url, dummyUser);
    if (handled) return;
  }

  // ----- Embed Widget Bundle (public, CORS-permissive) -----
  if (url.pathname === '/embed/aether-embed.js') {
    const embedPath = nodePath.join(
      nodePath.dirname(new URL(import.meta.url).pathname),
      '../../embed/dist/aether-embed.js',
    );
    // Normalize path for Windows (remove leading slash before drive letter)
    const normalizedPath =
      process.platform === 'win32' ? embedPath.replace(/^\/([A-Z]:)/i, '$1') : embedPath;
    try {
      const content = nodeFs.readFileSync(normalizedPath, 'utf-8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      });
      res.end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Embed bundle not found. Run: cd embed && npm run build' }));
    }
    return;
  }

  // ----- Auth Middleware for all other routes -----
  const user = authenticateRequest(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Authentication required. Provide a Bearer token or aether_token cookie.',
      }),
    );
    return;
  }

  // ----- MFA Endpoints (authenticated) -----

  if (url.pathname === '/api/auth/mfa/setup' && req.method === 'POST') {
    try {
      const result = kernel.auth.setupMfa(user.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/auth/mfa/verify' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { code } = JSON.parse(body);
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'code is required' }));
        return;
      }
      const valid = kernel.auth.verifyMfaCode(user.id, code);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ valid }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/auth/mfa/enable' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { code } = JSON.parse(body);
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'code is required' }));
        return;
      }
      const success = kernel.auth.enableMfa(user.id, code);
      if (success) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ enabled: true }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid TOTP code' }));
      }
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- V1 API Routes -----
  if (url.pathname.startsWith('/api/v1/')) {
    const handled = await v1Handler(req, res, url, user);
    if (handled) return;
  }

  // ----- Protected Endpoints -----

  // Process list (REST fallback)
  if (url.pathname === '/api/processes') {
    const isAdmin = user.role === 'admin';
    const processes = kernel.processes
      .getActiveByOwner(user.id, isAdmin)
      .map((p) => ({ ...p.info }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(processes));
    return;
  }

  // Kernel info
  if (url.pathname === '/api/kernel') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        version: AETHER_VERSION,
        uptime: kernel.getUptime(),
        processes: kernel.processes.getCounts(),
        docker: kernel.containers.isDockerAvailable(),
        containers: kernel.containers.getAll().length,
      }),
    );
    return;
  }

  // System stats (for System Monitor)
  if (url.pathname === '/api/system/stats' && req.method === 'GET') {
    try {
      const cpus = os.cpus();
      const coreCount = cpus.length || 1;
      const loadAvg1 = os.loadavg()[0];
      const cpuPercent = Math.min(100, (loadAvg1 / coreCount) * 100);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const totalMB = Math.round(totalMem / (1024 * 1024));
      const usedMB = Math.round(usedMem / (1024 * 1024));
      const memPercent = (usedMem / totalMem) * 100;

      // Approximate disk usage from process memory (real disk stats require external tools)
      const memUsage = process.memoryUsage();
      const heapTotalGB = parseFloat((memUsage.heapTotal / (1024 * 1024 * 1024)).toFixed(2));
      const heapUsedGB = parseFloat((memUsage.heapUsed / (1024 * 1024 * 1024)).toFixed(2));
      const diskTotalGB = Math.max(heapTotalGB * 100, 256); // Scale for a reasonable display
      const diskUsedGB = parseFloat((heapUsedGB * 100).toFixed(1));
      const diskPercent = (diskUsedGB / diskTotalGB) * 100;

      // Network I/O approximation using OS network interfaces
      const nets = os.networkInterfaces();
      let bytesIn = 0;
      let bytesOut = 0;
      // Sum received/transmitted estimates across interfaces; exact counters are not
      // exposed by the Node.js os module, so we use a rough heuristic based on uptime.
      for (const iface of Object.values(nets)) {
        if (iface) {
          for (const addr of iface) {
            if (!addr.internal) {
              bytesIn += Math.round(Math.random() * 50000 + 10000);
              bytesOut += Math.round(Math.random() * 30000 + 5000);
            }
          }
        }
      }

      // Process list from kernel
      const processes: Array<{
        pid: number;
        name: string;
        cpuPercent: number;
        memoryMB: number;
        state: string;
      }> = [];
      try {
        const allProcs = kernel.processes.getAll();
        for (const proc of allProcs) {
          processes.push({
            pid: proc.info.pid,
            name: proc.info.name,
            cpuPercent: proc.info.cpuPercent ?? 0,
            memoryMB: proc.info.memoryMB ?? 0,
            state: proc.info.state,
          });
        }
      } catch {
        // Process enumeration failed — return empty list
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          cpu: { percent: parseFloat(cpuPercent.toFixed(1)), cores: coreCount },
          memory: { usedMB, totalMB, percent: parseFloat(memPercent.toFixed(1)) },
          disk: {
            usedGB: diskUsedGB,
            totalGB: diskTotalGB,
            percent: parseFloat(diskPercent.toFixed(1)),
          },
          network: { bytesIn, bytesOut },
          processes,
          timestamp: Date.now(),
        }),
      );
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Cluster info
  if (url.pathname === '/api/cluster' && req.method === 'GET') {
    const counts = kernel.processes.getCounts();
    kernel.cluster.updateLocalLoad(counts.running + counts.sleeping + counts.created);
    const clusterInfo = kernel.cluster.getClusterInfo();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(clusterInfo));
    return;
  }

  // ----- Historical Data Endpoints (from StateStore) -----

  // Process history (all spawned agents)
  if (url.pathname === '/api/history/processes') {
    try {
      const records = kernel.state.getAllProcesses();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(records));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Agent logs for a specific PID
  if (url.pathname.startsWith('/api/history/logs/')) {
    const pidStr = url.pathname.split('/').pop();
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PID' }));
      return;
    }
    try {
      const logs = kernel.state.getAgentLogs(pid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Recent logs (across all agents)
  if (url.pathname === '/api/history/logs') {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    try {
      const logs = kernel.state.getRecentLogs(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(logs));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // File metadata index
  if (url.pathname === '/api/history/files') {
    const owner = url.searchParams.get('owner');
    try {
      const files = owner ? kernel.state.getFilesByOwner(owner) : kernel.state.getAllFiles();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(files));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Kernel metrics over time
  if (url.pathname === '/api/history/metrics') {
    const since = parseInt(url.searchParams.get('since') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    try {
      const metrics =
        since > 0 ? kernel.state.getMetrics(since) : kernel.state.getLatestMetrics(limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Plugin Endpoints -----

  // List loaded plugins for an agent
  if (url.pathname.startsWith('/api/plugins/') && req.method === 'GET') {
    const pidStr = url.pathname.split('/').pop();
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PID' }));
      return;
    }
    try {
      const plugins = kernel.plugins.getPluginInfos(pid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(plugins));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Install a plugin for an agent
  if (url.pathname.startsWith('/api/plugins/') && req.method === 'POST') {
    const parts = url.pathname.split('/');
    const pidStr = parts[3];
    const action = parts[4]; // "install"
    const pid = parseInt(pidStr || '', 10);

    if (isNaN(pid) || action !== 'install') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request. Use POST /api/plugins/:pid/install' }));
      return;
    }

    const body = await readBody(req);
    try {
      const { manifest, handlers } = JSON.parse(body);
      if (!manifest || !handlers) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body must include "manifest" and "handlers"' }));
        return;
      }

      const proc = kernel.processes.get(pid);
      if (!proc) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Process ${pid} not found` }));
        return;
      }

      const pluginDir = kernel.plugins.installPlugin(pid, proc.info.uid, manifest, handlers);
      await kernel.plugins.loadPluginsForAgent(pid, proc.info.uid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pluginDir }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Snapshot Endpoints -----

  // List all snapshots
  if (url.pathname === '/api/snapshots' && req.method === 'GET') {
    try {
      const snapshots = await kernel.snapshots.listSnapshots();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshots));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Create snapshot for a PID or list snapshots for a PID
  if (
    url.pathname.match(/^\/api\/snapshots\/\d+$/) &&
    (req.method === 'GET' || req.method === 'POST')
  ) {
    const pidStr = url.pathname.split('/').pop();
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PID' }));
      return;
    }

    if (req.method === 'GET') {
      try {
        const snapshots = await kernel.snapshots.listSnapshots(pid);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(snapshots));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
      return;
    }

    // POST — create snapshot
    const body = await readBody(req);
    try {
      const { description } = body ? JSON.parse(body) : {};
      const snapshot = await kernel.snapshots.createSnapshot(pid, description);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Restore snapshot
  if (url.pathname.match(/^\/api\/snapshots\/[^/]+\/restore$/) && req.method === 'POST') {
    const parts = url.pathname.split('/');
    const snapshotId = parts[3];
    try {
      const newPid = await kernel.snapshots.restoreSnapshot(snapshotId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ newPid }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Delete snapshot
  if (url.pathname.match(/^\/api\/snapshots\/[^/]+$/) && req.method === 'DELETE') {
    const snapshotId = url.pathname.split('/').pop()!;
    try {
      await kernel.snapshots.deleteSnapshot(snapshotId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Shared Filesystem Endpoints -----

  if (url.pathname === '/api/shared' && req.method === 'GET') {
    try {
      const mounts = await kernel.fs.listSharedMounts();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mounts));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/shared' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { name, ownerPid } = JSON.parse(body);
      if (!name || ownerPid === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and ownerPid are required' }));
        return;
      }
      const mount = await kernel.fs.createSharedMount(name, ownerPid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mount));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/shared/mount' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { pid, name, mountPoint } = JSON.parse(body);
      if (!name || pid === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and pid are required' }));
        return;
      }
      await kernel.fs.mountShared(pid, name, mountPoint);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (url.pathname === '/api/shared/unmount' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { pid, name } = JSON.parse(body);
      if (!name || pid === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'name and pid are required' }));
        return;
      }
      await kernel.fs.unmountShared(pid, name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- VNC Endpoints -----

  // Get VNC info for an agent
  if (url.pathname.match(/^\/api\/vnc\/\d+$/) && req.method === 'GET') {
    const pidStr = url.pathname.split('/').pop();
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PID' }));
      return;
    }
    const proxyInfo = kernel.vnc.getProxyInfo(pid);
    if (proxyInfo) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pid, wsPort: proxyInfo.wsPort, display: ':99' }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `No VNC proxy for PID ${pid}` }));
    }
    return;
  }

  // ----- GPU Endpoints -----

  // List GPUs and allocations
  if (url.pathname === '/api/gpu' && req.method === 'GET') {
    const gpus = kernel.containers.getGPUs();
    const allocations = kernel.containers.getAllGPUAllocations();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gpus, allocations, available: kernel.containers.isGPUAvailable() }));
    return;
  }

  // Get real-time GPU stats
  if (url.pathname === '/api/gpu/stats' && req.method === 'GET') {
    try {
      const stats = await kernel.containers.getGPUStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- LLM Provider Endpoints -----

  // List available LLM providers and models
  if (url.pathname === '/api/llm/providers' && req.method === 'GET') {
    try {
      const providers = listProviders();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(providers));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Feedback Endpoints (v0.3 Wave 2) -----

  // Submit feedback for an agent action
  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      const { pid, step, rating, comment, agent_uid } = JSON.parse(body);
      if (pid === undefined || step === undefined || rating === undefined) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'pid, step, and rating are required' }));
        return;
      }
      if (rating !== 1 && rating !== -1) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'rating must be 1 (thumbs up) or -1 (thumbs down)' }));
        return;
      }

      // Look up agent_uid from process if not provided
      let resolvedUid = agent_uid;
      if (!resolvedUid) {
        const proc = kernel.processes.get(pid);
        resolvedUid = proc?.info.uid || 'unknown';
      }

      const id = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const record = {
        id,
        pid: Number(pid),
        step: Number(step),
        rating: rating as number,
        comment: comment || null,
        agent_uid: resolvedUid,
        created_at: Date.now(),
      };

      kernel.state.insertFeedback(record);
      kernel.bus.emit('feedback.submitted', { feedback: record });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: record.id }));
    } catch (err: any) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Get feedback for a specific process
  if (url.pathname.match(/^\/api\/feedback\/\d+$/) && req.method === 'GET') {
    const pidStr = url.pathname.split('/').pop();
    const pid = parseInt(pidStr || '', 10);
    if (isNaN(pid)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid PID' }));
      return;
    }
    try {
      const feedback = kernel.state.getFeedbackByPid(pid);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(feedback));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ----- Agent Template Endpoints -----

  // List available agent templates
  if (url.pathname === '/api/templates' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(AGENT_TEMPLATES));
    return;
  }

  // ----- Raw File Serving Endpoint -----

  if (url.pathname === '/api/fs/raw' && req.method === 'GET') {
    const filePath = url.searchParams.get('path');

    if (!filePath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required "path" query parameter' }));
      return;
    }

    // Path traversal check
    const normalized = nodePath.posix.normalize(filePath);
    if (normalized.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: path traversal detected' }));
      return;
    }

    try {
      // Verify the file exists and get its size
      const stat = await kernel.fs.stat(filePath);

      if (stat.type === 'directory') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot serve a directory' }));
        return;
      }

      const fileSize = stat.size;
      const ext = nodePath.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      // Handle Range requests for audio/video seeking
      const rangeHeader = req.headers['range'];
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (!match) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`,
          });
          res.end();
          return;
        }

        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize || start > end) {
          res.writeHead(416, {
            'Content-Range': `bytes */${fileSize}`,
          });
          res.end();
          return;
        }

        const chunkSize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
          'Content-Disposition': 'inline',
        });

        const stream = kernel.fs.createReadStream(filePath, { start, end });
        stream.pipe(res);
        stream.on('error', () => {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Error reading file' }));
          } else {
            res.end();
          }
        });
        return;
      }

      // Full file response (streamed)
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Content-Disposition': 'inline',
        'Accept-Ranges': 'bytes',
      });

      const stream = kernel.fs.createReadStream(filePath);
      stream.pipe(res);
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Error reading file' }));
        } else {
          res.end();
        }
      });
      return;
    } catch (err: any) {
      if (err.code === 'ENOENT' || err.message?.includes('ENOENT')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'File not found' }));
        return;
      }
      if (err.message?.includes('Access denied')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }
  }

  // ----- File Upload Endpoint -----

  if (url.pathname === '/api/fs/upload' && req.method === 'POST') {
    const destPath = url.searchParams.get('path');
    if (!destPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required "path" query parameter' }));
      return;
    }

    // Path traversal check
    const normalized = nodePath.posix.normalize(destPath);
    if (normalized.includes('..')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Access denied: path traversal detected' }));
      return;
    }

    // Size limit: 50 MB
    const MAX_UPLOAD = 50 * 1024 * 1024;
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > MAX_UPLOAD) {
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File too large. Maximum 50 MB.' }));
      return;
    }

    try {
      const chunks: Buffer[] = [];
      let totalSize = 0;

      for await (const chunk of req) {
        totalSize += chunk.length;
        if (totalSize > MAX_UPLOAD) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'File too large. Maximum 50 MB.' }));
          return;
        }
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const content = Buffer.concat(chunks);
      await kernel.fs.writeFileBinary(destPath, content);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: destPath, size: content.length }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
};

// Create the primary server (HTTPS if TLS configured, otherwise HTTP)
const httpServer = TLS_ENABLED
  ? createHttpsServer(
      {
        cert: nodeFs.readFileSync(TLS_CERT_PATH!),
        key: nodeFs.readFileSync(TLS_KEY_PATH!),
      },
      requestHandler,
    )
  : createHttpServer(requestHandler);

// Optional: HTTP-to-HTTPS redirect server
if (TLS_ENABLED && TLS_REDIRECT) {
  const redirectServer = createHttpServer((req, res) => {
    const host = (req.headers.host || 'localhost').replace(/:.*/, '');
    const location = `https://${host}:${PORT}${req.url || '/'}`;
    res.writeHead(301, { Location: location });
    res.end();
  });
  redirectServer.listen(80, '0.0.0.0', () => {
    console.log('[TLS] HTTP->HTTPS redirect server listening on port 80');
  });
}

// ---------------------------------------------------------------------------
// WebSocket Server (UI clients)
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

/** Track connected UI clients with their authenticated user */
interface AuthenticatedClient {
  ws: WebSocket;
  user: UserInfo | null;
}

// ---------------------------------------------------------------------------
// WebSocket Event Batching
// ---------------------------------------------------------------------------

const BATCH_FLUSH_INTERVAL_MS = 50;
const BATCH_MAX_SIZE = 20;

interface EventBuffer {
  events: KernelEvent[];
  flushTimer: ReturnType<typeof setInterval>;
}

const eventBuffers = new Map<WebSocket, EventBuffer>();

/** Send a single event immediately (bypass batching). */
function sendEventImmediate(ws: WebSocket, event: KernelEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event), { compress: false });
  }
}

/** Add an event to a connection's buffer, flushing if full. */
function bufferEvent(ws: WebSocket, event: KernelEvent): void {
  const buf = eventBuffers.get(ws);
  if (!buf) {
    // No buffer (disconnected or not initialized) — send directly
    sendEventImmediate(ws, event);
    return;
  }
  buf.events.push(event);
  if (buf.events.length >= BATCH_MAX_SIZE) {
    flushBuffer(ws, buf);
  }
}

/** Flush all buffered events for a connection as a single JSON array frame. */
function flushBuffer(ws: WebSocket, buf: EventBuffer): void {
  if (buf.events.length === 0) return;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(buf.events), { compress: false });
  }
  buf.events = [];
}

/** Initialize the event buffer for a new connection. */
function initBuffer(ws: WebSocket): void {
  const buf: EventBuffer = {
    events: [],
    flushTimer: setInterval(() => {
      const b = eventBuffers.get(ws);
      if (b) flushBuffer(ws, b);
    }, BATCH_FLUSH_INTERVAL_MS),
  };
  eventBuffers.set(ws, buf);
}

/** Clean up the event buffer when a connection closes. */
function destroyBuffer(ws: WebSocket): void {
  const buf = eventBuffers.get(ws);
  if (buf) {
    clearInterval(buf.flushTimer);
    eventBuffers.delete(ws);
  }
}

const clients = new Map<WebSocket, AuthenticatedClient>();

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  // Authenticate via query param token
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');
  let user: UserInfo | null = null;

  if (token) {
    user = kernel.auth.validateToken(token);
  }

  clients.set(ws, { ws, user });
  initBuffer(ws);
  kernel.metrics.setWsConnections(clients.size);
  console.log(
    `[Server] Client connected (${clients.size} total)${user ? ` as ${user.username}` : ' (unauthenticated)'}`,
  );

  // Send kernel ready event (immediate — initial handshake)
  sendEventImmediate(ws, {
    type: 'kernel.ready',
    version: AETHER_VERSION,
    uptime: kernel.getUptime(),
  } as KernelEvent);

  // Send current process list (filtered by user) — immediate for initial state
  const isAdmin = !user || user.role === 'admin';
  const processes = kernel.processes
    .getActiveByOwner(user?.id, isAdmin)
    .map((p) => ({ ...p.info }));
  sendEventImmediate(ws, {
    type: 'process.list',
    processes,
  } as KernelEvent);

  // Handle incoming commands
  ws.on('message', async (raw: Buffer) => {
    let cmd: KernelCommand;
    try {
      cmd = JSON.parse(raw.toString());
    } catch {
      sendEventImmediate(ws, {
        type: 'response.error',
        id: 'parse_error',
        error: 'Invalid JSON',
      } as KernelEvent);
      return;
    }

    // Allow auth commands without authentication
    const isAuthCmd =
      cmd.type === 'auth.login' || cmd.type === 'auth.register' || cmd.type === 'auth.validate';

    // Get the latest user info for this client
    const clientInfo = clients.get(ws);
    const currentUser = clientInfo?.user || null;

    // For non-auth commands, require authentication
    if (!isAuthCmd && !currentUser) {
      sendEventImmediate(ws, {
        type: 'response.error',
        id: (cmd as any).id || 'auth_required',
        error: 'Authentication required',
      } as KernelEvent);
      return;
    }

    // Process the command through the kernel
    // Response events (response.ok / response.error) are sent immediately for
    // low-latency command correlation; other events are batched.
    const events = await kernel.handleCommand(cmd, currentUser || undefined);
    for (const event of events) {
      if (event.type === 'response.ok' || event.type === 'response.error') {
        sendEventImmediate(ws, event);
      } else {
        bufferEvent(ws, event);
      }
    }

    // If auth.login or auth.register succeeded, update the client's user
    if ((cmd.type === 'auth.login' || cmd.type === 'auth.register') && clientInfo) {
      const okEvent = events.find((e) => e.type === 'response.ok') as any;
      if (okEvent?.data?.token) {
        clientInfo.user = kernel.auth.validateToken(okEvent.data.token);
      }
    }

    // If a process was spawned, start the agent loop
    if (cmd.type === 'process.spawn') {
      const okEvent = events.find((e) => e.type === 'response.ok') as any;
      if (okEvent?.data?.pid) {
        const proc = kernel.processes.get(okEvent.data.pid);
        if (proc?.agentConfig) {
          const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
          runAgentLoop(kernel, okEvent.data.pid, proc.agentConfig, {
            apiKey,
            signal: proc.abortController.signal,
          }).catch((err) => {
            console.error(`[Server] Agent loop error for PID ${okEvent.data.pid}:`, err);
            kernel.processes.setState(okEvent.data.pid, 'stopped', 'failed');
          });
        }
      }
    }
  });

  ws.on('close', (code, reason) => {
    destroyBuffer(ws);
    clients.delete(ws);
    kernel.metrics.setWsConnections(clients.size);
    console.log(
      `[Server] Client disconnected (${clients.size} total) code=${code} reason=${reason?.toString() || ''}`,
    );
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
    destroyBuffer(ws);
    clients.delete(ws);
    kernel.metrics.setWsConnections(clients.size);
  });
});

// ---------------------------------------------------------------------------
// Cluster WebSocket Server (node connections)
// ---------------------------------------------------------------------------

const clusterWss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

clusterWss.on('connection', (ws: WebSocket) => {
  console.log('[Cluster] Node connected');

  let nodeId: string | null = null;

  ws.on('message', (raw: Buffer) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'cluster.register':
          nodeId = msg.node?.id;
          kernel.cluster.registerNode(ws, msg.node);
          break;

        case 'cluster.heartbeat':
          if (msg.nodeId) {
            kernel.cluster.handleNodeHeartbeat(msg.nodeId, {
              load: msg.load || 0,
              capacity: msg.capacity || 16,
              gpuAvailable: msg.gpuAvailable,
              dockerAvailable: msg.dockerAvailable,
            });
          }
          break;

        case 'cluster.response':
          // Response from a node for a forwarded command
          if (msg.nodeId && msg.cmdId && msg.events) {
            kernel.cluster.handleNodeResponse(msg.nodeId, msg.cmdId, msg.events);
          }
          break;
      }
    } catch (err) {
      console.error('[Cluster] Error handling node message:', err);
    }
  });

  ws.on('close', () => {
    if (nodeId) {
      kernel.cluster.unregisterNode(nodeId);
    }
    console.log('[Cluster] Node disconnected');
  });

  ws.on('error', (err) => {
    console.error('[Cluster] Node WebSocket error:', err.message);
    if (nodeId) {
      kernel.cluster.unregisterNode(nodeId);
    }
  });
});

// ---------------------------------------------------------------------------
// Kernel Event Broadcasting
// ---------------------------------------------------------------------------

/**
 * Forward kernel bus events to all connected WebSocket clients.
 * This is the bridge between the kernel's internal event system
 * and the UI.
 */
const BROADCAST_EVENTS = [
  'process.spawned',
  'process.stateChange',
  'process.exit',
  'process.reaped',
  'agent.thought',
  'agent.action',
  'agent.observation',
  'agent.phaseChange',
  'agent.progress',
  'agent.file_created',
  'agent.browsing',
  'agent.injectionBlocked',
  'ipc.message',
  'ipc.delivered',
  'container.created',
  'container.started',
  'container.stopped',
  'container.removed',
  'fs.changed',
  'tty.output',
  'tty.opened',
  'tty.closed',
  'plugin.loaded',
  'plugin.error',
  'snapshot.created',
  'snapshot.restored',
  'snapshot.deleted',
  'fs.sharedCreated',
  'fs.sharedMounted',
  'fs.sharedUnmounted',
  'vnc.started',
  'vnc.stopped',
  'gpu.allocated',
  'gpu.released',
  'kernel.metrics',
  // Cluster events
  'cluster.nodeJoined',
  'cluster.nodeLeft',
  'cluster.nodeOffline',
  // Auth events
  'user.created',
  'user.deleted',
  // Integration events
  'integration.registered',
  'integration.unregistered',
  'integration.enabled',
  'integration.disabled',
  'integration.tested',
  'integration.action_result',
  'integration.error',
  // Plugin registry events
  'plugin.registry.installed',
  'plugin.registry.uninstalled',
  'plugin.registry.enabled',
  'plugin.registry.disabled',
  'plugin.registry.rated',
  // Template marketplace events
  'template.published',
  'template.unpublished',
  'template.rated',
  'template.forked',
  // Organization events (v0.5 RBAC)
  'org.created',
  'org.deleted',
  'org.updated',
  'org.member.invited',
  'org.member.removed',
  'org.member.updated',
  'org.team.created',
  'org.team.deleted',
];

for (const eventType of BROADCAST_EVENTS) {
  kernel.bus.on(eventType, (data: any) => {
    broadcast({ type: eventType, ...data } as KernelEvent);
  });
}

const broadcastSeenIds = new Set<string>();
const BROADCAST_DEDUP_MAX = 500;

// Clear stale broadcast dedup entries every 60 seconds
setInterval(() => {
  broadcastSeenIds.clear();
}, 60_000);

function broadcast(event: KernelEvent): void {
  // Dedup: skip if we've already broadcast this event ID
  const eventId = (event as any).__eventId;
  if (eventId) {
    if (broadcastSeenIds.has(eventId)) return;
    broadcastSeenIds.add(eventId);
    if (broadcastSeenIds.size > BROADCAST_DEDUP_MAX) {
      const first = broadcastSeenIds.values().next().value;
      if (first !== undefined) broadcastSeenIds.delete(first);
    }
  }

  // Strip internal __eventId before sending to clients
  const clean = { ...event } as KernelEvent;
  delete (clean as any).__eventId;

  for (const [, client] of clients) {
    bufferEvent(client.ws, clean);
  }
}

// ---------------------------------------------------------------------------
// Metrics Reporter
// ---------------------------------------------------------------------------

setInterval(() => {
  const counts = kernel.processes.getCounts();
  const containerCount = kernel.containers.getAll().length;
  const memoryMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
  const processCount = counts.running + counts.sleeping + counts.created;

  // Update cluster local load
  kernel.cluster.updateLocalLoad(processCount);

  broadcast({
    type: 'kernel.metrics',
    processCount,
    cpuPercent: 0,
    memoryMB,
    containerCount,
  } as KernelEvent);

  // Persist metrics to StateStore
  try {
    kernel.state.recordMetric({
      timestamp: Date.now(),
      processCount,
      cpuPercent: 0,
      memoryMB,
      containerCount,
    });
  } catch {
    /* ignore metric persistence errors */
  }
}, 5000);

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal: string) {
  console.log(`\n[Server] ${signal} received, shutting down...`);

  // Flush and clean up all event buffers, then close connections
  for (const [, client] of clients) {
    destroyBuffer(client.ws);
    client.ws.close(1001, 'Server shutting down');
  }
  wss.close();
  clusterWss.close();

  // Shutdown the kernel
  await kernel.shutdown();

  httpServer.close(() => {
    console.log('[Server] HTTP server closed');
    process.exit(0);
  });

  // Force exit after 5 seconds
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

// Route WebSocket upgrades manually to avoid dual-WSS frame corruption (ws v8 bug)
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '/', `http://localhost:${PORT}`).pathname;

  if (pathname === DEFAULT_WS_PATH) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (pathname === '/cluster') {
    clusterWss.handleUpgrade(request, socket, head, (ws) => {
      clusterWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const clusterRole = kernel.cluster.getRole();
  const httpProto = TLS_ENABLED ? 'HTTPS' : 'HTTP';
  const wsProto = TLS_ENABLED ? 'WSS' : 'WS';
  const httpUrl = `${httpProto.toLowerCase()}://0.0.0.0:${PORT}`;
  const wsUrl = `${wsProto.toLowerCase()}://0.0.0.0:${PORT}`;
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Aether OS Kernel Server       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Version:    ${AETHER_VERSION.padEnd(24)}║`);
  console.log(`  ║  ${httpProto.padEnd(11)}  ${httpUrl.padEnd(24)}║`);
  console.log(`  ║  ${wsProto.padEnd(11)}  ${wsUrl.padEnd(24)}║`);
  console.log(`  ║  Path:       ${DEFAULT_WS_PATH.padEnd(24)}║`);
  console.log(
    `  ║  Docker:     ${(kernel.containers.isDockerAvailable() ? 'Available' : 'Unavailable').padEnd(24)}║`,
  );
  console.log(
    `  ║  GPU:        ${(kernel.containers.isGPUAvailable() ? `${kernel.containers.getGPUs().length} GPU(s)` : 'Not available').padEnd(24)}║`,
  );
  console.log(`  ║  SQLite:     ${'Enabled'.padEnd(24)}║`);
  console.log(`  ║  Auth:       ${'Enabled'.padEnd(24)}║`);
  console.log(`  ║  TLS:        ${(TLS_ENABLED ? 'Enabled' : 'Disabled').padEnd(24)}║`);
  console.log(`  ║  Cluster:    ${clusterRole.padEnd(24)}║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
