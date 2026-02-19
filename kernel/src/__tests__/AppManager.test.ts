/**
 * AppManager Tests
 *
 * Unit tests for the app lifecycle manager: install, uninstall, enable,
 * disable, list, get, permissions, and shutdown.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { AppManager } from '../AppManager.js';
import type { AetherAppManifest, AppPermission } from '@aether/shared';

// ---------------------------------------------------------------------------
// Mock StateStore (minimal interface the AppManager needs)
// ---------------------------------------------------------------------------

function createMockStateStore() {
  const apps = new Map<string, any>();
  return {
    insertApp: vi.fn((row: any) => {
      apps.set(row.id, row);
    }),
    deleteApp: vi.fn((id: string) => {
      apps.delete(id);
    }),
    setAppEnabled: vi.fn((id: string, enabled: boolean) => {
      const row = apps.get(id);
      if (row) row.enabled = enabled ? 1 : 0;
    }),
    getAllApps: vi.fn(() => Array.from(apps.values())),
    getApp: vi.fn((id: string) => apps.get(id) || null),
    // Allow direct manipulation for testing
    _apps: apps,
  };
}

// ---------------------------------------------------------------------------
// Helper: create a mock AetherAppManifest
// ---------------------------------------------------------------------------

function createMockManifest(overrides: Partial<AetherAppManifest> = {}): AetherAppManifest {
  return {
    id: 'com.test.myapp',
    name: 'Test App',
    version: '1.0.0',
    author: 'Test Author',
    description: 'A test application',
    icon: 'box',
    permissions: ['filesystem:read', 'network'] as AppPermission[],
    entry: 'index.js',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AppManager', () => {
  let bus: EventBus;
  let store: ReturnType<typeof createMockStateStore>;
  let manager: AppManager;

  beforeEach(() => {
    bus = new EventBus();
    store = createMockStateStore();
    manager = new AppManager(bus, store as any);
  });

  // -------------------------------------------------------------------------
  // init / shutdown
  // -------------------------------------------------------------------------

  describe('init()', () => {
    it('resolves without throwing', async () => {
      await expect(manager.init()).resolves.toBeUndefined();
    });
  });

  describe('shutdown()', () => {
    it('does not throw', () => {
      expect(() => manager.shutdown()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // install()
  // -------------------------------------------------------------------------

  describe('install()', () => {
    it('returns an InstalledApp with correct fields', () => {
      const manifest = createMockManifest();
      const app = manager.install(manifest);

      expect(app.id).toBe('com.test.myapp');
      expect(app.manifest).toEqual(manifest);
      expect(app.enabled).toBe(true);
      expect(app.install_source).toBe('registry');
      expect(app.installed_at).toBeGreaterThan(0);
      expect(app.updated_at).toBeGreaterThan(0);
    });

    it('uses the provided source parameter', () => {
      const manifest = createMockManifest();
      const app = manager.install(manifest, 'local');

      expect(app.install_source).toBe('local');
    });

    it('stores owner_uid when provided', () => {
      const manifest = createMockManifest();
      const app = manager.install(manifest, 'registry', 'user_123');

      expect(app.owner_uid).toBe('user_123');
    });

    it('calls state.insertApp with serialized manifest', () => {
      const manifest = createMockManifest();
      manager.install(manifest, 'local', 'user_42');

      expect(store.insertApp).toHaveBeenCalledOnce();
      const row = store.insertApp.mock.calls[0][0];
      expect(row.id).toBe('com.test.myapp');
      expect(JSON.parse(row.manifest)).toEqual(manifest);
      expect(row.enabled).toBe(1);
      expect(row.install_source).toBe('local');
      expect(row.owner_uid).toBe('user_42');
    });

    it('passes null owner_uid when not provided', () => {
      const manifest = createMockManifest();
      manager.install(manifest);

      const row = store.insertApp.mock.calls[0][0];
      expect(row.owner_uid).toBeNull();
    });

    it('emits app.installed event with the app', () => {
      const handler = vi.fn();
      bus.on('app.installed', handler);

      const manifest = createMockManifest();
      const app = manager.install(manifest);

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ app }));
    });

    it('defaults install_source to registry', () => {
      const manifest = createMockManifest();
      const app = manager.install(manifest);
      expect(app.install_source).toBe('registry');
    });
  });

  // -------------------------------------------------------------------------
  // uninstall()
  // -------------------------------------------------------------------------

  describe('uninstall()', () => {
    it('calls state.deleteApp with the appId', () => {
      manager.uninstall('com.test.myapp');

      expect(store.deleteApp).toHaveBeenCalledOnce();
      expect(store.deleteApp).toHaveBeenCalledWith('com.test.myapp');
    });

    it('emits app.uninstalled event', () => {
      const handler = vi.fn();
      bus.on('app.uninstalled', handler);

      manager.uninstall('com.test.myapp');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ appId: 'com.test.myapp' }));
    });
  });

  // -------------------------------------------------------------------------
  // enable() / disable()
  // -------------------------------------------------------------------------

  describe('enable()', () => {
    it('calls state.setAppEnabled with true', () => {
      manager.enable('com.test.myapp');

      expect(store.setAppEnabled).toHaveBeenCalledOnce();
      expect(store.setAppEnabled).toHaveBeenCalledWith('com.test.myapp', true);
    });

    it('emits app.enabled event', () => {
      const handler = vi.fn();
      bus.on('app.enabled', handler);

      manager.enable('com.test.myapp');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ appId: 'com.test.myapp' }));
    });
  });

  describe('disable()', () => {
    it('calls state.setAppEnabled with false', () => {
      manager.disable('com.test.myapp');

      expect(store.setAppEnabled).toHaveBeenCalledOnce();
      expect(store.setAppEnabled).toHaveBeenCalledWith('com.test.myapp', false);
    });

    it('emits app.disabled event', () => {
      const handler = vi.fn();
      bus.on('app.disabled', handler);

      manager.disable('com.test.myapp');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ appId: 'com.test.myapp' }));
    });
  });

  // -------------------------------------------------------------------------
  // list()
  // -------------------------------------------------------------------------

  describe('list()', () => {
    it('returns empty array when no apps are installed', () => {
      const apps = manager.list();
      expect(apps).toEqual([]);
      expect(store.getAllApps).toHaveBeenCalledOnce();
    });

    it('maps DB rows to InstalledApp objects', () => {
      const manifest = createMockManifest();
      const now = Date.now();

      // Insert a raw DB row into the mock store
      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: now,
        updated_at: now,
        enabled: 1,
        install_source: 'registry',
        owner_uid: 'user_1',
      });

      const apps = manager.list();

      expect(apps).toHaveLength(1);
      expect(apps[0].id).toBe('com.test.myapp');
      expect(apps[0].manifest).toEqual(manifest);
      expect(apps[0].enabled).toBe(true);
      expect(apps[0].install_source).toBe('registry');
      expect(apps[0].owner_uid).toBe('user_1');
      expect(apps[0].installed_at).toBe(now);
      expect(apps[0].updated_at).toBe(now);
    });

    it('converts enabled=0 to false', () => {
      const manifest = createMockManifest();
      store._apps.set('com.test.disabled', {
        id: 'com.test.disabled',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 0,
        install_source: 'local',
        owner_uid: null,
      });

      const apps = manager.list();
      expect(apps[0].enabled).toBe(false);
    });

    it('returns multiple apps', () => {
      const manifest1 = createMockManifest({ id: 'com.test.app1', name: 'App 1' });
      const manifest2 = createMockManifest({ id: 'com.test.app2', name: 'App 2' });
      const now = Date.now();

      store._apps.set('com.test.app1', {
        id: 'com.test.app1',
        manifest: JSON.stringify(manifest1),
        installed_at: now,
        updated_at: now,
        enabled: 1,
        install_source: 'registry',
        owner_uid: null,
      });
      store._apps.set('com.test.app2', {
        id: 'com.test.app2',
        manifest: JSON.stringify(manifest2),
        installed_at: now,
        updated_at: now,
        enabled: 1,
        install_source: 'url',
        owner_uid: null,
      });

      const apps = manager.list();
      expect(apps).toHaveLength(2);
      expect(apps.map((a) => a.id)).toContain('com.test.app1');
      expect(apps.map((a) => a.id)).toContain('com.test.app2');
    });
  });

  // -------------------------------------------------------------------------
  // get()
  // -------------------------------------------------------------------------

  describe('get()', () => {
    it('returns null for a non-existent app', () => {
      const result = manager.get('com.nonexistent.app');
      expect(result).toBeNull();
      expect(store.getApp).toHaveBeenCalledWith('com.nonexistent.app');
    });

    it('returns InstalledApp for an existing app', () => {
      const manifest = createMockManifest();
      const now = Date.now();

      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: now,
        updated_at: now,
        enabled: 1,
        install_source: 'registry',
        owner_uid: 'user_99',
      });

      const app = manager.get('com.test.myapp');

      expect(app).not.toBeNull();
      expect(app!.id).toBe('com.test.myapp');
      expect(app!.manifest).toEqual(manifest);
      expect(app!.enabled).toBe(true);
      expect(app!.install_source).toBe('registry');
      expect(app!.owner_uid).toBe('user_99');
    });

    it('converts enabled=0 to false', () => {
      const manifest = createMockManifest();
      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 0,
        install_source: 'local',
        owner_uid: null,
      });

      const app = manager.get('com.test.myapp');
      expect(app!.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getPermissions()
  // -------------------------------------------------------------------------

  describe('getPermissions()', () => {
    it('returns permissions from the manifest', () => {
      const manifest = createMockManifest({
        permissions: ['filesystem', 'network', 'memory'] as AppPermission[],
      });
      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 1,
        install_source: 'registry',
        owner_uid: null,
      });

      const perms = manager.getPermissions('com.test.myapp');
      expect(perms).toEqual(['filesystem', 'network', 'memory']);
    });

    it('returns empty array for non-existent app', () => {
      const perms = manager.getPermissions('com.nonexistent.app');
      expect(perms).toEqual([]);
    });

    it('returns empty array when manifest has no permissions', () => {
      const manifest = createMockManifest({ permissions: [] });
      store._apps.set('com.test.noperm', {
        id: 'com.test.noperm',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 1,
        install_source: 'registry',
        owner_uid: null,
      });

      const perms = manager.getPermissions('com.test.noperm');
      expect(perms).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // checkPermission()
  // -------------------------------------------------------------------------

  describe('checkPermission()', () => {
    it('returns true when the app has the permission', () => {
      const manifest = createMockManifest({
        permissions: ['filesystem', 'network'] as AppPermission[],
      });
      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 1,
        install_source: 'registry',
        owner_uid: null,
      });

      expect(manager.checkPermission('com.test.myapp', 'filesystem')).toBe(true);
      expect(manager.checkPermission('com.test.myapp', 'network')).toBe(true);
    });

    it('returns false when the app does not have the permission', () => {
      const manifest = createMockManifest({
        permissions: ['filesystem:read'] as AppPermission[],
      });
      store._apps.set('com.test.myapp', {
        id: 'com.test.myapp',
        manifest: JSON.stringify(manifest),
        installed_at: Date.now(),
        updated_at: Date.now(),
        enabled: 1,
        install_source: 'registry',
        owner_uid: null,
      });

      expect(manager.checkPermission('com.test.myapp', 'network')).toBe(false);
      expect(manager.checkPermission('com.test.myapp', 'system')).toBe(false);
    });

    it('returns false for non-existent app', () => {
      expect(manager.checkPermission('com.nonexistent.app', 'filesystem')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Integration: install then retrieve
  // -------------------------------------------------------------------------

  describe('install + get integration', () => {
    it('installed app is retrievable via get()', () => {
      const manifest = createMockManifest();
      manager.install(manifest, 'url', 'owner_abc');

      const app = manager.get('com.test.myapp');

      expect(app).not.toBeNull();
      expect(app!.id).toBe('com.test.myapp');
      expect(app!.enabled).toBe(true);
      expect(app!.install_source).toBe('url');
      expect(app!.owner_uid).toBe('owner_abc');
    });

    it('installed app appears in list()', () => {
      const manifest = createMockManifest();
      manager.install(manifest);

      const apps = manager.list();
      expect(apps).toHaveLength(1);
      expect(apps[0].id).toBe('com.test.myapp');
    });

    it('uninstalled app is no longer retrievable', () => {
      const manifest = createMockManifest();
      manager.install(manifest);
      manager.uninstall('com.test.myapp');

      const app = manager.get('com.test.myapp');
      expect(app).toBeNull();
    });

    it('permissions are accessible after install', () => {
      const manifest = createMockManifest({
        permissions: ['filesystem', 'ipc', 'cron'] as AppPermission[],
      });
      manager.install(manifest);

      expect(manager.checkPermission('com.test.myapp', 'filesystem')).toBe(true);
      expect(manager.checkPermission('com.test.myapp', 'ipc')).toBe(true);
      expect(manager.checkPermission('com.test.myapp', 'cron')).toBe(true);
      expect(manager.checkPermission('com.test.myapp', 'system')).toBe(false);
    });
  });
});
