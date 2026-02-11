/**
 * Aether Kernel - VNC Manager
 *
 * Manages noVNC WebSocket-to-TCP proxies for graphical agent containers.
 * Each graphical agent runs Xvfb + x11vnc inside its container. This manager
 * creates a WebSocket proxy on the host that bridges the browser (noVNC client)
 * to the container's VNC TCP port.
 *
 * Data flow: Browser (noVNC/RFB over WS) → VNCManager proxy → TCP → x11vnc in container
 */

import { createServer, Server as NetServer, Socket } from 'node:net';
import { EventBus } from './EventBus.js';
import { PID } from '@aether/shared';
import type { ContainerManager } from './ContainerManager.js';

interface ProxyInfo {
  pid: PID;
  vncPort: number; // Target TCP port (container's VNC)
  wsPort: number; // WebSocket proxy port for browser
  server: NetServer;
  connections: Set<Socket>;
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
   * The proxy listens on a free port and forwards data bidirectionally
   * between incoming TCP connections and the VNC server in the container.
   *
   * Note: noVNC can connect to a raw TCP socket via websockify protocol,
   * but for simplicity we create a TCP proxy here. The actual WebSocket
   * upgrade is handled by noVNC's built-in websockify or the server layer.
   */
  async startProxy(pid: PID, vncPort: number): Promise<{ wsPort: number }> {
    if (this.proxies.has(pid)) {
      const existing = this.proxies.get(pid)!;
      return { wsPort: existing.wsPort };
    }

    const wsPort = this.nextWsPort++;
    const connections = new Set<Socket>();

    const server = createServer((clientSocket: Socket) => {
      connections.add(clientSocket);

      // Connect to the VNC server in the container
      const vncSocket = new Socket();
      vncSocket.connect(vncPort, '127.0.0.1');

      // Pipe data bidirectionally
      clientSocket.pipe(vncSocket);
      vncSocket.pipe(clientSocket);

      const cleanup = () => {
        connections.delete(clientSocket);
        clientSocket.destroy();
        vncSocket.destroy();
      };

      clientSocket.on('error', cleanup);
      clientSocket.on('close', cleanup);
      vncSocket.on('error', () => {
        // VNC server disconnected — attempt reconnect after delay
        setTimeout(() => {
          if (!clientSocket.destroyed) {
            const retry = new Socket();
            retry.connect(vncPort, '127.0.0.1');
            clientSocket.pipe(retry);
            retry.pipe(clientSocket);
            retry.on('error', cleanup);
          }
        }, 1000);
      });
      vncSocket.on('close', cleanup);
    });

    return new Promise((resolve, reject) => {
      server.listen(wsPort, '0.0.0.0', () => {
        const proxyInfo: ProxyInfo = {
          pid,
          vncPort,
          wsPort,
          server,
          connections,
        };

        this.proxies.set(pid, proxyInfo);

        this.bus.emit('vnc.started', {
          pid,
          wsPort,
          display: ':99',
        });

        console.log(
          `[VNCManager] Proxy started for PID ${pid}: ws://0.0.0.0:${wsPort} → tcp://127.0.0.1:${vncPort}`,
        );
        resolve({ wsPort });
      });

      server.on('error', (err: Error) => {
        console.error(`[VNCManager] Failed to start proxy for PID ${pid}:`, err.message);
        // Try next port
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

    // Close all active connections
    for (const conn of proxy.connections) {
      conn.destroy();
    }
    proxy.connections.clear();

    // Close the server
    proxy.server.close();

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
