import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { PluginManager } from '../PluginManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import os from 'node:os';

describe('PluginManager', () => {
  let bus: EventBus;
  let pm: PluginManager;
  let testRoot: string;

  beforeEach(() => {
    bus = new EventBus();
    testRoot = path.join(
      os.tmpdir(),
      `aether-plugin-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(testRoot, { recursive: true });
    pm = new PluginManager(bus, testRoot);
  });

  afterEach(() => {
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function createPluginDir(uid: string, pluginName: string, manifest: any, handlerCode?: string) {
    const pluginDir = path.join(testRoot, 'home', uid, '.config', 'plugins', pluginName);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'manifest.json'), JSON.stringify(manifest));
    if (handlerCode) {
      fs.writeFileSync(path.join(pluginDir, 'handler.js'), handlerCode);
    }
    return pluginDir;
  }

  describe('loadPluginsForAgent()', () => {
    it('scans plugin directory and loads valid manifests', async () => {
      createPluginDir(
        'agent_1',
        'test-plugin',
        {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'A test plugin',
          tools: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {},
              handler: 'handler.js',
            },
          ],
        },
        'export default async function(params, ctx) { return "test result"; }',
      );

      const plugins = await pm.loadPluginsForAgent(1, 'agent_1');
      expect(plugins).toHaveLength(1);
      expect(plugins[0].manifest.name).toBe('test-plugin');
    });

    it('returns empty array when plugin dir does not exist', async () => {
      const plugins = await pm.loadPluginsForAgent(1, 'agent_nonexistent');
      expect(plugins).toEqual([]);
    });
  });

  describe('manifest validation', () => {
    it('rejects plugins with missing name', async () => {
      createPluginDir('agent_1', 'bad-plugin', {
        version: '1.0.0',
        description: 'Missing name',
        tools: [],
      });

      const errorHandler = vi.fn();
      bus.on('plugin.error', errorHandler);

      const plugins = await pm.loadPluginsForAgent(1, 'agent_1');
      expect(plugins).toHaveLength(0);
      expect(errorHandler).toHaveBeenCalled();
    });

    it('rejects plugins with missing tools array', async () => {
      createPluginDir('agent_1', 'bad-plugin', {
        name: 'bad-plugin',
        version: '1.0.0',
        description: 'Missing tools',
      });

      const errorHandler = vi.fn();
      bus.on('plugin.error', errorHandler);

      const plugins = await pm.loadPluginsForAgent(1, 'agent_1');
      expect(plugins).toHaveLength(0);
    });
  });

  describe('handler path security', () => {
    it('rejects handler paths that escape plugin directory', async () => {
      createPluginDir('agent_1', 'evil-plugin', {
        name: 'evil-plugin',
        version: '1.0.0',
        description: 'Evil plugin',
        tools: [
          {
            name: 'evil_tool',
            description: 'Escapes directory',
            parameters: {},
            handler: '../../etc/passwd',
          },
        ],
      });

      const errorHandler = vi.fn();
      bus.on('plugin.error', errorHandler);

      const plugins = await pm.loadPluginsForAgent(1, 'agent_1');
      expect(plugins).toHaveLength(0);
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('getPluginInfos()', () => {
    it('returns plugin info summaries', async () => {
      createPluginDir(
        'agent_1',
        'test-plugin',
        {
          name: 'test-plugin',
          version: '2.0.0',
          description: 'Test desc',
          tools: [
            {
              name: 'tool_a',
              description: 'Tool A',
              parameters: {},
              handler: 'handler.js',
            },
          ],
        },
        'export default async function() { return "ok"; }',
      );

      await pm.loadPluginsForAgent(1, 'agent_1');
      const infos = pm.getPluginInfos(1);

      expect(infos).toHaveLength(1);
      expect(infos[0].name).toBe('test-plugin');
      expect(infos[0].version).toBe('2.0.0');
      expect(infos[0].tools).toEqual(['tool_a']);
    });
  });

  describe('installPlugin()', () => {
    it('creates plugin directory and files', () => {
      const manifest = {
        name: 'installed-plugin',
        version: '1.0.0',
        description: 'Installed via API',
        tools: [{ name: 'my_tool', description: 'test', parameters: {}, handler: 'handler.js' }],
      };

      const handlers = {
        'handler.js': 'export default async function() { return "installed"; }',
      };

      const dir = pm.installPlugin(1, 'agent_1', manifest, handlers);
      expect(fs.existsSync(path.join(dir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'handler.js'))).toBe(true);
    });

    it('rejects plugin names that escape directory', () => {
      const manifest = {
        name: '../escape',
        version: '1.0.0',
        description: 'Evil',
        tools: [],
      };

      expect(() => pm.installPlugin(1, 'agent_1', manifest, {})).toThrow('Invalid plugin name');
    });
  });

  describe('unloadPlugins()', () => {
    it('removes plugins from memory', async () => {
      createPluginDir(
        'agent_1',
        'test-plugin',
        {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'test',
          tools: [{ name: 'tool', description: 'test', parameters: {}, handler: 'handler.js' }],
        },
        'export default async function() { return "ok"; }',
      );

      await pm.loadPluginsForAgent(1, 'agent_1');
      expect(pm.getPlugins(1)).toHaveLength(1);

      pm.unloadPlugins(1);
      expect(pm.getPlugins(1)).toHaveLength(0);
    });
  });
});

// Need vi import for mock functions used within the describe block
import { vi } from 'vitest';
