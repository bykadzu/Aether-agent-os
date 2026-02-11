import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { AuditLogger, sanitizeArgs, resultHash } from '../AuditLogger.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('AuditLogger', () => {
  let bus: EventBus;
  let store: StateStore;
  let audit: AuditLogger;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join('/tmp', `aether-audit-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    audit = new AuditLogger(bus, store);
  });

  afterEach(() => {
    audit.shutdown();
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // Tool Invocation Logging
  // ---------------------------------------------------------------------------

  describe('logToolInvocation', () => {
    it('logs a tool invocation with sanitized args', () => {
      audit.logToolInvocation(
        1,
        'agent_1',
        'file_read',
        { path: '/home/test.txt' },
        'file content',
      );

      const result = audit.query({});
      expect(result.total).toBe(1);
      expect(result.entries).toHaveLength(1);

      const entry = result.entries[0];
      expect(entry.event_type).toBe('tool.invocation');
      expect(entry.actor_pid).toBe(1);
      expect(entry.action).toBe('file_read');
      expect(entry.args_sanitized).toContain('/home/test.txt');
      expect(entry.result_hash).toBeDefined();
      expect(entry.result_hash).not.toBeNull();
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('records multiple tool invocations', () => {
      audit.logToolInvocation(1, 'agent_1', 'file_read', { path: '/a.txt' });
      audit.logToolInvocation(1, 'agent_1', 'file_write', { path: '/b.txt', content: 'hi' });
      audit.logToolInvocation(2, 'agent_2', 'shell_exec', { command: 'ls' });

      const result = audit.query({});
      expect(result.total).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Sensitive Data Sanitization
  // ---------------------------------------------------------------------------

  describe('sanitizeArgs', () => {
    it('redacts password fields', () => {
      const sanitized = sanitizeArgs({ username: 'admin', password: 'secret123' });
      expect(sanitized).toEqual({ username: 'admin', password: '[REDACTED]' });
    });

    it('redacts token fields', () => {
      const sanitized = sanitizeArgs({ token: 'abc123', data: 'hello' });
      expect(sanitized).toEqual({ token: '[REDACTED]', data: 'hello' });
    });

    it('redacts apiKey and api_key fields', () => {
      const sanitized = sanitizeArgs({ apiKey: 'key1', api_key: 'key2', name: 'test' });
      expect(sanitized).toEqual({ apiKey: '[REDACTED]', api_key: '[REDACTED]', name: 'test' });
    });

    it('redacts secret and credentials fields', () => {
      const sanitized = sanitizeArgs({ secret: 'mysecret', credentials: { a: 1 } });
      expect(sanitized).toEqual({ secret: '[REDACTED]', credentials: '[REDACTED]' });
    });

    it('redacts authorization field', () => {
      const sanitized = sanitizeArgs({ authorization: 'Bearer xyz', method: 'GET' });
      expect(sanitized).toEqual({ authorization: '[REDACTED]', method: 'GET' });
    });

    it('handles nested objects', () => {
      const sanitized = sanitizeArgs({
        config: { apiKey: 'secret', host: 'localhost' },
        name: 'test',
      });
      expect(sanitized).toEqual({
        config: { apiKey: '[REDACTED]', host: 'localhost' },
        name: 'test',
      });
    });

    it('handles arrays', () => {
      const sanitized = sanitizeArgs([{ password: 'abc' }, { name: 'test' }]);
      expect(sanitized).toEqual([{ password: '[REDACTED]' }, { name: 'test' }]);
    });

    it('handles null and primitives gracefully', () => {
      expect(sanitizeArgs(null)).toBeNull();
      expect(sanitizeArgs(undefined)).toBeUndefined();
      expect(sanitizeArgs('hello')).toBe('hello');
      expect(sanitizeArgs(42)).toBe(42);
    });
  });

  // ---------------------------------------------------------------------------
  // Result Hash
  // ---------------------------------------------------------------------------

  describe('resultHash', () => {
    it('returns SHA-256 hash of first 1000 chars', () => {
      const hash = resultHash('hello world');
      expect(hash).toBeDefined();
      expect(hash!.length).toBe(64); // SHA-256 hex length
    });

    it('returns null for null or undefined input', () => {
      expect(resultHash(null)).toBeNull();
      expect(resultHash(undefined)).toBeNull();
    });

    it('truncates input to 1000 chars before hashing', () => {
      const longStr = 'a'.repeat(2000);
      const shortStr = 'a'.repeat(1000);
      expect(resultHash(longStr)).toBe(resultHash(shortStr));
    });
  });

  // ---------------------------------------------------------------------------
  // Auth Event Logging
  // ---------------------------------------------------------------------------

  describe('logAuthEvent', () => {
    it('logs auth events', () => {
      audit.logAuthEvent('login', 'user_1', { ip: '127.0.0.1' });

      const result = audit.query({});
      expect(result.total).toBe(1);
      expect(result.entries[0].event_type).toBe('auth');
      expect(result.entries[0].action).toBe('login');
      expect(result.entries[0].actor_uid).toBe('user_1');
    });

    it('logs login_failure events', () => {
      audit.logAuthEvent('login_failure', null, { username: 'attacker' });

      const result = audit.query({});
      expect(result.entries[0].action).toBe('login_failure');
      expect(result.entries[0].actor_uid).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Admin Action Logging
  // ---------------------------------------------------------------------------

  describe('logAdminAction', () => {
    it('logs admin actions', () => {
      audit.logAdminAction('workspace.cleanup', 'admin_1', 'agent-workspace-1');

      const result = audit.query({});
      expect(result.total).toBe(1);
      expect(result.entries[0].event_type).toBe('admin');
      expect(result.entries[0].action).toBe('workspace.cleanup');
      expect(result.entries[0].target).toBe('agent-workspace-1');
    });
  });

  // ---------------------------------------------------------------------------
  // Query Filtering
  // ---------------------------------------------------------------------------

  describe('query filtering', () => {
    beforeEach(() => {
      // Seed audit entries
      audit.logToolInvocation(1, 'agent_1', 'file_read', { path: '/a.txt' });
      audit.logToolInvocation(1, 'agent_1', 'shell_exec', { cmd: 'ls' });
      audit.logToolInvocation(2, 'agent_2', 'file_read', { path: '/b.txt' });
      audit.logAuthEvent('login', 'user_1');
      audit.logAdminAction('agent.spawn', 'admin_1', 'agent-1');
    });

    it('filters by PID', () => {
      const result = audit.query({ pid: 1 });
      expect(result.total).toBe(2);
      result.entries.forEach((e) => expect(e.actor_pid).toBe(1));
    });

    it('filters by action', () => {
      const result = audit.query({ action: 'file_read' });
      expect(result.total).toBe(2);
      result.entries.forEach((e) => expect(e.action).toBe('file_read'));
    });

    it('filters by event_type', () => {
      const result = audit.query({ event_type: 'auth' });
      expect(result.total).toBe(1);
      expect(result.entries[0].action).toBe('login');
    });

    it('filters by time range', () => {
      const now = Date.now();
      const result = audit.query({ startTime: now - 60000, endTime: now + 60000 });
      expect(result.total).toBe(5); // All entries are within range
    });

    it('returns empty when no match', () => {
      const result = audit.query({ pid: 999 });
      expect(result.total).toBe(0);
      expect(result.entries).toHaveLength(0);
    });

    it('combines multiple filters', () => {
      const result = audit.query({ pid: 1, action: 'file_read' });
      expect(result.total).toBe(1);
      expect(result.entries[0].actor_pid).toBe(1);
      expect(result.entries[0].action).toBe('file_read');
    });
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  describe('pagination', () => {
    beforeEach(() => {
      for (let i = 0; i < 20; i++) {
        audit.logToolInvocation(i, `agent_${i}`, `tool_${i}`, { index: i });
      }
    });

    it('defaults to page size of 50', () => {
      const result = audit.query({});
      expect(result.total).toBe(20);
      expect(result.entries).toHaveLength(20);
    });

    it('respects limit parameter', () => {
      const result = audit.query({ limit: 5 });
      expect(result.total).toBe(20);
      expect(result.entries).toHaveLength(5);
    });

    it('respects offset parameter', () => {
      const page1 = audit.query({ limit: 5, offset: 0 });
      const page2 = audit.query({ limit: 5, offset: 5 });

      expect(page1.entries).toHaveLength(5);
      expect(page2.entries).toHaveLength(5);

      // Entries should not overlap (ordered by timestamp DESC, so IDs differ)
      const page1Ids = new Set(page1.entries.map((e) => e.id));
      const page2Ids = new Set(page2.entries.map((e) => e.id));
      for (const id of page2Ids) {
        expect(page1Ids.has(id)).toBe(false);
      }
    });

    it('offset beyond total returns empty', () => {
      const result = audit.query({ limit: 5, offset: 100 });
      expect(result.total).toBe(20);
      expect(result.entries).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Retention Pruning
  // ---------------------------------------------------------------------------

  describe('retention pruning', () => {
    it('prunes old entries', () => {
      // Insert entries directly with old timestamps
      const oldTimestamp = Date.now() - 31 * 24 * 60 * 60 * 1000; // 31 days ago
      store.insertAuditLog({
        timestamp: oldTimestamp,
        event_type: 'tool.invocation',
        actor_pid: 1,
        actor_uid: 'agent_1',
        action: 'old_tool',
        target: null,
        args_sanitized: null,
        result_hash: null,
        metadata: null,
      });

      // Insert a recent entry
      audit.logToolInvocation(2, 'agent_2', 'new_tool', {});

      // Verify both exist
      expect(audit.query({}).total).toBe(2);

      // Prune
      const removed = audit.prune();
      expect(removed).toBe(1);

      // Verify only the recent one remains
      const result = audit.query({});
      expect(result.total).toBe(1);
      expect(result.entries[0].action).toBe('new_tool');
    });

    it('does not prune recent entries', () => {
      audit.logToolInvocation(1, 'agent_1', 'recent', {});

      const removed = audit.prune();
      expect(removed).toBe(0);
      expect(audit.query({}).total).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // EventBus Subscription
  // ---------------------------------------------------------------------------

  describe('EventBus integration', () => {
    it('auto-logs process.spawned events', () => {
      bus.emit('process.spawned', {
        pid: 10,
        info: { pid: 10, uid: 'agent_10', name: 'TestAgent', env: { AETHER_GOAL: 'test goal' } },
      });

      const result = audit.query({ action: 'agent.spawn' });
      expect(result.total).toBe(1);
      expect(result.entries[0].actor_pid).toBe(10);
      expect(result.entries[0].target).toBe('TestAgent');
    });

    it('auto-logs process.exit events', () => {
      bus.emit('process.exit', { pid: 5, code: 0 });

      const result = audit.query({ action: 'agent.exit' });
      expect(result.total).toBe(1);
      expect(result.entries[0].actor_pid).toBe(5);
    });

    it('auto-logs agent.action events', () => {
      bus.emit('agent.action', { pid: 3, tool: 'file_write', args: { path: '/test.txt' } });

      const result = audit.query({ event_type: 'tool.invocation' });
      expect(result.total).toBe(1);
      expect(result.entries[0].action).toBe('file_write');
      expect(result.entries[0].actor_pid).toBe(3);
    });

    it('auto-logs resource.exceeded events', () => {
      bus.emit('resource.exceeded', {
        pid: 7,
        reason: 'Token limit exceeded',
        usage: { pid: 7, totalInputTokens: 100000 },
      });

      const result = audit.query({ action: 'quota.exceeded' });
      expect(result.total).toBe(1);
      expect(result.entries[0].event_type).toBe('resource');
    });

    it('auto-logs workspace.cleaned events', () => {
      bus.emit('workspace.cleaned', { agentName: 'researcher-5', success: true });

      const result = audit.query({ action: 'workspace.cleanup' });
      expect(result.total).toBe(1);
      expect(result.entries[0].target).toBe('researcher-5');
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-session Persistence
  // ---------------------------------------------------------------------------

  describe('cross-session persistence', () => {
    it('entries survive store close and reopen', () => {
      audit.logToolInvocation(1, 'agent_1', 'persistent_tool', { key: 'value' });
      audit.shutdown();
      store.close();

      const store2 = new StateStore(bus, dbPath);
      const audit2 = new AuditLogger(bus, store2);
      try {
        const result = audit2.query({});
        expect(result.total).toBe(1);
        expect(result.entries[0].action).toBe('persistent_tool');
      } finally {
        audit2.shutdown();
        store2.close();
      }
    });
  });
});
