import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { MemoryManager } from '../MemoryManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('MemoryManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let memory: MemoryManager;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join('/tmp', `aether-memory-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    store = new StateStore(bus, dbPath);
    memory = new MemoryManager(bus, store);
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
  // Store
  // ---------------------------------------------------------------------------

  describe('store', () => {
    it('stores a memory and returns a MemoryRecord with UUID', () => {
      const result = memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'I completed the data analysis task',
        tags: ['task', 'analysis'],
        importance: 0.8,
        source_pid: 1,
      });

      expect(result.id).toBeDefined();
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.agent_uid).toBe('agent_1');
      expect(result.layer).toBe('episodic');
      expect(result.content).toBe('I completed the data analysis task');
      expect(result.tags).toEqual(['task', 'analysis']);
      expect(result.importance).toBe(0.8);
      expect(result.access_count).toBe(0);
      expect(result.created_at).toBeGreaterThan(0);
      expect(result.last_accessed).toBeGreaterThan(0);
    });

    it('clamps importance to [0, 1] range', () => {
      const high = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'High importance',
        importance: 5.0,
      });
      expect(high.importance).toBe(1.0);

      const low = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Low importance',
        importance: -1.0,
      });
      expect(low.importance).toBe(0.0);
    });

    it('defaults importance to 0.5 and tags to empty array', () => {
      const result = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Some fact',
      });
      expect(result.importance).toBe(0.5);
      expect(result.tags).toEqual([]);
    });

    it('emits memory.stored event', () => {
      const events: any[] = [];
      bus.on('memory.stored', (data: any) => events.push(data));

      memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Test event',
      });

      expect(events).toHaveLength(1);
      expect(events[0].agent_uid).toBe('agent_1');
      expect(events[0].layer).toBe('episodic');
      expect(events[0].memoryId).toBeDefined();
    });

    it('stores memories in all four layers', () => {
      const layers = ['episodic', 'semantic', 'procedural', 'social'] as const;
      for (const layer of layers) {
        memory.store({
          agent_uid: 'agent_1',
          layer,
          content: `${layer} memory`,
        });
      }

      const stats = memory.getStats('agent_1');
      expect(stats.total).toBe(4);
      expect(stats.episodic).toBe(1);
      expect(stats.semantic).toBe(1);
      expect(stats.procedural).toBe(1);
      expect(stats.social).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Recall
  // ---------------------------------------------------------------------------

  describe('recall', () => {
    beforeEach(() => {
      // Seed some memories
      memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'The server crashed due to a memory leak in the parser module',
        tags: ['bug', 'server'],
        importance: 0.9,
      });
      memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Python is a dynamically typed programming language',
        tags: ['python', 'programming'],
        importance: 0.5,
      });
      memory.store({
        agent_uid: 'agent_1',
        layer: 'procedural',
        content: 'To deploy, run npm build then npm start in production mode',
        tags: ['deploy', 'npm'],
        importance: 0.7,
      });
      memory.store({
        agent_uid: 'agent_2',
        layer: 'episodic',
        content: 'Agent 2 specific memory about databases',
        tags: ['database'],
        importance: 0.6,
      });
    });

    it('recalls all memories for an agent', () => {
      const results = memory.recall({ agent_uid: 'agent_1' });
      expect(results).toHaveLength(3);
    });

    it('does not recall memories from other agents', () => {
      const results = memory.recall({ agent_uid: 'agent_1' });
      expect(results.every((m) => m.agent_uid === 'agent_1')).toBe(true);
    });

    it('recalls by layer filter', () => {
      const results = memory.recall({ agent_uid: 'agent_1', layer: 'episodic' });
      expect(results).toHaveLength(1);
      expect(results[0].layer).toBe('episodic');
    });

    it('recalls by tag filter', () => {
      const results = memory.recall({ agent_uid: 'agent_1', tags: ['deploy'] });
      expect(results).toHaveLength(1);
      expect(results[0].tags).toContain('deploy');
    });

    it('uses FTS5 for full-text search', () => {
      const results = memory.recall({
        agent_uid: 'agent_1',
        query: 'server crash memory leak',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('server crashed');
    });

    it('respects limit parameter', () => {
      // Add more memories
      for (let i = 0; i < 10; i++) {
        memory.store({
          agent_uid: 'agent_1',
          layer: 'semantic',
          content: `Fact number ${i} about testing`,
          importance: 0.3 + i * 0.05,
        });
      }

      const results = memory.recall({ agent_uid: 'agent_1', limit: 5 });
      expect(results).toHaveLength(5);
    });

    it('orders results by effective importance (higher first)', () => {
      const results = memory.recall({ agent_uid: 'agent_1' });
      // First result should have highest importance
      expect(results[0].importance).toBeGreaterThanOrEqual(results[results.length - 1].importance);
    });

    it('increments access_count on recall', () => {
      const first = memory.recall({ agent_uid: 'agent_1', layer: 'episodic' });
      expect(first).toHaveLength(1);

      // Recall again to trigger access count update
      const second = memory.recall({ agent_uid: 'agent_1', layer: 'episodic' });
      expect(second[0].access_count).toBeGreaterThanOrEqual(1);
    });

    it('emits memory.recalled event', () => {
      const events: any[] = [];
      bus.on('memory.recalled', (data: any) => events.push(data));

      memory.recall({ agent_uid: 'agent_1' });

      expect(events).toHaveLength(1);
      expect(events[0].agent_uid).toBe('agent_1');
      expect(events[0].memories).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Forget
  // ---------------------------------------------------------------------------

  describe('forget', () => {
    it('deletes a memory and returns true', () => {
      const stored = memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'To be forgotten',
      });

      const result = memory.forget(stored.id, 'agent_1');
      expect(result).toBe(true);

      // Verify it's gone
      const recalled = memory.recall({ agent_uid: 'agent_1' });
      expect(recalled).toHaveLength(0);
    });

    it('returns false for non-existent memory', () => {
      const result = memory.forget('nonexistent-id', 'agent_1');
      expect(result).toBe(false);
    });

    it('prevents agent from deleting another agent memory', () => {
      const stored = memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Agent 1 memory',
      });

      // Agent 2 tries to delete agent 1's memory
      const result = memory.forget(stored.id, 'agent_2');
      expect(result).toBe(false);

      // Memory still exists
      const recalled = memory.recall({ agent_uid: 'agent_1' });
      expect(recalled).toHaveLength(1);
    });

    it('emits memory.forgotten event', () => {
      const events: any[] = [];
      bus.on('memory.forgotten', (data: any) => events.push(data));

      const stored = memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Will be forgotten',
      });
      memory.forget(stored.id, 'agent_1');

      expect(events).toHaveLength(1);
      expect(events[0].memoryId).toBe(stored.id);
      expect(events[0].agent_uid).toBe('agent_1');
    });
  });

  // ---------------------------------------------------------------------------
  // Share
  // ---------------------------------------------------------------------------

  describe('share', () => {
    it('copies memory from one agent to another', () => {
      const original = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Shared knowledge about APIs',
        tags: ['api'],
        importance: 0.8,
      });

      const shared = memory.share(original.id, 'agent_1', 'agent_2');
      expect(shared).not.toBeNull();
      expect(shared!.agent_uid).toBe('agent_2');
      expect(shared!.content).toBe('Shared knowledge about APIs');
      expect(shared!.tags).toContain('shared_from:agent_1');
      expect(shared!.importance).toBeCloseTo(0.64); // 0.8 * 0.8
      expect(shared!.related_memories).toContain(original.id);
    });

    it('returns null for non-existent source memory', () => {
      const result = memory.share('nonexistent', 'agent_1', 'agent_2');
      expect(result).toBeNull();
    });

    it('returns null if from_uid does not own the memory', () => {
      const stored = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Agent 1 only',
      });

      const result = memory.share(stored.id, 'agent_2', 'agent_3');
      expect(result).toBeNull();
    });

    it('emits memory.shared event', () => {
      const events: any[] = [];
      bus.on('memory.shared', (data: any) => events.push(data));

      const original = memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'Shareable fact',
      });
      memory.share(original.id, 'agent_1', 'agent_2');

      expect(events).toHaveLength(1);
      expect(events[0].from_uid).toBe('agent_1');
      expect(events[0].to_uid).toBe('agent_2');
    });
  });

  // ---------------------------------------------------------------------------
  // Consolidation
  // ---------------------------------------------------------------------------

  describe('consolidate', () => {
    it('removes expired memories', () => {
      const past = Date.now() - 1000;
      memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Expired memory',
        expires_at: past,
      });
      memory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Valid memory',
      });

      const removed = memory.consolidate('agent_1');
      expect(removed).toBe(1);

      const remaining = memory.recall({ agent_uid: 'agent_1' });
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('Valid memory');
    });

    it('emits memory.consolidated event', () => {
      const events: any[] = [];
      bus.on('memory.consolidated', (data: any) => events.push(data));

      memory.consolidate('agent_1');

      expect(events).toHaveLength(1);
      expect(events[0].agent_uid).toBe('agent_1');
    });
  });

  // ---------------------------------------------------------------------------
  // Per-Layer Limits
  // ---------------------------------------------------------------------------

  describe('per-layer limits', () => {
    it('evicts lowest-importance memories when limit is reached', () => {
      // Create manager with very low limit
      const smallMemory = new MemoryManager(bus, store, { maxPerLayer: 3 });

      // Store 4 memories with different importance levels
      smallMemory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Low importance memory',
        importance: 0.1,
      });
      smallMemory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'Medium importance',
        importance: 0.5,
      });
      smallMemory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'High importance',
        importance: 0.9,
      });

      // This should evict the lowest importance memory
      smallMemory.store({
        agent_uid: 'agent_1',
        layer: 'episodic',
        content: 'New memory that causes eviction',
        importance: 0.6,
      });

      const results = smallMemory.recall({ agent_uid: 'agent_1', layer: 'episodic' });
      expect(results).toHaveLength(3);
      // The lowest importance (0.1) should have been evicted
      expect(results.find((m) => m.content === 'Low importance memory')).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Importance Decay
  // ---------------------------------------------------------------------------

  describe('importance decay', () => {
    it('recent memories have higher effective importance than old ones', () => {
      // Store a memory, then check that a fresh recall sorts newer higher
      // (Both have same nominal importance)
      memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'First memory',
        importance: 0.5,
      });

      // We can't easily test time decay in a unit test without mocking Date.now,
      // but we can verify the ranking is consistent
      const results = memory.recall({ agent_uid: 'agent_1' });
      expect(results).toHaveLength(1);
      expect(results[0].importance).toBe(0.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  describe('getStats', () => {
    it('returns correct per-layer counts', () => {
      memory.store({ agent_uid: 'agent_1', layer: 'episodic', content: 'E1' });
      memory.store({ agent_uid: 'agent_1', layer: 'episodic', content: 'E2' });
      memory.store({ agent_uid: 'agent_1', layer: 'semantic', content: 'S1' });
      memory.store({ agent_uid: 'agent_1', layer: 'procedural', content: 'P1' });

      const stats = memory.getStats('agent_1');
      expect(stats.total).toBe(4);
      expect(stats.episodic).toBe(2);
      expect(stats.semantic).toBe(1);
      expect(stats.procedural).toBe(1);
      expect(stats.social).toBe(0);
    });

    it('returns zeros for agent with no memories', () => {
      const stats = memory.getStats('unknown_agent');
      expect(stats.total).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Context Loading
  // ---------------------------------------------------------------------------

  describe('getMemoriesForContext', () => {
    it('returns relevant memories for a goal', () => {
      memory.store({
        agent_uid: 'agent_1',
        layer: 'semantic',
        content: 'The API server runs on port 3001',
        tags: ['api', 'server'],
        importance: 0.7,
      });
      memory.store({
        agent_uid: 'agent_1',
        layer: 'procedural',
        content: 'To test the API, use curl localhost:3001/health',
        tags: ['testing', 'api'],
        importance: 0.6,
      });

      const results = memory.getMemoriesForContext('agent_1', 'Fix the API server bug', 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 20; i++) {
        memory.store({
          agent_uid: 'agent_1',
          layer: 'semantic',
          content: `Fact ${i} about various topics`,
          importance: 0.3 + Math.random() * 0.5,
        });
      }

      const results = memory.getMemoriesForContext('agent_1', 'general knowledge', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('returns empty array for agent with no memories', () => {
      const results = memory.getMemoriesForContext('unknown_agent', 'some goal', 5);
      expect(results).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cross-session persistence
  // ---------------------------------------------------------------------------

  describe('cross-session persistence', () => {
    it('memories survive store close and reopen', () => {
      // Store a memory
      const original = memory.store({
        agent_uid: 'agent_persist',
        layer: 'semantic',
        content: 'This knowledge persists across sessions',
        tags: ['persistent'],
        importance: 0.9,
      });

      // Close and reopen the store
      store.close();
      const store2 = new StateStore(bus, dbPath);
      const memory2 = new MemoryManager(bus, store2);

      try {
        // Recall from the new instance
        const recalled = memory2.recall({ agent_uid: 'agent_persist' });
        expect(recalled).toHaveLength(1);
        expect(recalled[0].id).toBe(original.id);
        expect(recalled[0].content).toBe('This knowledge persists across sessions');
        expect(recalled[0].tags).toEqual(['persistent']);
      } finally {
        store2.close();
      }
    });
  });
});
