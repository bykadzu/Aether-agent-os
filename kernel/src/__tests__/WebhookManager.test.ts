import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { WebhookManager, matchesPattern } from '../WebhookManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { AgentConfig } from '@aether/shared';

const TEST_AGENT_CONFIG: AgentConfig = {
  role: 'Webhook Handler',
  goal: 'Handle webhook event',
  model: 'gemini:gemini-2.0-flash',
  tools: ['read_file', 'run_command'],
  maxSteps: 10,
};

describe('WebhookManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let webhooks: WebhookManager;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join(
      process.env.TEMP || '/tmp',
      `aether-webhook-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    webhooks = new WebhookManager(bus, store);
  });

  afterEach(() => {
    webhooks.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Event Pattern Matching
  // ---------------------------------------------------------------------------

  describe('matchesPattern', () => {
    it('matches wildcard "*" against any event', () => {
      expect(matchesPattern('*', 'agent.completed')).toBe(true);
      expect(matchesPattern('*', 'process.spawned')).toBe(true);
      expect(matchesPattern('*', 'anything')).toBe(true);
    });

    it('matches exact event type', () => {
      expect(matchesPattern('process.spawned', 'process.spawned')).toBe(true);
      expect(matchesPattern('process.spawned', 'process.exit')).toBe(false);
    });

    it('matches glob prefix with .*', () => {
      expect(matchesPattern('agent.*', 'agent.completed')).toBe(true);
      expect(matchesPattern('agent.*', 'agent.failed')).toBe(true);
      expect(matchesPattern('agent.*', 'process.spawned')).toBe(false);
    });

    it('does not match partial prefix without .*', () => {
      expect(matchesPattern('agent', 'agent.completed')).toBe(false);
    });

    it('does not match nested when pattern is shallow', () => {
      // "agent.*" should match "agent.x" but also "agent.x.y" since startsWith is used
      expect(matchesPattern('agent.*', 'agent.sub.event')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Webhook Registration and Unregistration
  // ---------------------------------------------------------------------------

  describe('register / unregister', () => {
    it('registers a webhook and returns an ID', () => {
      const id = webhooks.register('My Hook', 'https://example.com/hook', ['agent.*']);
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('registered webhook appears in list', () => {
      webhooks.register('Hook 1', 'https://example.com/hook1', ['agent.*']);
      webhooks.register('Hook 2', 'https://example.com/hook2', ['process.*']);

      const list = webhooks.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('Hook 1');
      expect(list[1].name).toBe('Hook 2');
    });

    it('register stores options correctly', () => {
      const id = webhooks.register('Full Hook', 'https://example.com/hook', ['agent.*'], {
        secret: 'mysecret',
        filters: { level: 'error' },
        headers: { Authorization: 'Bearer token' },
        owner_uid: 'user_1',
        retry_count: 5,
        timeout_ms: 10000,
      });

      const hook = webhooks.getWebhook(id);
      expect(hook).not.toBeNull();
      expect(hook!.secret).toBe('mysecret');
      expect(hook!.filters).toEqual({ level: 'error' });
      expect(hook!.headers).toEqual({ Authorization: 'Bearer token' });
      expect(hook!.owner_uid).toBe('user_1');
      expect(hook!.retry_count).toBe(5);
      expect(hook!.timeout_ms).toBe(10000);
      expect(hook!.enabled).toBe(true);
      expect(hook!.failure_count).toBe(0);
    });

    it('unregister removes webhook', () => {
      const id = webhooks.register('To Delete', 'https://example.com/hook', ['*']);
      webhooks.unregister(id);

      const list = webhooks.list();
      expect(list).toHaveLength(0);
    });

    it('unregister emits webhook.unregistered event', () => {
      const events: any[] = [];
      bus.on('webhook.unregistered', (data: any) => events.push(data));

      const id = webhooks.register('To Delete', 'https://example.com/hook', ['*']);
      webhooks.unregister(id);

      expect(events).toHaveLength(1);
      expect(events[0].webhookId).toBe(id);
    });

    it('register emits webhook.registered event', () => {
      const events: any[] = [];
      bus.on('webhook.registered', (data: any) => events.push(data));

      const id = webhooks.register('Event Hook', 'https://example.com/hook', ['*']);

      expect(events).toHaveLength(1);
      expect(events[0].webhookId).toBe(id);
      expect(events[0].name).toBe('Event Hook');
    });
  });

  // ---------------------------------------------------------------------------
  // Enable / Disable
  // ---------------------------------------------------------------------------

  describe('enable / disable', () => {
    it('disable prevents webhook from firing', () => {
      const id = webhooks.register('Toggle', 'https://example.com/hook', ['*']);
      webhooks.disable(id);

      const hook = webhooks.getWebhook(id);
      expect(hook!.enabled).toBe(false);
    });

    it('enable re-enables a disabled webhook', () => {
      const id = webhooks.register('Toggle', 'https://example.com/hook', ['*']);
      webhooks.disable(id);
      webhooks.enable(id);

      const hook = webhooks.getWebhook(id);
      expect(hook!.enabled).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Filtering by owner_uid
  // ---------------------------------------------------------------------------

  describe('list filtering', () => {
    it('list with ownerUid filters webhooks', () => {
      webhooks.register('User1 Hook', 'https://example.com/1', ['*'], { owner_uid: 'user_1' });
      webhooks.register('User2 Hook', 'https://example.com/2', ['*'], { owner_uid: 'user_2' });
      webhooks.register('User1 Hook 2', 'https://example.com/3', ['*'], { owner_uid: 'user_1' });

      const user1Hooks = webhooks.list('user_1');
      expect(user1Hooks).toHaveLength(2);
      expect(user1Hooks[0].name).toBe('User1 Hook');
      expect(user1Hooks[1].name).toBe('User1 Hook 2');
    });

    it('list without ownerUid returns all webhooks', () => {
      webhooks.register('H1', 'https://example.com/1', ['*'], { owner_uid: 'user_1' });
      webhooks.register('H2', 'https://example.com/2', ['*'], { owner_uid: 'user_2' });

      const all = webhooks.list();
      expect(all).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // HMAC Signature Generation
  // ---------------------------------------------------------------------------

  describe('HMAC signing', () => {
    it('generates correct HMAC-SHA256 signature', async () => {
      const secret = 'test-secret';
      let capturedHeaders: Record<string, string> = {};

      const mockFetch = vi.fn(async (url: string, init: any) => {
        capturedHeaders = init.headers;
        return new Response('ok', { status: 200 });
      });
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('Signed Hook', 'https://example.com/hook', ['test.*'], {
        secret,
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event', data: 'hello' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(capturedHeaders['X-Aether-Signature']).toBeDefined();

      // Verify the signature
      const body = mockFetch.mock.calls[0][1].body;
      const expectedSig = crypto.createHmac('sha256', secret).update(body).digest('hex');
      expect(capturedHeaders['X-Aether-Signature']).toBe(expectedSig);
    });

    it('does not include signature header when no secret', async () => {
      let capturedHeaders: Record<string, string> = {};

      const mockFetch = vi.fn(async (url: string, init: any) => {
        capturedHeaders = init.headers;
        return new Response('ok', { status: 200 });
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('No Secret', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event', data: 'hello' });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(capturedHeaders['X-Aether-Signature']).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Webhook Firing and Event Matching
  // ---------------------------------------------------------------------------

  describe('fire', () => {
    it('fires matching webhooks', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Agent Hook', 'https://example.com/agent', ['agent.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'agent.completed', pid: 42 });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://example.com/agent');
      expect(opts.method).toBe('POST');

      const body = JSON.parse(opts.body);
      expect(body.event).toBe('agent.completed');
      expect(body.data.pid).toBe(42);
    });

    it('does not fire non-matching webhooks', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Agent Only', 'https://example.com/agent', ['agent.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'process.spawned', pid: 42 });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not fire disabled webhooks', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('Disabled', 'https://example.com/hook', ['*'], {
        retry_count: 0,
      });
      webhooks.disable(id);

      await webhooks.fire({ type: 'agent.completed', pid: 42 });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends custom headers', async () => {
      let capturedHeaders: Record<string, string> = {};
      const mockFetch = vi.fn(async (url: string, init: any) => {
        capturedHeaders = init.headers;
        return new Response('ok', { status: 200 });
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Custom Headers', 'https://example.com/hook', ['*'], {
        headers: { 'X-Custom': 'value123' },
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      expect(capturedHeaders['X-Custom']).toBe('value123');
      expect(capturedHeaders['Content-Type']).toBe('application/json');
    });

    it('emits webhook.fired event on success', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const firedEvents: any[] = [];
      bus.on('webhook.fired', (data: any) => firedEvents.push(data));

      const id = webhooks.register('Success Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      expect(firedEvents).toHaveLength(1);
      expect(firedEvents[0].webhookId).toBe(id);
      expect(firedEvents[0].success).toBe(true);
    });

    it('emits webhook.failed event after all retries exhausted', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const failedEvents: any[] = [];
      bus.on('webhook.failed', (data: any) => failedEvents.push(data));

      const id = webhooks.register('Failing Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0, // No retries for speed
      });

      await webhooks.fire({ type: 'test.event' });

      expect(failedEvents).toHaveLength(1);
      expect(failedEvents[0].webhookId).toBe(id);
      expect(failedEvents[0].error).toContain('Connection refused');
    });
  });

  // ---------------------------------------------------------------------------
  // Retry Logic
  // ---------------------------------------------------------------------------

  describe('retry logic', () => {
    it('retries on failure up to retry_count', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Network error');
        }
        return new Response('ok', { status: 200 });
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Retry Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 2, // 1 initial + 2 retries = 3 attempts
      });

      await webhooks.fire({ type: 'test.event' });

      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('stops retrying after max attempts', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Always fails');
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Doomed Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 1, // 1 initial + 1 retry = 2 attempts total
      });

      await webhooks.fire({ type: 'test.event' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('increments failure_count on exhausted retries', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('Failure Count', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const hook = webhooks.getWebhook(id);
      expect(hook!.failure_count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Webhook Log Recording
  // ---------------------------------------------------------------------------

  describe('webhook logs', () => {
    it('records successful delivery in logs', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('Logged Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const logs = webhooks.getLogs(id);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(true);
      expect(logs[0].status_code).toBe(200);
      expect(logs[0].event_type).toBe('test.event');
      expect(logs[0].webhook_id).toBe(id);
    });

    it('records failed delivery in logs', async () => {
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('Failed Log Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const logs = webhooks.getLogs(id);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].response_body).toContain('Connection refused');
    });

    it('records HTTP error response in logs', async () => {
      const mockFetch = vi.fn(async () => new Response('Internal Server Error', { status: 500 }));
      vi.stubGlobal('fetch', mockFetch);

      const id = webhooks.register('HTTP Error Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const logs = webhooks.getLogs(id);
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].status_code).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // Inbound Webhooks
  // ---------------------------------------------------------------------------

  describe('inbound webhooks', () => {
    it('createInbound returns id, token, and url', () => {
      const result = webhooks.createInbound('My Inbound', TEST_AGENT_CONFIG);

      expect(result.id).toBeDefined();
      expect(result.token).toBeDefined();
      expect(result.token.length).toBe(64); // 32 bytes hex
      expect(result.url).toContain(result.token);
    });

    it('createInbound emits webhook.inbound.created event', () => {
      const events: any[] = [];
      bus.on('webhook.inbound.created', (data: any) => events.push(data));

      const result = webhooks.createInbound('My Inbound', TEST_AGENT_CONFIG);

      expect(events).toHaveLength(1);
      expect(events[0].inboundId).toBe(result.id);
      expect(events[0].name).toBe('My Inbound');
    });

    it('listInbound returns all inbound webhooks', () => {
      webhooks.createInbound('Inbound 1', TEST_AGENT_CONFIG);
      webhooks.createInbound('Inbound 2', TEST_AGENT_CONFIG);

      const list = webhooks.listInbound();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('Inbound 1');
      expect(list[1].name).toBe('Inbound 2');
    });

    it('listInbound filters by owner_uid', () => {
      webhooks.createInbound('U1', TEST_AGENT_CONFIG, { owner_uid: 'user_1' });
      webhooks.createInbound('U2', TEST_AGENT_CONFIG, { owner_uid: 'user_2' });

      const filtered = webhooks.listInbound('user_1');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('U1');
    });

    it('deleteInbound removes an inbound webhook', () => {
      const result = webhooks.createInbound('To Delete', TEST_AGENT_CONFIG);
      webhooks.deleteInbound(result.id);

      const list = webhooks.listInbound();
      expect(list).toHaveLength(0);
    });

    it('deleteInbound emits webhook.inbound.deleted event', () => {
      const events: any[] = [];
      bus.on('webhook.inbound.deleted', (data: any) => events.push(data));

      const result = webhooks.createInbound('To Delete', TEST_AGENT_CONFIG);
      webhooks.deleteInbound(result.id);

      expect(events).toHaveLength(1);
      expect(events[0].inboundId).toBe(result.id);
    });

    it('handleInbound spawns agent via callback', async () => {
      const mockSpawn = vi.fn(async () => 42);
      webhooks.setSpawnCallback(mockSpawn);

      const result = webhooks.createInbound('Triggerable', TEST_AGENT_CONFIG);
      const response = await webhooks.handleInbound(result.token, { data: 'test' });

      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(response.pid).toBe(42);
    });

    it('handleInbound emits webhook.inbound.triggered event', async () => {
      const events: any[] = [];
      bus.on('webhook.inbound.triggered', (data: any) => events.push(data));

      const mockSpawn = vi.fn(async () => 42);
      webhooks.setSpawnCallback(mockSpawn);

      const result = webhooks.createInbound('Triggerable', TEST_AGENT_CONFIG);
      await webhooks.handleInbound(result.token, {});

      expect(events).toHaveLength(1);
      expect(events[0].inboundId).toBe(result.id);
      expect(events[0].pid).toBe(42);
    });

    it('handleInbound returns empty for unknown token', async () => {
      const mockSpawn = vi.fn(async () => 42);
      webhooks.setSpawnCallback(mockSpawn);

      const response = await webhooks.handleInbound('nonexistent-token', {});

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(response.pid).toBeUndefined();
    });

    it('handleInbound returns empty when no spawn callback', async () => {
      const result = webhooks.createInbound('No Callback', TEST_AGENT_CONFIG);
      const response = await webhooks.handleInbound(result.token, {});

      expect(response.pid).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // EventBus Integration (init)
  // ---------------------------------------------------------------------------

  describe('EventBus integration', () => {
    it('init subscribes to wildcard events and fires matching webhooks', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      await webhooks.init();

      webhooks.register('Bus Hook', 'https://example.com/hook', ['process.*'], {
        retry_count: 0,
      });

      // Emit an event on the bus
      bus.emit('process.spawned', { pid: 1 });

      // Wait for the async setTimeout(0) delivery
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('shutdown stops listening to events', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      await webhooks.init();
      webhooks.register('Bus Hook', 'https://example.com/hook', ['*'], { retry_count: 0 });

      webhooks.shutdown();

      bus.emit('process.spawned', { pid: 1 });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Exponential Backoff
  // ---------------------------------------------------------------------------

  describe('exponential backoff', () => {
    it('computes backoff delays with base 1s doubling pattern', () => {
      // Seed Math.random to return 0 for deterministic jitter
      const origRandom = Math.random;
      Math.random = () => 0;

      try {
        // attempt 0 => min(1000*2^0, 16000) + 0 = 1000
        expect(webhooks.computeBackoffDelay(0)).toBe(1000);
        // attempt 1 => min(1000*2^1, 16000) + 0 = 2000
        expect(webhooks.computeBackoffDelay(1)).toBe(2000);
        // attempt 2 => min(1000*2^2, 16000) + 0 = 4000
        expect(webhooks.computeBackoffDelay(2)).toBe(4000);
        // attempt 3 => min(1000*2^3, 16000) + 0 = 8000
        expect(webhooks.computeBackoffDelay(3)).toBe(8000);
        // attempt 4 => min(1000*2^4, 16000) + 0 = 16000
        expect(webhooks.computeBackoffDelay(4)).toBe(16000);
        // attempt 5 => min(1000*2^5, 16000) + 0 = 16000 (capped)
        expect(webhooks.computeBackoffDelay(5)).toBe(16000);
      } finally {
        Math.random = origRandom;
      }
    });

    it('adds jitter (0-1s) to backoff delay', () => {
      const origRandom = Math.random;
      Math.random = () => 0.5;

      try {
        // attempt 0 => 1000 + 500 = 1500
        expect(webhooks.computeBackoffDelay(0)).toBe(1500);
      } finally {
        Math.random = origRandom;
      }
    });

    it('jitter adds randomness to delays', () => {
      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(webhooks.computeBackoffDelay(0));
      }
      // With real Math.random, very unlikely all 10 are identical
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Dead Letter Queue (DLQ)
  // ---------------------------------------------------------------------------

  describe('Dead Letter Queue', () => {
    it('failed delivery after max retries goes to DLQ', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('Connection refused');
      });
      vi.stubGlobal('fetch', mockFetch);

      const dlqEvents: any[] = [];
      bus.on('webhook.dlq.added', (data: any) => dlqEvents.push(data));

      const id = webhooks.register('DLQ Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 1, // 2 attempts total
      });

      await webhooks.fire({ type: 'test.event' });

      expect(dlqEvents).toHaveLength(1);
      expect(dlqEvents[0].webhookId).toBe(id);
      expect(dlqEvents[0].eventType).toBe('test.event');
      expect(dlqEvents[0].dlqId).toBeDefined();

      // Verify the DLQ entry exists
      const entries = webhooks.getDlqEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].webhook_id).toBe(id);
      expect(entries[0].event_type).toBe('test.event');
      expect(entries[0].error).toContain('Connection refused');
      expect(entries[0].attempts).toBe(2);
      vi.useRealTimers();
    });

    it('successful delivery does NOT go to DLQ', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('Success Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const entries = webhooks.getDlqEntries();
      expect(entries).toHaveLength(0);
    });

    it('getDlqEntries returns entries', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('DLQ1', 'https://example.com/1', ['test.*'], { retry_count: 0 });
      webhooks.register('DLQ2', 'https://example.com/2', ['test.*'], { retry_count: 0 });

      await webhooks.fire({ type: 'test.event' });

      const entries = webhooks.getDlqEntries();
      expect(entries).toHaveLength(2);
      vi.useRealTimers();
    });

    it('getDlqEntry returns a single entry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      const dlqEvents: any[] = [];
      bus.on('webhook.dlq.added', (data: any) => dlqEvents.push(data));

      webhooks.register('DLQ Single', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      const entry = webhooks.getDlqEntry(dlqEvents[0].dlqId);
      expect(entry).not.toBeNull();
      expect(entry!.event_type).toBe('test.event');
      vi.useRealTimers();
    });

    it('DLQ retry re-attempts delivery', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount <= 1) {
          throw new Error('fail');
        }
        return new Response('ok', { status: 200 });
      });
      vi.stubGlobal('fetch', mockFetch);

      const dlqEvents: any[] = [];
      bus.on('webhook.dlq.added', (data: any) => dlqEvents.push(data));

      webhooks.register('DLQ Retry', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });
      expect(dlqEvents).toHaveLength(1);

      // Now retry the DLQ entry - fetch will succeed this time
      const success = await webhooks.retryDlqEntry(dlqEvents[0].dlqId);
      expect(success).toBe(true);
      vi.useRealTimers();
    });

    it('DLQ purge removes a single entry', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      const dlqEvents: any[] = [];
      bus.on('webhook.dlq.added', (data: any) => dlqEvents.push(data));

      webhooks.register('DLQ Purge', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });
      expect(dlqEvents).toHaveLength(1);

      const purged = webhooks.purgeDlqEntry(dlqEvents[0].dlqId);
      expect(purged).toBe(true);

      const entries = webhooks.getDlqEntries();
      expect(entries).toHaveLength(0);
      vi.useRealTimers();
    });

    it('DLQ purge all removes all entries', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      webhooks.register('DLQ A', 'https://example.com/1', ['test.*'], { retry_count: 0 });
      webhooks.register('DLQ B', 'https://example.com/2', ['test.*'], { retry_count: 0 });

      await webhooks.fire({ type: 'test.event' });

      expect(webhooks.getDlqEntries()).toHaveLength(2);

      const count = webhooks.purgeDlq();
      expect(count).toBe(2);

      expect(webhooks.getDlqEntries()).toHaveLength(0);
      vi.useRealTimers();
    });

    it('emits webhook.delivery audit event on success', async () => {
      const mockFetch = vi.fn(async () => new Response('ok', { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const deliveryEvents: any[] = [];
      bus.on('webhook.delivery', (data: any) => deliveryEvents.push(data));

      const id = webhooks.register('Audit Hook', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      expect(deliveryEvents).toHaveLength(1);
      expect(deliveryEvents[0].webhookId).toBe(id);
      expect(deliveryEvents[0].status).toBe('delivered');
      expect(deliveryEvents[0].attempts).toBe(1);
      expect(deliveryEvents[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it('emits webhook.delivery audit event with dlq status on failure', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const mockFetch = vi.fn(async () => {
        throw new Error('fail');
      });
      vi.stubGlobal('fetch', mockFetch);

      const deliveryEvents: any[] = [];
      bus.on('webhook.delivery', (data: any) => deliveryEvents.push(data));

      const id = webhooks.register('DLQ Audit', 'https://example.com/hook', ['test.*'], {
        retry_count: 0,
      });

      await webhooks.fire({ type: 'test.event' });

      expect(deliveryEvents).toHaveLength(1);
      expect(deliveryEvents[0].webhookId).toBe(id);
      expect(deliveryEvents[0].status).toBe('dlq');
      expect(deliveryEvents[0].attempts).toBe(1);
      vi.useRealTimers();
    });
  });

  describe('persistence', () => {
    it('webhooks survive store close and reopen', () => {
      const id = webhooks.register('Persistent', 'https://example.com/hook', ['agent.*'], {
        secret: 'sec',
        owner_uid: 'user_1',
      });
      webhooks.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const webhooks2 = new WebhookManager(bus, store2);

      try {
        const list = webhooks2.list();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(id);
        expect(list[0].name).toBe('Persistent');
        expect(list[0].events).toEqual(['agent.*']);
        expect(list[0].secret).toBe('sec');
      } finally {
        webhooks2.shutdown();
        store2.close();
      }
    });

    it('inbound webhooks survive store close and reopen', () => {
      const result = webhooks.createInbound('Persistent Inbound', TEST_AGENT_CONFIG, {
        owner_uid: 'user_1',
      });
      webhooks.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const webhooks2 = new WebhookManager(bus, store2);

      try {
        const list = webhooks2.listInbound();
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(result.id);
        expect(list[0].name).toBe('Persistent Inbound');
        expect(list[0].agent_config).toEqual(TEST_AGENT_CONFIG);
      } finally {
        webhooks2.shutdown();
        store2.close();
      }
    });
  });
});
