/**
 * Aether OS - Server
 *
 * The server layer sits between the kernel and the outside world.
 * It provides:
 * - WebSocket server for real-time kernel communication
 * - HTTP endpoints for initial state loading and health checks
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
    }));
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
  'fs.changed',
  'tty.output',
  'tty.opened',
  'tty.closed',
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
  broadcast({
    type: 'kernel.metrics',
    processCount: counts.running + counts.sleeping + counts.created,
    cpuPercent: 0,
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  } as KernelEvent);
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
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
