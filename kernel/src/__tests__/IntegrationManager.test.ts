import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { IntegrationManager } from '../IntegrationManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('IntegrationManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let manager: IntegrationManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-integration-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    manager = new IntegrationManager(bus, store);
    await manager.init();
  });

  afterEach(() => {
    manager.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  describe('register / unregister', () => {
    it('registers a github integration and returns info', () => {
      const info = manager.register({
        type: 'github',
        name: 'My GitHub',
        credentials: { token: 'ghp_test123' },
      });

      expect(info.id).toBeDefined();
      expect(info.type).toBe('github');
      expect(info.name).toBe('My GitHub');
      expect(info.enabled).toBe(true);
      expect(info.status).toBe('disconnected');
      expect(info.available_actions.length).toBeGreaterThan(0);
    });

    it('emits integration.registered event', () => {
      const events: any[] = [];
      bus.on('integration.registered', (data: any) => events.push(data));

      manager.register({
        type: 'github',
        name: 'Test',
      });

      expect(events).toHaveLength(1);
      expect(events[0].integration.type).toBe('github');
    });

    it('throws for unknown integration type', () => {
      expect(() => manager.register({ type: 'unknown', name: 'Bad' })).toThrow(
        'Unknown integration type: unknown',
      );
    });

    it('unregister removes integration', () => {
      const info = manager.register({ type: 'github', name: 'To Delete' });
      manager.unregister(info.id);

      const list = manager.list();
      expect(list).toHaveLength(0);
    });

    it('emits integration.unregistered event', () => {
      const events: any[] = [];
      bus.on('integration.unregistered', (data: any) => events.push(data));

      const info = manager.register({ type: 'github', name: 'To Delete' });
      manager.unregister(info.id);

      expect(events).toHaveLength(1);
      expect(events[0].integrationId).toBe(info.id);
    });

    it('unregister on non-existent id is a no-op', () => {
      expect(() => manager.unregister('nonexistent')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // List and Get
  // ---------------------------------------------------------------------------

  describe('list / get', () => {
    it('lists all registered integrations', () => {
      manager.register({ type: 'github', name: 'GH1' });
      manager.register({ type: 'github', name: 'GH2' });

      const list = manager.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('GH1');
      expect(list[1].name).toBe('GH2');
    });

    it('get returns integration by id', () => {
      const info = manager.register({ type: 'github', name: 'Get Test' });
      const fetched = manager.get(info.id);

      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(info.id);
      expect(fetched!.name).toBe('Get Test');
    });

    it('get returns null for unknown id', () => {
      expect(manager.get('nonexistent')).toBeNull();
    });

    it('lists available actions from the integration type', () => {
      const info = manager.register({ type: 'github', name: 'Actions Test' });
      expect(info.available_actions.length).toBeGreaterThan(0);

      const actionNames = info.available_actions.map((a: any) => a.name);
      expect(actionNames).toContain('github.list_repos');
      expect(actionNames).toContain('github.create_issue');
    });
  });

  // ---------------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------------

  describe('enable / disable', () => {
    it('disable sets enabled to false', () => {
      const info = manager.register({ type: 'github', name: 'Toggle' });
      manager.disable(info.id);

      const fetched = manager.get(info.id);
      expect(fetched!.enabled).toBe(false);
    });

    it('enable re-enables a disabled integration', () => {
      const info = manager.register({ type: 'github', name: 'Toggle' });
      manager.disable(info.id);
      manager.enable(info.id);

      const fetched = manager.get(info.id);
      expect(fetched!.enabled).toBe(true);
    });

    it('emits enable/disable events', () => {
      const enabledEvents: any[] = [];
      const disabledEvents: any[] = [];
      bus.on('integration.enabled', (data: any) => enabledEvents.push(data));
      bus.on('integration.disabled', (data: any) => disabledEvents.push(data));

      const info = manager.register({ type: 'github', name: 'Events' });
      manager.disable(info.id);
      manager.enable(info.id);

      expect(disabledEvents).toHaveLength(1);
      expect(enabledEvents).toHaveLength(1);
      expect(disabledEvents[0].integrationId).toBe(info.id);
      expect(enabledEvents[0].integrationId).toBe(info.id);
    });
  });

  // ---------------------------------------------------------------------------
  // Configure
  // ---------------------------------------------------------------------------

  describe('configure', () => {
    it('updates settings', () => {
      const info = manager.register({ type: 'github', name: 'Configure Test' });
      manager.configure(info.id, { default_org: 'my-org' });

      const fetched = manager.get(info.id);
      expect(fetched!.settings).toEqual({ default_org: 'my-org' });
    });
  });

  // ---------------------------------------------------------------------------
  // Test Connection
  // ---------------------------------------------------------------------------

  describe('test', () => {
    it('returns failure for unknown integration', async () => {
      const result = await manager.test('nonexistent');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('calls testConnection on the implementation', async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ login: 'testuser' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Test Connection',
        credentials: { token: 'ghp_test' },
      });

      const result = await manager.test(info.id);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
    });

    it('updates status on successful test', async () => {
      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ login: 'testuser' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Status Test',
        credentials: { token: 'ghp_test' },
      });

      await manager.test(info.id);

      const fetched = manager.get(info.id);
      expect(fetched!.status).toBe('connected');
    });

    it('updates status on failed test', async () => {
      const mockFetch = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Fail Test',
        credentials: { token: 'bad_token' },
      });

      const result = await manager.test(info.id);

      expect(result.success).toBe(false);
      const fetched = manager.get(info.id);
      expect(fetched!.status).toBe('error');
    });

    it('emits integration.tested event', async () => {
      const events: any[] = [];
      bus.on('integration.tested', (data: any) => events.push(data));

      const mockFetch = vi.fn(
        async () => new Response(JSON.stringify({ login: 'user' }), { status: 200 }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Event Test',
        credentials: { token: 'ghp_test' },
      });

      await manager.test(info.id);

      expect(events).toHaveLength(1);
      expect(events[0].integrationId).toBe(info.id);
      expect(events[0].success).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Execute Actions
  // ---------------------------------------------------------------------------

  describe('execute', () => {
    it('throws for unknown integration', async () => {
      await expect(manager.execute('nonexistent', 'github.list_repos')).rejects.toThrow(
        'Integration not found',
      );
    });

    it('executes an action and returns result', async () => {
      const mockRepos = [{ name: 'repo1' }, { name: 'repo2' }];
      const mockFetch = vi.fn(async () => new Response(JSON.stringify(mockRepos), { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Exec Test',
        credentials: { token: 'ghp_test' },
      });

      const result = await manager.execute(info.id, 'github.list_repos');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toEqual(mockRepos);
    });

    it('logs successful action execution', async () => {
      const mockFetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Log Test',
        credentials: { token: 'ghp_test' },
      });

      await manager.execute(info.id, 'github.list_repos');

      const logs = store.getIntegrationLogs(info.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('github.list_repos');
      expect(logs[0].status).toBe('success');
    });

    it('logs failed action execution', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Network error');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Error Log Test',
        credentials: { token: 'ghp_test' },
      });

      await expect(manager.execute(info.id, 'github.list_repos')).rejects.toThrow('Network error');

      const logs = store.getIntegrationLogs(info.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('github.list_repos');
      expect(logs[0].status).toBe('error');
    });

    it('emits integration.action_result on success', async () => {
      const events: any[] = [];
      bus.on('integration.action_result', (data: any) => events.push(data));

      const mockFetch = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Event Exec',
        credentials: { token: 'ghp_test' },
      });

      await manager.execute(info.id, 'github.list_repos');

      expect(events).toHaveLength(1);
      expect(events[0].integrationId).toBe(info.id);
      expect(events[0].action).toBe('github.list_repos');
    });

    it('emits integration.error on failure', async () => {
      const events: any[] = [];
      bus.on('integration.error', (data: any) => events.push(data));

      const mockFetch = vi.fn(async () => {
        throw new Error('API down');
      });
      vi.stubGlobal('fetch', mockFetch);

      const info = manager.register({
        type: 'github',
        name: 'Error Event',
        credentials: { token: 'ghp_test' },
      });

      await expect(manager.execute(info.id, 'github.list_repos')).rejects.toThrow();

      expect(events).toHaveLength(1);
      expect(events[0].integrationId).toBe(info.id);
      expect(events[0].error).toContain('API down');
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('integrations survive store close and reopen', async () => {
      const info = manager.register({
        type: 'github',
        name: 'Persistent',
        credentials: { token: 'ghp_persist' },
        settings: { org: 'test-org' },
      });

      manager.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const manager2 = new IntegrationManager(bus, store2);
      await manager2.init();

      try {
        const list = manager2.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(info.id);
        expect(list[0].name).toBe('Persistent');
        expect(list[0].type).toBe('github');
        expect(list[0].settings).toEqual({ org: 'test-org' });
      } finally {
        manager2.shutdown();
        store2.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Shutdown
  // ---------------------------------------------------------------------------

  describe('shutdown', () => {
    it('clears integration types', () => {
      manager.shutdown();
      // After shutdown, registering should fail because types are cleared
      expect(() => manager.register({ type: 'github', name: 'After Shutdown' })).toThrow(
        'Unknown integration type: github',
      );
    });
  });
});
