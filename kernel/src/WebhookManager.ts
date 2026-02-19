/**
 * Aether Kernel - Webhook Manager (v0.4 Wave 1)
 *
 * Provides outbound and inbound webhook infrastructure:
 *
 * 1. **Outbound Webhooks**: Subscribe to kernel events and fire HTTP POST
 *    requests to registered URLs with HMAC-SHA256 signing.
 *
 * 2. **Inbound Webhooks**: Accept external HTTP requests via token-based
 *    endpoints and spawn agents in response.
 *
 * Event matching uses glob-style patterns:
 *   - "agent.*" matches "agent.completed", "agent.failed", etc.
 *   - "*" matches everything
 *   - "process.spawned" matches exactly "process.spawned"
 *
 * REST endpoints (handled by server/src/routes/v1.ts):
 *   POST   /api/v1/webhooks           - register outbound webhook
 *   GET    /api/v1/webhooks           - list outbound webhooks
 *   DELETE /api/v1/webhooks/:id       - unregister outbound webhook
 *   PUT    /api/v1/webhooks/:id/enable  - enable webhook
 *   PUT    /api/v1/webhooks/:id/disable - disable webhook
 *   GET    /api/v1/webhooks/:id/logs  - get webhook delivery logs
 *   POST   /api/v1/webhooks/inbound   - create inbound webhook
 *   GET    /api/v1/webhooks/inbound   - list inbound webhooks
 *   DELETE /api/v1/webhooks/inbound/:id - delete inbound webhook
 *   POST   /api/v1/hooks/:token       - trigger inbound webhook
 */

import * as crypto from 'node:crypto';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { StateStore } from './StateStore.js';
import type { AgentConfig } from '@aether/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  name: string;
  url: string;
  secret?: string;
  events: string[];
  filters?: Record<string, any>;
  headers?: Record<string, string>;
  enabled: boolean;
  owner_uid?: string;
  retry_count: number;
  timeout_ms: number;
  created_at: number;
  last_triggered?: number;
  failure_count: number;
}

export type DeliveryStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

export interface WebhookLog {
  id: number;
  webhook_id: string;
  event_type: string;
  payload: string;
  status_code?: number;
  response_body?: string;
  duration_ms?: number;
  success: boolean;
  delivery_status: DeliveryStatus;
  created_at: number;
}

export interface DlqEntry {
  id: string;
  webhook_id: string;
  event_type: string;
  payload: string;
  error: string | null;
  attempts: number;
  created_at: number;
  retried_at: number | null;
}

