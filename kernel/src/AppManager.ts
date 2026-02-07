/**
 * Aether Kernel - App Manager (v0.4 Wave 1)
 *
 * Manages the app lifecycle for Aether OS:
 * - Install / uninstall apps from manifests
 * - Enable / disable installed apps
 * - Permission model per app
 * - Persistent storage via StateStore
 */

import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import type { AetherAppManifest, InstalledApp, AppPermission } from '@aether/shared';

export class AppManager {
  constructor(
    private bus: EventBus,
    private state: StateStore,
  ) {}

  async init(): Promise<void> {
    // Nothing to initialize for now
  }

  install(
    manifest: AetherAppManifest,
    source: 'local' | 'registry' | 'url' = 'registry',
    ownerUid?: string,
  ): InstalledApp {
    const now = Date.now();
    const app: InstalledApp = {
      id: manifest.id,
      manifest,
      installed_at: now,
      updated_at: now,
      enabled: true,
      install_source: source,
      owner_uid: ownerUid,
    };
    this.state.insertApp({
      id: app.id,
      manifest: JSON.stringify(manifest),
      installed_at: now,
      updated_at: now,
      enabled: 1,
      install_source: source,
      owner_uid: ownerUid || null,
    });
    this.bus.emit('app.installed', { app });
    return app;
  }

  uninstall(appId: string): void {
    this.state.deleteApp(appId);
    this.bus.emit('app.uninstalled', { appId });
  }

  enable(appId: string): void {
    this.state.setAppEnabled(appId, true);
    this.bus.emit('app.enabled', { appId });
  }

  disable(appId: string): void {
    this.state.setAppEnabled(appId, false);
    this.bus.emit('app.disabled', { appId });
  }

  list(): InstalledApp[] {
    const rows = this.state.getAllApps();
    return rows.map((row: any) => ({
      id: row.id,
      manifest: JSON.parse(row.manifest),
      installed_at: row.installed_at,
      updated_at: row.updated_at,
      enabled: row.enabled === 1,
      install_source: row.install_source,
      owner_uid: row.owner_uid,
    }));
  }

  get(appId: string): InstalledApp | null {
    const row = this.state.getApp(appId);
    if (!row) return null;
    return {
      id: row.id,
      manifest: JSON.parse(row.manifest),
      installed_at: row.installed_at,
      updated_at: row.updated_at,
      enabled: row.enabled === 1,
      install_source: row.install_source,
      owner_uid: row.owner_uid,
    };
  }

  getPermissions(appId: string): AppPermission[] {
    const app = this.get(appId);
    return app?.manifest.permissions || [];
  }

  checkPermission(appId: string, permission: AppPermission): boolean {
    const perms = this.getPermissions(appId);
    return perms.includes(permission);
  }

  shutdown(): void {
    // Nothing to clean up
  }
}
