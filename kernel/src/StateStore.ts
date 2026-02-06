/**
 * Aether Kernel - State Store
 *
 * SQLite-based persistence for kernel state. Stores:
 * - Process history (all spawned agents, their configs, outcomes)
 * - Agent logs (full thought/action/observation history)
 * - File metadata index (what files exist, who owns them)
 * - Kernel metrics over time
 *
 * Uses better-sqlite3 for synchronous, fast access with no async complexity.
 */

import Database from 'better-sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { EventBus } from './EventBus.js';
import {
  PID,
  ProcessRecord,
  AgentLogEntry,
  FileMetadataRecord,
  KernelMetricRecord,
  SnapshotInfo,
  STATE_DB_PATH,
} from '@aether/shared';

export class StateStore {
  private db: Database.Database;
  private bus: EventBus;

  // Prepared statements - initialized in constructor after db is ready
  private stmts!: {
    insertProcess: Database.Statement;
    updateState: Database.Statement;
    recordExit: Database.Statement;
    getAllProcesses: Database.Statement;
    getProcessByPid: Database.Statement;
    insertLog: Database.Statement;
    getLogsByPid: Database.Statement;
    getRecentLogs: Database.Statement;
    upsertFile: Database.Statement;
    deleteFile: Database.Statement;
    getFilesByOwner: Database.Statement;
    getAllFiles: Database.Statement;
    insertMetric: Database.Statement;
    getMetrics: Database.Statement;
    getLatestMetrics: Database.Statement;
    insertSnapshot: Database.Statement;
    getAllSnapshots: Database.Statement;
    getSnapshotsByPid: Database.Statement;
    getSnapshotById: Database.Statement;
    deleteSnapshot: Database.Statement;
    insertSharedMount: Database.Statement;
    getSharedMount: Database.Statement;
    getAllSharedMounts: Database.Statement;
    addMountedBy: Database.Statement;
    removeMountedBy: Database.Statement;
    getMountedBy: Database.Statement;
    deleteSharedMount: Database.Statement;
  };

  constructor(bus: EventBus, dbPath?: string) {
    this.bus = bus;
    const resolvedPath = dbPath || STATE_DB_PATH;

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.initSchema();
    this.initStatements();
    this.setupEventListeners();
  }

  // ---------------------------------------------------------------------------
  // Schema
  // ---------------------------------------------------------------------------

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processes (
        pid INTEGER PRIMARY KEY,
        uid TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        goal TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'created',
        agent_phase TEXT,
        exit_code INTEGER,
        created_at INTEGER NOT NULL,
        exited_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS agent_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pid INTEGER NOT NULL,
        step INTEGER NOT NULL,
        phase TEXT NOT NULL,
        tool TEXT,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (pid) REFERENCES processes(pid)
      );

      CREATE INDEX IF NOT EXISTS idx_agent_logs_pid ON agent_logs(pid);
      CREATE INDEX IF NOT EXISTS idx_agent_logs_pid_step ON agent_logs(pid, step);

