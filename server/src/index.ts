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

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import * as nodePath from 'node:path';
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
} from '@aether/shared';

const PORT = parseInt(process.env.AETHER_PORT || String(DEFAULT_PORT), 10);

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
  fsRoot: process.env.AETHER_FS_ROOT || '/tmp/aether',
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

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
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
    res.end(JSON.stringify({
      status: 'ok',
      version: AETHER_VERSION,
      uptime: kernel.getUptime(),
      processes: kernel.processes.getCounts(),
      docker: kernel.containers.isDockerAvailable(),
      containers: kernel.containers.getAll().length,
      gpu: kernel.containers.isGPUAvailable(),
      gpuCount: kernel.containers.getGPUs().length,
    }));
    return;
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
        res.end(JSON.stringify({ token: result.token, user: result.user }));
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

  // ----- Auth Middleware for all other routes -----
  const user = authenticateRequest(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required. Provide a Bearer token or aether_token cookie.' }));
    return;
  }

  // ----- Protected Endpoints -----

  // Process list (REST fallback)
  if (url.pathname === '/api/processes') {
    const isAdmin = user.role === 'admin';
    const processes = kernel.processes.getActiveByOwner(user.id, isAdmin).map(p => ({ ...p.info }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(processes));
    return;
  }

  // Kernel info
  if (url.pathname === '/api/kernel') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      version: AETHER_VERSION,
      uptime: kernel.getUptime(),
      processes: kernel.processes.getCounts(),
      docker: kernel.containers.isDockerAvailable(),
      containers: kernel.containers.getAll().length,
    }));
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
      const files = owner
        ? kernel.state.getFilesByOwner(owner)
        : kernel.state.getAllFiles();
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
      const metrics = since > 0
        ? kernel.state.getMetrics(since)
        : kernel.state.getLatestMetrics(limit);
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
  if (url.pathname.match(/^\/api\/snapshots\/\d+$/) && (req.method === 'GET' || req.method === 'POST')) {
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

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// WebSocket Server (UI clients)
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  server: httpServer,
  path: DEFAULT_WS_PATH,
});

/** Track connected UI clients with their authenticated user */
interface AuthenticatedClient {
  ws: WebSocket;
  user: UserInfo | null;
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
  console.log(`[Server] Client connected (${clients.size} total)${user ? ` as ${user.username}` : ' (unauthenticated)'}`);

  // Send kernel ready event
  sendEvent(ws, {
    type: 'kernel.ready',
    version: AETHER_VERSION,
    uptime: kernel.getUptime(),
  });

  // Send current process list (filtered by user)
  const isAdmin = !user || user.role === 'admin';
  const processes = kernel.processes.getActiveByOwner(user?.id, isAdmin).map(p => ({ ...p.info }));
  sendEvent(ws, {
    type: 'process.list',
    processes,
  });

  // Handle incoming commands
  ws.on('message', async (raw: Buffer) => {
    let cmd: KernelCommand;
    try {
      cmd = JSON.parse(raw.toString());
    } catch {
      sendEvent(ws, {
        type: 'response.error',
        id: 'parse_error',
        error: 'Invalid JSON',
      });
      return;
    }

    // Allow auth commands without authentication
    const isAuthCmd = cmd.type === 'auth.login' || cmd.type === 'auth.register' || cmd.type === 'auth.validate';

    // Get the latest user info for this client
    const clientInfo = clients.get(ws);
    const currentUser = clientInfo?.user || null;

    // For non-auth commands, require authentication
    if (!isAuthCmd && !currentUser) {
      sendEvent(ws, {
        type: 'response.error',
        id: (cmd as any).id || 'auth_required',
        error: 'Authentication required',
      });
      return;
    }

    // Process the command through the kernel
    const events = await kernel.handleCommand(cmd, currentUser || undefined);
    for (const event of events) {
      sendEvent(ws, event);
    }

    // If auth.login or auth.register succeeded, update the client's user
    if ((cmd.type === 'auth.login' || cmd.type === 'auth.register') && clientInfo) {
      const okEvent = events.find(e => e.type === 'response.ok') as any;
      if (okEvent?.data?.token) {
        clientInfo.user = kernel.auth.validateToken(okEvent.data.token);
      }
    }

    // If a process was spawned, start the agent loop
    if (cmd.type === 'process.spawn') {
      const okEvent = events.find(e => e.type === 'response.ok') as any;
      if (okEvent?.data?.pid) {
        const proc = kernel.processes.get(okEvent.data.pid);
        if (proc?.agentConfig) {
          const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
          runAgentLoop(kernel, okEvent.data.pid, proc.agentConfig, {
            apiKey,
            signal: proc.abortController.signal,
          }).catch(err => {
            console.error(`[Server] Agent loop error for PID ${okEvent.data.pid}:`, err);
          });
        }
      }
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[Server] Client disconnected (${clients.size} total)`);
  });

  ws.on('error', (err) => {
    console.error('[Server] WebSocket error:', err.message);
    clients.delete(ws);
  });
});

// ---------------------------------------------------------------------------
// Cluster WebSocket Server (node connections)
// ---------------------------------------------------------------------------

const clusterWss = new WebSocketServer({
  server: httpServer,
  path: '/cluster',
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
];

for (const eventType of BROADCAST_EVENTS) {
  kernel.bus.on(eventType, (data: any) => {
    broadcast({ type: eventType, ...data } as KernelEvent);
  });
}

function sendEvent(ws: WebSocket, event: KernelEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function broadcast(event: KernelEvent): void {
  const msg = JSON.stringify(event);
  for (const [, client] of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
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
  } catch { /* ignore metric persistence errors */ }
}, 5000);

// ---------------------------------------------------------------------------
// Graceful Shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal: string) {
  console.log(`\n[Server] ${signal} received, shutting down...`);

  // Close all WebSocket connections
  for (const [, client] of clients) {
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

httpServer.listen(PORT, '0.0.0.0', () => {
  const clusterRole = kernel.cluster.getRole();
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Aether OS Kernel Server       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Version:    ${AETHER_VERSION.padEnd(24)}║`);
  console.log(`  ║  HTTP:       http://0.0.0.0:${String(PORT).padEnd(10)}║`);
  console.log(`  ║  WebSocket:  ws://0.0.0.0:${String(PORT).padEnd(11)}║`);
  console.log(`  ║  Path:       ${DEFAULT_WS_PATH.padEnd(24)}║`);
  console.log(`  ║  Docker:     ${(kernel.containers.isDockerAvailable() ? 'Available' : 'Unavailable').padEnd(24)}║`);
  console.log(`  ║  GPU:        ${(kernel.containers.isGPUAvailable() ? `${kernel.containers.getGPUs().length} GPU(s)` : 'Not available').padEnd(24)}║`);
  console.log(`  ║  SQLite:     ${'Enabled'.padEnd(24)}║`);
  console.log(`  ║  Auth:       ${'Enabled'.padEnd(24)}║`);
  console.log(`  ║  Cluster:    ${clusterRole.padEnd(24)}║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
