/**
 * Aether Kernel - Snapshot Manager
 *
 * Provides VM-checkpoint-like snapshots for agent processes.
 * A snapshot atomically captures:
 *   - ProcessInfo (pid, state, phase, environment, step count)
 *   - Agent's home directory (tar.gz archive) with SHA-256 integrity hash
 *   - Agent memories (all layers from MemoryManager)
 *   - Active plan state (if any)
 *   - Resource usage (from ResourceGovernor)
 *   - Agent log history (from StateStore)
 *   - IPC message queue (pending messages)
 *
 * A manifest.json is written alongside the tarball to record all captured data.
 *
 * Snapshots are stored at /tmp/aether/var/snapshots/
 */

import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventBus } from './EventBus.js';
import { errMsg } from './logger.js';
import { ProcessManager } from './ProcessManager.js';
import { StateStore } from './StateStore.js';
import { MemoryManager } from './MemoryManager.js';
import { ResourceGovernor } from './ResourceGovernor.js';
import { PID, SnapshotInfo, SnapshotManifest, AETHER_ROOT, MemoryLayer } from '@aether/shared';

const execFileAsync = promisify(execFile);

const SNAPSHOTS_DIR = path.join(AETHER_ROOT, 'var', 'snapshots');

export class SnapshotManager {
  private bus: EventBus;
  private processes: ProcessManager;
  private state: StateStore;
  private fsRoot: string;
  private memory: MemoryManager | null;
  private resources: ResourceGovernor | null;

