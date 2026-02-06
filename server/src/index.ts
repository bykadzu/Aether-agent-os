/**
 * Aether OS - Server
 *
 * The server layer sits between the kernel and the outside world.
 * It provides:
 * - WebSocket server for real-time kernel communication
 * - HTTP endpoints for initial state loading, health checks, and history queries
 * - CORS support for the Vite dev server
 *
 * This is intentionally minimal. The kernel does the real work.
 * The server just handles transport.
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { Kernel } from '@aether/kernel';
import { runAgentLoop } from '@aether/runtime';
import {
  KernelCommand,
  KernelEvent,
  DEFAULT_PORT,
  DEFAULT_WS_PATH,
  AETHER_VERSION,
} from '@aether/shared';

const PORT = parseInt(process.env.AETHER_PORT || String(DEFAULT_PORT), 10);

// ---------------------------------------------------------------------------
// Boot the kernel
// ---------------------------------------------------------------------------

const kernel = new Kernel({
  fsRoot: process.env.AETHER_FS_ROOT || '/tmp/aether',
});

await kernel.boot();

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for Vite dev server
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

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
    }));
    return;
  }

  // Process list (REST fallback)
  if (url.pathname === '/api/processes') {
    const processes = kernel.processes.getActive().map(p => ({ ...p.info }));
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

    // Read request body
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

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
      // Reload plugins for this agent
      await kernel.plugins.loadPluginsForAgent(pid, proc.info.uid);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pluginDir }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ---------------------------------------------------------------------------
// WebSocket Server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({
  server: httpServer,
  path: DEFAULT_WS_PATH,
});

/** Track connected clients */
const clients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  clients.add(ws);
  console.log(`[Server] Client connected (${clients.size} total)`);

  // Send kernel ready event
  sendEvent(ws, {
    type: 'kernel.ready',
    version: AETHER_VERSION,
    uptime: kernel.getUptime(),
  });

  // Send current process list
  const processes = kernel.processes.getActive().map(p => ({ ...p.info }));
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

    // Process the command through the kernel
    const events = await kernel.handleCommand(cmd);
    for (const event of events) {
      sendEvent(ws, event);
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
  'kernel.metrics',
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
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
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
  for (const client of clients) {
    client.close(1001, 'Server shutting down');
  }
  wss.close();

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
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         Aether OS Kernel Server       ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Version:    ${AETHER_VERSION.padEnd(24)}║`);
  console.log(`  ║  HTTP:       http://0.0.0.0:${String(PORT).padEnd(10)}║`);
  console.log(`  ║  WebSocket:  ws://0.0.0.0:${String(PORT).padEnd(11)}║`);
  console.log(`  ║  Path:       ${DEFAULT_WS_PATH.padEnd(24)}║`);
  console.log(`  ║  Docker:     ${(kernel.containers.isDockerAvailable() ? 'Available' : 'Unavailable').padEnd(24)}║`);
  console.log(`  ║  SQLite:     ${'Enabled'.padEnd(24)}║`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
