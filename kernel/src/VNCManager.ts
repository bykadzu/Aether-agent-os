/**
 * Aether Kernel - VNC Manager
 *
 * Manages WebSocket-to-TCP proxies (websockify) for graphical agent containers.
 * Each graphical agent runs Xvfb + x11vnc inside its container. This manager
 * creates a WebSocket server on the host that bridges the browser (noVNC client)
 * to the container's VNC TCP port.
 *
 * Data flow: Browser (noVNC/RFB over WS) → VNCManager WebSocket proxy → TCP → x11vnc in container
 */

import { Socket } from 'node:net';
import { createServer as createHttpServer, IncomingMessage, Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventBus } from './EventBus.js';
import { PID } from '@aether/shared';
import type { ContainerManager } from './ContainerManager.js';

interface ProxyInfo {
  pid: PID;
  vncPort: number; // Target TCP port (container's VNC)
  wsPort: number; // WebSocket proxy port for browser
  httpServer: HttpServer;
  wss: WebSocketServer;
  connections: Set<WebSocket>;
}

export class VNCManager {
  private proxies = new Map<PID, ProxyInfo>();
  private bus: EventBus;
  private nextWsPort = 6080;
  private containerManager: ContainerManager | null = null;

  constructor(bus: EventBus, containerManager?: ContainerManager) {
    this.bus = bus;
    this.containerManager = containerManager ?? null;
  }

  /**
   * Set or replace the ContainerManager reference.
   */
  setContainerManager(cm: ContainerManager): void {
    this.containerManager = cm;
  }

  /**
   * Start a WebSocket-to-TCP proxy for a graphical agent's VNC stream.
   * The proxy listens on a free port and bridges WebSocket connections (from noVNC)
   * to the VNC TCP server running inside the container.
   */
  async startProxy(pid: PID, vncPort: number): Promise<{ wsPort: number }> {
    if (this.proxies.has(pid)) {
      const existing = this.proxies.get(pid)!;
      return { wsPort: existing.wsPort };
    }

    const wsPort = this.nextWsPort++;
    const connections = new Set<WebSocket>();

    // Create HTTP server for WebSocket upgrade
    const httpServer = createHttpServer((_req, res) => {
      res.writeHead(426, { 'Content-Type': 'text/plain' });
      res.end('WebSocket connection required');
    });

    // Create WebSocket server attached to the HTTP server
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
      connections.add(ws);

      let retryCount = 0;
      const MAX_RETRIES = 8;
      let activeSocket: Socket | null = null;
      let receivedData = false;

      const cleanup = () => {
        connections.delete(ws);
        if (activeSocket && !activeSocket.destroyed) activeSocket.destroy();
        activeSocket = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      };

      const connectVNC = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        const vncSocket = new Socket();
        activeSocket = vncSocket;
        receivedData = false;

        vncSocket.connect(vncPort, '127.0.0.1');

        // Forward WebSocket messages (binary) to VNC TCP
        ws.removeAllListeners('message');
        ws.on('message', (data: Buffer) => {
          if (vncSocket.writable) {
            vncSocket.write(data);
          }
        });

        // Forward VNC TCP data to WebSocket
        vncSocket.on('data', (data: Buffer) => {
          receivedData = true;
          retryCount = 0; // Reset retries once we get real data
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        // On TCP close, retry if we haven't received data (x11vnc not ready yet)
        vncSocket.on('close', () => {
          if (!receivedData && retryCount < MAX_RETRIES && ws.readyState === WebSocket.OPEN) {
            retryCount++;
            const delay = Math.min(500 * retryCount, 3000);
            console.log(
              `[VNCManager] VNC TCP closed before data (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${delay}ms...`,
            );
            setTimeout(connectVNC, delay);
          } else if (receivedData && retryCount < MAX_RETRIES && ws.readyState === WebSocket.OPEN) {
            // Was connected and lost connection — try once more
            retryCount++;
            console.log(`[VNCManager] VNC TCP dropped, reconnecting (attempt ${retryCount})...`);
            setTimeout(connectVNC, 1000);
          } else {
            cleanup();
          }
        });

        vncSocket.on('error', (err: Error) => {
          if (retryCount < MAX_RETRIES && ws.readyState === WebSocket.OPEN) {
            retryCount++;
            const delay = Math.min(500 * retryCount, 3000);
            console.log(
              `[VNCManager] VNC TCP error: ${err.message} (attempt ${retryCount}/${MAX_RETRIES}), retrying in ${delay}ms...`,
            );
            if (!vncSocket.destroyed) vncSocket.destroy();
            setTimeout(connectVNC, delay);
          } else {
            cleanup();
          }
        });
      };

      ws.on('close', cleanup);
      ws.on('error', cleanup);

      // Start first connection attempt
      connectVNC();
    });