export interface InboundWebhook {
  id: string;
  name: string;
  token: string;
  agent_config: AgentConfig;
  transform?: string;
  enabled: boolean;
  owner_uid?: string;
  last_triggered?: number;
  trigger_count: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Glob-style event pattern matching.
 * - "*" matches everything
 * - "agent.*" matches "agent.completed", "agent.failed", etc.
 * - "process.spawned" matches exactly "process.spawned"
 */
export function matchesPattern(pattern: string, eventType: string): boolean {
  if (pattern === '*') return true;
  if (pattern === eventType) return true;
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2);
    return eventType.startsWith(prefix + '.');
  }
  return false;
}

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 */
function signPayload(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ---------------------------------------------------------------------------
// WebhookManager
// ---------------------------------------------------------------------------

export class WebhookManager {
  private bus: EventBus;
  private state: StateStore;
  private eventUnsubscriber: (() => void) | null = null;
  private spawnCallback: ((config: AgentConfig) => Promise<number | null>) | null = null;

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Initialize the webhook manager. Subscribe to kernel events and
   * fire matching outbound webhooks asynchronously.
   */
  async init(): Promise<void> {
    this.eventUnsubscriber = this.bus.on('*', (data: { event: string; data: any }) => {
      // Don't trigger on webhook events to prevent infinite loops
      if (data.event.startsWith('webhook.')) return;

      // Fire asynchronously so we don't block the EventBus
      setTimeout(() => {
        this.fire({ type: data.event, ...data.data }).catch((err) => {
          console.error('[WebhookManager] Error firing webhooks:', err);
        });
      }, 0);
    });
  }

  /**
   * Set the spawn callback for inbound webhooks.
   */
  setSpawnCallback(fn: (config: AgentConfig) => Promise<number | null>): void {
    this.spawnCallback = fn;
  }

  /**
   * Shutdown the webhook manager. Clean up event listeners.
   */
  shutdown(): void {
    if (this.eventUnsubscriber) {
      this.eventUnsubscriber();
      this.eventUnsubscriber = null;
    }
    this.spawnCallback = null;
  }

  // ---------------------------------------------------------------------------
  // Outbound Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Register a new outbound webhook.
   * Returns the webhook ID.
   */
  register(
    name: string,
    url: string,
    events: string[],
    options?: {
      secret?: string;
      filters?: Record<string, any>;
      headers?: Record<string, string>;
      owner_uid?: string;
      retry_count?: number;
      timeout_ms?: number;
    },
  ): string {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.state.insertWebhook({
      id,
      name,
      url,
      secret: options?.secret || null,
      events: JSON.stringify(events),
      filters: options?.filters ? JSON.stringify(options.filters) : null,
      headers: options?.headers ? JSON.stringify(options.headers) : null,
      enabled: 1,
      owner_uid: options?.owner_uid || null,
      retry_count: options?.retry_count ?? 3,
      timeout_ms: options?.timeout_ms ?? 5000,
      created_at: now,
      last_triggered: null,
      failure_count: 0,
    });

    this.bus.emit('webhook.registered', { webhookId: id, name });
    return id;
  }

  /**
   * Unregister (delete) an outbound webhook.
   */
  unregister(webhookId: string): void {
    const existing = this.state.getWebhook(webhookId);
    if (!existing) return;
    this.state.deleteWebhook(webhookId);
    this.bus.emit('webhook.unregistered', { webhookId });
  }

  /**
   * List all outbound webhooks, optionally filtered by owner.
   */
  list(ownerUid?: string): Webhook[] {
    const rows = ownerUid ? this.state.getWebhooksByOwner(ownerUid) : this.state.getAllWebhooks();
    return rows.map((row) => this.hydrateWebhook(row));
  }

  /**
   * Enable an outbound webhook.
   */
  enable(webhookId: string): void {
    this.state.setWebhookEnabled(webhookId, true);
  }

  /**
   * Disable an outbound webhook.
   */
  disable(webhookId: string): void {
    this.state.setWebhookEnabled(webhookId, false);
  }

  /**
   * Get a single webhook by ID.
   */
  getWebhook(webhookId: string): Webhook | null {
    const row = this.state.getWebhook(webhookId);
    return row ? this.hydrateWebhook(row) : null;
  }

  /**
   * Get delivery logs for a webhook.
   */
  getLogs(webhookId: string, limit: number = 50): WebhookLog[] {
    const rows = this.state.getWebhookLogs(webhookId, limit);
    return rows.map((row) => ({
      ...row,
      success: Boolean(row.success),
      delivery_status: (row.success ? 'delivered' : 'failed') as DeliveryStatus,
    }));
  }

  /**
   * Fire all matching outbound webhooks for an event.
   * Called internally when kernel events match registered patterns.
   */
  async fire(event: { type: string; [key: string]: any }): Promise<void> {
    const enabledWebhooks = this.state.getEnabledWebhooks();

    for (const raw of enabledWebhooks) {
      const webhook = this.hydrateWebhook(raw);
      const eventMatches = webhook.events.some((pattern) => matchesPattern(pattern, event.type));
      if (!eventMatches) continue;

      // Check filters if any
      if (webhook.filters) {
        const passes = Object.entries(webhook.filters).every(
          ([key, value]) => event[key] === value,
        );
        if (!passes) continue;
      }

      await this.deliverWebhook(webhook, event);
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound Webhooks
  // ---------------------------------------------------------------------------

  /**
   * Create a new inbound webhook endpoint.
   * Returns the inbound webhook info including the generated token.
   */
  createInbound(
    name: string,
    agentConfig: AgentConfig,
    options?: {
      transform?: string;
      owner_uid?: string;
    },
  ): { id: string; token: string; url: string } {
    const id = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.state.insertInboundWebhook({
      id,
      name,
      token,
      agent_config: JSON.stringify(agentConfig),
      transform: options?.transform || null,
      enabled: 1,
      owner_uid: options?.owner_uid || null,
      last_triggered: null,
      trigger_count: 0,
      created_at: now,
    });

    this.bus.emit('webhook.inbound.created', { inboundId: id, name, token });

    return {
      id,
      token,
      url: `/api/v1/hooks/${token}`,
    };
  }

  /**
   * Delete an inbound webhook.
   */
  deleteInbound(id: string): void {
    const existing = this.state.getInboundWebhook(id);
    if (!existing) return;
    this.state.deleteInboundWebhook(id);
    this.bus.emit('webhook.inbound.deleted', { inboundId: id });
  }

  /**
   * List all inbound webhooks, optionally filtered by owner.
   */
  listInbound(ownerUid?: string): InboundWebhook[] {
    const rows = ownerUid
      ? this.state.getInboundWebhooksByOwner(ownerUid)
      : this.state.getAllInboundWebhooks();
    return rows.map((row) => this.hydrateInboundWebhook(row));
  }

  /**
   * Handle an incoming request to an inbound webhook endpoint.
   * Looks up the webhook by token, spawns the configured agent.
   */
  async handleInbound(token: string, payload: any): Promise<{ pid?: number }> {
    const raw = this.state.getInboundWebhookByToken(token);
    if (!raw || !raw.enabled) {
      return {};
    }

    const inbound = this.hydrateInboundWebhook(raw);

    if (!this.spawnCallback) {
      console.warn('[WebhookManager] No spawn callback set, cannot handle inbound webhook');
      return {};
    }

    const pid = await this.spawnCallback(inbound.agent_config);
    if (pid !== null && pid !== undefined) {
      this.state.updateInboundWebhookTriggered(inbound.id, Date.now());
      this.bus.emit('webhook.inbound.triggered', { inboundId: inbound.id, pid });
      return { pid };
    }

    return {};
  }

  // ---------------------------------------------------------------------------
  // Delivery (internal)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Dead Letter Queue (DLQ)
  // ---------------------------------------------------------------------------

  /**
   * List DLQ entries.
   */
  getDlqEntries(limit: number = 50, offset: number = 0): DlqEntry[] {
    return this.state.getDlqEntries(limit, offset) as DlqEntry[];
  }

  /**
   * Get a single DLQ entry by ID.
   */
  getDlqEntry(id: string): DlqEntry | null {
    const entry = this.state.getDlqEntry(id);
    return entry ? (entry as DlqEntry) : null;
  }

  /**
   * Retry delivery of a DLQ entry.
   * Returns true if delivery succeeded, false otherwise.
   */
  async retryDlqEntry(id: string): Promise<boolean> {
    const entry = this.state.getDlqEntry(id);
    if (!entry) return false;

    const webhook = this.getWebhook(entry.webhook_id);
    if (!webhook) return false;

    // Parse the stored payload to extract the event
    let event: { type: string; [key: string]: any };
    try {
      const parsed = JSON.parse(entry.payload);
      event = { type: entry.event_type, ...parsed.data };
    } catch {
      event = { type: entry.event_type };
    }

    // Attempt single delivery (no retries for DLQ retry)
    const body = entry.payload;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    };
    if (webhook.secret) {
      headers['X-Aether-Signature'] = signPayload(body, webhook.secret);
    }

    const startTime = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), webhook.timeout_ms);
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        this.state.updateDlqRetried(id, Date.now());
        this.bus.emit('webhook.dlq.retried', { dlqId: id, success: true });
        return true;
      }
    } catch {
      // delivery failed again
    }

    this.state.updateDlqRetried(id, Date.now());
    this.bus.emit('webhook.dlq.retried', { dlqId: id, success: false });
    return false;
  }

  /**
   * Purge a single DLQ entry.
   */
  purgeDlqEntry(id: string): boolean {
    const deleted = this.state.deleteDlqEntry(id);
    if (deleted) {
      this.bus.emit('webhook.dlq.purged', { dlqId: id, count: 1 });
    }
    return deleted;
  }

  /**
   * Purge all DLQ entries. Returns the number of entries removed.
   */
  purgeDlq(): number {
    const count = this.state.deleteAllDlqEntries();
    if (count > 0) {
      this.bus.emit('webhook.dlq.purged', { count });
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Delivery (internal)
  // ---------------------------------------------------------------------------

  /**
   * Compute exponential backoff delay with jitter.
   * Formula: min(baseDelay * 2^attempt, maxDelay) + random jitter (0-1s)
   */
  computeBackoffDelay(attempt: number, baseDelay: number = 1000, maxDelay: number = 16000): number {
    const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }

  /**
   * Deliver a webhook with exponential backoff retry and DLQ.
   */
  private async deliverWebhook(
    webhook: Webhook,
    event: { type: string; [key: string]: any },
  ): Promise<void> {
    const body = JSON.stringify({
      event: event.type,
      timestamp: Date.now(),
      webhookId: webhook.id,
      data: event,
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...webhook.headers,
    };

    if (webhook.secret) {
      headers['X-Aether-Signature'] = signPayload(body, webhook.secret);
    }

    const maxAttempts = webhook.retry_count + 1;
    let lastError: string | undefined;
    let deliveryStatus: DeliveryStatus = 'pending';
    const deliveryStartTime = Date.now();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s with jitter
        const delayMs = this.computeBackoffDelay(attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      deliveryStatus = 'delivering';
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), webhook.timeout_ms);

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const durationMs = Date.now() - startTime;
        const responseBody = await response.text().catch(() => '');
        const success = response.ok;

        deliveryStatus = success ? 'delivered' : 'failed';

        this.state.insertWebhookLog({
          webhook_id: webhook.id,
          event_type: event.type,
          payload: body,
          status_code: response.status,
          response_body: responseBody.slice(0, 4096),
          duration_ms: durationMs,
          success: success ? 1 : 0,
          created_at: Date.now(),
        });

        if (success) {
          this.state.updateWebhookTriggered(webhook.id, Date.now());
          this.bus.emit('webhook.delivery', {
            webhookId: webhook.id,
            eventType: event.type,
            status: 'delivered',
            attempts: attempt + 1,
            durationMs: Date.now() - deliveryStartTime,
          });
          this.bus.emit('webhook.fired', {
            webhookId: webhook.id,
            eventType: event.type,
            success: true,
          });
          return;
        }

        lastError = `HTTP ${response.status}: ${responseBody.slice(0, 200)}`;
      } catch (err: unknown) {
        const durationMs = Date.now() - startTime;
        lastError = errMsg(err) || String(err);
        deliveryStatus = 'failed';

        this.state.insertWebhookLog({
          webhook_id: webhook.id,
          event_type: event.type,
          payload: body,
          status_code: null,
          response_body: lastError,
          duration_ms: durationMs,
          success: 0,
          created_at: Date.now(),
        });
      }
    }

    // All retries exhausted — move to DLQ
    const dlqId = crypto.randomUUID();
    this.state.insertDlqEntry({
      id: dlqId,
      webhook_id: webhook.id,
      event_type: event.type,
      payload: body,
      error: lastError || 'Unknown error',
      attempts: maxAttempts,
      created_at: Date.now(),
      retried_at: null,
    });

    this.state.incrementWebhookFailure(webhook.id);
    this.bus.emit('webhook.delivery', {
      webhookId: webhook.id,
      eventType: event.type,
      status: 'dlq',
      attempts: maxAttempts,
      durationMs: Date.now() - deliveryStartTime,
    });
    this.bus.emit('webhook.dlq.added', {
      dlqId,
      webhookId: webhook.id,
      eventType: event.type,
    });
    this.bus.emit('webhook.failed', {
      webhookId: webhook.id,
      eventType: event.type,
      error: lastError || 'Unknown error',
    });
  }

  // ---------------------------------------------------------------------------
  // Hydration Helpers
  // ---------------------------------------------------------------------------

  private hydrateWebhook(raw: any): Webhook {
    return {
      id: raw.id,
      name: raw.name,
      url: raw.url,
      secret: raw.secret || undefined,
      events: typeof raw.events === 'string' ? JSON.parse(raw.events) : raw.events,
      filters: raw.filters
        ? typeof raw.filters === 'string'
          ? JSON.parse(raw.filters)
          : raw.filters
        : undefined,
      headers: raw.headers
        ? typeof raw.headers === 'string'
          ? JSON.parse(raw.headers)
          : raw.headers
        : undefined,
      enabled: Boolean(raw.enabled),
      owner_uid: raw.owner_uid || undefined,
      retry_count: raw.retry_count,
      timeout_ms: raw.timeout_ms,
      created_at: raw.created_at,
      last_triggered: raw.last_triggered || undefined,
      failure_count: raw.failure_count,
    };
  }

  private hydrateInboundWebhook(raw: any): InboundWebhook {
    return {
      id: raw.id,
      name: raw.name,
      token: raw.token,
      agent_config:
        typeof raw.agent_config === 'string' ? JSON.parse(raw.agent_config) : raw.agent_config,
      transform: raw.transform || undefined,
      enabled: Boolean(raw.enabled),
      owner_uid: raw.owner_uid || undefined,
      last_triggered: raw.last_triggered || undefined,
      trigger_count: raw.trigger_count,
      created_at: raw.created_at,
    };
  }
}
