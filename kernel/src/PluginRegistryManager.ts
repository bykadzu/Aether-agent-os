/**
 * Aether Kernel - Plugin Registry Manager (v0.4 Wave 2)
 *
 * Manages the plugin lifecycle for Aether OS:
 * - Install / uninstall plugins from manifests
 * - Enable / disable installed plugins
 * - Search and filter by category / keywords
 * - Rating system with per-user reviews
 * - Per-plugin settings storage
 * - Persistent storage via StateStore (direct DB access)
 */

import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import { getDefaultPlugins } from './seedPlugins.js';

// ---------------------------------------------------------------------------
// Types (local — Agent 2 will add to protocol.ts later)
// ---------------------------------------------------------------------------

export type PluginCategory =
  | 'tools'
  | 'llm-providers'
  | 'data-sources'
  | 'notification-channels'
  | 'auth-providers'
  | 'themes'
  | 'widgets';

export interface PluginSettingSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  default?: any;
  options?: string[];
  description?: string;
}

export interface PluginRegistryManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  icon: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
  }>;
  dependencies?: string[];
  settings?: PluginSettingSchema[];
  events?: string[];
  min_aether_version?: string;
  keywords?: string[];
  repository?: string;
}

export interface RegisteredPlugin {
  id: string;
  manifest: PluginRegistryManifest;
  installed_at: number;
  updated_at: number;
  enabled: boolean;
  install_source: 'local' | 'registry' | 'url';
  owner_uid?: string;
  download_count: number;
  rating_avg: number;
  rating_count: number;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class PluginRegistryManager {
  private stmts!: {
    insertPlugin: any;
    getPlugin: any;
    getAllPlugins: any;
    deletePlugin: any;
    setEnabled: any;
    updateRating: any;
    upsertRating: any;
    getRatingSum: any;
    getSetting: any;
    getAllSettings: any;
    upsertSetting: any;
  };

  constructor(
    private bus: EventBus,
    private state: StateStore,
  ) {}

  async init(): Promise<void> {
    const db = (this.state as any).db;

    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_registry (
        id TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        install_source TEXT,
        owner_uid TEXT,
        download_count INTEGER DEFAULT 0,
        rating_avg REAL DEFAULT 0.0,
        rating_count INTEGER DEFAULT 0
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_ratings (
        plugin_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        review TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, user_id)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS plugin_settings (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (plugin_id, key)
      )
    `);

    this.stmts = {
      insertPlugin: db.prepare(
        `INSERT OR REPLACE INTO plugin_registry (id, manifest, installed_at, updated_at, enabled, install_source, owner_uid, download_count, rating_avg, rating_count)
         VALUES (@id, @manifest, @installed_at, @updated_at, @enabled, @install_source, @owner_uid, @download_count, @rating_avg, @rating_count)`,
      ),
      getPlugin: db.prepare(`SELECT * FROM plugin_registry WHERE id = ?`),
      getAllPlugins: db.prepare(`SELECT * FROM plugin_registry`),
      deletePlugin: db.prepare(`DELETE FROM plugin_registry WHERE id = ?`),
      setEnabled: db.prepare(`UPDATE plugin_registry SET enabled = ?, updated_at = ? WHERE id = ?`),
      updateRating: db.prepare(
        `UPDATE plugin_registry SET rating_avg = ?, rating_count = ?, updated_at = ? WHERE id = ?`,
      ),
      upsertRating: db.prepare(
        `INSERT OR REPLACE INTO plugin_ratings (plugin_id, user_id, rating, review, created_at)
         VALUES (@plugin_id, @user_id, @rating, @review, @created_at)`,
      ),
      getRatingSum: db.prepare(
        `SELECT COALESCE(SUM(rating), 0) AS total, COUNT(*) AS cnt FROM plugin_ratings WHERE plugin_id = ?`,
      ),
      getSetting: db.prepare(`SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?`),
      getAllSettings: db.prepare(`SELECT key, value FROM plugin_settings WHERE plugin_id = ?`),
      upsertSetting: db.prepare(
        `INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)`,
      ),
    };

    // Seed default plugins if registry is empty
    const existingPlugins = this.stmts.getAllPlugins.all();
    if (existingPlugins.length === 0) {
      const defaults = getDefaultPlugins();
      for (const manifest of defaults) {
        this.install(manifest, 'registry', 'system');
      }
    }
  }

  install(
    manifest: PluginRegistryManifest,
    source: 'local' | 'registry' | 'url' = 'registry',
    ownerUid?: string,
  ): RegisteredPlugin {
    const now = Date.now();
    this.stmts.insertPlugin.run({
      id: manifest.id,
      manifest: JSON.stringify(manifest),
      installed_at: now,
      updated_at: now,
      enabled: 1,
      install_source: source,
      owner_uid: ownerUid || null,
      download_count: 0,
      rating_avg: 0,
      rating_count: 0,
    });

    const plugin: RegisteredPlugin = {
      id: manifest.id,
      manifest,
      installed_at: now,
      updated_at: now,
      enabled: true,
      install_source: source,
      owner_uid: ownerUid,
      download_count: 0,
      rating_avg: 0,
      rating_count: 0,
    };

    this.bus.emit('plugin.installed', { plugin });
    return plugin;
  }

  uninstall(pluginId: string): void {
    this.stmts.deletePlugin.run(pluginId);
    this.bus.emit('plugin.uninstalled', { pluginId });
  }

  enable(pluginId: string): void {
    this.stmts.setEnabled.run(1, Date.now(), pluginId);
    this.bus.emit('plugin.enabled', { pluginId });
  }

  disable(pluginId: string): void {
    this.stmts.setEnabled.run(0, Date.now(), pluginId);
    this.bus.emit('plugin.disabled', { pluginId });
  }

  list(category?: string): RegisteredPlugin[] {
    const rows = this.stmts.getAllPlugins.all();
    const plugins = rows.map((row: any) => this.rowToPlugin(row));
    if (category) {
      return plugins.filter((p) => p.manifest.category === category);
    }
    return plugins;
  }

  search(query: string, category?: string): RegisteredPlugin[] {
    const q = query.toLowerCase();
    return this.list(category).filter((p) => {
      const m = p.manifest;
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        (m.keywords && m.keywords.some((kw) => kw.toLowerCase().includes(q)))
      );
    });
  }

  get(pluginId: string): RegisteredPlugin | null {
    const row = this.stmts.getPlugin.get(pluginId);
    if (!row) return null;
    return this.rowToPlugin(row);
  }

  rate(pluginId: string, userId: string, rating: number, review?: string): { newAvg: number } {
    this.stmts.upsertRating.run({
      plugin_id: pluginId,
      user_id: userId,
      rating,
      review: review || null,
      created_at: Date.now(),
    });

    const { total, cnt } = this.stmts.getRatingSum.get(pluginId) as {
      total: number;
      cnt: number;
    };

    const newAvgVal = cnt > 0 ? total / cnt : 0;
    this.stmts.updateRating.run(newAvgVal, cnt, Date.now(), pluginId);
    this.bus.emit('plugin.rated', { pluginId, userId, rating, review });

    return { newAvg: newAvgVal };
  }

  getSettings(pluginId: string): Record<string, any> {
    const rows = this.stmts.getAllSettings.all(pluginId) as Array<{
      key: string;
      value: string;
    }>;
    const settings: Record<string, any> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    return settings;
  }

  setSetting(pluginId: string, key: string, value: any): void {
    this.stmts.upsertSetting.run(pluginId, key, JSON.stringify(value));
    this.bus.emit('plugin.setting.changed', { pluginId, key, value });
  }

  shutdown(): void {
    // Nothing to clean up
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private rowToPlugin(row: any): RegisteredPlugin {
    return {
      id: row.id,
      manifest: JSON.parse(row.manifest),
      installed_at: row.installed_at,
      updated_at: row.updated_at,
      enabled: row.enabled === 1,
      install_source: row.install_source,
      owner_uid: row.owner_uid,
      download_count: row.download_count || 0,
      rating_avg: row.rating_avg || 0,
      rating_count: row.rating_count || 0,
    };
  }
}
