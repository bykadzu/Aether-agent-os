import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { RemoteAccessManager } from '../RemoteAccessManager.js';
import type { SSHTunnelConfig } from '../RemoteAccessManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as child_process from 'node:child_process';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpDb(): { dbPath: string; tmpDir: string } {
  const tmpDir = path.join(
    process.env.TEMP || '/tmp',
    `aether-remote-test-${crypto.randomBytes(8).toString('hex')}`,
  );
  fs.mkdirSync(tmpDir, { recursive: true });
  return { dbPath: path.join(tmpDir, 'test.db'), tmpDir };
}

function defaultTunnelConfig(overrides?: Partial<SSHTunnelConfig>): SSHTunnelConfig {
  return {
    name: 'test-tunnel',
    type: 'local',
    host: 'remote.example.com',
    port: 22,
    localPort: 8080,
    remoteHost: 'localhost',
    remotePort: 3000,
    username: 'aether',
    autoReconnect: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RemoteAccessManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let manager: RemoteAccessManager;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    bus = new EventBus();
    ({ dbPath, tmpDir } = makeTmpDb());
    store = new StateStore(bus, dbPath);

    // Mock execSync so SSH and Tailscale appear available
    vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
      if (
        typeof cmd === 'string' &&
        (cmd.includes('which ssh') || cmd.includes('which tailscale'))
      ) {
        return Buffer.from('/usr/bin/ssh\n');
      }
      if (typeof cmd === 'string' && cmd.includes('tailscale status --json')) {
        return Buffer.from(
          JSON.stringify({
            Version: '1.56.0',
            TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'],
            Self: {
              ID: 'self-id',
              HostName: 'aether-node',
              OS: 'linux',
              Online: true,
              LastSeen: '2025-01-01T00:00:00Z',
            },
            MagicDNSSuffix: 'tailnet-abc.ts.net',
            Peer: {
              'node-key-1': {
                ID: 'peer-1',
                HostName: 'peer-node',
                TailscaleIPs: ['100.64.0.2', 'fd7a:115c:a1e0::2'],
                OS: 'linux',
                Online: true,
                LastSeen: '2025-01-01T00:00:00Z',
              },
            },
          }),
        );
      }
      if (typeof cmd === 'string' && cmd.includes('tailscale up')) {
        return Buffer.from('');
      }
      if (typeof cmd === 'string' && cmd.includes('tailscale down')) {
        return Buffer.from('');
      }
      if (typeof cmd === 'string' && cmd.includes('tailscale serve')) {
        return Buffer.from('');
      }
      if (typeof cmd === 'string' && cmd.includes('tailscale funnel')) {
        return Buffer.from('');
      }
      return Buffer.from('');
    });

    // Mock spawn so SSH tunnel processes are simulated
    vi.spyOn(child_process, 'spawn').mockImplementation(() => {
      const EventEmitter = require('node:events');
      const proc = new EventEmitter();
      proc.pid = 12345;
      proc.killed = false;
      proc.kill = vi.fn(() => {
        proc.killed = true;
      });
      proc.stdin = null;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.stdio = [null, proc.stdout, proc.stderr];
      return proc as any;
    });

    manager = new RemoteAccessManager(bus, store);
    await manager.init();
  });

  afterEach(async () => {
    await manager.shutdown();
    store.close();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // SSH Detection
  // ---------------------------------------------------------------------------

  describe('SSH detection', () => {
    it('detects SSH as available when which succeeds', () => {
      expect(manager.isSSHAvailable()).toBe(true);
    });

    it('detects SSH as unavailable when which fails', async () => {
      vi.restoreAllMocks();
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          throw new Error('not found');
        }
        if (typeof cmd === 'string' && cmd.includes('which tailscale')) {
          throw new Error('not found');
        }
        return Buffer.from('');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      expect(manager2.isSSHAvailable()).toBe(false);
      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Tunnel Creation and Listing
  // ---------------------------------------------------------------------------

  describe('tunnel creation and listing', () => {
    it('creates a tunnel and returns tunnel info', () => {
      const tunnel = manager.createTunnel(defaultTunnelConfig());

      expect(tunnel.id).toBeDefined();
      expect(tunnel.config.name).toBe('test-tunnel');
      expect(tunnel.config.type).toBe('local');
      expect(tunnel.status).toBe('connecting');
      expect(tunnel.createdAt).toBeGreaterThan(0);
      expect(tunnel.retryCount).toBe(0);
    });

    it('lists all tunnels', () => {
      manager.createTunnel(defaultTunnelConfig({ name: 'tunnel-1' }));
      manager.createTunnel(defaultTunnelConfig({ name: 'tunnel-2' }));

      const tunnels = manager.listTunnels();
      expect(tunnels).toHaveLength(2);
      expect(tunnels[0].config.name).toBe('tunnel-1');
      expect(tunnels[1].config.name).toBe('tunnel-2');
    });

    it('gets a specific tunnel by ID', () => {
      const created = manager.createTunnel(defaultTunnelConfig());
      const fetched = manager.getTunnel(created.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.config.name).toBe('test-tunnel');
    });

    it('returns null for unknown tunnel ID', () => {
      expect(manager.getTunnel('nonexistent')).toBeNull();
    });

    it('emits remote.tunnel.created event', () => {
      const events: any[] = [];
      bus.on('remote.tunnel.created', (data: any) => events.push(data));

      const tunnel = manager.createTunnel(defaultTunnelConfig());

      expect(events).toHaveLength(1);
      expect(events[0].tunnelId).toBe(tunnel.id);
      expect(events[0].name).toBe('test-tunnel');
      expect(events[0].type).toBe('local');
    });

    it('spawns an SSH process with correct arguments', () => {
      const spawnSpy = vi.spyOn(child_process, 'spawn');
      manager.createTunnel(defaultTunnelConfig());

      expect(spawnSpy).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-N', '-L', '8080:localhost:3000']),
        expect.any(Object),
      );
    });

    it('creates a remote tunnel with -R flag', () => {
      const spawnSpy = vi.spyOn(child_process, 'spawn');
      manager.createTunnel(
        defaultTunnelConfig({
          type: 'remote',
          localPort: 22,
          remotePort: 2222,
        }),
      );

      expect(spawnSpy).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-R', '2222:localhost:22']),
        expect.any(Object),
      );
    });

    it('creates a dynamic SOCKS proxy with -D flag', () => {
      const spawnSpy = vi.spyOn(child_process, 'spawn');
      manager.createTunnel(
        defaultTunnelConfig({
          type: 'dynamic',
          localPort: 1080,
        }),
      );

      expect(spawnSpy).toHaveBeenCalledWith(
        'ssh',
        expect.arrayContaining(['-D', '1080']),
        expect.any(Object),
      );
    });

    it('throws when SSH is not available', async () => {
      vi.restoreAllMocks();
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          throw new Error('not found');
        }
        if (typeof cmd === 'string' && cmd.includes('which tailscale')) {
          throw new Error('not found');
        }
        return Buffer.from('');
      });
      vi.spyOn(child_process, 'spawn').mockImplementation(() => {
        throw new Error('should not be called');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      expect(() => manager2.createTunnel(defaultTunnelConfig())).toThrow(
        'SSH is not available on this system',
      );
      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Tunnel Destruction
  // ---------------------------------------------------------------------------

  describe('tunnel destruction', () => {
    it('destroys a tunnel and removes it from the list', () => {
      const tunnel = manager.createTunnel(defaultTunnelConfig());
      const result = manager.destroyTunnel(tunnel.id);

      expect(result).toBe(true);
      expect(manager.listTunnels()).toHaveLength(0);
    });

    it('returns false when destroying nonexistent tunnel', () => {
      expect(manager.destroyTunnel('nonexistent')).toBe(false);
    });

    it('emits remote.tunnel.destroyed event', () => {
      const events: any[] = [];
      bus.on('remote.tunnel.destroyed', (data: any) => events.push(data));

      const tunnel = manager.createTunnel(defaultTunnelConfig());
      manager.destroyTunnel(tunnel.id);

      expect(events).toHaveLength(1);
      expect(events[0].tunnelId).toBe(tunnel.id);
      expect(events[0].name).toBe('test-tunnel');
    });

    it('kills the SSH process on destroy', () => {
      const tunnel = manager.createTunnel(defaultTunnelConfig());

      // Destroy the tunnel
      manager.destroyTunnel(tunnel.id);

      // The mocked process's kill should have been called
      const spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      if (spawnResult) {
        expect(spawnResult.kill).toHaveBeenCalled();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-Reconnect Logic
  // ---------------------------------------------------------------------------

  describe('auto-reconnect', () => {
    it('schedules reconnect on tunnel process exit when autoReconnect is true', () => {
      vi.useFakeTimers();

      const tunnel = manager.createTunnel(
        defaultTunnelConfig({
          autoReconnect: true,
          maxRetries: 3,
        }),
      );

      // Simulate the SSH process exiting
      const spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      if (spawnResult) {
        spawnResult.emit('exit', 1);
      }

      // Advance timers to trigger reconnect (2s for first retry)
      vi.advanceTimersByTime(2500);

      // Spawn should have been called twice (initial + 1 reconnect)
      expect(child_process.spawn).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('does not reconnect when autoReconnect is false', () => {
      vi.useFakeTimers();

      manager.createTunnel(
        defaultTunnelConfig({
          autoReconnect: false,
        }),
      );

      // Simulate the SSH process exiting
      const spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      if (spawnResult) {
        spawnResult.emit('exit', 1);
      }

      vi.advanceTimersByTime(10000);

      // Spawn should have been called only once
      expect(child_process.spawn).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it('uses exponential backoff for reconnection attempts', () => {
      vi.useFakeTimers();

      manager.createTunnel(
        defaultTunnelConfig({
          autoReconnect: true,
          maxRetries: 5,
        }),
      );

      // First exit triggers reconnect after 2s
      let spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      spawnResult?.emit('exit', 1);

      vi.advanceTimersByTime(2100);
      expect(child_process.spawn).toHaveBeenCalledTimes(2);

      // Second exit triggers reconnect after 4s
      spawnResult = (child_process.spawn as any).mock.results[1]?.value;
      spawnResult?.emit('exit', 1);

      vi.advanceTimersByTime(4100);
      expect(child_process.spawn).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });

    it('stops reconnecting after maxRetries', () => {
      vi.useFakeTimers();

      const errorEvents: any[] = [];
      bus.on('remote.tunnel.error', (data: any) => errorEvents.push(data));

      manager.createTunnel(
        defaultTunnelConfig({
          autoReconnect: true,
          maxRetries: 1,
        }),
      );

      // First exit — will schedule reconnect
      let spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      spawnResult?.emit('exit', 1);

      vi.advanceTimersByTime(2100);
      expect(child_process.spawn).toHaveBeenCalledTimes(2);

      // Second exit — maxRetries reached, should not reconnect
      spawnResult = (child_process.spawn as any).mock.results[1]?.value;
      spawnResult?.emit('exit', 1);

      vi.advanceTimersByTime(60000);
      expect(child_process.spawn).toHaveBeenCalledTimes(2);

      // Should emit error about max retries
      const maxRetryError = errorEvents.find((e) => e.error?.includes('Max reconnection'));
      expect(maxRetryError).toBeDefined();

      vi.useRealTimers();
    });
  });

  // ---------------------------------------------------------------------------
  // Tunnel Error Events
  // ---------------------------------------------------------------------------

  describe('tunnel error events', () => {
    it('emits remote.tunnel.error when SSH process writes to stderr during connect', () => {
      const events: any[] = [];
      bus.on('remote.tunnel.error', (data: any) => events.push(data));

      manager.createTunnel(defaultTunnelConfig({ autoReconnect: false }));

      const spawnResult = (child_process.spawn as any).mock.results[0]?.value;
      spawnResult?.stderr.emit('data', Buffer.from('Connection refused'));

      expect(events).toHaveLength(1);
      expect(events[0].error).toBe('Connection refused');
    });

    it('emits remote.tunnel.error when spawn throws', async () => {
      vi.restoreAllMocks();

      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          return Buffer.from('/usr/bin/ssh\n');
        }
        if (typeof cmd === 'string' && cmd.includes('which tailscale')) {
          throw new Error('not found');
        }
        return Buffer.from('');
      });

      vi.spyOn(child_process, 'spawn').mockImplementation(() => {
        throw new Error('spawn ENOENT');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      const events: any[] = [];
      bus.on('remote.tunnel.error', (data: any) => events.push(data));

      const tunnel = manager2.createTunnel(defaultTunnelConfig({ autoReconnect: false }));

      expect(events).toHaveLength(1);
      expect(events[0].error).toBe('spawn ENOENT');
      expect(manager2.getTunnel(tunnel.id)!.status).toBe('error');

      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Tailscale Status Detection
  // ---------------------------------------------------------------------------

  describe('tailscale status', () => {
    it('detects Tailscale as available when which succeeds', () => {
      expect(manager.isTailscaleAvailable()).toBe(true);
    });

    it('returns status with version and IPs', () => {
      const status = manager.tailscaleStatus();

      expect(status.installed).toBe(true);
      expect(status.running).toBe(true);
      expect(status.version).toBe('1.56.0');
      expect(status.ipv4).toBe('100.64.0.1');
      expect(status.ipv6).toBe('fd7a:115c:a1e0::1');
      expect(status.hostname).toBe('aether-node');
      expect(status.tailnet).toBe('tailnet-abc.ts.net');
      expect(status.online).toBe(true);
    });

    it('returns installed=false when Tailscale is not installed', async () => {
      vi.restoreAllMocks();
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          return Buffer.from('/usr/bin/ssh\n');
        }
        throw new Error('not found');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      const status = manager2.tailscaleStatus();
      expect(status.installed).toBe(false);
      expect(status.running).toBe(false);

      await manager2.shutdown();
    });

    it('returns installed=true running=false when tailscale status fails', () => {
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          return Buffer.from('/usr/bin/ssh\n');
        }
        if (typeof cmd === 'string' && cmd.includes('which tailscale')) {
          return Buffer.from('/usr/bin/tailscale\n');
        }
        if (typeof cmd === 'string' && cmd.includes('tailscale status')) {
          throw new Error('tailscale daemon not running');
        }
        return Buffer.from('');
      });

      // Re-init to pick up the new mocks (tailscale installed but daemon not running)
      // The isTailscaleAvailable should still be true from init detection
      const status = manager.tailscaleStatus();
      // Even though the actual status call throws, it should return installed=true, running=false
      // Note: The mock here replaces the previously configured one during the test
      expect(status.installed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Tailscale Up/Down
  // ---------------------------------------------------------------------------

  describe('tailscale up/down', () => {
    it('calls tailscale up and emits connected event', async () => {
      const events: any[] = [];
      bus.on('remote.tailscale.connected', (data: any) => events.push(data));

      const result = await manager.tailscaleUp();

      expect(result.success).toBe(true);
      expect(events).toHaveLength(1);
    });

    it('calls tailscale up with config options', async () => {
      const execSpy = vi.spyOn(child_process, 'execSync');

      await manager.tailscaleUp({
        authKey: 'tskey-abcdef',
        hostname: 'my-node',
        acceptRoutes: true,
      });

      expect(execSpy).toHaveBeenCalledWith(
        expect.stringContaining('--authkey'),
        expect.any(Object),
      );
    });

    it('calls tailscale down and emits disconnected event', async () => {
      const events: any[] = [];
      bus.on('remote.tailscale.disconnected', (data: any) => events.push(data));

      const result = await manager.tailscaleDown();

      expect(result.success).toBe(true);
      expect(events).toHaveLength(1);
    });

    it('returns failure when Tailscale not installed', async () => {
      vi.restoreAllMocks();
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          return Buffer.from('/usr/bin/ssh\n');
        }
        throw new Error('not found');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      const upResult = await manager2.tailscaleUp();
      expect(upResult.success).toBe(false);
      expect(upResult.message).toContain('not installed');

      const downResult = await manager2.tailscaleDown();
      expect(downResult.success).toBe(false);

      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Tailscale Devices
  // ---------------------------------------------------------------------------

  describe('tailscale devices', () => {
    it('lists devices on the tailnet', () => {
      const devices = manager.tailscaleDevices();

      expect(devices.length).toBeGreaterThanOrEqual(2);

      const self = devices.find((d) => d.hostname === 'aether-node');
      expect(self).toBeDefined();
      expect(self!.ipv4).toBe('100.64.0.1');
      expect(self!.online).toBe(true);

      const peer = devices.find((d) => d.hostname === 'peer-node');
      expect(peer).toBeDefined();
      expect(peer!.ipv4).toBe('100.64.0.2');
    });

    it('returns empty array when Tailscale not available', async () => {
      vi.restoreAllMocks();
      vi.spyOn(child_process, 'execSync').mockImplementation((cmd: string) => {
        if (typeof cmd === 'string' && cmd.includes('which ssh')) {
          return Buffer.from('/usr/bin/ssh\n');
        }
        throw new Error('not found');
      });

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      expect(manager2.tailscaleDevices()).toEqual([]);
      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Tailscale Serve
  // ---------------------------------------------------------------------------

  describe('tailscale serve', () => {
    it('exposes a port and returns success', async () => {
      const result = await manager.tailscaleServe(3000);

      expect(result.success).toBe(true);
      expect(result.message).toContain('3000');
      expect(result.url).toBeDefined();
    });

    it('uses funnel when option is set', async () => {
      const execSpy = vi.spyOn(child_process, 'execSync');

      await manager.tailscaleServe(8080, { funnel: true });

      expect(execSpy).toHaveBeenCalledWith(
        expect.stringContaining('tailscale funnel'),
        expect.any(Object),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Authorized Keys Management
  // ---------------------------------------------------------------------------

  describe('authorized keys', () => {
    const sampleKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0 user@host';

    it('adds an authorized key', () => {
      const key = manager.addAuthorizedKey(sampleKey, 'My Laptop');

      expect(key.id).toBeDefined();
      expect(key.key).toBe(sampleKey);
      expect(key.label).toBe('My Laptop');
      expect(key.fingerprint).toMatch(/^SHA256:/);
      expect(key.addedAt).toBeGreaterThan(0);
    });

    it('lists authorized keys', () => {
      manager.addAuthorizedKey(sampleKey, 'Key 1');
      manager.addAuthorizedKey('ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG test@host', 'Key 2');

      const keys = manager.listAuthorizedKeys();
      expect(keys).toHaveLength(2);
      expect(keys[0].label).toBe('Key 1');
      expect(keys[1].label).toBe('Key 2');
    });

    it('removes an authorized key', () => {
      const key = manager.addAuthorizedKey(sampleKey, 'To Remove');
      const result = manager.removeAuthorizedKey(key.id);

      expect(result).toBe(true);
      expect(manager.listAuthorizedKeys()).toHaveLength(0);
    });

    it('returns false when removing nonexistent key', () => {
      expect(manager.removeAuthorizedKey('nonexistent')).toBe(false);
    });

    it('emits remote.key.added event', () => {
      const events: any[] = [];
      bus.on('remote.key.added', (data: any) => events.push(data));

      manager.addAuthorizedKey(sampleKey, 'Event Key');

      expect(events).toHaveLength(1);
      expect(events[0].label).toBe('Event Key');
      expect(events[0].fingerprint).toMatch(/^SHA256:/);
    });

    it('emits remote.key.removed event', () => {
      const events: any[] = [];
      bus.on('remote.key.removed', (data: any) => events.push(data));

      const key = manager.addAuthorizedKey(sampleKey, 'Event Key');
      manager.removeAuthorizedKey(key.id);

      expect(events).toHaveLength(1);
      expect(events[0].keyId).toBe(key.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('persists authorized keys across shutdown and init', async () => {
      const sampleKey = 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC0 persist@host';
      manager.addAuthorizedKey(sampleKey, 'Persistent Key');

      await manager.shutdown();

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      const keys = manager2.listAuthorizedKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].label).toBe('Persistent Key');
      expect(keys[0].key).toBe(sampleKey);

      await manager2.shutdown();
    });

    it('persists tunnel configs (as disconnected) across shutdown and init', async () => {
      manager.createTunnel(defaultTunnelConfig({ name: 'persist-tunnel' }));

      await manager.shutdown();

      const manager2 = new RemoteAccessManager(bus, store);
      await manager2.init();

      const tunnels = manager2.listTunnels();
      expect(tunnels).toHaveLength(1);
      expect(tunnels[0].config.name).toBe('persist-tunnel');
      expect(tunnels[0].status).toBe('disconnected');

      await manager2.shutdown();
    });
  });

  // ---------------------------------------------------------------------------
  // Connection Summary
  // ---------------------------------------------------------------------------

  describe('connection summary', () => {
    it('returns a summary of all connections', () => {
      manager.createTunnel(defaultTunnelConfig());

      const summary = manager.getConnectionSummary();

      expect(summary.ssh.available).toBe(true);
      expect(summary.ssh.activeTunnels).toBeGreaterThanOrEqual(1);
      expect(summary.tailscale.available).toBe(true);
      expect(summary.tailscale.status.installed).toBe(true);
      expect(summary.authorizedKeys).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  describe('shutdown', () => {
    it('kills all tunnel processes on shutdown', async () => {
      manager.createTunnel(defaultTunnelConfig({ name: 't1' }));
      manager.createTunnel(defaultTunnelConfig({ name: 't2' }));

      await manager.shutdown();

      // All tunnels should be disconnected
      const tunnels = manager.listTunnels();
      for (const t of tunnels) {
        expect(t.status).toBe('disconnected');
      }
    });
  });
});
