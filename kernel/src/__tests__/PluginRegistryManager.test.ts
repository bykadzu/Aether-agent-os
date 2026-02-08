import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { PluginRegistryManager } from '../PluginRegistryManager.js';
import type { PluginRegistryManifest } from '../PluginRegistryManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

const SAMPLE_MANIFEST: PluginRegistryManifest = {
  id: 'com.test.sample-plugin',
  name: 'Sample Plugin',
  version: '1.0.0',
  author: 'Test Author',
  description: 'A sample plugin for testing',
  category: 'tools',
  icon: 'Wrench',
  tools: [
    {
      name: 'sample_tool',
      description: 'A sample tool',
      parameters: {
        input: { type: 'string', description: 'Input value', required: true },
      },
    },
  ],
  keywords: ['test', 'sample', 'demo'],
  settings: [
    { key: 'api_key', label: 'API Key', type: 'string', required: true },
    { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
  ],
};

const SAMPLE_MANIFEST_2: PluginRegistryManifest = {
  id: 'com.test.another-plugin',
  name: 'Another Plugin',
  version: '2.0.0',
  author: 'Another Author',
  description: 'Another plugin for data sources',
  category: 'data-sources',
  icon: 'Database',
  tools: [],
  keywords: ['data', 'database'],
};

describe('PluginRegistryManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let registry: PluginRegistryManager;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-plugin-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    registry = new PluginRegistryManager(bus, store);
    await registry.init();
  });

  afterEach(() => {
    registry.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Install / Uninstall
  // ---------------------------------------------------------------------------

  describe('install / uninstall', () => {
    it('installs a plugin and returns RegisteredPlugin', () => {
      const plugin = registry.install(SAMPLE_MANIFEST);
      expect(plugin.id).toBe('com.test.sample-plugin');
      expect(plugin.manifest.name).toBe('Sample Plugin');
      expect(plugin.enabled).toBe(true);
      expect(plugin.install_source).toBe('registry');
      expect(plugin.download_count).toBe(0);
      expect(plugin.rating_avg).toBe(0);
      expect(plugin.rating_count).toBe(0);
    });

    it('installs with custom source and owner', () => {
      const plugin = registry.install(SAMPLE_MANIFEST, 'local', 'user_1');
      expect(plugin.install_source).toBe('local');
      expect(plugin.owner_uid).toBe('user_1');
    });

    it('emits plugin.installed event', () => {
      const events: any[] = [];
      bus.on('plugin.installed', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);

      expect(events).toHaveLength(1);
      expect(events[0].plugin.id).toBe('com.test.sample-plugin');
    });

    it('uninstalls a plugin', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.uninstall('com.test.sample-plugin');

      const result = registry.get('com.test.sample-plugin');
      expect(result).toBeNull();
    });

    it('emits plugin.uninstalled event', () => {
      const events: any[] = [];
      bus.on('plugin.uninstalled', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);
      registry.uninstall('com.test.sample-plugin');

      expect(events).toHaveLength(1);
      expect(events[0].pluginId).toBe('com.test.sample-plugin');
    });
  });

  // ---------------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------------

  describe('enable / disable', () => {
    it('disables a plugin', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.disable('com.test.sample-plugin');

      const plugin = registry.get('com.test.sample-plugin');
      expect(plugin!.enabled).toBe(false);
    });

    it('re-enables a disabled plugin', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.disable('com.test.sample-plugin');
      registry.enable('com.test.sample-plugin');

      const plugin = registry.get('com.test.sample-plugin');
      expect(plugin!.enabled).toBe(true);
    });

    it('emits plugin.enabled event', () => {
      const events: any[] = [];
      bus.on('plugin.enabled', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);
      registry.disable('com.test.sample-plugin');
      registry.enable('com.test.sample-plugin');

      expect(events).toHaveLength(1);
      expect(events[0].pluginId).toBe('com.test.sample-plugin');
    });

    it('emits plugin.disabled event', () => {
      const events: any[] = [];
      bus.on('plugin.disabled', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);
      registry.disable('com.test.sample-plugin');

      expect(events).toHaveLength(1);
      expect(events[0].pluginId).toBe('com.test.sample-plugin');
    });
  });

  // ---------------------------------------------------------------------------
  // List / Search
  // ---------------------------------------------------------------------------

  describe('list / search', () => {
    it('lists all installed plugins', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const plugins = registry.list();
      expect(plugins).toHaveLength(2);
    });

    it('filters by category', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const tools = registry.list('tools');
      expect(tools).toHaveLength(1);
      expect(tools[0].id).toBe('com.test.sample-plugin');

      const dataSources = registry.list('data-sources');
      expect(dataSources).toHaveLength(1);
      expect(dataSources[0].id).toBe('com.test.another-plugin');
    });

    it('searches by name', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const results = registry.search('Sample');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('com.test.sample-plugin');
    });

    it('searches by description', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const results = registry.search('data sources');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('com.test.another-plugin');
    });

    it('searches by keywords', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const results = registry.search('demo');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('com.test.sample-plugin');
    });

    it('search with category filter', () => {
      registry.install(SAMPLE_MANIFEST);
      registry.install(SAMPLE_MANIFEST_2);

      const results = registry.search('plugin', 'tools');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('com.test.sample-plugin');
    });

    it('get returns null for unknown plugin', () => {
      const result = registry.get('com.test.nonexistent');
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Rating
  // ---------------------------------------------------------------------------

  describe('rate', () => {
    it('rates a plugin and returns new average', () => {
      registry.install(SAMPLE_MANIFEST);

      const result = registry.rate('com.test.sample-plugin', 'user_1', 4);
      expect(result.newAvg).toBe(4);
    });

    it('calculates average across multiple users', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.rate('com.test.sample-plugin', 'user_1', 5);
      const result = registry.rate('com.test.sample-plugin', 'user_2', 3);

      expect(result.newAvg).toBe(4); // (5 + 3) / 2
    });

    it('updates rating when same user rates again', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.rate('com.test.sample-plugin', 'user_1', 2);
      const result = registry.rate('com.test.sample-plugin', 'user_1', 5);

      expect(result.newAvg).toBe(5); // only one rating now (updated)
    });

    it('updates plugin rating_avg and rating_count', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.rate('com.test.sample-plugin', 'user_1', 4);
      registry.rate('com.test.sample-plugin', 'user_2', 2);

      const plugin = registry.get('com.test.sample-plugin');
      expect(plugin!.rating_count).toBe(2);
      expect(plugin!.rating_avg).toBe(3); // (4 + 2) / 2
    });

    it('emits plugin.rated event', () => {
      const events: any[] = [];
      bus.on('plugin.rated', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);
      registry.rate('com.test.sample-plugin', 'user_1', 5, 'Great plugin!');

      expect(events).toHaveLength(1);
      expect(events[0].pluginId).toBe('com.test.sample-plugin');
      expect(events[0].rating).toBe(5);
      expect(events[0].review).toBe('Great plugin!');
    });
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  describe('settings', () => {
    it('sets and gets a setting', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.setSetting('com.test.sample-plugin', 'api_key', 'secret123');
      const settings = registry.getSettings('com.test.sample-plugin');

      expect(settings.api_key).toBe('secret123');
    });

    it('handles multiple settings', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.setSetting('com.test.sample-plugin', 'api_key', 'secret123');
      registry.setSetting('com.test.sample-plugin', 'enabled', true);
      registry.setSetting('com.test.sample-plugin', 'count', 42);

      const settings = registry.getSettings('com.test.sample-plugin');
      expect(settings.api_key).toBe('secret123');
      expect(settings.enabled).toBe(true);
      expect(settings.count).toBe(42);
    });

    it('overwrites existing setting', () => {
      registry.install(SAMPLE_MANIFEST);

      registry.setSetting('com.test.sample-plugin', 'api_key', 'old');
      registry.setSetting('com.test.sample-plugin', 'api_key', 'new');

      const settings = registry.getSettings('com.test.sample-plugin');
      expect(settings.api_key).toBe('new');
    });

    it('returns empty object for plugin with no settings', () => {
      registry.install(SAMPLE_MANIFEST);
      const settings = registry.getSettings('com.test.sample-plugin');
      expect(settings).toEqual({});
    });

    it('emits plugin.setting.changed event', () => {
      const events: any[] = [];
      bus.on('plugin.setting.changed', (data: any) => events.push(data));

      registry.install(SAMPLE_MANIFEST);
      registry.setSetting('com.test.sample-plugin', 'api_key', 'secret');

      expect(events).toHaveLength(1);
      expect(events[0].pluginId).toBe('com.test.sample-plugin');
      expect(events[0].key).toBe('api_key');
      expect(events[0].value).toBe('secret');
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('plugins survive store close and reopen', async () => {
      registry.install(SAMPLE_MANIFEST, 'local', 'user_1');
      registry.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const registry2 = new PluginRegistryManager(bus, store2);
      await registry2.init();

      try {
        const plugins = registry2.list();
        expect(plugins).toHaveLength(1);
        expect(plugins[0].id).toBe('com.test.sample-plugin');
        expect(plugins[0].manifest.name).toBe('Sample Plugin');
        expect(plugins[0].install_source).toBe('local');
        expect(plugins[0].owner_uid).toBe('user_1');
      } finally {
        registry2.shutdown();
        store2.close();
      }
    });

    it('ratings persist across restart', async () => {
      registry.install(SAMPLE_MANIFEST);
      registry.rate('com.test.sample-plugin', 'user_1', 5);
      registry.rate('com.test.sample-plugin', 'user_2', 3);
      registry.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const registry2 = new PluginRegistryManager(bus, store2);
      await registry2.init();

      try {
        const plugin = registry2.get('com.test.sample-plugin');
        expect(plugin!.rating_count).toBe(2);
        expect(plugin!.rating_avg).toBe(4);
      } finally {
        registry2.shutdown();
        store2.close();
      }
    });

    it('settings persist across restart', async () => {
      registry.install(SAMPLE_MANIFEST);
      registry.setSetting('com.test.sample-plugin', 'api_key', 'persistent-key');
      registry.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const registry2 = new PluginRegistryManager(bus, store2);
      await registry2.init();

      try {
        const settings = registry2.getSettings('com.test.sample-plugin');
        expect(settings.api_key).toBe('persistent-key');
      } finally {
        registry2.shutdown();
        store2.close();
      }
    });
  });
});
