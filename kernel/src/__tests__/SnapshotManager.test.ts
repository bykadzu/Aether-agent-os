import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ProcessManager } from '../ProcessManager.js';
import { StateStore } from '../StateStore.js';
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
    snapMgr = new SnapshotManager(bus, pm, store, testRoot);
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

      expect(handler).toHaveBeenCalledWith({ snapshotId: snapshot.id });
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
  });
});
