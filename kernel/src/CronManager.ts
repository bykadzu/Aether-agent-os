/**
 * Aether Kernel - Cron Manager (v0.3 Wave 1)
 *
 * Provides scheduled agent spawning via two mechanisms:
 *
 * 1. **Cron Jobs**: 5-field cron expressions (min hour dom month dow).
 *    A tick() method runs on a 60-second interval, checking for due jobs
 *    and spawning agents accordingly.
 *
 * 2. **Event Triggers**: Listen on the kernel EventBus for matching event
 *    types. When a matching event fires, spawn an agent (with cooldown).
 *
 * Design: No external cron library. We implement a simple 5-field parser.
 * Jobs store the full AgentConfig as JSON so they can spawn agents with
 * any role, goal, tools, and model.
 */

import * as crypto from 'node:crypto';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import type { AgentConfig, CronJob, EventTrigger } from '@aether/shared';

/** Default tick interval: 60 seconds */
const TICK_INTERVAL_MS = 60_000;

/** Default cooldown for event triggers: 60 seconds */
const DEFAULT_COOLDOWN_MS = 60_000;

export class CronManager {
  private bus: EventBus;
  private state: StateStore;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private eventUnsubscribers: Array<() => void> = [];
  private spawnCallback: ((config: AgentConfig) => Promise<number | null>) | null = null;

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start the cron ticker and register event trigger listeners.
   * @param spawnFn - Callback to spawn an agent (returns PID or null)
   */
  start(spawnFn: (config: AgentConfig) => Promise<number | null>): void {
    this.spawnCallback = spawnFn;

    // Start the 60-second tick loop
    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[CronManager] Tick error:', err);
      });
    }, TICK_INTERVAL_MS);

    // Register wildcard listener for event triggers
    this.setupEventTriggers();
  }

  /**
   * Stop the cron ticker and clean up event listeners.
   */
  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const unsub of this.eventUnsubscribers) {
      unsub();
    }
    this.eventUnsubscribers = [];
    this.spawnCallback = null;
  }

  // ---------------------------------------------------------------------------
  // Cron Jobs
  // ---------------------------------------------------------------------------

  /**
   * Create a new cron job.
   */
  createJob(
    name: string,
    cronExpression: string,
    agentConfig: AgentConfig,
    ownerUid: string,
  ): CronJob {
    // Validate cron expression
    parseCronExpression(cronExpression);

    const id = crypto.randomUUID();
    const now = Date.now();
    const nextRun = getNextCronTime(cronExpression, now);

    const job: CronJob = {
      id,
      name,
      cron_expression: cronExpression,
      agent_config: agentConfig,
      enabled: true,
      owner_uid: ownerUid,
      next_run: nextRun,
      run_count: 0,
      created_at: now,
    };

    this.state.insertCronJob({
      id: job.id,
      name: job.name,
      cron_expression: job.cron_expression,
      agent_config: JSON.stringify(job.agent_config),
      enabled: 1,
      owner_uid: job.owner_uid,
      next_run: job.next_run,
      run_count: 0,
      created_at: job.created_at,
    });

    this.bus.emit('cron.created', { job });
    return job;
  }

  /**
   * Delete a cron job.
   */
  deleteJob(jobId: string): boolean {
    const existing = this.state.getCronJob(jobId);
    if (!existing) return false;
    this.state.deleteCronJob(jobId);
    this.bus.emit('cron.deleted', { jobId });
    return true;
  }

  /**
   * Enable a cron job.
   */
  enableJob(jobId: string): boolean {
    const existing = this.state.getCronJob(jobId);
    if (!existing) return false;
    this.state.setCronJobEnabled(jobId, true);
    return true;
  }

  /**
   * Disable a cron job.
   */
  disableJob(jobId: string): boolean {
    const existing = this.state.getCronJob(jobId);
    if (!existing) return false;
    this.state.setCronJobEnabled(jobId, false);
    return true;
  }

  /**
   * List all cron jobs.
   */
  listJobs(): CronJob[] {
    return this.state.getAllCronJobs().map((row) => this.hydrateCronJob(row));
  }

  // ---------------------------------------------------------------------------
  // Event Triggers
  // ---------------------------------------------------------------------------

  /**
   * Create a new event trigger.
   */
  createTrigger(
    name: string,
    eventType: string,
    agentConfig: AgentConfig,
    ownerUid: string,
    cooldownMs: number = DEFAULT_COOLDOWN_MS,
    eventFilter?: Record<string, any>,
  ): EventTrigger {
    const id = crypto.randomUUID();
    const now = Date.now();

    const trigger: EventTrigger = {
      id,
      name,
      event_type: eventType,
      event_filter: eventFilter,
      agent_config: agentConfig,
      enabled: true,
      owner_uid: ownerUid,
      cooldown_ms: cooldownMs,
      fire_count: 0,
      created_at: now,
    };

    this.state.insertTrigger({
      id: trigger.id,
      name: trigger.name,
      event_type: trigger.event_type,
      event_filter: eventFilter ? JSON.stringify(eventFilter) : null,
      agent_config: JSON.stringify(trigger.agent_config),
      enabled: 1,
      owner_uid: trigger.owner_uid,
      cooldown_ms: trigger.cooldown_ms,
      fire_count: 0,
      created_at: trigger.created_at,
    });

    this.bus.emit('trigger.created', { trigger });
    return trigger;
  }

  /**
   * Delete an event trigger.
   */
  deleteTrigger(triggerId: string): boolean {
    const existing = this.state.getTrigger(triggerId);
    if (!existing) return false;
    this.state.deleteTrigger(triggerId);
    this.bus.emit('trigger.deleted', { triggerId });
    return true;
  }

  /**
   * List all event triggers.
   */
  listTriggers(): EventTrigger[] {
    return this.state.getAllTriggers().map((row) => this.hydrateTrigger(row));
  }

  // ---------------------------------------------------------------------------
  // Tick - process due cron jobs
  // ---------------------------------------------------------------------------

  /**
   * Check for and execute due cron jobs.
   * Called every 60 seconds by the tick timer.
   */
  async tick(): Promise<number> {
    if (!this.spawnCallback) return 0;

    const now = Date.now();
    const dueJobs = this.state.getEnabledCronJobsDue(now);
    let spawned = 0;

    for (const raw of dueJobs) {
      const job = this.hydrateCronJob(raw);
      try {
        const pid = await this.spawnCallback(job.agent_config);
        if (pid !== null) {
          const nextRun = getNextCronTime(job.cron_expression, now);
          this.state.updateCronJobRun(job.id, now, nextRun);
          this.bus.emit('cron.fired', { jobId: job.id, pid });
          spawned++;
        }
      } catch (err) {
        console.error(`[CronManager] Failed to fire job ${job.id} (${job.name}):`, err);
      }
    }

    return spawned;
  }

  // ---------------------------------------------------------------------------
  // Event Trigger Handling
  // ---------------------------------------------------------------------------

  /**
   * Set up a wildcard event listener that checks incoming events
   * against registered triggers.
   */
  private setupEventTriggers(): void {
    const unsub = this.bus.on('*', (data: { event: string; data: any }) => {
      // Don't trigger on our own events to prevent infinite loops
      if (
        data.event.startsWith('cron.') ||
        data.event.startsWith('trigger.') ||
        data.event.startsWith('memory.')
      ) {
        return;
      }
      this.handleEvent(data.event, data.data).catch((err) => {
        console.error('[CronManager] Event trigger error:', err);
      });
    });
    this.eventUnsubscribers.push(unsub);
  }

  /**
   * Check if an event matches any registered triggers and fire them.
   */
  private async handleEvent(eventType: string, eventData: any): Promise<void> {
    if (!this.spawnCallback) return;

    const now = Date.now();
    const triggers = this.state.getEnabledTriggersByEvent(eventType);

    for (const raw of triggers) {
      const trigger = this.hydrateTrigger(raw);

      // Check cooldown
      if (trigger.last_fired && now - trigger.last_fired < trigger.cooldown_ms) {
        continue;
      }

      // Check event filter (if any)
      if (trigger.event_filter && !matchesFilter(eventData, trigger.event_filter)) {
        continue;
      }

      try {
        const pid = await this.spawnCallback(trigger.agent_config);
        if (pid !== null) {
          this.state.updateTriggerFired(trigger.id, now);
          this.bus.emit('trigger.fired', {
            triggerId: trigger.id,
            pid,
            event_type: eventType,
          });
        }
      } catch (err) {
        console.error(`[CronManager] Failed to fire trigger ${trigger.id} (${trigger.name}):`, err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hydration Helpers
  // ---------------------------------------------------------------------------

  private hydrateCronJob(raw: any): CronJob {
    return {
      id: raw.id,
      name: raw.name,
      cron_expression: raw.cron_expression,
      agent_config:
        typeof raw.agent_config === 'string' ? JSON.parse(raw.agent_config) : raw.agent_config,
      enabled: Boolean(raw.enabled),
      owner_uid: raw.owner_uid,
      last_run: raw.last_run || undefined,
      next_run: raw.next_run,
      run_count: raw.run_count,
      created_at: raw.created_at,
    };
  }

  private hydrateTrigger(raw: any): EventTrigger {
    return {
      id: raw.id,
      name: raw.name,
      event_type: raw.event_type,
      event_filter: raw.event_filter
        ? typeof raw.event_filter === 'string'
          ? JSON.parse(raw.event_filter)
          : raw.event_filter
        : undefined,
      agent_config:
        typeof raw.agent_config === 'string' ? JSON.parse(raw.agent_config) : raw.agent_config,
      enabled: Boolean(raw.enabled),
      owner_uid: raw.owner_uid,
      cooldown_ms: raw.cooldown_ms,
      last_fired: raw.last_fired || undefined,
      fire_count: raw.fire_count,
      created_at: raw.created_at,
    };
  }
}

// =============================================================================
// Cron Expression Parser (5-field: min hour dom month dow)
// =============================================================================

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>; // 0=Sunday, 6=Saturday
}

/**
 * Parse a 5-field cron expression into sets of valid values.
 * Supports: *, ranges (1-5), steps (* /15), lists (1,3,5), and combinations.
 */
export function parseCronExpression(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }

  return {
    minutes: parseField(parts[0], 0, 59),
    hours: parseField(parts[1], 0, 23),
    daysOfMonth: parseField(parts[2], 1, 31),
    months: parseField(parts[3], 1, 12),
    daysOfWeek: parseField(parts[4], 0, 6),
  };
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step: ${stepStr}`);

      let start = min;
      let end = max;
      if (range !== '*') {
        if (range.includes('-')) {
          const [s, e] = range.split('-').map(Number);
          start = s;
          end = e;
        } else {
          start = parseInt(range, 10);
        }
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) values.add(i);
      }
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range: ${part}`);
      for (let i = start; i <= end; i++) {
        if (i >= min && i <= max) values.add(i);
      }
    } else {
      const val = parseInt(part, 10);
      if (isNaN(val) || val < min || val > max) {
        throw new Error(`Invalid value ${part} (range: ${min}-${max})`);
      }
      values.add(val);
    }
  }

  return values;
}

