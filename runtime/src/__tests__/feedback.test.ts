import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock native modules that @aether/kernel transitively imports
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(), onExit: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pid: 9999,
  })),
}));
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({ StdioClientTransport: vi.fn() }));
vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({ SSEClientTransport: vi.fn() }));

import { EventBus, StateStore } from '@aether/kernel';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('Feedback System', () => {
  let bus: EventBus;
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join(
      '/tmp',
      `aether-feedback-test-${crypto.randomBytes(8).toString('hex')}`,
    );
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // ---------------------------------------------------------------------------
  // insertFeedback / getFeedback
  // ---------------------------------------------------------------------------

  describe('insertFeedback', () => {
    it('stores positive feedback', () => {
      const id = crypto.randomUUID();
      store.insertFeedback({
        id,
        pid: 1,
        step: 3,
        rating: 1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: Date.now(),
      });

      const result = store.getFeedback(id);
      expect(result).toBeDefined();
      expect(result.pid).toBe(1);
      expect(result.step).toBe(3);
      expect(result.rating).toBe(1);
      expect(result.agent_uid).toBe('agent_1');
    });

    it('stores negative feedback with comment', () => {
      const id = crypto.randomUUID();
      store.insertFeedback({
        id,
        pid: 1,
        step: 5,
        rating: -1,
        comment: 'The answer was incorrect.',
        agent_uid: 'agent_1',
        created_at: Date.now(),
      });

      const result = store.getFeedback(id);
      expect(result).toBeDefined();
      expect(result.rating).toBe(-1);
      expect(result.comment).toBe('The answer was incorrect.');
    });
  });

  // ---------------------------------------------------------------------------
  // getFeedbackByPid
  // ---------------------------------------------------------------------------

  describe('getFeedbackByPid', () => {
    it('returns all feedback for a process', () => {
      const now = Date.now();
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: now,
      });
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 3,
        rating: -1,
        comment: 'Wrong approach',
        agent_uid: 'agent_1',
        created_at: now + 1000,
      });
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 2,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_2',
        created_at: now,
      });

      const feedback = store.getFeedbackByPid(1);
      expect(feedback).toHaveLength(2);
      expect(feedback.every((f: any) => f.pid === 1)).toBe(true);
    });

    it('returns empty array for PID with no feedback', () => {
      const feedback = store.getFeedbackByPid(999);
      expect(feedback).toHaveLength(0);
    });

    it('orders by created_at DESC (newest first)', () => {
      const now = Date.now();
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: now,
      });
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 2,
        rating: -1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: now + 5000,
      });

      const feedback = store.getFeedbackByPid(1);
      expect(feedback[0].step).toBe(2); // newer first
      expect(feedback[1].step).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getFeedbackByAgent
  // ---------------------------------------------------------------------------

  describe('getFeedbackByAgent', () => {
    it('returns feedback across all PIDs for an agent', () => {
      const now = Date.now();
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: now,
      });
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 2,
        step: 1,
        rating: -1,
        comment: 'Poor result',
        agent_uid: 'agent_1',
        created_at: now + 1000,
      });

      const feedback = store.getFeedbackByAgent('agent_1');
      expect(feedback).toHaveLength(2);
    });

    it('does not return feedback from other agents', () => {
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 1,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_1',
        created_at: Date.now(),
      });
      store.insertFeedback({
        id: crypto.randomUUID(),
        pid: 2,
        step: 1,
        rating: 1,
        comment: null,
        agent_uid: 'agent_2',
        created_at: Date.now(),
      });

      const feedback = store.getFeedbackByAgent('agent_1');
      expect(feedback).toHaveLength(1);
      expect(feedback[0].agent_uid).toBe('agent_1');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        store.insertFeedback({
          id: crypto.randomUUID(),
          pid: 1,
          step: i,
          rating: i % 2 === 0 ? 1 : -1,
          comment: null,
          agent_uid: 'agent_1',
          created_at: Date.now() + i,
        });
      }

      const feedback = store.getFeedbackByAgent('agent_1', 5);
      expect(feedback).toHaveLength(5);
    });
  });

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  describe('persistence', () => {
    it('feedback survives store close and reopen', () => {
      const id = crypto.randomUUID();
      store.insertFeedback({
        id,
        pid: 1,
        step: 3,
        rating: 1,
        comment: 'Great work!',
        agent_uid: 'agent_1',
        created_at: Date.now(),
      });

      store.close();
      const store2 = new StateStore(bus, dbPath);

      try {
        const result = store2.getFeedback(id);
        expect(result).toBeDefined();
        expect(result.rating).toBe(1);
        expect(result.comment).toBe('Great work!');
      } finally {
        store2.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Feedback summary computation
  // ---------------------------------------------------------------------------

  describe('feedback summary', () => {
    it('can compute positive/negative ratio', () => {
      const now = Date.now();
      for (let i = 0; i < 7; i++) {
        store.insertFeedback({
          id: crypto.randomUUID(),
          pid: 1,
          step: i,
          rating: 1,
          comment: null,
          agent_uid: 'agent_1',
          created_at: now + i,
        });
      }
      for (let i = 0; i < 3; i++) {
        store.insertFeedback({
          id: crypto.randomUUID(),
          pid: 1,
          step: 10 + i,
          rating: -1,
          comment: 'Issue',
          agent_uid: 'agent_1',
          created_at: now + 100 + i,
        });
      }

      const feedback = store.getFeedbackByAgent('agent_1');
      const positive = feedback.filter((f: any) => f.rating === 1).length;
      const negative = feedback.filter((f: any) => f.rating === -1).length;
      expect(positive).toBe(7);
      expect(negative).toBe(3);
      expect(feedback).toHaveLength(10);
    });
  });
});