      CREATE TABLE IF NOT EXISTS file_metadata (
        path TEXT PRIMARY KEY,
        owner_uid TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        file_type TEXT NOT NULL DEFAULT 'file',
        created_at INTEGER NOT NULL,
        modified_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_file_metadata_owner ON file_metadata(owner_uid);

      CREATE TABLE IF NOT EXISTS kernel_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        process_count INTEGER NOT NULL,
        cpu_percent REAL NOT NULL DEFAULT 0,
        memory_mb REAL NOT NULL DEFAULT 0,
        container_count INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_kernel_metrics_time ON kernel_metrics(timestamp);

      CREATE TABLE IF NOT EXISTS snapshots (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL,
        tarball_path TEXT NOT NULL,
        process_info TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_pid ON snapshots(pid);

      CREATE TABLE IF NOT EXISTS shared_mounts (
        name TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        owner_pid INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS shared_mount_members (
        name TEXT NOT NULL,
        pid INTEGER NOT NULL,
        mount_point TEXT NOT NULL,
        PRIMARY KEY (name, pid),
        FOREIGN KEY (name) REFERENCES shared_mounts(name)
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // Prepared Statements
  // ---------------------------------------------------------------------------

  private initStatements(): void {
    this.stmts = {
      insertProcess: this.db.prepare(`
        INSERT OR REPLACE INTO processes (pid, uid, name, role, goal, state, agent_phase, created_at)
        VALUES (@pid, @uid, @name, @role, @goal, @state, @agentPhase, @createdAt)
      `),
      updateState: this.db.prepare(`
        UPDATE processes SET state = ?, agent_phase = ? WHERE pid = ?
      `),
      recordExit: this.db.prepare(`
        UPDATE processes SET state = 'zombie', exit_code = ?, exited_at = ? WHERE pid = ?
      `),
      getAllProcesses: this.db.prepare(`
        SELECT pid, uid, name, role, goal, state, agent_phase as agentPhase,
               exit_code as exitCode, created_at as createdAt, exited_at as exitedAt
        FROM processes ORDER BY created_at DESC
      `),
      getProcessByPid: this.db.prepare(`
        SELECT pid, uid, name, role, goal, state, agent_phase as agentPhase,
               exit_code as exitCode, created_at as createdAt, exited_at as exitedAt
        FROM processes WHERE pid = ?
      `),
      insertLog: this.db.prepare(`
        INSERT INTO agent_logs (pid, step, phase, tool, content, timestamp)
        VALUES (@pid, @step, @phase, @tool, @content, @timestamp)
      `),
      getLogsByPid: this.db.prepare(`
        SELECT id, pid, step, phase, tool, content, timestamp
        FROM agent_logs WHERE pid = ? ORDER BY timestamp ASC
      `),
      getRecentLogs: this.db.prepare(`
        SELECT id, pid, step, phase, tool, content, timestamp
        FROM agent_logs ORDER BY timestamp DESC LIMIT ?
      `),
      upsertFile: this.db.prepare(`
        INSERT OR REPLACE INTO file_metadata (path, owner_uid, size, file_type, created_at, modified_at)
        VALUES (@path, @ownerUid, @size, @fileType, @createdAt, @modifiedAt)
      `),
      deleteFile: this.db.prepare(`DELETE FROM file_metadata WHERE path = ?`),
      getFilesByOwner: this.db.prepare(`
        SELECT path, owner_uid as ownerUid, size, file_type as fileType,
               created_at as createdAt, modified_at as modifiedAt
        FROM file_metadata WHERE owner_uid = ? ORDER BY path
      `),
      getAllFiles: this.db.prepare(`
        SELECT path, owner_uid as ownerUid, size, file_type as fileType,
               created_at as createdAt, modified_at as modifiedAt
        FROM file_metadata ORDER BY path
      `),
      insertMetric: this.db.prepare(`
        INSERT INTO kernel_metrics (timestamp, process_count, cpu_percent, memory_mb, container_count)
        VALUES (@timestamp, @processCount, @cpuPercent, @memoryMB, @containerCount)
      `),
      getMetrics: this.db.prepare(`
        SELECT timestamp, process_count as processCount, cpu_percent as cpuPercent,
               memory_mb as memoryMB, container_count as containerCount
        FROM kernel_metrics WHERE timestamp >= ? ORDER BY timestamp ASC
      `),
      getLatestMetrics: this.db.prepare(`
        SELECT timestamp, process_count as processCount, cpu_percent as cpuPercent,
               memory_mb as memoryMB, container_count as containerCount
        FROM kernel_metrics ORDER BY timestamp DESC LIMIT ?
      `),
      insertSnapshot: this.db.prepare(`
        INSERT INTO snapshots (id, pid, timestamp, description, file_path, tarball_path, process_info, size_bytes)
        VALUES (@id, @pid, @timestamp, @description, @filePath, @tarballPath, @processInfo, @sizeBytes)
      `),
      getAllSnapshots: this.db.prepare(`
        SELECT id, pid, timestamp, description, file_path as filePath, tarball_path as tarballPath,
               process_info as processInfo, size_bytes as sizeBytes
        FROM snapshots ORDER BY timestamp DESC
      `),
      getSnapshotsByPid: this.db.prepare(`
        SELECT id, pid, timestamp, description, file_path as filePath, tarball_path as tarballPath,
               process_info as processInfo, size_bytes as sizeBytes
        FROM snapshots WHERE pid = ? ORDER BY timestamp DESC
      `),
      getSnapshotById: this.db.prepare(`
        SELECT id, pid, timestamp, description, file_path as filePath, tarball_path as tarballPath,
               process_info as processInfo, size_bytes as sizeBytes
        FROM snapshots WHERE id = ?
      `),
      deleteSnapshot: this.db.prepare(`DELETE FROM snapshots WHERE id = ?`),
      insertSharedMount: this.db.prepare(`
        INSERT OR REPLACE INTO shared_mounts (name, path, owner_pid, created_at)
        VALUES (@name, @path, @ownerPid, @createdAt)
      `),
      getSharedMount: this.db.prepare(`
        SELECT name, path, owner_pid as ownerPid, created_at as createdAt
        FROM shared_mounts WHERE name = ?
      `),
      getAllSharedMounts: this.db.prepare(`
        SELECT name, path, owner_pid as ownerPid, created_at as createdAt
        FROM shared_mounts ORDER BY name
      `),
      addMountedBy: this.db.prepare(`
        INSERT OR REPLACE INTO shared_mount_members (name, pid, mount_point)
        VALUES (@name, @pid, @mountPoint)
      `),
      removeMountedBy: this.db.prepare(`
        DELETE FROM shared_mount_members WHERE name = ? AND pid = ?
      `),
      getMountedBy: this.db.prepare(`
        SELECT pid, mount_point as mountPoint FROM shared_mount_members WHERE name = ?
      `),
      deleteSharedMount: this.db.prepare(`DELETE FROM shared_mounts WHERE name = ?`),
    };
  }

  // ---------------------------------------------------------------------------
  // Event Listeners - auto-persist on kernel events
  // ---------------------------------------------------------------------------

  private setupEventListeners(): void {
    this.bus.on('process.spawned', (data: { pid: PID; info: any }) => {
      try {
        this.recordProcess({
          pid: data.info.pid,
          uid: data.info.uid,
          name: data.info.name,
          role: data.info.env?.AETHER_ROLE || 'unknown',
          goal: data.info.env?.AETHER_GOAL || '',
          state: data.info.state,
          agentPhase: data.info.agentPhase,
          createdAt: data.info.createdAt,
        });
      } catch (err) {
        console.error('[StateStore] Failed to record process spawn:', err);
      }
    });

    this.bus.on('process.stateChange', (data: { pid: PID; state: string; agentPhase?: string }) => {
      try {
        this.updateProcessState(data.pid, data.state, data.agentPhase);
      } catch (err) {
        console.error('[StateStore] Failed to update process state:', err);
      }
    });

    this.bus.on('process.exit', (data: { pid: PID; code: number }) => {
      try {
        this.recordProcessExit(data.pid, data.code);
      } catch (err) {
        console.error('[StateStore] Failed to record process exit:', err);
      }
    });

    this.bus.on('agent.thought', (data: { pid: PID; thought: string }) => {
      try {
        this.recordAgentLog({
          pid: data.pid,
          step: -1,
          phase: 'thought',
          content: data.thought,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[StateStore] Failed to record agent thought:', err);
      }
    });

    this.bus.on('agent.action', (data: { pid: PID; tool: string; args: any }) => {
      try {
        this.recordAgentLog({
          pid: data.pid,
          step: -1,
          phase: 'action',
          tool: data.tool,
          content: JSON.stringify(data.args),
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[StateStore] Failed to record agent action:', err);
      }
    });

    this.bus.on('agent.observation', (data: { pid: PID; result: string }) => {
      try {
        this.recordAgentLog({
          pid: data.pid,
          step: -1,
          phase: 'observation',
          content: data.result,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error('[StateStore] Failed to record agent observation:', err);
      }
    });

    this.bus.on('fs.changed', (data: { path: string; changeType: string }) => {
      try {
        if (data.changeType === 'delete') {
          this.deleteFileMetadata(data.path);
        }
      } catch (err) {
        console.error('[StateStore] Failed to handle fs change:', err);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Process History
  // ---------------------------------------------------------------------------

  recordProcess(record: ProcessRecord): void {
    this.stmts.insertProcess.run({
      pid: record.pid,
      uid: record.uid,
      name: record.name,
      role: record.role,
      goal: record.goal,
      state: record.state,
      agentPhase: record.agentPhase || null,
      createdAt: record.createdAt,
    });
  }

  updateProcessState(pid: PID, state: string, agentPhase?: string): void {
    this.stmts.updateState.run(state, agentPhase || null, pid);
  }

  recordProcessExit(pid: PID, exitCode: number): void {
    this.stmts.recordExit.run(exitCode, Date.now(), pid);
  }

  getAllProcesses(): ProcessRecord[] {
    return this.stmts.getAllProcesses.all() as ProcessRecord[];
  }

  getProcess(pid: PID): ProcessRecord | undefined {
    return this.stmts.getProcessByPid.get(pid) as ProcessRecord | undefined;
  }

  // ---------------------------------------------------------------------------
  // Agent Logs
  // ---------------------------------------------------------------------------

  recordAgentLog(entry: AgentLogEntry): void {
    this.stmts.insertLog.run({
      pid: entry.pid,
      step: entry.step,
      phase: entry.phase,
      tool: entry.tool || null,
      content: entry.content,
      timestamp: entry.timestamp,
    });
  }

  getAgentLogs(pid: PID): AgentLogEntry[] {
    return this.stmts.getLogsByPid.all(pid) as AgentLogEntry[];
  }

  getRecentLogs(limit: number = 100): AgentLogEntry[] {
    return this.stmts.getRecentLogs.all(limit) as AgentLogEntry[];
  }

  // ---------------------------------------------------------------------------
  // File Metadata
  // ---------------------------------------------------------------------------

  recordFileMetadata(record: FileMetadataRecord): void {
    this.stmts.upsertFile.run({
      path: record.path,
      ownerUid: record.ownerUid,
      size: record.size,
      fileType: record.fileType,
      createdAt: record.createdAt,
      modifiedAt: record.modifiedAt,
    });
  }

  deleteFileMetadata(filePath: string): void {
    this.stmts.deleteFile.run(filePath);
  }

  getFilesByOwner(uid: string): FileMetadataRecord[] {
    return this.stmts.getFilesByOwner.all(uid) as FileMetadataRecord[];
  }

  getAllFiles(): FileMetadataRecord[] {
    return this.stmts.getAllFiles.all() as FileMetadataRecord[];
  }

  // ---------------------------------------------------------------------------
  // Kernel Metrics
  // ---------------------------------------------------------------------------

  recordMetric(metric: KernelMetricRecord): void {
    this.stmts.insertMetric.run({
      timestamp: metric.timestamp,
      processCount: metric.processCount,
      cpuPercent: metric.cpuPercent,
      memoryMB: metric.memoryMB,
      containerCount: metric.containerCount,
    });
  }

  getMetrics(since: number): KernelMetricRecord[] {
    return this.stmts.getMetrics.all(since) as KernelMetricRecord[];
  }

  getLatestMetrics(limit: number = 100): KernelMetricRecord[] {
    return this.stmts.getLatestMetrics.all(limit) as KernelMetricRecord[];
  }

  // ---------------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------------

  recordSnapshot(record: {
    id: string;
    pid: PID;
    timestamp: number;
    description: string;
    filePath: string;
    tarballPath: string;
    processInfo: string;
    sizeBytes: number;
  }): void {
    this.stmts.insertSnapshot.run(record);
  }

  getAllSnapshots(): Array<{ id: string; pid: PID; timestamp: number; description: string; filePath: string; tarballPath: string; processInfo: string; sizeBytes: number }> {
    return this.stmts.getAllSnapshots.all() as any[];
  }

  getSnapshotsByPid(pid: PID): Array<{ id: string; pid: PID; timestamp: number; description: string; filePath: string; tarballPath: string; processInfo: string; sizeBytes: number }> {
    return this.stmts.getSnapshotsByPid.all(pid) as any[];
  }

  getSnapshotById(id: string): { id: string; pid: PID; timestamp: number; description: string; filePath: string; tarballPath: string; processInfo: string; sizeBytes: number } | undefined {
    return this.stmts.getSnapshotById.get(id) as any;
  }

  deleteSnapshotRecord(id: string): void {
    this.stmts.deleteSnapshot.run(id);
  }

  // ---------------------------------------------------------------------------
  // Shared Mounts
  // ---------------------------------------------------------------------------

  recordSharedMount(record: { name: string; path: string; ownerPid: PID; createdAt: number }): void {
    this.stmts.insertSharedMount.run(record);
  }

  getSharedMount(name: string): { name: string; path: string; ownerPid: PID; createdAt: number } | undefined {
    return this.stmts.getSharedMount.get(name) as any;
  }

  getAllSharedMounts(): Array<{ name: string; path: string; ownerPid: PID; createdAt: number }> {
    return this.stmts.getAllSharedMounts.all() as any[];
  }

  addMountMember(name: string, pid: PID, mountPoint: string): void {
    this.stmts.addMountedBy.run({ name, pid, mountPoint });
  }

  removeMountMember(name: string, pid: PID): void {
    this.stmts.removeMountedBy.run(name, pid);
  }

  getMountMembers(name: string): Array<{ pid: PID; mountPoint: string }> {
    return this.stmts.getMountedBy.all(name) as any[];
  }

  deleteSharedMount(name: string): void {
    this.stmts.deleteSharedMount.run(name);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Close the database connection.
   */
  close(): void {
    try {
      this.db.close();
    } catch (err) {
      console.error('[StateStore] Error closing database:', err);
    }
  }
}
