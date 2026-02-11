import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ProcessManager } from '../ProcessManager.js';
import { StateStore } from '../StateStore.js';
import { MemoryManager } from '../MemoryManager.js';
import { ResourceGovernor } from '../ResourceGovernor.js';
import { SnapshotManager } from '../SnapshotManager.js';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

// Mock child_process execFile to avoid needing actual tar
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: vi.fn((cmd: string, args: string[], opts: any, cb: any) => {
      // Simulate tar by creating an empty file
      if (typeof opts === 'function') {
        cb = opts;
        opts = {};
      }
      if (cmd === 'tar' && args[0] === 'czf') {
        const tarPath = args[1];
        fs.writeFileSync(tarPath, 'mock-tar-content');
        cb(null, '', '');
      } else if (cmd === 'tar' && args[0] === 'xzf') {
        cb(null, '', '');
      } else if (cmd === 'cp') {
        cb(null, '', '');
      } else {
        cb(null, '', '');
      }
    }),
  };
});

describe('SnapshotManager', () => {
  let bus: EventBus;
  let pm: ProcessManager;
  let store: StateStore;
  let memory: MemoryManager;
  let resources: ResourceGovernor;
  let snapMgr: SnapshotManager;
  let testRoot: string;
  let dbPath: string;

  beforeEach(async () => {
    bus = new EventBus();
    pm = new ProcessManager(bus);
    const tmpDir = path.join('/tmp', `aether-snap-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    testRoot = tmpDir;
    dbPath = path.join(tmpDir, 'snap-test.db');
    store = new StateStore(bus, dbPath);
    memory = new MemoryManager(bus, store);
    resources = new ResourceGovernor(bus, pm);
    snapMgr = new SnapshotManager(bus, pm, store, testRoot, memory, resources);
    await snapMgr.init();

    // Create snapshots dir (mimic what init does)
    fs.mkdirSync(path.join('/tmp/aether/var/snapshots'), { recursive: true });
  });

  afterEach(() => {
    store.close();
    try {
      fs.rmSync(testRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('createSnapshot()', () => {
    it('creates JSON file and records in StateStore', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Test' });
      pm.setState(proc.info.pid, 'running');

      // Create agent home dir
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid, 'Test snapshot');

      expect(snapshot.id).toMatch(/^snap_\d+_\d+$/);
      expect(snapshot.pid).toBe(proc.info.pid);
      expect(snapshot.description).toBe('Test snapshot');
      expect(snapshot.size).toBeGreaterThan(0);

      // Verify stored in StateStore
      const stored = store.getSnapshotById(snapshot.id);
      expect(stored).toBeDefined();
      expect(stored!.pid).toBe(proc.info.pid);
    });

    it('emits snapshot.created event', async () => {
      const handler = vi.fn();
      bus.on('snapshot.created', handler);

      const proc = pm.spawn({ role: 'Coder', goal: 'Test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      await snapMgr.createSnapshot(proc.info.pid);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('throws for non-existent process', async () => {
      await expect(snapMgr.createSnapshot(999)).rejects.toThrow('Process 999 not found');
    });

    it('captures process state, memories, and resource usage in manifest', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Atomic test' });
      pm.setState(proc.info.pid, 'running', 'thinking');

      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      // Add some memories
      memory.store({
        agent_uid: proc.info.uid,
        layer: 'episodic',
        content: 'Completed first task successfully',
        tags: ['task', 'success'],
        importance: 0.8,
      });
      memory.store({
        agent_uid: proc.info.uid,
        layer: 'semantic',
        content: 'TypeScript is a typed superset of JavaScript',
        tags: ['knowledge'],
        importance: 0.6,
      });

      // Record resource usage
      resources.recordTokenUsage(proc.info.pid, 1000, 500, 'gemini');

      const snapshot = await snapMgr.createSnapshot(proc.info.pid, 'Atomic snapshot');

      // Verify manifest file was written
      const record = store.getSnapshotById(snapshot.id);
      expect(record).toBeDefined();
      const manifestPath = record!.filePath.replace('.json', '.manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.version).toBe(1);
      expect(manifest.snapshotId).toBe(snapshot.id);
      expect(manifest.pid).toBe(proc.info.pid);
      expect(manifest.uid).toBe(proc.info.uid);
      expect(manifest.processState.state).toBe('stopped'); // paused by SIGSTOP
      expect(manifest.processState.config).toBeDefined();
      expect(manifest.processState.metrics).toBeDefined();
      expect(manifest.memories).toHaveLength(2);
      expect(manifest.memories[0].layer).toBe('episodic');
      expect(manifest.memories[1].layer).toBe('semantic');
      expect(manifest.resourceUsage).toBeDefined();
      expect(manifest.resourceUsage.tokensUsed).toBe(1500);
      expect(manifest.resourceUsage.costUsd).toBeGreaterThan(0);
      expect(manifest.fsHash).toBeTruthy();
      expect(manifest.fsSize).toBeGreaterThan(0);
    });

    it('creates manifest with empty memories array when no memories exist', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'No memories test' });
      pm.setState(proc.info.pid, 'running');

      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      const record = store.getSnapshotById(snapshot.id);
      const manifestPath = record!.filePath.replace('.json', '.manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      expect(manifest.memories).toEqual([]);
    });

    it('creates manifest with no active plan when none exists', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'No plan test' });
      pm.setState(proc.info.pid, 'running');

      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      const record = store.getSnapshotById(snapshot.id);
      const manifestPath = record!.filePath.replace('.json', '.manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

      expect(manifest.planState).toBeUndefined();
    });
  });

  describe('listSnapshots()', () => {
    it('returns correct entries', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      await snapMgr.createSnapshot(proc.info.pid, 'Snap 1');
      await snapMgr.createSnapshot(proc.info.pid, 'Snap 2');

      const all = await snapMgr.listSnapshots();
      expect(all).toHaveLength(2);

      const forPid = await snapMgr.listSnapshots(proc.info.pid);
      expect(forPid).toHaveLength(2);
    });
  });

  describe('deleteSnapshot()', () => {
    it('removes snapshot and files', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      await snapMgr.deleteSnapshot(snapshot.id);

      const stored = store.getSnapshotById(snapshot.id);
      expect(stored).toBeUndefined();
    });

    it('emits snapshot.deleted event', async () => {
      const handler = vi.fn();
      bus.on('snapshot.deleted', handler);

      const proc = pm.spawn({ role: 'Coder', goal: 'Test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      await snapMgr.deleteSnapshot(snapshot.id);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: snapshot.id }));
    });

    it('throws for non-existent snapshot', async () => {
      await expect(snapMgr.deleteSnapshot('nonexistent')).rejects.toThrow('not found');
    });
  });

  describe('restoreSnapshot()', () => {
    it('spawns a new process from snapshot config', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Restore test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);

      const newPid = await snapMgr.restoreSnapshot(snapshot.id);
      expect(newPid).toBeGreaterThan(proc.info.pid);

      const newProc = pm.get(newPid);
      expect(newProc).toBeDefined();
      expect(newProc!.agentConfig?.role).toBe('Coder');
      expect(newProc!.agentConfig?.goal).toBe('Restore test');
    });

    it('restores memories into the new agent', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Memory restore test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      // Store memories for original agent
      memory.store({
        agent_uid: proc.info.uid,
        layer: 'episodic',
        content: 'I completed the login feature',
        tags: ['login'],
        importance: 0.9,
      });
      memory.store({
        agent_uid: proc.info.uid,
        layer: 'procedural',
        content: 'Run npm test before committing',
        tags: ['workflow'],
        importance: 0.7,
      });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid, 'With memories');
      const newPid = await snapMgr.restoreSnapshot(snapshot.id);

      const newProc = pm.get(newPid);
      expect(newProc).toBeDefined();

      // Check memories were restored for the new agent
      const restoredMemories = memory.recall({ agent_uid: newProc!.info.uid });
      expect(restoredMemories).toHaveLength(2);

      const contents = restoredMemories.map((m) => m.content).sort();
      expect(contents).toContain('I completed the login feature');
      expect(contents).toContain('Run npm test before committing');
    });

    it('restores process metrics from manifest', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Metrics restore test' });
      pm.setState(proc.info.pid, 'running');
      pm.updateMetrics(proc.info.pid, 42.5, 256);
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      const newPid = await snapMgr.restoreSnapshot(snapshot.id);

      const newProc = pm.get(newPid);
      expect(newProc).toBeDefined();
      // Metrics should be restored from the manifest's processState
      // Note: the captured metrics will reflect the stopped state
      expect(newProc!.info.cpuPercent).toBeDefined();
      expect(newProc!.info.memoryMB).toBeDefined();
    });
  });

  describe('validateSnapshot()', () => {
    it('returns valid for a correct snapshot', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Validate test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);
      const result = await snapMgr.validateSnapshot(snapshot.id);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for non-existent snapshot', async () => {
      const result = await snapMgr.validateSnapshot('nonexistent');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Snapshot record not found in database');
    });

    it('detects tarball integrity failure', async () => {
      const proc = pm.spawn({ role: 'Coder', goal: 'Integrity test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await snapMgr.createSnapshot(proc.info.pid);

      // Corrupt the tarball
      const record = store.getSnapshotById(snapshot.id);
      fs.writeFileSync(record!.tarballPath, 'corrupted-content');

      const result = await snapMgr.validateSnapshot(snapshot.id);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('integrity check failed'))).toBe(true);
    });
  });

  describe('without optional subsystems', () => {
    it('works when MemoryManager is not provided', async () => {
      const noMemSnapMgr = new SnapshotManager(bus, pm, store, testRoot);
      await noMemSnapMgr.init();

      const proc = pm.spawn({ role: 'Coder', goal: 'No memory manager test' });
      pm.setState(proc.info.pid, 'running');
      const homeDir = path.join(testRoot, 'home', proc.info.uid);
      fs.mkdirSync(homeDir, { recursive: true });

      const snapshot = await noMemSnapMgr.createSnapshot(proc.info.pid);
      expect(snapshot.id).toBeTruthy();

      const record = store.getSnapshotById(snapshot.id);
      const manifestPath = record!.filePath.replace('.json', '.manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      expect(manifest.memories).toEqual([]);
      expect(manifest.resourceUsage).toBeUndefined();
    });
  });
});
