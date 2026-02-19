/**
 * Aether Kernel - Plugin Manager
 *
 * Manages agent plugins that extend the tool set available to AI agents.
 * Plugins live in each agent's home directory at ~/.config/plugins/ and
 * are discovered on agent boot.
 *
 * Each plugin is a directory containing:
 *   - manifest.json: describes the plugin and its tools
 *   - handler.js: exports a default async function that executes the tool
 *
 * Security: plugins run in the agent's process context (same sandbox).
 * Handler paths are validated to prevent directory traversal.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { PID } from '@aether/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PluginToolParameter {
  type: string;
  description: string;
  required?: boolean;
}

export interface PluginToolManifest {
  name: string;
  description: string;
  parameters: Record<string, PluginToolParameter>;
  handler: string;
  requiresApproval?: boolean;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  tools: PluginToolManifest[];
}

export interface PluginToolHandler {
  (params: Record<string, any>, context: PluginContext): Promise<string>;
}

export interface PluginContext {
  pid: PID;
  cwd: string;
  kernel: any;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  handlers: Map<string, PluginToolHandler>;
}

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  tools: string[];
}

// ---------------------------------------------------------------------------
// Plugin Manager
// ---------------------------------------------------------------------------

export class PluginManager {
  private plugins = new Map<PID, LoadedPlugin[]>();
  private bus: EventBus;
  private fsRoot: string;

  constructor(bus: EventBus, fsRoot: string = '/tmp/aether') {
    this.bus = bus;
    this.fsRoot = fsRoot;
  }

  /**
   * Scan and load plugins for a given agent process.
   * Looks in the agent's home directory at ~/.config/plugins/
   */
  async loadPluginsForAgent(pid: PID, uid: string): Promise<LoadedPlugin[]> {
    const pluginBaseDir = join(this.fsRoot, 'home', uid, '.config', 'plugins');

    if (!existsSync(pluginBaseDir)) {
      this.plugins.set(pid, []);
      return [];
    }

    const loaded: LoadedPlugin[] = [];
    let entries: string[];

    try {
      entries = readdirSync(pluginBaseDir);
    } catch {
      this.plugins.set(pid, []);
      return [];
    }

    for (const entry of entries) {
      const pluginDir = join(pluginBaseDir, entry);
      const manifestPath = join(pluginDir, 'manifest.json');

      if (!existsSync(manifestPath)) continue;

      try {
        const plugin = await this.loadPlugin(pluginDir, manifestPath, pid);
        if (plugin) {
          loaded.push(plugin);
          this.bus.emit('plugin.loaded', {
            pid,
            name: plugin.manifest.name,
            version: plugin.manifest.version,
            tools: plugin.manifest.tools.map((t) => t.name),
          });
        }
      } catch (err: unknown) {
        this.bus.emit('plugin.error', {
          pid,
          plugin: entry,
          error: errMsg(err),
        });
      }
    }

    this.plugins.set(pid, loaded);
    return loaded;
  }

  /**
   * Load a single plugin from its directory.
   */
  private async loadPlugin(
    pluginDir: string,
    manifestPath: string,
    pid: PID,
  ): Promise<LoadedPlugin | null> {
    const raw = readFileSync(manifestPath, 'utf-8');
    const manifest: PluginManifest = JSON.parse(raw);

    // Validate required fields
    if (!manifest.name || !manifest.version || !Array.isArray(manifest.tools)) {
      throw new Error(`Invalid manifest: missing name, version, or tools`);
    }

    const handlers = new Map<string, PluginToolHandler>();

    for (const tool of manifest.tools) {
      if (!tool.name || !tool.handler) {
        throw new Error(
          `Invalid tool definition in plugin ${manifest.name}: missing name or handler`,
        );
      }

      // Security: validate handler path doesn't escape the plugin directory
      const handlerPath = resolve(pluginDir, tool.handler);
      const relPath = relative(pluginDir, handlerPath);
      if (relPath.startsWith('..') || isAbsolute(relPath)) {
        throw new Error(
          `Security: handler path "${tool.handler}" escapes plugin directory in ${manifest.name}`,
        );
      }

      if (!existsSync(handlerPath)) {
        throw new Error(`Handler not found: ${tool.handler} in plugin ${manifest.name}`);
      }

      // Load handler via dynamic import
      const handlerUrl = pathToFileURL(handlerPath).href;
      const mod = await import(handlerUrl);
      const handler = mod.default;

      if (typeof handler !== 'function') {
        throw new Error(
          `Handler ${tool.handler} in ${manifest.name} does not export a default function`,
        );
      }

      handlers.set(tool.name, handler);
    }

    return { manifest, dir: pluginDir, handlers };
  }

  /**
   * Get all loaded plugins for an agent process.
   */
  getPlugins(pid: PID): LoadedPlugin[] {
    return this.plugins.get(pid) || [];
  }

  /**
   * Get plugin info summaries for an agent process.
   */
  getPluginInfos(pid: PID): PluginInfo[] {
    const loaded = this.plugins.get(pid) || [];
    return loaded.map((p) => ({
      name: p.manifest.name,
      version: p.manifest.version,
      description: p.manifest.description,
      tools: p.manifest.tools.map((t) => t.name),
    }));
  }

  /**
   * Install a plugin from an inline manifest and handler code.
   * Creates the plugin directory and files under the agent's ~/.config/plugins/.
   */
  installPlugin(
    pid: PID,
    uid: string,
    manifest: PluginManifest,
    handlers: Record<string, string>,
  ): string {
    const pluginBaseDir = join(this.fsRoot, 'home', uid, '.config', 'plugins');
    const pluginDir = join(pluginBaseDir, manifest.name);

    // Security: validate the plugin name doesn't escape the directory
    const relPath = relative(pluginBaseDir, pluginDir);
    if (relPath.startsWith('..') || isAbsolute(relPath)) {
      throw new Error(`Invalid plugin name: "${manifest.name}"`);
    }

    mkdirSync(pluginDir, { recursive: true });

    // Write manifest
    writeFileSync(join(pluginDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Write handler files
    for (const [filename, code] of Object.entries(handlers)) {
      const handlerPath = resolve(pluginDir, filename);
      const handlerRel = relative(pluginDir, handlerPath);
      if (handlerRel.startsWith('..') || isAbsolute(handlerRel)) {
        throw new Error(`Security: handler path "${filename}" escapes plugin directory`);
      }
      writeFileSync(handlerPath, code);
    }

    return pluginDir;
  }

  /**
   * Unload all plugins for an agent (on process exit).
   */
  unloadPlugins(pid: PID): void {
    this.plugins.delete(pid);
  }
}
