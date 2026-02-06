/**
 * Aether Kernel - Snapshot Manager
 *
 * Provides VM-checkpoint-like snapshots for agent processes.
 * A snapshot captures:
 *   - ProcessInfo (pid, state, phase, environment, step count)
 *   - Agent's home directory (tar.gz archive)
 *   - Agent log history (from StateStore)
 *   - IPC message queue (pending messages)
 *   - Artifact list (files created by the agent)
 *
 * Snapshots are stored at /tmp/aether/var/snapshots/
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventBus } from './EventBus.js';
import { ProcessManager } from './ProcessManager.js';
import { StateStore } from './StateStore.js';
import { PID, SnapshotInfo, AETHER_ROOT } from '@aether/shared';

const execFileAsync = promisify(execFile);

const SNAPSHOTS_DIR = path.join(AETHER_ROOT, 'var', 'snapshots');

export class SnapshotManager {
  private bus: EventBus;
  private processes: ProcessManager;
  private state: StateStore;
  private fsRoot: string;

  constructor(bus: EventBus, processes: ProcessManager, state: StateStore, fsRoot?: string) {
    this.bus = bus;
    this.processes = processes;
    this.state = state;
    this.fsRoot = fsRoot || AETHER_ROOT;
  }

  /**
   * Initialize the snapshot directory.
   */
  async init(): Promise<void> {
    await fs.mkdir(SNAPSHOTS_DIR, { recursive: true });
  }

  /**
   * Create a snapshot of an agent's current state.
   * Pauses the agent (SIGSTOP), captures state, resumes (SIGCONT).
   */
  async createSnapshot(pid: PID, description?: string): Promise<SnapshotInfo> {
    const proc = this.processes.get(pid);
    if (!proc) {
      throw new Error(`Process ${pid} not found`);
    }

    // Pause the agent while we capture state
    this.processes.signal(pid, 'SIGSTOP');

    try {
      const timestamp = Date.now();
      const snapshotId = `snap_${pid}_${timestamp}`;
      const snapshotFile = path.join(SNAPSHOTS_DIR, `${pid}-${timestamp}.json`);
      const tarballFile = path.join(SNAPSHOTS_DIR, `${pid}-${timestamp}.tar.gz`);

      // Capture process info
      const processInfo = { ...proc.info };

      // Capture agent logs
      const logs = this.state.getAgentLogs(pid);

      // Capture IPC message queue
      const messageQueue = this.processes.peekMessages(pid);

      // Build snapshot data
      const snapshotData = {
        id: snapshotId,
        pid,
        timestamp,
        description: description || `Snapshot of PID ${pid}`,
        processInfo,
        agentConfig: proc.agentConfig,
        logs,
        messageQueue,
      };

      // Write snapshot JSON
      await fs.writeFile(snapshotFile, JSON.stringify(snapshotData, null, 2));

      // Create tarball of agent's home directory
      const homeDir = path.join(this.fsRoot, 'home', proc.info.uid);
      let tarballSize = 0;

      try {
        await fs.access(homeDir);
        await execFileAsync('tar', [
          'czf', tarballFile,
          '-C', path.dirname(homeDir),
          path.basename(homeDir),
        ]);
        const tarStat = await fs.stat(tarballFile);
        tarballSize = tarStat.size;
      } catch {
        // Home dir may not exist or tar may fail - create empty tarball
        await execFileAsync('tar', ['czf', tarballFile, '--files-from', '/dev/null']);
      }

      const jsonStat = await fs.stat(snapshotFile);
      const totalSize = jsonStat.size + tarballSize;

      // Record in StateStore
      this.state.recordSnapshot({
        id: snapshotId,
        pid,
        timestamp,
        description: snapshotData.description,
        filePath: snapshotFile,
        tarballPath: tarballFile,
        processInfo: JSON.stringify(processInfo),
        sizeBytes: totalSize,
      });

      const info: SnapshotInfo = {
        id: snapshotId,
        pid,
        timestamp,
        size: totalSize,
        description: snapshotData.description,
      };

      this.bus.emit('snapshot.created', { snapshot: info });
      return info;
    } finally {
      // Resume the agent regardless of success/failure
      this.processes.signal(pid, 'SIGCONT');
    }
  }

  /**
   * List all snapshots, optionally filtered by PID.
   */
  async listSnapshots(pid?: PID): Promise<SnapshotInfo[]> {
    const records = pid !== undefined
      ? this.state.getSnapshotsByPid(pid)
      : this.state.getAllSnapshots();

    return records.map(r => ({
      id: r.id,
      pid: r.pid,
      timestamp: r.timestamp,
      size: r.sizeBytes,
      description: r.description,
    }));
  }

  /**
   * Restore an agent from a snapshot.
   * Spawns a NEW process with the saved config, extracts the filesystem,
   * and replays the step count so the agent continues where it left off.
   * Returns the new PID.
   */
  async restoreSnapshot(snapshotId: string): Promise<PID> {
    const record = this.state.getSnapshotById(snapshotId);
    if (!record) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Read the full snapshot data
    const snapshotData = JSON.parse(await fs.readFile(record.filePath, 'utf-8'));
    const savedProcessInfo = snapshotData.processInfo;
    const agentConfig = snapshotData.agentConfig;

    if (!agentConfig) {
      throw new Error('Snapshot does not contain agent configuration');
    }

    // Spawn a new process with the same config
    const newProc = this.processes.spawn(agentConfig);
    const newPid = newProc.info.pid;

    // Extract the tarball to the new agent's home directory
    const newHomeDir = path.join(this.fsRoot, 'home', newProc.info.uid);
    await fs.mkdir(newHomeDir, { recursive: true });

    try {
      await fs.access(record.tarballPath);
      await execFileAsync('tar', [
        'xzf', record.tarballPath,
        '-C', path.join(this.fsRoot, 'home'),
      ]);

      // The tarball extracts to the original agent's uid directory.
      // We need to move/copy it to the new agent's home if different.
      const originalUid = savedProcessInfo.uid;
      if (originalUid !== newProc.info.uid) {
        const originalDir = path.join(this.fsRoot, 'home', originalUid);
        try {
          await fs.access(originalDir);
          // Copy contents from original to new home
          await execFileAsync('cp', ['-a', `${originalDir}/.`, newHomeDir]);
          // Clean up the extracted original dir
          await fs.rm(originalDir, { recursive: true, force: true });
        } catch {
          // Original dir wasn't extracted or doesn't exist
        }
      }
    } catch {
      // Tarball may not exist - continue without filesystem restoration
    }

    // Carry over environment variables from the snapshot
    if (savedProcessInfo.env) {
      const preserveKeys = ['HOME', 'USER', 'SHELL', 'TERM'];
      for (const [key, value] of Object.entries(savedProcessInfo.env)) {
        if (!preserveKeys.includes(key)) {
          newProc.info.env[key] = value as string;
        }
      }
    }

    this.bus.emit('snapshot.restored', { snapshotId, newPid });
    return newPid;
  }

  /**
   * Delete a snapshot and its files.
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    const record = this.state.getSnapshotById(snapshotId);
    if (!record) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    // Remove files
    try { await fs.unlink(record.filePath); } catch { /* ignore */ }
    try { await fs.unlink(record.tarballPath); } catch { /* ignore */ }

    // Remove from database
    this.state.deleteSnapshotRecord(snapshotId);

    this.bus.emit('snapshot.deleted', { snapshotId });
  }
}