    return new Promise((resolve, reject) => {
      httpServer.listen(wsPort, '0.0.0.0', () => {
        const proxyInfo: ProxyInfo = {
          pid,
          vncPort,
          wsPort,
          httpServer,
          wss,
          connections,
        };

        this.proxies.set(pid, proxyInfo);

        this.bus.emit('vnc.started', {
          pid,
          wsPort,
          display: ':99',
        });

        console.log(
          `[VNCManager] WebSocket proxy started for PID ${pid}: ws://0.0.0.0:${wsPort} → tcp://127.0.0.1:${vncPort}`,
        );
        resolve({ wsPort });
      });

      httpServer.on('error', (err: Error) => {
        console.error(`[VNCManager] Failed to start proxy for PID ${pid}:`, err.message);
        // Try next port on EADDRINUSE
        this.nextWsPort++;
        reject(err);
      });
    });
  }

  /**
   * Stop and tear down the VNC proxy for a process.
   */
  stopProxy(pid: PID): void {
    const proxy = this.proxies.get(pid);
    if (!proxy) return;

    // Close all active WebSocket connections
    for (const ws of proxy.connections) {
      try {
        ws.close();
      } catch {}
    }
    proxy.connections.clear();

    // Close the WebSocket server and HTTP server
    proxy.wss.close();
    proxy.httpServer.close();

    this.proxies.delete(pid);

    this.bus.emit('vnc.stopped', { pid });

    console.log(`[VNCManager] Proxy stopped for PID ${pid}`);
  }

  /**
   * Get proxy info for a process.
   */
  getProxyInfo(pid: PID): { wsPort: number } | null {
    const proxy = this.proxies.get(pid);
    if (!proxy) return null;
    return { wsPort: proxy.wsPort };
  }

  /**
   * Resize the virtual display for a graphical container via xrandr.
   * Requires a ContainerManager reference to exec inside the container.
   */
  async resizeDisplay(pid: PID, width: number, height: number): Promise<void> {
    if (!this.containerManager) {
      console.warn('[VNCManager] Cannot resize display: no ContainerManager set');
      return;
    }

    try {
      const modeName = `${width}x${height}`;
      await this.containerManager.execGraphical(
        pid,
        `xrandr --output default --mode ${modeName} 2>/dev/null || ` +
          `(xrandr --newmode "${modeName}" 0 ${width} 0 0 0 ${height} 0 0 0 2>/dev/null; ` +
          `xrandr --addmode default "${modeName}" 2>/dev/null; ` +
          `xrandr --output default --mode "${modeName}" 2>/dev/null) || true`,
      );
      console.log(`[VNCManager] Display resized to ${modeName} for PID ${pid}`);
    } catch (err: any) {
      console.warn(`[VNCManager] Failed to resize display for PID ${pid}: ${err.message}`);
    }
  }

  /**
   * Shutdown all proxies.
   */
  async shutdown(): Promise<void> {
    for (const pid of Array.from(this.proxies.keys())) {
      this.stopProxy(pid);
    }
  }
}