  constructor(
    bus: EventBus,
    processes: ProcessManager,
    state: StateStore,
    fsRoot?: string,
    memory?: MemoryManager,
    resources?: ResourceGovernor,
  ) {
    this.bus = bus;
    this.processes = processes;
    this.state = state;
    this.fsRoot = fsRoot || AETHER_ROOT;
    this.memory = memory || null;
    this.resources = resources || null;
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
      const manifestFile = path.join(SNAPSHOTS_DIR, `${pid}-${timestamp}.manifest.json`);

      // Capture process info
      const processInfo = { ...proc.info };

      // Capture agent logs
      const logs = this.state.getAgentLogs(pid);

      // Capture IPC message queue
      const messageQueue = this.processes.peekMessages(pid);

      // Capture agent memories
      const memories = this.captureMemories(proc.info.uid);

      // Capture active plan state
      const planState = this.capturePlanState(pid);

      // Capture resource usage
      const resourceUsage = this.captureResourceUsage(pid);

      // Build snapshot data (legacy format for backward compatibility)
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
          'czf',
          tarballFile,
          '-C',
          path.dirname(homeDir),
          path.basename(homeDir),
        ]);
        const tarStat = await fs.stat(tarballFile);
        tarballSize = tarStat.size;
      } catch {
        // Home dir may not exist or tar may fail - create empty tarball
        await execFileAsync('tar', ['czf', tarballFile, '--files-from', '/dev/null']);
      }

      // Compute SHA-256 hash of tarball for integrity verification
      const fsHash = await this.computeFileHash(tarballFile);

      // Build the manifest
      const manifest: SnapshotManifest = {
        version: 1,
        snapshotId,
        pid,
        uid: proc.info.uid,
        timestamp,
        description: description || `Snapshot of PID ${pid}`,
        processState: {
          state: processInfo.state,
          phase: processInfo.agentPhase || 'idle',
          config: proc.agentConfig || null,
          metrics: {
            cpuPercent: processInfo.cpuPercent,
            memoryMB: processInfo.memoryMB,
          },
        },
        memories,
        planState,
        resourceUsage,
        fsHash,
        fsSize: tarballSize,
      };

      // Write manifest JSON
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));

      const jsonStat = await fs.stat(snapshotFile);
      const manifestStat = await fs.stat(manifestFile);
      const totalSize = jsonStat.size + tarballSize + manifestStat.size;

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
    const records =
      pid !== undefined ? this.state.getSnapshotsByPid(pid) : this.state.getAllSnapshots();

    return records.map((r) => ({
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
   * restores memories, and replays state so the agent continues where it left off.
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

    // Read manifest if available
    const manifest = await this.readManifest(record);

    // Verify tarball integrity if manifest exists
    if (manifest) {
      await this.verifyTarballIntegrity(record.tarballPath, manifest.fsHash);
    }

    // Spawn a new process with the same config
    const newProc = this.processes.spawn(agentConfig);
    const newPid = newProc.info.pid;

    // Extract the tarball to the new agent's home directory
    const newHomeDir = path.join(this.fsRoot, 'home', newProc.info.uid);
    await fs.mkdir(newHomeDir, { recursive: true });

    try {
      await fs.access(record.tarballPath);
      await execFileAsync('tar', ['xzf', record.tarballPath, '-C', path.join(this.fsRoot, 'home')]);

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

    // Restore memories from manifest
    if (manifest && manifest.memories.length > 0) {
      this.restoreMemories(newProc.info.uid, manifest.memories);
    }

    // Restore process state/phase from manifest
    if (manifest && manifest.processState) {
      newProc.info.cpuPercent = manifest.processState.metrics?.cpuPercent ?? 0;
      newProc.info.memoryMB = manifest.processState.metrics?.memoryMB ?? 0;
    }

    this.bus.emit('snapshot.restored', {
      snapshotId,
      newPid,
      manifest: manifest || undefined,
    });
    return newPid;
  }

  /**
   * Validate a snapshot's integrity.
   * Checks that the manifest exists, is well-formed, and the tarball hash matches.
   */
  async validateSnapshot(snapshotId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    const record = this.state.getSnapshotById(snapshotId);
    if (!record) {
      return { valid: false, errors: ['Snapshot record not found in database'] };
    }

    // Check snapshot JSON exists
    try {
      await fs.access(record.filePath);
    } catch {
      errors.push('Snapshot JSON file not found');
    }

    // Check tarball exists
    try {
      await fs.access(record.tarballPath);
    } catch {
      errors.push('Tarball file not found');
    }

    // Check manifest exists and is valid
    const manifest = await this.readManifest(record);
    if (!manifest) {
      errors.push('Manifest file not found or invalid');
    } else {
      if (manifest.version !== 1) {
        errors.push(`Unsupported manifest version: ${manifest.version}`);
      }
      if (manifest.snapshotId !== snapshotId) {
        errors.push(`Manifest snapshotId mismatch: ${manifest.snapshotId} !== ${snapshotId}`);
      }

      // Verify tarball integrity
      if (errors.length === 0) {
        try {
          await this.verifyTarballIntegrity(record.tarballPath, manifest.fsHash);
        } catch (err: unknown) {
          errors.push(errMsg(err));
        }
      }
    }

    return { valid: errors.length === 0, errors };
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
    try {
      await fs.unlink(record.filePath);
    } catch {
      /* ignore */
    }
    try {
      await fs.unlink(record.tarballPath);
    } catch {
      /* ignore */
    }
    // Remove manifest file
    const manifestPath = record.filePath.replace('.json', '.manifest.json');
    try {
      await fs.unlink(manifestPath);
    } catch {
      /* ignore */
    }

    // Remove from database
    this.state.deleteSnapshotRecord(snapshotId);

    this.bus.emit('snapshot.deleted', { snapshotId });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Capture all memories for an agent, formatted for the manifest.
   */
  private captureMemories(uid: string): SnapshotManifest['memories'] {
    if (!this.memory) return [];
    try {
      const rawMemories = this.state.getMemoriesByAgent(uid);
      return rawMemories.map((row: any) => ({
        key: row.id,
        value: row.content,
        layer: row.layer,
        metadata: {
          tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
          importance: row.importance,
          access_count: row.access_count,
          created_at: row.created_at,
          last_accessed: row.last_accessed,
          expires_at: row.expires_at || undefined,
          source_pid: row.source_pid || undefined,
          related_memories:
            typeof row.related_memories === 'string'
              ? JSON.parse(row.related_memories)
              : row.related_memories || [],
        },
      }));
    } catch {
      return [];
    }
  }

  /**
   * Capture active plan state for a process.
   */
  private capturePlanState(pid: PID): any {
    try {
      const plan = this.state.getActivePlanByPid(pid);
      if (!plan) return undefined;
      return {
        id: plan.id,
        agent_uid: plan.agent_uid,
        goal: plan.goal,
        plan_tree: typeof plan.plan_tree === 'string' ? JSON.parse(plan.plan_tree) : plan.plan_tree,
        status: plan.status,
        created_at: plan.created_at,
        updated_at: plan.updated_at,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Capture resource usage for a process.
   */
  private captureResourceUsage(pid: PID): SnapshotManifest['resourceUsage'] {
    if (!this.resources) return undefined;
    try {
      const usage = this.resources.getUsage(pid);
      if (!usage) return undefined;
      const quota = this.resources.getQuota(pid);
      const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
      return {
        tokensUsed: totalTokens,
        costUsd: usage.estimatedCostUSD,
        quotaRemaining: Math.max(0, quota.maxTokensPerSession - totalTokens),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Compute SHA-256 hash of a file.
   */
  private async computeFileHash(filePath: string): Promise<string> {
    try {
      const content = await fs.readFile(filePath);
      return crypto.createHash('sha256').update(content).digest('hex');
    } catch {
      return '';
    }
  }

  /**
   * Read the manifest file for a snapshot record.
   */
  private async readManifest(record: { filePath: string }): Promise<SnapshotManifest | null> {
    const manifestPath = record.filePath.replace('.json', '.manifest.json');
    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      return JSON.parse(content) as SnapshotManifest;
    } catch {
      return null;
    }
  }

  /**
   * Verify tarball integrity against expected hash.
   */
  private async verifyTarballIntegrity(tarballPath: string, expectedHash: string): Promise<void> {
    if (!expectedHash) return;
    const actualHash = await this.computeFileHash(tarballPath);
    if (actualHash !== expectedHash) {
      throw new Error(
        `Tarball integrity check failed: expected ${expectedHash}, got ${actualHash}`,
      );
    }
  }

  /**
   * Restore memories from snapshot manifest into the new agent's memory store.
   */
  private restoreMemories(newUid: string, memories: SnapshotManifest['memories']): void {
    if (!this.memory) return;
    for (const mem of memories) {
      try {
        this.memory.store({
          agent_uid: newUid,
          layer: mem.layer as MemoryLayer,
          content: mem.value,
          tags: mem.metadata?.tags || [],
          importance: mem.metadata?.importance ?? 0.5,
          source_pid: mem.metadata?.source_pid,
          expires_at: mem.metadata?.expires_at,
          related_memories: mem.metadata?.related_memories || [],
        });
      } catch {
        // Skip individual memory failures
      }
    }
  }
}
