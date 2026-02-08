/**
 * Aether Kernel - Integration Manager (v0.4 Wave 2)
 *
 * Manages external service integrations (GitHub, Slack, etc.).
 * Each integration type implements the IIntegration interface for
 * uniform credential management, action execution, and logging.
 *
 * Follows the WebhookManager pattern: constructor(bus, state), init/shutdown lifecycle.
 */

import * as crypto from 'node:crypto';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import type { IIntegration } from './integrations/IIntegration.js';
import { GitHubIntegration } from './integrations/GitHubIntegration.js';
import type { IntegrationConfig, IntegrationInfo } from '@aether/shared';

export class IntegrationManager {
  private bus: EventBus;
  private state: StateStore;
  private integrationTypes = new Map<string, IIntegration>();

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  async init(): Promise<void> {
    this.integrationTypes.set('github', new GitHubIntegration());
  }

  register(config: IntegrationConfig, ownerUid?: string): IntegrationInfo {
    const impl = this.integrationTypes.get(config.type);
    if (!impl) {
      throw new Error(`Unknown integration type: ${config.type}`);
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    this.state.insertIntegration({
      id,
      type: config.type,
      name: config.name,
      enabled: 1,
      owner_uid: ownerUid || null,
      credentials: config.credentials ? JSON.stringify(config.credentials) : null,
      settings: config.settings ? JSON.stringify(config.settings) : null,
      status: 'disconnected',
      last_error: null,
      created_at: now,
      updated_at: now,
    });

    const info = this.hydrateIntegration(this.state.getIntegration(id)!, impl);
    this.bus.emit('integration.registered', { integration: info });
    return info;
  }

  unregister(integrationId: string): void {
    const existing = this.state.getIntegration(integrationId);
    if (!existing) return;
    this.state.deleteIntegration(integrationId);
    this.bus.emit('integration.unregistered', { integrationId });
  }

  configure(integrationId: string, settings: Record<string, any>): void {
    this.state.updateIntegrationSettings(integrationId, JSON.stringify(settings));
  }

  enable(integrationId: string): void {
    this.state.setIntegrationEnabled(integrationId, true);
    this.bus.emit('integration.enabled', { integrationId });
  }

  disable(integrationId: string): void {
    this.state.setIntegrationEnabled(integrationId, false);
    this.bus.emit('integration.disabled', { integrationId });
  }

  list(): IntegrationInfo[] {
    const rows = this.state.getAllIntegrations();
    return rows.map((row: any) => {
      const impl = this.integrationTypes.get(row.type);
      return this.hydrateIntegration(row, impl || null);
    });
  }

  get(integrationId: string): IntegrationInfo | null {
    const row = this.state.getIntegration(integrationId);
    if (!row) return null;
    const impl = this.integrationTypes.get(row.type);
    return this.hydrateIntegration(row, impl || null);
  }

  async test(integrationId: string): Promise<{ success: boolean; message: string }> {
    const row = this.state.getIntegration(integrationId);
    if (!row) return { success: false, message: 'Integration not found' };

    const impl = this.integrationTypes.get(row.type);
    if (!impl) return { success: false, message: `Unknown integration type: ${row.type}` };

    const credentials = row.credentials ? JSON.parse(row.credentials) : {};
    const result = await impl.testConnection(credentials);

    this.state.updateIntegrationStatus(
      integrationId,
      result.success ? 'connected' : 'error',
      result.success ? null : result.message,
    );

    this.bus.emit('integration.tested', {
      integrationId,
      success: result.success,
      message: result.message,
    });

    return result;
  }

  async execute(integrationId: string, action: string, params?: Record<string, any>): Promise<any> {
    const row = this.state.getIntegration(integrationId);
    if (!row) throw new Error('Integration not found');

    const impl = this.integrationTypes.get(row.type);
    if (!impl) throw new Error(`Unknown integration type: ${row.type}`);

    const credentials = row.credentials ? JSON.parse(row.credentials) : {};
    const startTime = Date.now();

    try {
      const result = await impl.executeAction(action, params || {}, credentials);
      const durationMs = Date.now() - startTime;

      this.state.insertIntegrationLog({
        integration_id: integrationId,
        action,
        status: 'success',
        request_summary: JSON.stringify(params || {}).slice(0, 500),
        response_summary: JSON.stringify(result).slice(0, 500),
        duration_ms: durationMs,
        created_at: Date.now(),
      });

      this.bus.emit('integration.action_result', { integrationId, action, result });
      return result;
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      this.state.insertIntegrationLog({
        integration_id: integrationId,
        action,
        status: 'error',
        request_summary: JSON.stringify(params || {}).slice(0, 500),
        response_summary: err.message || String(err),
        duration_ms: durationMs,
        created_at: Date.now(),
      });

      this.state.updateIntegrationStatus(integrationId, 'error', err.message);
      this.bus.emit('integration.error', { integrationId, action, error: err.message });
      throw err;
    }
  }

  shutdown(): void {
    this.integrationTypes.clear();
  }

  private hydrateIntegration(row: any, impl: IIntegration | null): IntegrationInfo {
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: Boolean(row.enabled),
      owner_uid: row.owner_uid || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at,
      settings: row.settings
        ? typeof row.settings === 'string'
          ? JSON.parse(row.settings)
          : row.settings
        : undefined,
      available_actions: impl ? impl.getAvailableActions() : [],
      status: row.status || 'disconnected',
      last_error: row.last_error || undefined,
    };
  }
}
