/**
 * Aether Kernel - Audit Logger
 *
 * Comprehensive audit logging subsystem. Logs every significant action:
 * - Tool invocations (with sanitized arguments)
 * - Auth events (login, logout, failures)
 * - Admin actions (spawn, kill, workspace cleanup, config changes)
 * - Resource quota violations
 *
 * The audit_log table is append-only — no UPDATE or DELETE except for
 * retention pruning. Uses the StateStore (better-sqlite3) for persistence.
 */

import { createHash } from 'node:crypto';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import { AUDIT_RETENTION_DAYS, AUDIT_DEFAULT_PAGE_SIZE } from '@aether/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AuditEntry {
  id: number;
  timestamp: number;
  event_type: string;
  actor_pid: number | null;
  actor_uid: string | null;
  action: string;
  target: string | null;
  args_sanitized: string | null;
  result_hash: string | null;
  metadata: string | null;
  created_at: number;
}

export interface AuditQueryFilters {
  pid?: number;
  uid?: string;
  action?: string;
  event_type?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

// Fields whose values are redacted when sanitizing arguments
const SENSITIVE_FIELDS = new Set([
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'credentials',
  'authorization',
  'apiKey',
]);

// ---------------------------------------------------------------------------
// Sanitization helpers
// ---------------------------------------------------------------------------

/**
 * Deep-clone an object, replacing values of sensitive keys with [REDACTED].
 */
export function sanitizeArgs(input: unknown): unknown {
  if (input === null || input === undefined) return input;
  if (typeof input !== 'object') return input;

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeArgs(item));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(key) || SENSITIVE_FIELDS.has(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      out[key] = sanitizeArgs(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * SHA-256 hash of the first 1000 characters of a string.
 */
export function resultHash(result: string | undefined | null): string | null {
  if (!result) return null;
  const slice = result.slice(0, 1000);
  return createHash('sha256').update(slice).digest('hex');
}

// ---------------------------------------------------------------------------
// AuditLogger class
// ---------------------------------------------------------------------------

export class AuditLogger {
  private bus: EventBus;
  private state: StateStore;
  private retentionDays: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(bus: EventBus, state: StateStore, retentionDays?: number) {
    this.bus = bus;
    this.state = state;
    this.retentionDays = retentionDays ?? AUDIT_RETENTION_DAYS;

    this.subscribeToEvents();
    this.startRetentionPruning();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Log a tool invocation.
   */
  logToolInvocation(
    pid: number,
    uid: string | null,
    tool: string,
    args: Record<string, unknown>,
    result?: string,
  ): void {
    this.log({
      event_type: 'tool.invocation',
      actor_pid: pid,
      actor_uid: uid,
      action: tool,
      target: null,
      args_sanitized: JSON.stringify(sanitizeArgs(args)),
      result_hash: resultHash(result),
      metadata: null,
    });
  }

  /**
   * Log an auth event (login, logout, failure, etc.).
   */
  logAuthEvent(
    action: 'login' | 'logout' | 'token_refresh' | 'login_failure' | 'register',
    uid: string | null,
    metadata?: Record<string, unknown>,
  ): void {
    this.log({
      event_type: 'auth',
      actor_pid: null,
      actor_uid: uid,
      action,
      target: null,
      args_sanitized: null,
      result_hash: null,
      metadata: metadata ? JSON.stringify(sanitizeArgs(metadata)) : null,
    });
  }

  /**
   * Log an admin action (spawn, kill, workspace cleanup, config change).
   */
  logAdminAction(
    action: string,
    actorUid: string | null,
    target?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.log({
      event_type: 'admin',
      actor_pid: null,
      actor_uid: actorUid,
      action,
      target: target ?? null,
      args_sanitized: null,
      result_hash: null,
      metadata: metadata ? JSON.stringify(sanitizeArgs(metadata)) : null,
    });
  }

  /**
   * Log a generic audit event.
   */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'created_at'>): void {
    const now = Date.now();
    this.state.insertAuditLog({
      timestamp: now,
      event_type: entry.event_type,
      actor_pid: entry.actor_pid ?? null,
      actor_uid: entry.actor_uid ?? null,
      action: entry.action,
      target: entry.target ?? null,
      args_sanitized: entry.args_sanitized ?? null,
      result_hash: entry.result_hash ?? null,
      metadata: entry.metadata ?? null,
    });
  }

  /**
   * Query audit log entries with filters and pagination.
   */
  query(filters: AuditQueryFilters = {}): { entries: AuditEntry[]; total: number } {
    const limit = filters.limit ?? AUDIT_DEFAULT_PAGE_SIZE;
    const offset = filters.offset ?? 0;
    return this.state.queryAuditLog(filters, limit, offset);
  }

  /**
   * Prune entries older than retention period.
   * Returns the number of deleted rows.
   */
  prune(): number {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    return this.state.pruneAuditLog(cutoff);
  }

  /**
   * Shut down the audit logger (clear timers).
   */
  shutdown(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // EventBus subscriptions
  // -------------------------------------------------------------------------

  private subscribeToEvents(): void {
    this.bus.on('process.spawned', (data: { pid: number; info: any }) => {
      try {
        this.log({
          event_type: 'admin',
          actor_pid: data.pid,
          actor_uid: data.info?.uid ?? null,
          action: 'agent.spawn',
          target: data.info?.name ?? null,
          args_sanitized: data.info?.env?.AETHER_GOAL
            ? JSON.stringify({ goal: data.info.env.AETHER_GOAL })
            : null,
          result_hash: null,
          metadata: null,
        });
      } catch {
        /* non-critical */
      }
    });

    this.bus.on('process.exit', (data: { pid: number; code: number }) => {
      try {
        this.log({
          event_type: 'admin',
          actor_pid: data.pid,
          actor_uid: null,
          action: 'agent.exit',
          target: null,
          args_sanitized: null,
          result_hash: null,
          metadata: JSON.stringify({ exitCode: data.code }),
        });
      } catch {
        /* non-critical */
      }
    });

    this.bus.on(
      'agent.action',
      (data: { pid: number; tool: string; args: Record<string, any> }) => {
        try {
          this.logToolInvocation(data.pid, null, data.tool, data.args);
        } catch {
          /* non-critical */
        }
      },
    );

    this.bus.on('resource.exceeded', (data: { pid: number; reason: string; usage: any }) => {
      try {
        this.log({
          event_type: 'resource',
          actor_pid: data.pid,
          actor_uid: null,
          action: 'quota.exceeded',
          target: null,
          args_sanitized: null,
          result_hash: null,
          metadata: JSON.stringify({ reason: data.reason }),
        });
      } catch {
        /* non-critical */
      }
    });

    this.bus.on('workspace.cleaned', (data: { agentName: string; success: boolean }) => {
      try {
        this.log({
          event_type: 'admin',
          actor_pid: null,
          actor_uid: null,
          action: 'workspace.cleanup',
          target: data.agentName,
          args_sanitized: null,
          result_hash: null,
          metadata: JSON.stringify({ success: data.success }),
        });
      } catch {
        /* non-critical */
      }
    });
  }

  // -------------------------------------------------------------------------
  // Retention pruning
  // -------------------------------------------------------------------------

  private startRetentionPruning(): void {
    // Run once per hour
    this.pruneTimer = setInterval(
      () => {
        try {
          const removed = this.prune();
          if (removed > 0) {
            console.log(
              `[AuditLogger] Pruned ${removed} audit entries older than ${this.retentionDays} days`,
            );
          }
        } catch (err) {
          console.error('[AuditLogger] Prune error:', err);
        }
      },
      60 * 60 * 1000,
    );
    // Don't prevent Node from exiting
    if (this.pruneTimer.unref) {
      this.pruneTimer.unref();
    }
  }
}
