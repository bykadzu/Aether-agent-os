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
  UserInfo,
  MemoryRecord,
  MemoryLayer,
  CronJob,
  EventTrigger,
  AgentConfig,
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
    // User management
    insertUser: Database.Statement;
    getUserById: Database.Statement;
    getUserByUsername: Database.Statement;
    getAllUsers: Database.Statement;
    updateUser: Database.Statement;
    updateUserLogin: Database.Statement;
    deleteUser: Database.Statement;
    getProcessesByOwner: Database.Statement;
    // Memory statements (v0.3)
    insertMemory: Database.Statement;
    getMemory: Database.Statement;
    getMemoriesByAgent: Database.Statement;
    getMemoriesByAgentLayer: Database.Statement;
    updateMemoryAccess: Database.Statement;
    deleteMemory: Database.Statement;
    deleteMemoriesByAgent: Database.Statement;
    getMemoryCount: Database.Statement;
    getOldestMemories: Database.Statement;
    insertMemoryFts: Database.Statement;
    deleteMemoryFts: Database.Statement;
    // Cron statements (v0.3)
    insertCronJob: Database.Statement;
    getCronJob: Database.Statement;
    getAllCronJobs: Database.Statement;
    getEnabledCronJobs: Database.Statement;
    updateCronJobRun: Database.Statement;
    updateCronJobEnabled: Database.Statement;
    deleteCronJob: Database.Statement;
    // Trigger statements (v0.3)
    insertTrigger: Database.Statement;
    getTrigger: Database.Statement;
    getAllTriggers: Database.Statement;
    getEnabledTriggersByEvent: Database.Statement;
    updateTriggerFired: Database.Statement;
    updateTriggerEnabled: Database.Statement;
    deleteTrigger: Database.Statement;
  };

  private _persistenceDisabled = false;

  constructor(bus: EventBus, dbPath?: string) {
    this.bus = bus;
    const resolvedPath = dbPath || STATE_DB_PATH;

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

    try {
      this.db = new Database(resolvedPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');
    } catch (err: any) {
      // If DB is corrupted or locked, try to recreate it
      console.error(`[StateStore] Failed to open database at ${resolvedPath}: ${err.message}`);
      console.warn('[StateStore] Attempting to recreate database...');
      try {
        // Remove corrupt file and try again
        try {
          fs.unlinkSync(resolvedPath);
        } catch {
          /* may not exist */
        }
        try {
          fs.unlinkSync(resolvedPath + '-wal');
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(resolvedPath + '-shm');
        } catch {
          /* ignore */
        }
        this.db = new Database(resolvedPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('synchronous = NORMAL');
        console.log('[StateStore] Database recreated successfully');
      } catch (retryErr: any) {
        console.error(`[StateStore] Failed to recreate database: ${retryErr.message}`);
        console.warn('[StateStore] Persistence disabled — kernel will operate in-memory only');
        // Use in-memory database as last resort
        this.db = new Database(':memory:');
        this._persistenceDisabled = true;
      }
    }

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

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at INTEGER NOT NULL,
        last_login INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

      -- Memory tables (v0.3 Wave 1)
      CREATE TABLE IF NOT EXISTS agent_memories (
        id TEXT PRIMARY KEY,
        agent_uid TEXT NOT NULL,
        layer TEXT NOT NULL CHECK(layer IN ('episodic', 'semantic', 'procedural', 'social')),
        content TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        importance REAL NOT NULL DEFAULT 0.5,
        access_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        expires_at INTEGER,
        source_pid INTEGER,
        related_memories TEXT NOT NULL DEFAULT '[]'
      );

      CREATE INDEX IF NOT EXISTS idx_memories_agent ON agent_memories(agent_uid);
      CREATE INDEX IF NOT EXISTS idx_memories_agent_layer ON agent_memories(agent_uid, layer);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories(importance DESC);

      -- FTS5 virtual table for full-text search on memory content
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(
        id UNINDEXED,
        content,
        tags
      );

      -- Cron jobs table (v0.3 Wave 1)
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        agent_config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        owner_uid TEXT NOT NULL,
        last_run INTEGER,
        next_run INTEGER NOT NULL,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_cron_enabled ON cron_jobs(enabled);
      CREATE INDEX IF NOT EXISTS idx_cron_next_run ON cron_jobs(next_run);

      -- Event triggers table (v0.3 Wave 1)
      CREATE TABLE IF NOT EXISTS event_triggers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_filter TEXT,
        agent_config TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        owner_uid TEXT NOT NULL,
        cooldown_ms INTEGER NOT NULL DEFAULT 60000,
        last_fired INTEGER,
        fire_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_triggers_event ON event_triggers(event_type);
      CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON event_triggers(enabled);
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
      // User management
      insertUser: this.db.prepare(`
        INSERT INTO users (id, username, display_name, password_hash, role, created_at)
        VALUES (@id, @username, @displayName, @passwordHash, @role, @createdAt)
      `),
      getUserById: this.db.prepare(`
        SELECT id, username, display_name as displayName, password_hash as passwordHash,
               role, created_at as createdAt, last_login as lastLogin
        FROM users WHERE id = ?
      `),
      getUserByUsername: this.db.prepare(`
        SELECT id, username, display_name as displayName, password_hash as passwordHash,
               role, created_at as createdAt, last_login as lastLogin
        FROM users WHERE username = ?
      `),
      getAllUsers: this.db.prepare(`
        SELECT id, username, display_name as displayName, role,
               created_at as createdAt, last_login as lastLogin
        FROM users ORDER BY created_at ASC
      `),
      updateUser: this.db.prepare(`
        UPDATE users SET display_name = @displayName, role = @role WHERE id = @id
      `),
      updateUserLogin: this.db.prepare(`
        UPDATE users SET last_login = ? WHERE id = ?
      `),
      deleteUser: this.db.prepare(`DELETE FROM users WHERE id = ?`),
      getProcessesByOwner: this.db.prepare(`
        SELECT pid, uid, name, role, goal, state, agent_phase as agentPhase,
               exit_code as exitCode, created_at as createdAt, exited_at as exitedAt
        FROM processes WHERE uid LIKE ? ORDER BY created_at DESC
      `),
      // Memory statements (v0.3)
      insertMemory: this.db.prepare(`
        INSERT INTO agent_memories (id, agent_uid, layer, content, tags, importance, access_count, created_at, last_accessed, expires_at, source_pid, related_memories)
        VALUES (@id, @agent_uid, @layer, @content, @tags, @importance, @access_count, @created_at, @last_accessed, @expires_at, @source_pid, @related_memories)
      `),
      getMemory: this.db.prepare(`
        SELECT id, agent_uid, layer, content, tags, importance, access_count, created_at, last_accessed, expires_at, source_pid, related_memories
        FROM agent_memories WHERE id = ?
      `),
      getMemoriesByAgent: this.db.prepare(`
        SELECT id, agent_uid, layer, content, tags, importance, access_count, created_at, last_accessed, expires_at, source_pid, related_memories
        FROM agent_memories WHERE agent_uid = ? ORDER BY importance DESC, last_accessed DESC
      `),
      getMemoriesByAgentLayer: this.db.prepare(`
        SELECT id, agent_uid, layer, content, tags, importance, access_count, created_at, last_accessed, expires_at, source_pid, related_memories
        FROM agent_memories WHERE agent_uid = ? AND layer = ? ORDER BY importance DESC, last_accessed DESC
      `),
      updateMemoryAccess: this.db.prepare(`
        UPDATE agent_memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
      `),
      deleteMemory: this.db.prepare(`DELETE FROM agent_memories WHERE id = ? AND agent_uid = ?`),
      deleteMemoriesByAgent: this.db.prepare(`DELETE FROM agent_memories WHERE agent_uid = ?`),
      getMemoryCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM agent_memories WHERE agent_uid = ? AND layer = ?
      `),
      getOldestMemories: this.db.prepare(`
        SELECT id FROM agent_memories WHERE agent_uid = ? AND layer = ?
        ORDER BY importance ASC, last_accessed ASC LIMIT ?
      `),
      insertMemoryFts: this.db.prepare(`
        INSERT INTO agent_memories_fts (id, content, tags) VALUES (?, ?, ?)
      `),
      deleteMemoryFts: this.db.prepare(`
        DELETE FROM agent_memories_fts WHERE id = ?
      `),
      // Cron statements (v0.3)
      insertCronJob: this.db.prepare(`
        INSERT INTO cron_jobs (id, name, cron_expression, agent_config, enabled, owner_uid, next_run, run_count, created_at)
        VALUES (@id, @name, @cron_expression, @agent_config, @enabled, @owner_uid, @next_run, @run_count, @created_at)
      `),
      getCronJob: this.db.prepare(`
        SELECT id, name, cron_expression, agent_config, enabled, owner_uid, last_run, next_run, run_count, created_at
        FROM cron_jobs WHERE id = ?
      `),
      getAllCronJobs: this.db.prepare(`
        SELECT id, name, cron_expression, agent_config, enabled, owner_uid, last_run, next_run, run_count, created_at
        FROM cron_jobs ORDER BY created_at ASC
      `),
      getEnabledCronJobs: this.db.prepare(`
        SELECT id, name, cron_expression, agent_config, enabled, owner_uid, last_run, next_run, run_count, created_at
        FROM cron_jobs WHERE enabled = 1 AND next_run <= ? ORDER BY next_run ASC
      `),
      updateCronJobRun: this.db.prepare(`
        UPDATE cron_jobs SET last_run = ?, next_run = ?, run_count = run_count + 1 WHERE id = ?
      `),
      updateCronJobEnabled: this.db.prepare(`
        UPDATE cron_jobs SET enabled = ? WHERE id = ?
      `),
      deleteCronJob: this.db.prepare(`DELETE FROM cron_jobs WHERE id = ?`),
      // Trigger statements (v0.3)
      insertTrigger: this.db.prepare(`
        INSERT INTO event_triggers (id, name, event_type, event_filter, agent_config, enabled, owner_uid, cooldown_ms, fire_count, created_at)
        VALUES (@id, @name, @event_type, @event_filter, @agent_config, @enabled, @owner_uid, @cooldown_ms, @fire_count, @created_at)
      `),
      getTrigger: this.db.prepare(`
        SELECT id, name, event_type, event_filter, agent_config, enabled, owner_uid, cooldown_ms, last_fired, fire_count, created_at
        FROM event_triggers WHERE id = ?
      `),
      getAllTriggers: this.db.prepare(`
        SELECT id, name, event_type, event_filter, agent_config, enabled, owner_uid, cooldown_ms, last_fired, fire_count, created_at
        FROM event_triggers ORDER BY created_at ASC
      `),
      getEnabledTriggersByEvent: this.db.prepare(`
        SELECT id, name, event_type, event_filter, agent_config, enabled, owner_uid, cooldown_ms, last_fired, fire_count, created_at
        FROM event_triggers WHERE enabled = 1 AND event_type = ?
      `),
      updateTriggerFired: this.db.prepare(`
        UPDATE event_triggers SET last_fired = ?, fire_count = fire_count + 1 WHERE id = ?
      `),
      updateTriggerEnabled: this.db.prepare(`
        UPDATE event_triggers SET enabled = ? WHERE id = ?
      `),
      deleteTrigger: this.db.prepare(`DELETE FROM event_triggers WHERE id = ?`),
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

  getAllSnapshots(): Array<{
    id: string;
    pid: PID;
    timestamp: number;
    description: string;
    filePath: string;
    tarballPath: string;
    processInfo: string;
    sizeBytes: number;
  }> {
    return this.stmts.getAllSnapshots.all() as any[];
  }

  getSnapshotsByPid(
    pid: PID,
  ): Array<{
    id: string;
    pid: PID;
    timestamp: number;
    description: string;
    filePath: string;
    tarballPath: string;
    processInfo: string;
    sizeBytes: number;
  }> {
    return this.stmts.getSnapshotsByPid.all(pid) as any[];
  }

  getSnapshotById(
    id: string,
  ):
    | {
        id: string;
        pid: PID;
        timestamp: number;
        description: string;
        filePath: string;
        tarballPath: string;
        processInfo: string;
        sizeBytes: number;
      }
    | undefined {
    return this.stmts.getSnapshotById.get(id) as any;
  }

  deleteSnapshotRecord(id: string): void {
    this.stmts.deleteSnapshot.run(id);
  }

  // ---------------------------------------------------------------------------
  // Shared Mounts
  // ---------------------------------------------------------------------------

  recordSharedMount(record: {
    name: string;
    path: string;
    ownerPid: PID;
    createdAt: number;
  }): void {
    this.stmts.insertSharedMount.run(record);
  }

  getSharedMount(
    name: string,
  ): { name: string; path: string; ownerPid: PID; createdAt: number } | undefined {
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
  // Users
  // ---------------------------------------------------------------------------

  createUser(record: {
    id: string;
    username: string;
    displayName: string;
    passwordHash: string;
    role: string;
    createdAt: number;
  }): void {
    this.stmts.insertUser.run(record);
  }

  getUserById(
    id: string,
  ):
    | {
        id: string;
        username: string;
        displayName: string;
        passwordHash: string;
        role: string;
        createdAt: number;
        lastLogin?: number;
      }
    | undefined {
    return this.stmts.getUserById.get(id) as any;
  }

  getUserByUsername(
    username: string,
  ):
    | {
        id: string;
        username: string;
        displayName: string;
        passwordHash: string;
        role: string;
        createdAt: number;
        lastLogin?: number;
      }
    | undefined {
    return this.stmts.getUserByUsername.get(username) as any;
  }

  getAllUsers(): Array<{
    id: string;
    username: string;
    displayName: string;
    role: string;
    createdAt: number;
    lastLogin?: number;
  }> {
    return this.stmts.getAllUsers.all() as any[];
  }

  updateUser(id: string, updates: { displayName?: string; role?: string }): void {
    const existing = this.getUserById(id);
    if (!existing) return;
    this.stmts.updateUser.run({
      id,
      displayName: updates.displayName ?? existing.displayName,
      role: updates.role ?? existing.role,
    });
  }

  updateUserLogin(id: string): void {
    this.stmts.updateUserLogin.run(Date.now(), id);
  }

  deleteUser(id: string): void {
    this.stmts.deleteUser.run(id);
  }

  getUserCount(): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    return row.count;
  }

  updateUserPasswordHash(id: string, passwordHash: string): void {
    this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
  }

  // ---------------------------------------------------------------------------
  // Agent Memories (v0.3)
  // ---------------------------------------------------------------------------

  insertMemory(record: {
    id: string;
    agent_uid: string;
    layer: string;
    content: string;
    tags: string;
    importance: number;
    access_count: number;
    created_at: number;
    last_accessed: number;
    expires_at: number | null;
    source_pid: number | null;
    related_memories: string;
  }): void {
    this.stmts.insertMemory.run(record);
    this.stmts.insertMemoryFts.run(record.id, record.content, record.tags);
  }

  getMemory(id: string): any | undefined {
    return this.stmts.getMemory.get(id);
  }

  getMemoriesByAgent(agent_uid: string): any[] {
    return this.stmts.getMemoriesByAgent.all(agent_uid) as any[];
  }

  getMemoriesByAgentLayer(agent_uid: string, layer: string): any[] {
    return this.stmts.getMemoriesByAgentLayer.all(agent_uid, layer) as any[];
  }

  updateMemoryAccess(id: string): void {
    this.stmts.updateMemoryAccess.run(Date.now(), id);
  }

  deleteMemory(id: string, agent_uid: string): boolean {
    const result = this.stmts.deleteMemory.run(id, agent_uid);
    if (result.changes > 0) {
      this.stmts.deleteMemoryFts.run(id);
      return true;
    }
    return false;
  }

  deleteMemoriesByAgent(agent_uid: string): void {
    // Delete FTS entries first
    const memories = this.getMemoriesByAgent(agent_uid);
    for (const m of memories) {
      this.stmts.deleteMemoryFts.run(m.id);
    }
    this.stmts.deleteMemoriesByAgent.run(agent_uid);
  }

  getMemoryCount(agent_uid: string, layer: string): number {
    const row = this.stmts.getMemoryCount.get(agent_uid, layer) as { count: number };
    return row.count;
  }

  getOldestMemories(agent_uid: string, layer: string, limit: number): Array<{ id: string }> {
    return this.stmts.getOldestMemories.all(agent_uid, layer, limit) as any[];
  }

  searchMemories(agent_uid: string, query: string, limit: number = 20): any[] {
    // Convert natural language query to FTS5 OR-joined terms
    // FTS5 treats space-separated words as implicit AND; we use OR for broader recall
    const terms = query
      .replace(/[^\w\s]/g, '') // strip special chars
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => `"${t}"`)
      .join(' OR ');
    if (!terms) return [];

    // Use FTS5 search joined with main table for agent filtering
    const stmt = this.db.prepare(`
      SELECT m.id, m.agent_uid, m.layer, m.content, m.tags, m.importance, m.access_count,
             m.created_at, m.last_accessed, m.expires_at, m.source_pid, m.related_memories,
             rank
      FROM agent_memories_fts fts
      JOIN agent_memories m ON fts.id = m.id
      WHERE agent_memories_fts MATCH ? AND m.agent_uid = ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(terms, agent_uid, limit) as any[];
  }

  // ---------------------------------------------------------------------------
  // Cron Jobs (v0.3)
  // ---------------------------------------------------------------------------

  insertCronJob(record: {
    id: string;
    name: string;
    cron_expression: string;
    agent_config: string;
    enabled: number;
    owner_uid: string;
    next_run: number;
    run_count: number;
    created_at: number;
  }): void {
    this.stmts.insertCronJob.run(record);
  }

  getCronJob(id: string): any | undefined {
    return this.stmts.getCronJob.get(id);
  }

  getAllCronJobs(): any[] {
    return this.stmts.getAllCronJobs.all() as any[];
  }

  getEnabledCronJobsDue(now: number): any[] {
    return this.stmts.getEnabledCronJobs.all(now) as any[];
  }

  updateCronJobRun(id: string, lastRun: number, nextRun: number): void {
    this.stmts.updateCronJobRun.run(lastRun, nextRun, id);
  }

  setCronJobEnabled(id: string, enabled: boolean): void {
    this.stmts.updateCronJobEnabled.run(enabled ? 1 : 0, id);
  }

  deleteCronJob(id: string): void {
    this.stmts.deleteCronJob.run(id);
  }

  // ---------------------------------------------------------------------------
  // Event Triggers (v0.3)
  // ---------------------------------------------------------------------------

  insertTrigger(record: {
    id: string;
    name: string;
    event_type: string;
    event_filter: string | null;
    agent_config: string;
    enabled: number;
    owner_uid: string;
    cooldown_ms: number;
    fire_count: number;
    created_at: number;
  }): void {
    this.stmts.insertTrigger.run(record);
  }

  getTrigger(id: string): any | undefined {
    return this.stmts.getTrigger.get(id);
  }

  getAllTriggers(): any[] {
    return this.stmts.getAllTriggers.all() as any[];
  }

  getEnabledTriggersByEvent(event_type: string): any[] {
    return this.stmts.getEnabledTriggersByEvent.all(event_type) as any[];
  }

  updateTriggerFired(id: string, now: number): void {
    this.stmts.updateTriggerFired.run(now, id);
  }

  setTriggerEnabled(id: string, enabled: boolean): void {
    this.stmts.updateTriggerEnabled.run(enabled ? 1 : 0, id);
  }

  deleteTrigger(id: string): void {
    this.stmts.deleteTrigger.run(id);
  }

  /** Expose the underlying database for direct queries (used by MemoryManager for FTS5) */
  getDatabase(): Database.Database {
    return this.db;
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
