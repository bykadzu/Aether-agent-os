/**
 * Aether Kernel - Remote Access Manager (v0.4)
 *
 * Manages secure remote access to Aether OS instances:
 * - SSH tunnel management (local/remote/dynamic port forwarding)
 * - Tailscale mesh VPN integration
 * - Authorized SSH key management
 *
 * Follows the subsystem pattern: constructor(bus, state), init/shutdown lifecycle.
 * Uses child_process.spawn for SSH tunnels and shells out to the `tailscale` CLI.
 * Gracefully detects when SSH or Tailscale are not installed.
 */

import * as crypto from 'node:crypto';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SSHTunnelConfig {
  name: string;
  type: 'local' | 'remote' | 'dynamic';
  host: string;
  port: number;
  localPort?: number;
  remoteHost?: string;
  remotePort?: number;
  username?: string;
  privateKeyPath?: string;
  autoReconnect?: boolean;
  maxRetries?: number;
}

export interface SSHTunnel {
  id: string;
  config: SSHTunnelConfig;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  pid?: number;
  createdAt: number;
  lastConnected?: number;
  error?: string;
  retryCount: number;
}

export interface TailscaleConfig {
  authKey?: string;
  hostname?: string;
  acceptRoutes?: boolean;
  exitNode?: string;
  advertiseExitNode?: boolean;
  tags?: string[];
}

export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  ipv4?: string;
  ipv6?: string;
  hostname?: string;
  tailnet?: string;
  online?: boolean;
}

export interface TailscaleDevice {
  id: string;
  hostname: string;
  ipv4: string;
  ipv6: string;
  os: string;
  online: boolean;
  lastSeen: string;
}

export interface ServeOptions {
  funnel?: boolean;
  protocol?: 'http' | 'https' | 'tcp' | 'tls-terminated-tcp';
}

export interface AuthorizedKey {
  id: string;
  key: string;
  label: string;
  fingerprint: string;
  addedAt: number;
}

// ---------------------------------------------------------------------------
// RemoteAccessManager
// ---------------------------------------------------------------------------

export class RemoteAccessManager {
  private bus: EventBus;
  private state: StateStore;
  private tunnels = new Map<string, SSHTunnel>();
  private tunnelProcesses = new Map<string, ChildProcess>();
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private sshAvailable = false;
  private tailscaleAvailable = false;
  private authorizedKeys = new Map<string, AuthorizedKey>();

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    // Detect SSH
    try {
      execSync('which ssh', { stdio: 'ignore', timeout: 5000 });
      this.sshAvailable = true;
    } catch {
      this.sshAvailable = false;
      console.log('[RemoteAccess] SSH not available on this system');
    }

    // Detect Tailscale
    try {
      execSync('which tailscale', { stdio: 'ignore', timeout: 5000 });
      this.tailscaleAvailable = true;
    } catch {
      this.tailscaleAvailable = false;
      console.log('[RemoteAccess] Tailscale not installed');
    }

    // Restore persisted tunnels and keys from StateStore
    this.loadFromStore();

