import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import os from 'node:os';

describe('StateStore', () => {
  let bus: EventBus;
  let store: StateStore;
  let dbPath: string;

  beforeEach(() => {
    bus = new EventBus();
    const tmpDir = path.join(
      os.tmpdir(),
      `aether-state-test-${crypto.randomBytes(8).toString('hex')}`,
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

  describe('schema creation', () => {
    it('creates database with correct tables', () => {
      // The constructor should have created all tables
      // Verify by running a query against each table
      expect(() => store.getAllProcesses()).not.toThrow();
      expect(() => store.getRecentLogs(10)).not.toThrow();
      expect(() => store.getAllFiles()).not.toThrow();
      expect(() => store.getLatestMetrics(10)).not.toThrow();
      expect(() => store.getAllSnapshots()).not.toThrow();
      expect(() => store.getAllUsers()).not.toThrow();
    });
  });

  describe('process records', () => {
    it('recordProcess / getProcess round-trip', () => {
      const record = {
        pid: 1,
        uid: 'agent_1',
        name: 'Test Agent',
        role: 'Coder',
        goal: 'Write code',
        state: 'created' as const,
        agentPhase: 'booting' as const,
        createdAt: Date.now(),
      };

      store.recordProcess(record);
      const retrieved = store.getProcess(1);

      expect(retrieved).toBeDefined();
      expect(retrieved!.pid).toBe(1);
      expect(retrieved!.uid).toBe('agent_1');
      expect(retrieved!.name).toBe('Test Agent');
      expect(retrieved!.role).toBe('Coder');
      expect(retrieved!.goal).toBe('Write code');
    });

    it('getAllProcesses returns all records', () => {
      store.recordProcess({
        pid: 1,
        uid: 'agent_1',
        name: 'Agent 1',
        role: 'Coder',
        goal: 'Goal 1',
        state: 'running',
        createdAt: Date.now(),
      });
      store.recordProcess({
        pid: 2,
        uid: 'agent_2',
        name: 'Agent 2',
        role: 'Researcher',
        goal: 'Goal 2',
        state: 'running',
        createdAt: Date.now(),
      });

      const all = store.getAllProcesses();
      expect(all).toHaveLength(2);
    });

    it('updateProcessState updates state and phase', () => {
      store.recordProcess({
        pid: 1,
        uid: 'agent_1',
        name: 'Agent 1',
        role: 'Coder',
        goal: 'Goal',
        state: 'created',
        createdAt: Date.now(),
      });

      store.updateProcessState(1, 'running', 'thinking');
      const updated = store.getProcess(1);
      expect(updated!.state).toBe('running');
      expect(updated!.agentPhase).toBe('thinking');
    });
  });

  describe('agent logs', () => {
    it('recordAgentLog / getAgentLogs round-trip', () => {
      store.recordProcess({
        pid: 1,
        uid: 'agent_1',
        name: 'Agent 1',
        role: 'Coder',
        goal: 'Goal',
        state: 'running',
        createdAt: Date.now(),
      });

      store.recordAgentLog({
        pid: 1,
        step: 1,
        phase: 'thought',
        content: 'I should write a test',
        timestamp: Date.now(),
      });
      store.recordAgentLog({
        pid: 1,
        step: 2,
        phase: 'action',
        tool: 'write_file',
        content: '{"path": "test.ts"}',
        timestamp: Date.now() + 1,
      });

      const logs = store.getAgentLogs(1);
      expect(logs).toHaveLength(2);
      expect(logs[0].phase).toBe('thought');
      expect(logs[1].phase).toBe('action');
      expect(logs[1].tool).toBe('write_file');
    });
  });

  describe('metrics', () => {
    it('recordMetric / getMetrics with time range filtering', () => {
      const now = Date.now();
      store.recordMetric({
        timestamp: now - 2000,
        processCount: 2,
        cpuPercent: 10,
        memoryMB: 100,
        containerCount: 1,
      });
      store.recordMetric({
        timestamp: now - 1000,
        processCount: 3,
        cpuPercent: 20,
        memoryMB: 200,
        containerCount: 2,
      });
      store.recordMetric({
        timestamp: now,
        processCount: 4,
        cpuPercent: 30,
        memoryMB: 300,
        containerCount: 3,
      });

      // Get metrics since 1500ms ago (should get the last 2)
      const recent = store.getMetrics(now - 1500);
      expect(recent).toHaveLength(2);
      expect(recent[0].processCount).toBe(3);
      expect(recent[1].processCount).toBe(4);
    });
  });

  describe('users', () => {
    it('createUser stores user data', () => {
      store.createUser({
        id: 'user_1',
        username: 'testuser',
        displayName: 'Test User',
        passwordHash: 'abc:def',
        role: 'user',
        createdAt: Date.now(),
      });

      const user = store.getUserByUsername('testuser');
      expect(user).toBeDefined();
      expect(user!.username).toBe('testuser');
      expect(user!.displayName).toBe('Test User');
    });

    it('getAllUsers returns all users', () => {
      store.createUser({
        id: 'user_1',
        username: 'user1',
        displayName: 'User 1',
        passwordHash: 'hash1',
        role: 'admin',
        createdAt: Date.now(),
      });
      store.createUser({
        id: 'user_2',
        username: 'user2',
        displayName: 'User 2',
        passwordHash: 'hash2',
        role: 'user',
        createdAt: Date.now(),
      });

      const users = store.getAllUsers();
      expect(users).toHaveLength(2);
    });

    it('deleteUser removes user', () => {
      store.createUser({
        id: 'user_del',
        username: 'todelete',
        displayName: 'Delete Me',
        passwordHash: 'hash',
        role: 'user',
        createdAt: Date.now(),
      });

      store.deleteUser('user_del');
      const result = store.getUserById('user_del');
      expect(result).toBeUndefined();
    });
  });

  describe('snapshots', () => {
    it('recordSnapshot / getSnapshotById round-trip', () => {
      const now = Date.now();
      store.recordSnapshot({
        id: 'snap_1',
        pid: 1,
        timestamp: now,
        description: 'Test snapshot',
        filePath: '/tmp/snap.json',
        tarballPath: '/tmp/snap.tar.gz',
        processInfo: '{}',
        sizeBytes: 1024,
      });

      const snap = store.getSnapshotById('snap_1');
      expect(snap).toBeDefined();
      expect(snap!.id).toBe('snap_1');
      expect(snap!.pid).toBe(1);
      expect(snap!.description).toBe('Test snapshot');
    });
  });
});
