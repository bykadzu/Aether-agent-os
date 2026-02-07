import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { CronManager, parseCronExpression, getNextCronTime } from '../CronManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AgentConfig } from '@aether/shared';

const TEST_AGENT_CONFIG: AgentConfig = {
  role: 'Tester',
  goal: 'Run scheduled tests',
  model: 'gemini:gemini-2.0-flash',
  tools: ['read_file', 'run_command'],
  maxSteps: 10,
};

describe('CronManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let cron: CronManager;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join('/tmp', `aether-cron-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    cron = new CronManager(bus, store);
  });

  afterEach(() => {
    cron.stop();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Cron Expression Parser
  // ---------------------------------------------------------------------------

  describe('parseCronExpression', () => {
    it('parses wildcard (*) correctly', () => {
      const fields = parseCronExpression('* * * * *');
      expect(fields.minutes.size).toBe(60); // 0-59
      expect(fields.hours.size).toBe(24); // 0-23
      expect(fields.daysOfMonth.size).toBe(31); // 1-31
      expect(fields.months.size).toBe(12); // 1-12
      expect(fields.daysOfWeek.size).toBe(7); // 0-6
    });

    it('parses specific values', () => {
      const fields = parseCronExpression('30 2 15 6 1');
      expect(fields.minutes).toEqual(new Set([30]));
      expect(fields.hours).toEqual(new Set([2]));
      expect(fields.daysOfMonth).toEqual(new Set([15]));
      expect(fields.months).toEqual(new Set([6]));
      expect(fields.daysOfWeek).toEqual(new Set([1]));
    });

    it('parses ranges (1-5)', () => {
      const fields = parseCronExpression('1-5 * * * *');
      expect(fields.minutes).toEqual(new Set([1, 2, 3, 4, 5]));
    });

    it('parses steps (*/15)', () => {
      const fields = parseCronExpression('*/15 * * * *');
      expect(fields.minutes).toEqual(new Set([0, 15, 30, 45]));
    });

    it('parses lists (1,3,5)', () => {
      const fields = parseCronExpression('1,3,5 * * * *');
      expect(fields.minutes).toEqual(new Set([1, 3, 5]));
    });

    it('parses range with step (0-30/10)', () => {
      const fields = parseCronExpression('0-30/10 * * * *');
      expect(fields.minutes).toEqual(new Set([0, 10, 20, 30]));
    });

    it('throws on invalid field count', () => {
      expect(() => parseCronExpression('* * *')).toThrow('expected 5 fields');
    });

    it('throws on invalid value', () => {
      expect(() => parseCronExpression('60 * * * *')).toThrow();
    });

    it('parses "every weekday at 9am" pattern', () => {
      const fields = parseCronExpression('0 9 * * 1-5');
      expect(fields.minutes).toEqual(new Set([0]));
      expect(fields.hours).toEqual(new Set([9]));
      expect(fields.daysOfWeek).toEqual(new Set([1, 2, 3, 4, 5]));
    });
  });

  // ---------------------------------------------------------------------------
  // getNextCronTime
  // ---------------------------------------------------------------------------

  describe('getNextCronTime', () => {
    it('finds the next minute for "every minute" cron', () => {
      const now = new Date(2025, 0, 15, 10, 30, 0).getTime(); // Jan 15, 2025, 10:30:00
      const next = getNextCronTime('* * * * *', now);
      const nextDate = new Date(next);
      expect(nextDate.getMinutes()).toBe(31);
      expect(nextDate.getHours()).toBe(10);
    });

    it('finds the next matching time for specific schedule', () => {
      // "At minute 0 past every hour" - current time is 10:30
      const now = new Date(2025, 0, 15, 10, 30, 0).getTime();
      const next = getNextCronTime('0 * * * *', now);
      const nextDate = new Date(next);
      expect(nextDate.getMinutes()).toBe(0);
      expect(nextDate.getHours()).toBe(11);
    });

    it('wraps to next day if no match today', () => {
      // "At 9:00 AM" - current time is 10:30
      const now = new Date(2025, 0, 15, 10, 30, 0).getTime();
      const next = getNextCronTime('0 9 * * *', now);
      const nextDate = new Date(next);
      expect(nextDate.getMinutes()).toBe(0);
      expect(nextDate.getHours()).toBe(9);
      expect(nextDate.getDate()).toBe(16); // next day
    });
  });

  // ---------------------------------------------------------------------------
  // Cron Jobs CRUD
  // ---------------------------------------------------------------------------

  describe('cron jobs', () => {
    it('createJob stores a job and returns CronJob', () => {
      const job = cron.createJob('Daily Check', '0 9 * * *', TEST_AGENT_CONFIG, 'user_1');

      expect(job.id).toBeDefined();
      expect(job.name).toBe('Daily Check');
      expect(job.cron_expression).toBe('0 9 * * *');
      expect(job.agent_config).toEqual(TEST_AGENT_CONFIG);
      expect(job.enabled).toBe(true);
      expect(job.owner_uid).toBe('user_1');
      expect(job.run_count).toBe(0);
      expect(job.next_run).toBeGreaterThan(Date.now());
    });

    it('createJob emits cron.created event', () => {
      const events: any[] = [];
      bus.on('cron.created', (data: any) => events.push(data));

      cron.createJob('Test', '* * * * *', TEST_AGENT_CONFIG, 'user_1');

      expect(events).toHaveLength(1);
      expect(events[0].job.name).toBe('Test');
    });

    it('createJob rejects invalid cron expression', () => {
      expect(() => cron.createJob('Bad Cron', 'not-a-cron', TEST_AGENT_CONFIG, 'user_1')).toThrow();
    });

    it('listJobs returns all jobs', () => {
      cron.createJob('Job 1', '0 9 * * *', TEST_AGENT_CONFIG, 'user_1');
      cron.createJob('Job 2', '0 18 * * *', TEST_AGENT_CONFIG, 'user_1');

      const jobs = cron.listJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe('Job 1');
      expect(jobs[1].name).toBe('Job 2');
    });

    it('deleteJob removes job and returns true', () => {
      const job = cron.createJob('To Delete', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      const result = cron.deleteJob(job.id);
      expect(result).toBe(true);

      const jobs = cron.listJobs();
      expect(jobs).toHaveLength(0);
    });

    it('deleteJob returns false for non-existent job', () => {
      const result = cron.deleteJob('nonexistent');
      expect(result).toBe(false);
    });

    it('deleteJob emits cron.deleted event', () => {
      const events: any[] = [];
      bus.on('cron.deleted', (data: any) => events.push(data));

      const job = cron.createJob('To Delete', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      cron.deleteJob(job.id);

      expect(events).toHaveLength(1);
      expect(events[0].jobId).toBe(job.id);
    });

    it('enableJob / disableJob toggles enabled state', () => {
      const job = cron.createJob('Toggle', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      expect(job.enabled).toBe(true);

      cron.disableJob(job.id);
      let jobs = cron.listJobs();
      expect(jobs[0].enabled).toBe(false);

      cron.enableJob(job.id);
      jobs = cron.listJobs();
      expect(jobs[0].enabled).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Event Triggers
  // ---------------------------------------------------------------------------

  describe('event triggers', () => {
    it('createTrigger stores a trigger and returns EventTrigger', () => {
      const trigger = cron.createTrigger(
        'On Process Exit',
        'process.exit',
        TEST_AGENT_CONFIG,
        'user_1',
        30000,
      );

      expect(trigger.id).toBeDefined();
      expect(trigger.name).toBe('On Process Exit');
      expect(trigger.event_type).toBe('process.exit');
      expect(trigger.agent_config).toEqual(TEST_AGENT_CONFIG);
      expect(trigger.enabled).toBe(true);
      expect(trigger.cooldown_ms).toBe(30000);
      expect(trigger.fire_count).toBe(0);
    });

    it('createTrigger emits trigger.created event', () => {
      const events: any[] = [];
      bus.on('trigger.created', (data: any) => events.push(data));

      cron.createTrigger('Test', 'process.exit', TEST_AGENT_CONFIG, 'user_1');

      expect(events).toHaveLength(1);
      expect(events[0].trigger.name).toBe('Test');
    });

    it('listTriggers returns all triggers', () => {
      cron.createTrigger('T1', 'process.exit', TEST_AGENT_CONFIG, 'user_1');
      cron.createTrigger('T2', 'fs.changed', TEST_AGENT_CONFIG, 'user_1');

      const triggers = cron.listTriggers();
      expect(triggers).toHaveLength(2);
    });

    it('deleteTrigger removes trigger and returns true', () => {
      const trigger = cron.createTrigger('To Delete', 'process.exit', TEST_AGENT_CONFIG, 'user_1');
      const result = cron.deleteTrigger(trigger.id);
      expect(result).toBe(true);
      expect(cron.listTriggers()).toHaveLength(0);
    });

    it('deleteTrigger emits trigger.deleted event', () => {
      const events: any[] = [];
      bus.on('trigger.deleted', (data: any) => events.push(data));

      const trigger = cron.createTrigger('To Delete', 'process.exit', TEST_AGENT_CONFIG, 'user_1');
      cron.deleteTrigger(trigger.id);

      expect(events).toHaveLength(1);
      expect(events[0].triggerId).toBe(trigger.id);
    });

    it('createTrigger with event_filter stores filter', () => {
      const trigger = cron.createTrigger(
        'Filtered',
        'process.exit',
        TEST_AGENT_CONFIG,
        'user_1',
        60000,
        { code: 1 },
      );

      const triggers = cron.listTriggers();
      expect(triggers[0].event_filter).toEqual({ code: 1 });
    });
  });

  // ---------------------------------------------------------------------------
  // Tick - Cron Job Firing
  // ---------------------------------------------------------------------------

  describe('tick', () => {
    it('fires due cron jobs and calls spawn callback', async () => {
      const spawnedConfigs: AgentConfig[] = [];
      const mockSpawn = vi.fn(async (config: AgentConfig) => {
        spawnedConfigs.push(config);
        return 42; // mock PID
      });

      cron.start(mockSpawn);

      // Create a job that's already due (next_run in the past)
      const job = cron.createJob('Due Job', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      // Manually set next_run to past
      store.updateCronJobRun(job.id, 0, Date.now() - 1000);

      const spawned = await cron.tick();
      expect(spawned).toBe(1);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(spawnedConfigs[0]).toEqual(TEST_AGENT_CONFIG);
    });

    it('emits cron.fired event when job fires', async () => {
      const events: any[] = [];
      bus.on('cron.fired', (data: any) => events.push(data));

      cron.start(async () => 42);

      const job = cron.createJob('Firing Job', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      store.updateCronJobRun(job.id, 0, Date.now() - 1000);

      await cron.tick();

      expect(events).toHaveLength(1);
      expect(events[0].jobId).toBe(job.id);
      expect(events[0].pid).toBe(42);
    });

    it('does not fire disabled jobs', async () => {
      const mockSpawn = vi.fn(async () => 42);
      cron.start(mockSpawn);

      const job = cron.createJob('Disabled Job', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      store.updateCronJobRun(job.id, 0, Date.now() - 1000);
      cron.disableJob(job.id);

      const spawned = await cron.tick();
      expect(spawned).toBe(0);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('updates run_count and next_run after firing', async () => {
      cron.start(async () => 42);

      const job = cron.createJob('Counting Job', '* * * * *', TEST_AGENT_CONFIG, 'user_1');
      // Manually set next_run to the past so it fires on tick
      // updateCronJobRun increments run_count by 1, so after this it's 1
      store.updateCronJobRun(job.id, 0, Date.now() - 1000);

      await cron.tick();

      const jobs = cron.listJobs();
      // run_count is 2: +1 from updateCronJobRun above, +1 from tick() firing
      expect(jobs[0].run_count).toBe(2);
      expect(jobs[0].last_run).toBeGreaterThan(0);
      expect(jobs[0].next_run).toBeGreaterThan(Date.now() - 1000);
    });

    it('returns 0 when no jobs are due', async () => {
      cron.start(async () => 42);

      // Create job with next_run in the future
      cron.createJob('Future Job', '0 9 * * *', TEST_AGENT_CONFIG, 'user_1');

      const spawned = await cron.tick();
      expect(spawned).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Event Trigger Firing
  // ---------------------------------------------------------------------------

  describe('event trigger firing', () => {
    it('fires trigger when matching event is emitted', async () => {
      const spawnedConfigs: AgentConfig[] = [];
      const mockSpawn = vi.fn(async (config: AgentConfig) => {
        spawnedConfigs.push(config);
        return 99;
      });

      cron.start(mockSpawn);
      cron.createTrigger('On Exit', 'process.exit', TEST_AGENT_CONFIG, 'user_1', 0);

      // Emit matching event
      bus.emit('process.exit', { pid: 1, code: 0 });

      // Wait for async handler
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('emits trigger.fired event', async () => {
      const events: any[] = [];
      bus.on('trigger.fired', (data: any) => events.push(data));

      cron.start(async () => 99);
      const trigger = cron.createTrigger('On Exit', 'process.exit', TEST_AGENT_CONFIG, 'user_1', 0);

      bus.emit('process.exit', { pid: 1, code: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(events).toHaveLength(1);
      expect(events[0].triggerId).toBe(trigger.id);
      expect(events[0].pid).toBe(99);
      expect(events[0].event_type).toBe('process.exit');
    });

    it('respects cooldown period', async () => {
      const mockSpawn = vi.fn(async () => 99);
      cron.start(mockSpawn);

      cron.createTrigger('Cooldown Test', 'process.exit', TEST_AGENT_CONFIG, 'user_1', 60000); // 60s cooldown

      // First fire
      bus.emit('process.exit', { pid: 1, code: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second fire (should be blocked by cooldown)
      bus.emit('process.exit', { pid: 2, code: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('does not fire for non-matching event types', async () => {
      const mockSpawn = vi.fn(async () => 99);
      cron.start(mockSpawn);

      cron.createTrigger('On Exit', 'process.exit', TEST_AGENT_CONFIG, 'user_1', 0);

      // Emit non-matching event
      bus.emit('fs.changed', { path: '/test', changeType: 'create' });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('does not fire disabled triggers', async () => {
      const mockSpawn = vi.fn(async () => 99);
      cron.start(mockSpawn);

      const trigger = cron.createTrigger(
        'Disabled',
        'process.exit',
        TEST_AGENT_CONFIG,
        'user_1',
        0,
      );
      cron.deleteTrigger(trigger.id); // Remove trigger

      bus.emit('process.exit', { pid: 1, code: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('applies event_filter correctly', async () => {
      const mockSpawn = vi.fn(async () => 99);
      cron.start(mockSpawn);

      cron.createTrigger(
        'Error Only',
        'process.exit',
        TEST_AGENT_CONFIG,
        'user_1',
        0,
        { code: 1 }, // Only trigger on error exits
      );

      // Emit non-matching event (code: 0)
      bus.emit('process.exit', { pid: 1, code: 0 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockSpawn).not.toHaveBeenCalled();

      // Emit matching event (code: 1)
      bus.emit('process.exit', { pid: 2, code: 1 });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('cron jobs survive store close and reopen', () => {
      const job = cron.createJob('Persistent Job', '0 9 * * *', TEST_AGENT_CONFIG, 'user_1');
      cron.stop();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const cron2 = new CronManager(bus, store2);

      try {
        const jobs = cron2.listJobs();
        expect(jobs).toHaveLength(1);
        expect(jobs[0].id).toBe(job.id);
        expect(jobs[0].name).toBe('Persistent Job');
        expect(jobs[0].agent_config).toEqual(TEST_AGENT_CONFIG);
      } finally {
        cron2.stop();
        store2.close();
      }
    });

    it('event triggers survive store close and reopen', () => {
      const trigger = cron.createTrigger(
        'Persistent Trigger',
        'process.exit',
        TEST_AGENT_CONFIG,
        'user_1',
      );
      cron.stop();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const cron2 = new CronManager(bus, store2);

      try {
        const triggers = cron2.listTriggers();
        expect(triggers).toHaveLength(1);
        expect(triggers[0].id).toBe(trigger.id);
        expect(triggers[0].name).toBe('Persistent Trigger');
      } finally {
        cron2.stop();
        store2.close();
      }
    });
  });
});