    // Start health monitoring for active tunnels
    this.startHealthCheck();
  }

  async shutdown(): Promise<void> {
    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Clear all reconnect timers
    for (const [, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Kill all tunnel processes
    for (const [tunnelId, proc] of this.tunnelProcesses) {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      const tunnel = this.tunnels.get(tunnelId);
      if (tunnel) {
        tunnel.status = 'disconnected';
      }
    }
    this.tunnelProcesses.clear();

    // Persist state
    this.saveToStore();
  }

  // -------------------------------------------------------------------------
  // SSH Tunnel Management
  // -------------------------------------------------------------------------

  /**
   * Create a new SSH tunnel.
   */
  createTunnel(config: SSHTunnelConfig): SSHTunnel {
    if (!this.sshAvailable) {
      throw new Error('SSH is not available on this system');
    }

    const id = crypto.randomUUID();
    const tunnel: SSHTunnel = {
      id,
      config,
      status: 'connecting',
      createdAt: Date.now(),
      retryCount: 0,
    };

    this.tunnels.set(id, tunnel);
    this.saveToStore();

    // Start the SSH process
    this.startTunnelProcess(tunnel);

    this.bus.emit('remote.tunnel.created', {
      tunnelId: id,
      name: config.name,
      type: config.type,
      host: config.host,
    });

    return { ...tunnel };
  }

  /**
   * Destroy an existing SSH tunnel.
   */
  destroyTunnel(tunnelId: string): boolean {
    const tunnel = this.tunnels.get(tunnelId);
    if (!tunnel) return false;

    // Cancel any pending reconnect
    const timer = this.reconnectTimers.get(tunnelId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(tunnelId);
    }

    // Kill the SSH process
    const proc = this.tunnelProcesses.get(tunnelId);
    if (proc) {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      this.tunnelProcesses.delete(tunnelId);
    }

    this.tunnels.delete(tunnelId);
    this.saveToStore();

    this.bus.emit('remote.tunnel.destroyed', {
      tunnelId,
      name: tunnel.config.name,
    });

    return true;
  }

  /**
   * List all tunnels with their current status.
   */
  listTunnels(): SSHTunnel[] {
    return Array.from(this.tunnels.values()).map((t) => ({ ...t }));
  }

  /**
   * Get a specific tunnel by ID.
   */
  getTunnel(tunnelId: string): SSHTunnel | null {
    const tunnel = this.tunnels.get(tunnelId);
    return tunnel ? { ...tunnel } : null;
  }

  /**
   * Check if SSH is available.
   */
  isSSHAvailable(): boolean {
    return this.sshAvailable;
  }

  // -------------------------------------------------------------------------
  // Tailscale Integration
  // -------------------------------------------------------------------------

  /**
   * Get Tailscale status.
   */
  tailscaleStatus(): TailscaleStatus {
    if (!this.tailscaleAvailable) {
      return { installed: false, running: false };
    }

    try {
      const output = execSync('tailscale status --json', {
        timeout: 10000,
        encoding: 'utf-8',
      });
      const status = JSON.parse(output);

      return {
        installed: true,
        running: true,
        version: status.Version || undefined,
        ipv4: status.TailscaleIPs?.[0] || undefined,
        ipv6: status.TailscaleIPs?.[1] || undefined,
        hostname: status.Self?.HostName || undefined,
        tailnet: status.MagicDNSSuffix || undefined,
        online: status.Self?.Online ?? true,
      };
    } catch {
      return { installed: true, running: false };
    }
  }

  /**
   * Bring Tailscale up (connect to the tailnet).
   */
  async tailscaleUp(config?: TailscaleConfig): Promise<{ success: boolean; message: string }> {
    if (!this.tailscaleAvailable) {
      return { success: false, message: 'Tailscale is not installed on this system' };
    }

    const args = ['up'];

    if (config?.authKey) {
      args.push('--authkey', config.authKey);
    }
    if (config?.hostname) {
      args.push('--hostname', config.hostname);
    }
    if (config?.acceptRoutes) {
      args.push('--accept-routes');
    }
    if (config?.exitNode) {
      args.push('--exit-node', config.exitNode);
    }
    if (config?.advertiseExitNode) {
      args.push('--advertise-exit-node');
    }
    if (config?.tags && config.tags.length > 0) {
      args.push('--advertise-tags', config.tags.join(','));
    }

    try {
      execSync(`tailscale ${args.join(' ')}`, {
        timeout: 30000,
        encoding: 'utf-8',
      });

      this.bus.emit('remote.tailscale.connected', {});
      return { success: true, message: 'Tailscale connected' };
    } catch (err: any) {
      const message =
        err.stderr?.toString().trim() || err.message || 'Failed to bring Tailscale up';
      return { success: false, message };
    }
  }

  /**
   * Bring Tailscale down (disconnect from the tailnet).
   */
  async tailscaleDown(): Promise<{ success: boolean; message: string }> {
    if (!this.tailscaleAvailable) {
      return { success: false, message: 'Tailscale is not installed on this system' };
    }

    try {
      execSync('tailscale down', {
        timeout: 10000,
        encoding: 'utf-8',
      });

      this.bus.emit('remote.tailscale.disconnected', {});
      return { success: true, message: 'Tailscale disconnected' };
    } catch (err: any) {
      const message =
        err.stderr?.toString().trim() || err.message || 'Failed to bring Tailscale down';
      return { success: false, message };
    }
  }

  /**
   * List devices on the tailnet.
   */
  tailscaleDevices(): TailscaleDevice[] {
    if (!this.tailscaleAvailable) {
      return [];
    }

    try {
      const output = execSync('tailscale status --json', {
        timeout: 10000,
        encoding: 'utf-8',
      });
      const status = JSON.parse(output);
      const peers = status.Peer || {};

      const devices: TailscaleDevice[] = [];

      // Add self
      if (status.Self) {
        devices.push({
          id: status.Self.ID || 'self',
          hostname: status.Self.HostName || 'self',
          ipv4: status.TailscaleIPs?.[0] || '',
          ipv6: status.TailscaleIPs?.[1] || '',
          os: status.Self.OS || '',
          online: status.Self.Online ?? true,
          lastSeen: status.Self.LastSeen || new Date().toISOString(),
        });
      }

      // Add peers
      for (const [nodeKey, peer] of Object.entries(peers) as [string, any][]) {
        devices.push({
          id: peer.ID || nodeKey,
          hostname: peer.HostName || 'unknown',
          ipv4: peer.TailscaleIPs?.[0] || '',
          ipv6: peer.TailscaleIPs?.[1] || '',
          os: peer.OS || '',
          online: peer.Online ?? false,
          lastSeen: peer.LastSeen || '',
        });
      }

      return devices;
    } catch {
      return [];
    }
  }

  /**
   * Expose a local port via Tailscale Serve or Funnel.
   */
  async tailscaleServe(
    port: number,
    opts?: ServeOptions,
  ): Promise<{ success: boolean; message: string; url?: string }> {
    if (!this.tailscaleAvailable) {
      return { success: false, message: 'Tailscale is not installed on this system' };
    }

    const protocol = opts?.protocol || 'http';
    const useFunnel = opts?.funnel ?? false;

    try {
      const subcommand = useFunnel ? 'funnel' : 'serve';
      execSync(`tailscale ${subcommand} ${protocol}://localhost:${port}`, {
        timeout: 15000,
        encoding: 'utf-8',
      });

      // Try to get the URL from Tailscale status
      const status = this.tailscaleStatus();
      const hostname = status.hostname || 'localhost';
      const tailnet = status.tailnet || '';
      const url = tailnet ? `https://${hostname}.${tailnet}` : `https://${hostname}`;

      return { success: true, message: `Port ${port} exposed via Tailscale ${subcommand}`, url };
    } catch (err: any) {
      const message = err.stderr?.toString().trim() || err.message || 'Failed to expose port';
      return { success: false, message };
    }
  }

  /**
   * Check if Tailscale is available.
   */
  isTailscaleAvailable(): boolean {
    return this.tailscaleAvailable;
  }

  // -------------------------------------------------------------------------
  // Authorized Keys Management
  // -------------------------------------------------------------------------

  /**
   * Add an SSH public key to the authorized list.
   */
  addAuthorizedKey(key: string, label: string): AuthorizedKey {
    const id = crypto.randomUUID();
    const fingerprint = this.computeKeyFingerprint(key);

    const entry: AuthorizedKey = {
      id,
      key: key.trim(),
      label,
      fingerprint,
      addedAt: Date.now(),
    };

    this.authorizedKeys.set(id, entry);
    this.saveToStore();

    this.bus.emit('remote.key.added', { keyId: id, label, fingerprint });
    return { ...entry };
  }

  /**
   * Remove an authorized key by ID.
   */
  removeAuthorizedKey(keyId: string): boolean {
    const existed = this.authorizedKeys.delete(keyId);
    if (existed) {
      this.saveToStore();
      this.bus.emit('remote.key.removed', { keyId });
    }
    return existed;
  }

  /**
   * List all authorized keys.
   */
  listAuthorizedKeys(): AuthorizedKey[] {
    return Array.from(this.authorizedKeys.values()).map((k) => ({ ...k }));
  }

  // -------------------------------------------------------------------------
  // Connection Status Summary
  // -------------------------------------------------------------------------

  /**
   * Get a summary of all remote access connections.
   */
  getConnectionSummary(): {
    ssh: { available: boolean; activeTunnels: number };
    tailscale: { available: boolean; status: TailscaleStatus };
    authorizedKeys: number;
  } {
    return {
      ssh: {
        available: this.sshAvailable,
        activeTunnels: Array.from(this.tunnels.values()).filter(
          (t) => t.status === 'connected' || t.status === 'connecting',
        ).length,
      },
      tailscale: {
        available: this.tailscaleAvailable,
        status: this.tailscaleAvailable
          ? this.tailscaleStatus()
          : { installed: false, running: false },
      },
      authorizedKeys: this.authorizedKeys.size,
    };
  }

  // -------------------------------------------------------------------------
  // Internal: SSH Tunnel Process Management
  // -------------------------------------------------------------------------

  private startTunnelProcess(tunnel: SSHTunnel): void {
    const config = tunnel.config;
    const args: string[] = [];

    // Disable pseudo-terminal, we just want the tunnel
    args.push('-N');

    // Keepalive settings
    args.push('-o', 'ServerAliveInterval=30');
    args.push('-o', 'ServerAliveCountMax=3');
    args.push('-o', 'ExitOnForwardFailure=yes');
    args.push('-o', 'StrictHostKeyChecking=accept-new');

    // Authentication
    if (config.username) {
      args.push('-l', config.username);
    }
    if (config.privateKeyPath) {
      args.push('-i', config.privateKeyPath);
    }

    // Port specification
    args.push('-p', String(config.port));

    // Tunnel type
    switch (config.type) {
      case 'local': {
        const remoteTarget = `${config.remoteHost || 'localhost'}:${config.remotePort || config.port}`;
        const localBind = `${config.localPort || 0}:${remoteTarget}`;
        args.push('-L', localBind);
        break;
      }
      case 'remote': {
        const remoteBind = `${config.remotePort || 0}:localhost:${config.localPort || 22}`;
        args.push('-R', remoteBind);
        break;
      }
      case 'dynamic': {
        args.push('-D', String(config.localPort || 1080));
        break;
      }
    }

    // Target host
    args.push(config.host);

    try {
      const child = spawn('ssh', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      tunnel.pid = child.pid;
      this.tunnelProcesses.set(tunnel.id, child);

      // Monitor for connection establishment
      // SSH with -N doesn't produce stdout on success, so we consider it connected
      // after a brief period without errors
      const connectTimer = setTimeout(() => {
        if (tunnel.status === 'connecting') {
          tunnel.status = 'connected';
          tunnel.lastConnected = Date.now();
          tunnel.error = undefined;
          this.bus.emit('remote.tunnel.connected', {
            tunnelId: tunnel.id,
            name: config.name,
          });
        }
      }, 3000);

      child.stderr?.on('data', (data: Buffer) => {
        const message = data.toString().trim();
        if (message && tunnel.status === 'connecting') {
          clearTimeout(connectTimer);
          tunnel.status = 'error';
          tunnel.error = message;
          this.bus.emit('remote.tunnel.error', {
            tunnelId: tunnel.id,
            name: config.name,
            error: message,
          });
        }
      });

      child.on('exit', (code) => {
        clearTimeout(connectTimer);
        this.tunnelProcesses.delete(tunnel.id);
        tunnel.pid = undefined;

        const wasConnected = tunnel.status === 'connected';
        tunnel.status = 'disconnected';

        if (wasConnected) {
          this.bus.emit('remote.tunnel.disconnected', {
            tunnelId: tunnel.id,
            name: config.name,
            exitCode: code,
          });
        }

        // Auto-reconnect if configured
        if (config.autoReconnect !== false && this.tunnels.has(tunnel.id)) {
          const maxRetries = config.maxRetries ?? 10;
          if (tunnel.retryCount < maxRetries) {
            this.scheduleReconnect(tunnel);
          } else {
            tunnel.status = 'error';
            tunnel.error = `Max reconnection attempts (${maxRetries}) reached`;
            this.bus.emit('remote.tunnel.error', {
              tunnelId: tunnel.id,
              name: config.name,
              error: tunnel.error,
            });
          }
        }
      });

      child.on('error', (err) => {
        clearTimeout(connectTimer);
        tunnel.status = 'error';
        tunnel.error = err.message;
        this.tunnelProcesses.delete(tunnel.id);
        tunnel.pid = undefined;

        this.bus.emit('remote.tunnel.error', {
          tunnelId: tunnel.id,
          name: config.name,
          error: err.message,
        });
      });
    } catch (err: any) {
      tunnel.status = 'error';
      tunnel.error = err.message;
      this.bus.emit('remote.tunnel.error', {
        tunnelId: tunnel.id,
        name: config.name,
        error: err.message,
      });
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Backoff: 2s, 4s, 8s, 16s, 32s, max 60s
   */
  private scheduleReconnect(tunnel: SSHTunnel): void {
    tunnel.retryCount++;
    const backoffMs = Math.min(2000 * Math.pow(2, tunnel.retryCount - 1), 60000);

    console.log(
      `[RemoteAccess] Reconnecting tunnel "${tunnel.config.name}" in ${backoffMs}ms ` +
        `(attempt ${tunnel.retryCount}/${tunnel.config.maxRetries ?? 10})`,
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(tunnel.id);
      if (this.tunnels.has(tunnel.id)) {
        tunnel.status = 'connecting';
        this.startTunnelProcess(tunnel);
      }
    }, backoffMs);

    this.reconnectTimers.set(tunnel.id, timer);
  }

  // -------------------------------------------------------------------------
  // Health Monitoring
  // -------------------------------------------------------------------------

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      for (const [tunnelId, tunnel] of this.tunnels) {
        if (tunnel.status !== 'connected') continue;

        // Check if the process is still alive
        const proc = this.tunnelProcesses.get(tunnelId);
        if (!proc || proc.killed) {
          tunnel.status = 'disconnected';
          this.tunnelProcesses.delete(tunnelId);
          tunnel.pid = undefined;

          this.bus.emit('remote.tunnel.disconnected', {
            tunnelId,
            name: tunnel.config.name,
            reason: 'process died',
          });

          // Trigger reconnect
          if (tunnel.config.autoReconnect !== false) {
            const maxRetries = tunnel.config.maxRetries ?? 10;
            if (tunnel.retryCount < maxRetries) {
              this.scheduleReconnect(tunnel);
            }
          }
        }
      }
    }, 30000); // Check every 30 seconds
  }

  // -------------------------------------------------------------------------
  // Persistence (using StateStore generic KV)
  // -------------------------------------------------------------------------

  private loadFromStore(): void {
    try {
      // Load tunnels
      const tunnelsJson = this.state.getKV('remote_access_tunnels');
      if (tunnelsJson) {
        const tunnelConfigs: SSHTunnel[] = JSON.parse(tunnelsJson);
        for (const t of tunnelConfigs) {
          // Only restore the config, set status to disconnected
          t.status = 'disconnected';
          t.pid = undefined;
          t.retryCount = 0;
          this.tunnels.set(t.id, t);
        }
      }

      // Load authorized keys
      const keysJson = this.state.getKV('remote_access_keys');
      if (keysJson) {
        const keys: AuthorizedKey[] = JSON.parse(keysJson);
        for (const k of keys) {
          this.authorizedKeys.set(k.id, k);
        }
      }
    } catch (err: any) {
      console.warn('[RemoteAccess] Failed to load persisted state:', err.message);
    }
  }

  private saveToStore(): void {
    try {
      const tunnels = Array.from(this.tunnels.values()).map((t) => ({
        ...t,
        pid: undefined, // Don't persist runtime PID
      }));
      this.state.setKV('remote_access_tunnels', JSON.stringify(tunnels));

      const keys = Array.from(this.authorizedKeys.values());
      this.state.setKV('remote_access_keys', JSON.stringify(keys));
    } catch (err: any) {
      console.warn('[RemoteAccess] Failed to persist state:', err.message);
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Compute a simple fingerprint for an SSH public key.
   */
  private computeKeyFingerprint(key: string): string {
    const parts = key.trim().split(/\s+/);
    const keyData = parts.length >= 2 ? parts[1] : parts[0];
    try {
      const hash = crypto
        .createHash('sha256')
        .update(Buffer.from(keyData, 'base64'))
        .digest('base64');
      return `SHA256:${hash.replace(/=+$/, '')}`;
    } catch {
      // If the key format is invalid, return a hash of the full key
      const hash = crypto.createHash('sha256').update(key).digest('base64');
      return `SHA256:${hash.replace(/=+$/, '')}`;
    }
  }
}