/**
 * Calculate the next time a cron expression should fire, starting from `after`.
 * Returns a Unix timestamp in milliseconds.
 */
export function getNextCronTime(expression: string, after: number): number {
  const fields = parseCronExpression(expression);
  const date = new Date(after);

  // Advance to the next minute boundary
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  // Search for the next matching minute (max ~2 years of minutes to prevent infinite loop)
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const minute = date.getMinutes();
    const hour = date.getHours();
    const dayOfMonth = date.getDate();
    const month = date.getMonth() + 1; // JS months are 0-indexed
    const dayOfWeek = date.getDay(); // 0=Sunday

    if (
      fields.minutes.has(minute) &&
      fields.hours.has(hour) &&
      fields.daysOfMonth.has(dayOfMonth) &&
      fields.months.has(month) &&
      fields.daysOfWeek.has(dayOfWeek)
    ) {
      return date.getTime();
    }

    date.setMinutes(date.getMinutes() + 1);
  }

  // Fallback: return 24 hours from now
  return after + 24 * 60 * 60 * 1000;
}

/**
 * Check if event data matches a filter object.
 * Filter is a shallow key-value match: every key in the filter must exist
 * in the data and have the same value.
 */
function matchesFilter(data: any, filter: Record<string, any>): boolean {
  if (!data || typeof data !== 'object') return false;
  for (const [key, value] of Object.entries(filter)) {
    if (data[key] !== value) return false;
  }
  return true;
}
