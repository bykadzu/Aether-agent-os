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
  ReflectionRecord,
  PlanRecord,
  PlanNode,
  FeedbackRecord,
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
    // Reflection statements (v0.3 Wave 2)
    insertReflection: Database.Statement;
    getReflectionsByAgent: Database.Statement;
    getReflectionsByPid: Database.Statement;
    getReflection: Database.Statement;
    // Plan statements (v0.3 Wave 2)
    insertPlan: Database.Statement;
    getPlan: Database.Statement;
    getActivePlanByPid: Database.Statement;
    getPlansByAgent: Database.Statement;
    updatePlan: Database.Statement;
    // Feedback statements (v0.3 Wave 2)
    insertFeedback: Database.Statement;
    getFeedbackByPid: Database.Statement;
    getFeedbackByAgent: Database.Statement;
    getFeedback: Database.Statement;
    // Profile statements (v0.3 Wave 4)
    upsertProfile: Database.Statement;
    getProfile: Database.Statement;
    getAllProfiles: Database.Statement;
    // App Framework statements (v0.4)
    insertApp: Database.Statement;
    getApp: Database.Statement;
    getAllApps: Database.Statement;
    deleteApp: Database.Statement;
    updateAppEnabled: Database.Statement;
    // Webhook statements (v0.4)
    insertWebhook: Database.Statement;
    getWebhook: Database.Statement;
    getAllWebhooks: Database.Statement;
    getWebhooksByOwner: Database.Statement;
    getEnabledWebhooks: Database.Statement;
    updateWebhookEnabled: Database.Statement;
    updateWebhookTriggered: Database.Statement;
    updateWebhookFailure: Database.Statement;
    deleteWebhook: Database.Statement;
    insertWebhookLog: Database.Statement;
    getWebhookLogs: Database.Statement;
    insertInboundWebhook: Database.Statement;
    getInboundWebhook: Database.Statement;
    getInboundWebhookByToken: Database.Statement;
    getAllInboundWebhooks: Database.Statement;
    getInboundWebhooksByOwner: Database.Statement;
    updateInboundWebhookTriggered: Database.Statement;
    deleteInboundWebhook: Database.Statement;
    // Webhook DLQ statements (v0.5 Phase 3)
    insertDlqEntry: Database.Statement;
    getDlqEntry: Database.Statement;
    getDlqEntries: Database.Statement;
    getDlqCount: Database.Statement;
    deleteDlqEntry: Database.Statement;
    deleteAllDlqEntries: Database.Statement;
    updateDlqRetried: Database.Statement;
    // Plugin registry statements (v0.4 Wave 2)
    insertPlugin: Database.Statement;
    getPlugin: Database.Statement;
    getAllPlugins: Database.Statement;
    getPluginsByCategory: Database.Statement;
    deletePlugin: Database.Statement;
    updatePluginEnabled: Database.Statement;
    updatePluginRating: Database.Statement;
    insertPluginRating: Database.Statement;
    getPluginRatings: Database.Statement;
    getPluginSetting: Database.Statement;
    upsertPluginSetting: Database.Statement;
    getPluginSettings: Database.Statement;
    deletePluginSettings: Database.Statement;
    // Integration statements (v0.4 Wave 2)
    insertIntegration: Database.Statement;
    getIntegration: Database.Statement;
    getAllIntegrations: Database.Statement;
    deleteIntegration: Database.Statement;
    updateIntegrationEnabled: Database.Statement;
    updateIntegrationSettings: Database.Statement;
    updateIntegrationStatus: Database.Statement;
    insertIntegrationLog: Database.Statement;
    getIntegrationLogs: Database.Statement;
    // Template marketplace statements (v0.4 Wave 2)
    insertTemplate: Database.Statement;
    getTemplate: Database.Statement;
    getAllTemplates: Database.Statement;
    getTemplatesByCategory: Database.Statement;
    deleteTemplate: Database.Statement;
    updateTemplateRating: Database.Statement;
    insertTemplateRating: Database.Statement;
    updateTemplateDownloads: Database.Statement;
    // Organization statements (v0.5 RBAC)
    insertOrg: Database.Statement;
    getOrg: Database.Statement;
    getOrgByName: Database.Statement;
    getAllOrgs: Database.Statement;
    getOrgsByUser: Database.Statement;
    updateOrg: Database.Statement;
    deleteOrg: Database.Statement;
    insertTeam: Database.Statement;
    getTeam: Database.Statement;
    getTeamsByOrg: Database.Statement;
    deleteTeam: Database.Statement;
    insertOrgMember: Database.Statement;
    getOrgMember: Database.Statement;
    getOrgMembers: Database.Statement;
    updateOrgMemberRole: Database.Statement;
    deleteOrgMember: Database.Statement;
    insertTeamMember: Database.Statement;
    getTeamMember: Database.Statement;
    getTeamMembers: Database.Statement;
    deleteTeamMember: Database.Statement;
    // Generic KV store (v0.4 Remote Access)
    getKV: Database.Statement;
    setKV: Database.Statement;
    deleteKV: Database.Statement;
    // Audit log statements (v0.5)
    insertAuditLog: Database.Statement;
    countAuditLog: Database.Statement;
    pruneAuditLog: Database.Statement;
    // MFA statements (v0.5 Phase 3)
    getUserMfa: Database.Statement;
    setUserMfa: Database.Statement;
    enableUserMfa: Database.Statement;
    disableUserMfa: Database.Statement;
    // Permission Policy statements (v0.5 Phase 4)
    insertPermissionPolicy: Database.Statement;
    deletePermissionPolicy: Database.Statement;
    getPermissionPoliciesForSubject: Database.Statement;
    getPermissionPoliciesForAction: Database.Statement;
    getAllPermissionPolicies: Database.Statement;
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

      -- Reflections table (v0.3 Wave 2)
      CREATE TABLE IF NOT EXISTS agent_reflections (
        id TEXT PRIMARY KEY,
        agent_uid TEXT NOT NULL,
        pid INTEGER NOT NULL,
        goal TEXT NOT NULL,
        summary TEXT NOT NULL,
        quality_rating INTEGER NOT NULL CHECK(quality_rating BETWEEN 1 AND 5),
        justification TEXT NOT NULL,
        lessons_learned TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reflections_agent ON agent_reflections(agent_uid);
      CREATE INDEX IF NOT EXISTS idx_reflections_pid ON agent_reflections(pid);

      -- Plans table (v0.3 Wave 2)
      CREATE TABLE IF NOT EXISTS agent_plans (
        id TEXT PRIMARY KEY,
        agent_uid TEXT NOT NULL,
        pid INTEGER NOT NULL,
        goal TEXT NOT NULL,
        plan_tree TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'abandoned')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plans_agent ON agent_plans(agent_uid);
      CREATE INDEX IF NOT EXISTS idx_plans_pid ON agent_plans(pid);
      CREATE INDEX IF NOT EXISTS idx_plans_status ON agent_plans(status);

      -- Feedback table (v0.3 Wave 2)
      CREATE TABLE IF NOT EXISTS agent_feedback (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        step INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating IN (1, -1)),
        comment TEXT,
        agent_uid TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_feedback_pid ON agent_feedback(pid);
      CREATE INDEX IF NOT EXISTS idx_feedback_agent ON agent_feedback(agent_uid);

      -- Installed apps table (v0.4 Wave 1)
      CREATE TABLE IF NOT EXISTS installed_apps (
        id TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        install_source TEXT,
        owner_uid TEXT
      );

      -- Webhooks tables (v0.4 Wave 1)
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL,
        filters TEXT,
        headers TEXT,
        enabled INTEGER DEFAULT 1,
        owner_uid TEXT,
        retry_count INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 5000,
        created_at INTEGER NOT NULL,
        last_triggered INTEGER,
        failure_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status_code INTEGER,
        response_body TEXT,
        duration_ms INTEGER,
        success INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);

      CREATE TABLE IF NOT EXISTS inbound_webhooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        agent_config TEXT NOT NULL,
        transform TEXT,
        enabled INTEGER DEFAULT 1,
        owner_uid TEXT,
        last_triggered INTEGER,
        trigger_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_inbound_webhooks_token ON inbound_webhooks(token);

      -- Webhook Dead Letter Queue (v0.5 Phase 3)
      CREATE TABLE IF NOT EXISTS webhook_dlq (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        error TEXT,
        attempts INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        retried_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_webhook_dlq_webhook ON webhook_dlq(webhook_id);
      CREATE INDEX IF NOT EXISTS idx_webhook_dlq_created ON webhook_dlq(created_at);

      -- Plugin registry table (v0.4 Wave 2)
      CREATE TABLE IF NOT EXISTS plugin_registry (
        id TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1,
        install_source TEXT DEFAULT 'registry',
        owner_uid TEXT,
        download_count INTEGER DEFAULT 0,
        rating_avg REAL DEFAULT 0.0,
        rating_count INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS plugin_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        review TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(plugin_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS plugin_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        UNIQUE(plugin_id, key)
      );

      -- Integrations tables (v0.4 Wave 2)
      CREATE TABLE IF NOT EXISTS integrations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        owner_uid TEXT,
        credentials TEXT,
        settings TEXT,
        status TEXT DEFAULT 'disconnected',
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS integration_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        request_summary TEXT,
        response_summary TEXT,
        duration_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_integration_logs_integration ON integration_logs(integration_id);
      CREATE INDEX IF NOT EXISTS idx_integration_logs_created ON integration_logs(created_at);

      -- Template marketplace tables (v0.4 Wave 2)
      CREATE TABLE IF NOT EXISTS template_marketplace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL,
        config TEXT NOT NULL,
        suggested_goals TEXT NOT NULL DEFAULT '[]',
        author TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        download_count INTEGER DEFAULT 0,
        rating_avg REAL DEFAULT 0.0,
        rating_count INTEGER DEFAULT 0,
        published_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS template_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        template_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        review TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(template_id, user_id)
      );

      -- Organizations tables (v0.5 RBAC)
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        owner_uid TEXT NOT NULL,
        settings TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        UNIQUE(org_id, name),
        FOREIGN KEY (org_id) REFERENCES organizations(id)
      );

      CREATE TABLE IF NOT EXISTS org_members (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        UNIQUE(org_id, user_id),
        FOREIGN KEY (org_id) REFERENCES organizations(id)
      );

      CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at INTEGER NOT NULL,
        UNIQUE(team_id, user_id),
        FOREIGN KEY (team_id) REFERENCES teams(id)
      );

      CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);
      CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);
      CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
      CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

      -- Agent profiles table (v0.3 Wave 4)
      -- Generic key-value store (v0.4 Remote Access)
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_profiles (
        agent_uid TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        total_tasks INTEGER NOT NULL DEFAULT 0,
        successful_tasks INTEGER NOT NULL DEFAULT 0,
        failed_tasks INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0.0,
        expertise TEXT NOT NULL DEFAULT '[]',
        personality_traits TEXT NOT NULL DEFAULT '[]',
        avg_quality_rating REAL NOT NULL DEFAULT 0.0,
        total_steps INTEGER NOT NULL DEFAULT 0,
        first_seen INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      -- Audit log table (v0.5 Audit Logger)
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        actor_pid INTEGER,
        actor_uid TEXT,
        action TEXT NOT NULL,
        target TEXT,
        args_sanitized TEXT,
        result_hash TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_event_type ON audit_log(event_type);
      CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_pid, actor_uid);
    `);

    // v0.5 Phase 3: Add MFA columns to users table
    this.migrateAddColumn('users', 'mfa_secret', 'TEXT');
    this.migrateAddColumn('users', 'mfa_enabled', 'INTEGER DEFAULT 0');

    // v0.5 Phase 4: Permission policies table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS permission_policies (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        effect TEXT NOT NULL CHECK(effect IN ('allow', 'deny')),
        created_at INTEGER NOT NULL,
        created_by TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_permission_policies_subject_action ON permission_policies(subject, action);
    `);
  }

  /** Safely add a column if it does not already exist. */
  private migrateAddColumn(table: string, column: string, type: string): void {
    const cols = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols || cols.length === 0) return; // table doesn't exist yet
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
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
      // Reflection statements (v0.3 Wave 2)
      insertReflection: this.db.prepare(`
        INSERT INTO agent_reflections (id, agent_uid, pid, goal, summary, quality_rating, justification, lessons_learned, created_at)
        VALUES (@id, @agent_uid, @pid, @goal, @summary, @quality_rating, @justification, @lessons_learned, @created_at)
      `),
      getReflectionsByAgent: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, summary, quality_rating, justification, lessons_learned, created_at
        FROM agent_reflections WHERE agent_uid = ? ORDER BY created_at DESC
      `),
      getReflectionsByPid: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, summary, quality_rating, justification, lessons_learned, created_at
        FROM agent_reflections WHERE pid = ? ORDER BY created_at DESC
      `),
      getReflection: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, summary, quality_rating, justification, lessons_learned, created_at
        FROM agent_reflections WHERE id = ?
      `),
      // Plan statements (v0.3 Wave 2)
      insertPlan: this.db.prepare(`
        INSERT INTO agent_plans (id, agent_uid, pid, goal, plan_tree, status, created_at, updated_at)
        VALUES (@id, @agent_uid, @pid, @goal, @plan_tree, @status, @created_at, @updated_at)
      `),
      getPlan: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, plan_tree, status, created_at, updated_at
        FROM agent_plans WHERE id = ?
      `),
      getActivePlanByPid: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, plan_tree, status, created_at, updated_at
        FROM agent_plans WHERE pid = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1
      `),
      getPlansByAgent: this.db.prepare(`
        SELECT id, agent_uid, pid, goal, plan_tree, status, created_at, updated_at
        FROM agent_plans WHERE agent_uid = ? ORDER BY created_at DESC
      `),
      updatePlan: this.db.prepare(`
        UPDATE agent_plans SET plan_tree = @plan_tree, status = @status, updated_at = @updated_at WHERE id = @id
      `),
      // Feedback statements (v0.3 Wave 2)
      insertFeedback: this.db.prepare(`
        INSERT INTO agent_feedback (id, pid, step, rating, comment, agent_uid, created_at)
        VALUES (@id, @pid, @step, @rating, @comment, @agent_uid, @created_at)
      `),
      getFeedbackByPid: this.db.prepare(`
        SELECT id, pid, step, rating, comment, agent_uid, created_at
        FROM agent_feedback WHERE pid = ? ORDER BY created_at DESC
      `),
      getFeedbackByAgent: this.db.prepare(`
        SELECT id, pid, step, rating, comment, agent_uid, created_at
        FROM agent_feedback WHERE agent_uid = ? ORDER BY created_at DESC LIMIT ?
      `),
      getFeedback: this.db.prepare(`
        SELECT id, pid, step, rating, comment, agent_uid, created_at
        FROM agent_feedback WHERE id = ?
      `),
      // Profile statements (v0.3 Wave 4)
      upsertProfile: this.db.prepare(`
        INSERT OR REPLACE INTO agent_profiles (agent_uid, display_name, total_tasks, successful_tasks, failed_tasks, success_rate, expertise, personality_traits, avg_quality_rating, total_steps, first_seen, last_active, updated_at)
        VALUES (@agent_uid, @display_name, @total_tasks, @successful_tasks, @failed_tasks, @success_rate, @expertise, @personality_traits, @avg_quality_rating, @total_steps, @first_seen, @last_active, @updated_at)
      `),
      getProfile: this.db.prepare(`
        SELECT agent_uid, display_name, total_tasks, successful_tasks, failed_tasks, success_rate, expertise, personality_traits, avg_quality_rating, total_steps, first_seen, last_active, updated_at
        FROM agent_profiles WHERE agent_uid = ?
      `),
      getAllProfiles: this.db.prepare(`
        SELECT agent_uid, display_name, total_tasks, successful_tasks, failed_tasks, success_rate, expertise, personality_traits, avg_quality_rating, total_steps, first_seen, last_active, updated_at
        FROM agent_profiles ORDER BY last_active DESC
      `),
      // App Framework statements (v0.4)
      insertApp: this.db.prepare(`
        INSERT OR REPLACE INTO installed_apps (id, manifest, installed_at, updated_at, enabled, install_source, owner_uid)
        VALUES (@id, @manifest, @installed_at, @updated_at, @enabled, @install_source, @owner_uid)
      `),
      getApp: this.db.prepare(`
        SELECT id, manifest, installed_at, updated_at, enabled, install_source, owner_uid
        FROM installed_apps WHERE id = ?
      `),
      getAllApps: this.db.prepare(`
        SELECT id, manifest, installed_at, updated_at, enabled, install_source, owner_uid
        FROM installed_apps ORDER BY installed_at ASC
      `),
      deleteApp: this.db.prepare(`DELETE FROM installed_apps WHERE id = ?`),
      updateAppEnabled: this.db.prepare(`
        UPDATE installed_apps SET enabled = ? WHERE id = ?
      `),
      // Webhook statements (v0.4)
      insertWebhook: this.db.prepare(`
        INSERT INTO webhooks (id, name, url, secret, events, filters, headers, enabled, owner_uid, retry_count, timeout_ms, created_at, last_triggered, failure_count)
        VALUES (@id, @name, @url, @secret, @events, @filters, @headers, @enabled, @owner_uid, @retry_count, @timeout_ms, @created_at, @last_triggered, @failure_count)
      `),
      getWebhook: this.db.prepare(`
        SELECT id, name, url, secret, events, filters, headers, enabled, owner_uid, retry_count, timeout_ms, created_at, last_triggered, failure_count
        FROM webhooks WHERE id = ?
      `),
      getAllWebhooks: this.db.prepare(`
        SELECT id, name, url, secret, events, filters, headers, enabled, owner_uid, retry_count, timeout_ms, created_at, last_triggered, failure_count
        FROM webhooks ORDER BY created_at ASC
      `),
      getWebhooksByOwner: this.db.prepare(`
        SELECT id, name, url, secret, events, filters, headers, enabled, owner_uid, retry_count, timeout_ms, created_at, last_triggered, failure_count
        FROM webhooks WHERE owner_uid = ? ORDER BY created_at ASC
      `),
      getEnabledWebhooks: this.db.prepare(`
        SELECT id, name, url, secret, events, filters, headers, enabled, owner_uid, retry_count, timeout_ms, created_at, last_triggered, failure_count
        FROM webhooks WHERE enabled = 1
      `),
      updateWebhookEnabled: this.db.prepare(`
        UPDATE webhooks SET enabled = ? WHERE id = ?
      `),
      updateWebhookTriggered: this.db.prepare(`
        UPDATE webhooks SET last_triggered = ? WHERE id = ?
      `),
      updateWebhookFailure: this.db.prepare(`
        UPDATE webhooks SET failure_count = failure_count + 1 WHERE id = ?
      `),
      deleteWebhook: this.db.prepare(`DELETE FROM webhooks WHERE id = ?`),
      insertWebhookLog: this.db.prepare(`
        INSERT INTO webhook_logs (webhook_id, event_type, payload, status_code, response_body, duration_ms, success, created_at)
        VALUES (@webhook_id, @event_type, @payload, @status_code, @response_body, @duration_ms, @success, @created_at)
      `),
      getWebhookLogs: this.db.prepare(`
        SELECT id, webhook_id, event_type, payload, status_code, response_body, duration_ms, success, created_at
        FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      insertInboundWebhook: this.db.prepare(`
        INSERT INTO inbound_webhooks (id, name, token, agent_config, transform, enabled, owner_uid, last_triggered, trigger_count, created_at)
        VALUES (@id, @name, @token, @agent_config, @transform, @enabled, @owner_uid, @last_triggered, @trigger_count, @created_at)
      `),
      getInboundWebhook: this.db.prepare(`
        SELECT id, name, token, agent_config, transform, enabled, owner_uid, last_triggered, trigger_count, created_at
        FROM inbound_webhooks WHERE id = ?
      `),
      getInboundWebhookByToken: this.db.prepare(`
        SELECT id, name, token, agent_config, transform, enabled, owner_uid, last_triggered, trigger_count, created_at
        FROM inbound_webhooks WHERE token = ?
      `),
      getAllInboundWebhooks: this.db.prepare(`
        SELECT id, name, token, agent_config, transform, enabled, owner_uid, last_triggered, trigger_count, created_at
        FROM inbound_webhooks ORDER BY created_at ASC
      `),
      getInboundWebhooksByOwner: this.db.prepare(`
        SELECT id, name, token, agent_config, transform, enabled, owner_uid, last_triggered, trigger_count, created_at
        FROM inbound_webhooks WHERE owner_uid = ? ORDER BY created_at ASC
      `),
      updateInboundWebhookTriggered: this.db.prepare(`
        UPDATE inbound_webhooks SET last_triggered = ?, trigger_count = trigger_count + 1 WHERE id = ?
      `),
      deleteInboundWebhook: this.db.prepare(`DELETE FROM inbound_webhooks WHERE id = ?`),
      // Webhook DLQ statements (v0.5 Phase 3)
      insertDlqEntry: this.db.prepare(`
        INSERT INTO webhook_dlq (id, webhook_id, event_type, payload, error, attempts, created_at, retried_at)
        VALUES (@id, @webhook_id, @event_type, @payload, @error, @attempts, @created_at, @retried_at)
      `),
      getDlqEntry: this.db.prepare(`
        SELECT id, webhook_id, event_type, payload, error, attempts, created_at, retried_at
        FROM webhook_dlq WHERE id = ?
      `),
      getDlqEntries: this.db.prepare(`
        SELECT id, webhook_id, event_type, payload, error, attempts, created_at, retried_at
        FROM webhook_dlq ORDER BY created_at DESC LIMIT ? OFFSET ?
      `),
      getDlqCount: this.db.prepare(`SELECT COUNT(*) as count FROM webhook_dlq`),
      deleteDlqEntry: this.db.prepare(`DELETE FROM webhook_dlq WHERE id = ?`),
      deleteAllDlqEntries: this.db.prepare(`DELETE FROM webhook_dlq`),
      updateDlqRetried: this.db.prepare(`
        UPDATE webhook_dlq SET retried_at = ? WHERE id = ?
      `),
      // Plugin registry statements (v0.4 Wave 2)
      insertPlugin: this.db.prepare(`
        INSERT OR REPLACE INTO plugin_registry (id, manifest, installed_at, updated_at, enabled, install_source, owner_uid, download_count, rating_avg, rating_count)
        VALUES (@id, @manifest, @installed_at, @updated_at, @enabled, @install_source, @owner_uid, @download_count, @rating_avg, @rating_count)
      `),
      getPlugin: this.db.prepare(`
        SELECT id, manifest, installed_at, updated_at, enabled, install_source, owner_uid, download_count, rating_avg, rating_count
        FROM plugin_registry WHERE id = ?
      `),
      getAllPlugins: this.db.prepare(`
        SELECT id, manifest, installed_at, updated_at, enabled, install_source, owner_uid, download_count, rating_avg, rating_count
        FROM plugin_registry ORDER BY installed_at DESC
      `),
      getPluginsByCategory: this.db.prepare(`
        SELECT id, manifest, installed_at, updated_at, enabled, install_source, owner_uid, download_count, rating_avg, rating_count
        FROM plugin_registry WHERE json_extract(manifest, '$.category') = ? ORDER BY installed_at DESC
      `),
      deletePlugin: this.db.prepare(`DELETE FROM plugin_registry WHERE id = ?`),
      updatePluginEnabled: this.db.prepare(
        `UPDATE plugin_registry SET enabled = ?, updated_at = ? WHERE id = ?`,
      ),
      updatePluginRating: this.db.prepare(
        `UPDATE plugin_registry SET rating_avg = ?, rating_count = ?, updated_at = ? WHERE id = ?`,
      ),
      insertPluginRating: this.db.prepare(`
        INSERT OR REPLACE INTO plugin_ratings (plugin_id, user_id, rating, review, created_at)
        VALUES (@plugin_id, @user_id, @rating, @review, @created_at)
      `),
      getPluginRatings: this.db.prepare(`
        SELECT plugin_id, user_id, rating, review, created_at FROM plugin_ratings WHERE plugin_id = ?
      `),
      getPluginSetting: this.db.prepare(
        `SELECT value FROM plugin_settings WHERE plugin_id = ? AND key = ?`,
      ),
      upsertPluginSetting: this.db.prepare(`
        INSERT OR REPLACE INTO plugin_settings (plugin_id, key, value) VALUES (?, ?, ?)
      `),
      getPluginSettings: this.db.prepare(
        `SELECT key, value FROM plugin_settings WHERE plugin_id = ?`,
      ),
      deletePluginSettings: this.db.prepare(`DELETE FROM plugin_settings WHERE plugin_id = ?`),
      // Integration statements (v0.4 Wave 2)
      insertIntegration: this.db.prepare(`
        INSERT INTO integrations (id, type, name, enabled, owner_uid, credentials, settings, status, last_error, created_at, updated_at)
        VALUES (@id, @type, @name, @enabled, @owner_uid, @credentials, @settings, @status, @last_error, @created_at, @updated_at)
      `),
      getIntegration: this.db.prepare(`
        SELECT id, type, name, enabled, owner_uid, credentials, settings, status, last_error, created_at, updated_at
        FROM integrations WHERE id = ?
      `),
      getAllIntegrations: this.db.prepare(`
        SELECT id, type, name, enabled, owner_uid, credentials, settings, status, last_error, created_at, updated_at
        FROM integrations ORDER BY created_at ASC
      `),
      deleteIntegration: this.db.prepare(`DELETE FROM integrations WHERE id = ?`),
      updateIntegrationEnabled: this.db.prepare(
        `UPDATE integrations SET enabled = ?, updated_at = ? WHERE id = ?`,
      ),
      updateIntegrationSettings: this.db.prepare(
        `UPDATE integrations SET settings = ?, updated_at = ? WHERE id = ?`,
      ),
      updateIntegrationStatus: this.db.prepare(
        `UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`,
      ),
      insertIntegrationLog: this.db.prepare(`
        INSERT INTO integration_logs (integration_id, action, status, request_summary, response_summary, duration_ms, created_at)
        VALUES (@integration_id, @action, @status, @request_summary, @response_summary, @duration_ms, @created_at)
      `),
      getIntegrationLogs: this.db.prepare(`
        SELECT id, integration_id, action, status, request_summary, response_summary, duration_ms, created_at
        FROM integration_logs WHERE integration_id = ? ORDER BY created_at DESC LIMIT ?
      `),
      // Template marketplace statements (v0.4 Wave 2)
      insertTemplate: this.db.prepare(`
        INSERT OR REPLACE INTO template_marketplace (id, name, description, icon, category, config, suggested_goals, author, tags, download_count, rating_avg, rating_count, published_at, updated_at, enabled)
        VALUES (@id, @name, @description, @icon, @category, @config, @suggested_goals, @author, @tags, @download_count, @rating_avg, @rating_count, @published_at, @updated_at, @enabled)
      `),
      getTemplate: this.db.prepare(`
        SELECT id, name, description, icon, category, config, suggested_goals, author, tags, download_count, rating_avg, rating_count, published_at, updated_at, enabled
        FROM template_marketplace WHERE id = ?
      `),
      getAllTemplates: this.db.prepare(`
        SELECT id, name, description, icon, category, config, suggested_goals, author, tags, download_count, rating_avg, rating_count, published_at, updated_at, enabled
        FROM template_marketplace WHERE enabled = 1 ORDER BY download_count DESC
      `),
      getTemplatesByCategory: this.db.prepare(`
        SELECT id, name, description, icon, category, config, suggested_goals, author, tags, download_count, rating_avg, rating_count, published_at, updated_at, enabled
        FROM template_marketplace WHERE category = ? AND enabled = 1 ORDER BY download_count DESC
      `),
      deleteTemplate: this.db.prepare(`DELETE FROM template_marketplace WHERE id = ?`),
      updateTemplateRating: this.db.prepare(
        `UPDATE template_marketplace SET rating_avg = ?, rating_count = ?, updated_at = ? WHERE id = ?`,
      ),
      insertTemplateRating: this.db.prepare(`
        INSERT OR REPLACE INTO template_ratings (template_id, user_id, rating, review, created_at)
        VALUES (@template_id, @user_id, @rating, @review, @created_at)
      `),
      updateTemplateDownloads: this.db.prepare(
        `UPDATE template_marketplace SET download_count = download_count + 1 WHERE id = ?`,
      ),
      // Organization statements (v0.5 RBAC)
      insertOrg: this.db.prepare(`
        INSERT INTO organizations (id, name, display_name, owner_uid, settings, created_at, updated_at)
        VALUES (@id, @name, @display_name, @owner_uid, @settings, @created_at, @updated_at)
      `),
      getOrg: this.db.prepare(`
        SELECT id, name, display_name, owner_uid, settings, created_at, updated_at
        FROM organizations WHERE id = ?
      `),
      getOrgByName: this.db.prepare(`
        SELECT id, name, display_name, owner_uid, settings, created_at, updated_at
        FROM organizations WHERE name = ?
      `),
      getAllOrgs: this.db.prepare(`
        SELECT id, name, display_name, owner_uid, settings, created_at, updated_at
        FROM organizations ORDER BY created_at ASC
      `),
      getOrgsByUser: this.db.prepare(`
        SELECT o.id, o.name, o.display_name, o.owner_uid, o.settings, o.created_at, o.updated_at
        FROM organizations o
        JOIN org_members m ON o.id = m.org_id
        WHERE m.user_id = ?
        ORDER BY o.created_at ASC
      `),
      updateOrg: this.db.prepare(`
        UPDATE organizations SET settings = @settings, display_name = @display_name, updated_at = @updated_at WHERE id = @id
      `),
      deleteOrg: this.db.prepare(`DELETE FROM organizations WHERE id = ?`),
      insertTeam: this.db.prepare(`
        INSERT INTO teams (id, org_id, name, description, created_at)
        VALUES (@id, @org_id, @name, @description, @created_at)
      `),
      getTeam: this.db.prepare(`
        SELECT id, org_id, name, description, created_at
        FROM teams WHERE id = ?
      `),
      getTeamsByOrg: this.db.prepare(`
        SELECT id, org_id, name, description, created_at
        FROM teams WHERE org_id = ? ORDER BY created_at ASC
      `),
      deleteTeam: this.db.prepare(`DELETE FROM teams WHERE id = ?`),
      insertOrgMember: this.db.prepare(`
        INSERT INTO org_members (id, org_id, user_id, role, joined_at)
        VALUES (@id, @org_id, @user_id, @role, @joined_at)
      `),
      getOrgMember: this.db.prepare(`
        SELECT id, org_id, user_id, role, joined_at
        FROM org_members WHERE org_id = ? AND user_id = ?
      `),
      getOrgMembers: this.db.prepare(`
        SELECT id, org_id, user_id, role, joined_at
        FROM org_members WHERE org_id = ? ORDER BY joined_at ASC
      `),
      updateOrgMemberRole: this.db.prepare(`
        UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?
      `),
      deleteOrgMember: this.db.prepare(`
        DELETE FROM org_members WHERE org_id = ? AND user_id = ?
      `),
      insertTeamMember: this.db.prepare(`
        INSERT INTO team_members (id, team_id, user_id, role, joined_at)
        VALUES (@id, @team_id, @user_id, @role, @joined_at)
      `),
      getTeamMember: this.db.prepare(`
        SELECT id, team_id, user_id, role, joined_at
        FROM team_members WHERE team_id = ? AND user_id = ?
      `),
      getTeamMembers: this.db.prepare(`
        SELECT id, team_id, user_id, role, joined_at
        FROM team_members WHERE team_id = ? ORDER BY joined_at ASC
      `),
      deleteTeamMember: this.db.prepare(`
        DELETE FROM team_members WHERE team_id = ? AND user_id = ?
      `),
      // Generic KV store (v0.4 Remote Access)
      getKV: this.db.prepare(`SELECT value FROM kv_store WHERE key = ?`),
      setKV: this.db.prepare(`
        INSERT OR REPLACE INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
      `),
      deleteKV: this.db.prepare(`DELETE FROM kv_store WHERE key = ?`),
      // Audit log statements (v0.5)
      insertAuditLog: this.db.prepare(`
        INSERT INTO audit_log (timestamp, event_type, actor_pid, actor_uid, action, target, args_sanitized, result_hash, metadata, created_at)
        VALUES (@timestamp, @event_type, @actor_pid, @actor_uid, @action, @target, @args_sanitized, @result_hash, @metadata, @timestamp)
      `),
      countAuditLog: this.db.prepare(`SELECT COUNT(*) as count FROM audit_log`),
      pruneAuditLog: this.db.prepare(`DELETE FROM audit_log WHERE timestamp < ?`),
      // MFA (v0.5 Phase 3)
      getUserMfa: this.db.prepare(
        `SELECT mfa_secret as mfaSecret, mfa_enabled as mfaEnabled FROM users WHERE id = ?`,
      ),
      setUserMfa: this.db.prepare(`UPDATE users SET mfa_secret = ? WHERE id = ?`),
      enableUserMfa: this.db.prepare(`UPDATE users SET mfa_enabled = 1 WHERE id = ?`),
      disableUserMfa: this.db.prepare(
        `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?`,
      ),
      // Permission Policy statements (v0.5 Phase 4)
      insertPermissionPolicy: this.db.prepare(`
        INSERT INTO permission_policies (id, subject, action, resource, effect, created_at, created_by)
        VALUES (@id, @subject, @action, @resource, @effect, @created_at, @created_by)
      `),
      deletePermissionPolicy: this.db.prepare(`DELETE FROM permission_policies WHERE id = ?`),
      getPermissionPoliciesForSubject: this.db.prepare(
        `SELECT id, subject, action, resource, effect, created_at, created_by FROM permission_policies WHERE subject = ?`,
      ),
      getPermissionPoliciesForAction: this.db.prepare(
        `SELECT id, subject, action, resource, effect, created_at, created_by FROM permission_policies WHERE action = ?`,
      ),
      getAllPermissionPolicies: this.db.prepare(
        `SELECT id, subject, action, resource, effect, created_at, created_by FROM permission_policies ORDER BY created_at ASC`,
      ),
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

  getSnapshotsByPid(pid: PID): Array<{
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

  getSnapshotById(id: string):
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

  getUserById(id: string):
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

  getUserByUsername(username: string):
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
  // MFA (v0.5 Phase 3)
  // ---------------------------------------------------------------------------

  getUserMfa(id: string): { mfaSecret: string | null; mfaEnabled: number } | undefined {
    return this.stmts.getUserMfa.get(id) as any;
  }

  setUserMfaSecret(id: string, secret: string): void {
    this.stmts.setUserMfa.run(secret, id);
  }

  enableUserMfa(id: string): void {
    this.stmts.enableUserMfa.run(id);
  }

  disableUserMfa(id: string): void {
    this.stmts.disableUserMfa.run(id);
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

  // ---------------------------------------------------------------------------
  // Agent Reflections (v0.3 Wave 2)
  // ---------------------------------------------------------------------------

  insertReflection(record: {
    id: string;
    agent_uid: string;
    pid: number;
    goal: string;
    summary: string;
    quality_rating: number;
    justification: string;
    lessons_learned: string;
    created_at: number;
  }): void {
    this.stmts.insertReflection.run(record);
  }

  getReflectionsByAgent(agent_uid: string): any[] {
    return this.stmts.getReflectionsByAgent.all(agent_uid) as any[];
  }

  getReflectionsByPid(pid: number): any[] {
    return this.stmts.getReflectionsByPid.all(pid) as any[];
  }

  getReflection(id: string): any | undefined {
    return this.stmts.getReflection.get(id);
  }

  // ---------------------------------------------------------------------------
  // Agent Plans (v0.3 Wave 2)
  // ---------------------------------------------------------------------------

  insertPlan(record: {
    id: string;
    agent_uid: string;
    pid: number;
    goal: string;
    plan_tree: string;
    status: string;
    created_at: number;
    updated_at: number;
  }): void {
    this.stmts.insertPlan.run(record);
  }

  getPlan(id: string): any | undefined {
    return this.stmts.getPlan.get(id);
  }

  getActivePlanByPid(pid: number): any | undefined {
    return this.stmts.getActivePlanByPid.get(pid);
  }

  getPlansByAgent(agent_uid: string): any[] {
    return this.stmts.getPlansByAgent.all(agent_uid) as any[];
  }

  updatePlan(id: string, plan_tree: string, status: string): void {
    this.stmts.updatePlan.run({
      id,
      plan_tree,
      status,
      updated_at: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // Agent Feedback (v0.3 Wave 2)
  // ---------------------------------------------------------------------------

  insertFeedback(record: {
    id: string;
    pid: number;
    step: number;
    rating: number;
    comment: string | null;
    agent_uid: string;
    created_at: number;
  }): void {
    this.stmts.insertFeedback.run(record);
  }

  getFeedbackByPid(pid: number): any[] {
    return this.stmts.getFeedbackByPid.all(pid) as any[];
  }

  getFeedbackByAgent(agent_uid: string, limit: number = 50): any[] {
    return this.stmts.getFeedbackByAgent.all(agent_uid, limit) as any[];
  }

  getFeedback(id: string): any | undefined {
    return this.stmts.getFeedback.get(id);
  }

  // ---------------------------------------------------------------------------
  // Agent Profiles (v0.3 Wave 4)
  // ---------------------------------------------------------------------------

  upsertProfile(record: {
    agent_uid: string;
    display_name: string;
    total_tasks: number;
    successful_tasks: number;
    failed_tasks: number;
    success_rate: number;
    expertise: string;
    personality_traits: string;
    avg_quality_rating: number;
    total_steps: number;
    first_seen: number;
    last_active: number;
    updated_at: number;
  }): void {
    this.stmts.upsertProfile.run(record);
  }

  getProfile(agent_uid: string): any | undefined {
    return this.stmts.getProfile.get(agent_uid);
  }

  getAllProfiles(): any[] {
    return this.stmts.getAllProfiles.all() as any[];
  }

  // ---------------------------------------------------------------------------
  // Installed Apps (v0.4)
  // ---------------------------------------------------------------------------

  insertApp(record: {
    id: string;
    manifest: string;
    installed_at: number;
    updated_at: number;
    enabled: number;
    install_source: string | undefined;
    owner_uid: string | null;
  }): void {
    this.stmts.insertApp.run(record);
  }

  getApp(id: string): any | undefined {
    return this.stmts.getApp.get(id);
  }

  getAllApps(): any[] {
    return this.stmts.getAllApps.all() as any[];
  }

  deleteApp(id: string): void {
    this.stmts.deleteApp.run(id);
  }

  setAppEnabled(id: string, enabled: boolean): void {
    this.stmts.updateAppEnabled.run(enabled ? 1 : 0, id);
  }

  // ---------------------------------------------------------------------------
  // Webhooks (v0.4)
  // ---------------------------------------------------------------------------

  insertWebhook(record: {
    id: string;
    name: string;
    url: string;
    secret: string | null;
    events: string;
    filters: string | null;
    headers: string | null;
    enabled: number;
    owner_uid: string | null;
    retry_count: number;
    timeout_ms: number;
    created_at: number;
    last_triggered: number | null;
    failure_count: number;
  }): void {
    this.stmts.insertWebhook.run(record);
  }

  getWebhook(id: string): any | undefined {
    return this.stmts.getWebhook.get(id);
  }

  getAllWebhooks(): any[] {
    return this.stmts.getAllWebhooks.all() as any[];
  }

  getWebhooksByOwner(owner_uid: string): any[] {
    return this.stmts.getWebhooksByOwner.all(owner_uid) as any[];
  }

  getEnabledWebhooks(): any[] {
    return this.stmts.getEnabledWebhooks.all() as any[];
  }

  setWebhookEnabled(id: string, enabled: boolean): void {
    this.stmts.updateWebhookEnabled.run(enabled ? 1 : 0, id);
  }

  updateWebhookTriggered(id: string, now: number): void {
    this.stmts.updateWebhookTriggered.run(now, id);
  }

  incrementWebhookFailure(id: string): void {
    this.stmts.updateWebhookFailure.run(id);
  }

  deleteWebhook(id: string): void {
    this.stmts.deleteWebhook.run(id);
  }

  insertWebhookLog(record: {
    webhook_id: string;
    event_type: string;
    payload: string;
    status_code: number | null;
    response_body: string | null;
    duration_ms: number | null;
    success: number;
    created_at: number;
  }): void {
    this.stmts.insertWebhookLog.run(record);
  }

  getWebhookLogs(webhookId: string, limit: number = 50): any[] {
    return this.stmts.getWebhookLogs.all(webhookId, limit) as any[];
  }

  insertInboundWebhook(record: {
    id: string;
    name: string;
    token: string;
    agent_config: string;
    transform: string | null;
    enabled: number;
    owner_uid: string | null;
    last_triggered: number | null;
    trigger_count: number;
    created_at: number;
  }): void {
    this.stmts.insertInboundWebhook.run(record);
  }

  getInboundWebhook(id: string): any | undefined {
    return this.stmts.getInboundWebhook.get(id);
  }

  getInboundWebhookByToken(token: string): any | undefined {
    return this.stmts.getInboundWebhookByToken.get(token);
  }

  getAllInboundWebhooks(): any[] {
    return this.stmts.getAllInboundWebhooks.all() as any[];
  }

  getInboundWebhooksByOwner(owner_uid: string): any[] {
    return this.stmts.getInboundWebhooksByOwner.all(owner_uid) as any[];
  }

  updateInboundWebhookTriggered(id: string, now: number): void {
    this.stmts.updateInboundWebhookTriggered.run(now, id);
  }

  deleteInboundWebhook(id: string): void {
    this.stmts.deleteInboundWebhook.run(id);
  }

  // ---------------------------------------------------------------------------
  // Webhook DLQ (v0.5 Phase 3)
  // ---------------------------------------------------------------------------

  insertDlqEntry(record: {
    id: string;
    webhook_id: string;
    event_type: string;
    payload: string;
    error: string | null;
    attempts: number;
    created_at: number;
    retried_at: number | null;
  }): void {
    this.stmts.insertDlqEntry.run(record);
  }

  getDlqEntry(id: string): any | undefined {
    return this.stmts.getDlqEntry.get(id);
  }

  getDlqEntries(limit: number = 50, offset: number = 0): any[] {
    return this.stmts.getDlqEntries.all(limit, offset) as any[];
  }

  getDlqCount(): number {
    return (this.stmts.getDlqCount.get() as any).count;
  }

  deleteDlqEntry(id: string): boolean {
    const result = this.stmts.deleteDlqEntry.run(id);
    return result.changes > 0;
  }

  deleteAllDlqEntries(): number {
    const result = this.stmts.deleteAllDlqEntries.run();
    return result.changes;
  }

  updateDlqRetried(id: string, retriedAt: number): void {
    this.stmts.updateDlqRetried.run(retriedAt, id);
  }

  // ---------------------------------------------------------------------------
  // Plugin Registry (v0.4 Wave 2)
  // ---------------------------------------------------------------------------

  insertPlugin(record: {
    id: string;
    manifest: string;
    installed_at: number;
    updated_at: number;
    enabled: number;
    install_source: string;
    owner_uid: string | null;
    download_count: number;
    rating_avg: number;
    rating_count: number;
  }): void {
    this.stmts.insertPlugin.run(record);
  }

  getPlugin(id: string): any | undefined {
    return this.stmts.getPlugin.get(id);
  }

  getAllPlugins(): any[] {
    return this.stmts.getAllPlugins.all() as any[];
  }

  getPluginsByCategory(category: string): any[] {
    return this.stmts.getPluginsByCategory.all(category) as any[];
  }

  deletePlugin(id: string): void {
    this.stmts.deletePluginSettings.run(id);
    this.stmts.deletePlugin.run(id);
  }

  setPluginEnabled(id: string, enabled: boolean): void {
    this.stmts.updatePluginEnabled.run(enabled ? 1 : 0, Date.now(), id);
  }

  updatePluginRating(id: string, avg: number, count: number): void {
    this.stmts.updatePluginRating.run(avg, count, Date.now(), id);
  }

  insertPluginRating(record: {
    plugin_id: string;
    user_id: string;
    rating: number;
    review: string | null;
    created_at: number;
  }): void {
    this.stmts.insertPluginRating.run(record);
  }

  getPluginRatings(pluginId: string): any[] {
    return this.stmts.getPluginRatings.all(pluginId) as any[];
  }

  getPluginSetting(pluginId: string, key: string): string | undefined {
    const row = this.stmts.getPluginSetting.get(pluginId, key) as { value: string } | undefined;
    return row?.value;
  }

  setPluginSetting(pluginId: string, key: string, value: string): void {
    this.stmts.upsertPluginSetting.run(pluginId, key, value);
  }

  getPluginSettings(pluginId: string): Record<string, string> {
    const rows = this.stmts.getPluginSettings.all(pluginId) as Array<{
      key: string;
      value: string;
    }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Integrations (v0.4 Wave 2)
  // ---------------------------------------------------------------------------

  insertIntegration(record: {
    id: string;
    type: string;
    name: string;
    enabled: number;
    owner_uid: string | null;
    credentials: string | null;
    settings: string | null;
    status: string;
    last_error: string | null;
    created_at: number;
    updated_at: number;
  }): void {
    this.stmts.insertIntegration.run(record);
  }

  getIntegration(id: string): any | undefined {
    return this.stmts.getIntegration.get(id);
  }

  getAllIntegrations(): any[] {
    return this.stmts.getAllIntegrations.all() as any[];
  }

  deleteIntegration(id: string): void {
    this.stmts.deleteIntegration.run(id);
  }

  setIntegrationEnabled(id: string, enabled: boolean): void {
    this.stmts.updateIntegrationEnabled.run(enabled ? 1 : 0, Date.now(), id);
  }

  updateIntegrationSettings(id: string, settings: string): void {
    this.stmts.updateIntegrationSettings.run(settings, Date.now(), id);
  }

  updateIntegrationStatus(id: string, status: string, lastError: string | null): void {
    this.stmts.updateIntegrationStatus.run(status, lastError, Date.now(), id);
  }

  insertIntegrationLog(record: {
    integration_id: string;
    action: string;
    status: string;
    request_summary: string | null;
    response_summary: string | null;
    duration_ms: number;
    created_at: number;
  }): void {
    this.stmts.insertIntegrationLog.run(record);
  }

  getIntegrationLogs(integrationId: string, limit: number = 50): any[] {
    return this.stmts.getIntegrationLogs.all(integrationId, limit) as any[];
  }

  // ---------------------------------------------------------------------------
  // Template Marketplace (v0.4 Wave 2)
  // ---------------------------------------------------------------------------

  insertTemplate(record: {
    id: string;
    name: string;
    description: string;
    icon: string;
    category: string;
    config: string;
    suggested_goals: string;
    author: string;
    tags: string;
    download_count: number;
    rating_avg: number;
    rating_count: number;
    published_at: number;
    updated_at: number;
    enabled: number;
  }): void {
    this.stmts.insertTemplate.run(record);
  }

  getTemplate(id: string): any | undefined {
    return this.stmts.getTemplate.get(id);
  }

  getAllTemplates(): any[] {
    return this.stmts.getAllTemplates.all() as any[];
  }

  getTemplatesByCategory(category: string): any[] {
    return this.stmts.getTemplatesByCategory.all(category) as any[];
  }

  deleteTemplate(id: string): void {
    this.stmts.deleteTemplate.run(id);
  }

  updateTemplateRating(id: string, avg: number, count: number): void {
    this.stmts.updateTemplateRating.run(avg, count, Date.now(), id);
  }

  insertTemplateRating(record: {
    template_id: string;
    user_id: string;
    rating: number;
    review: string | null;
    created_at: number;
  }): void {
    this.stmts.insertTemplateRating.run(record);
  }

  incrementTemplateDownloads(id: string): void {
    this.stmts.updateTemplateDownloads.run(id);
  }

  // ---------------------------------------------------------------------------
  // Organizations (v0.5 RBAC)
  // ---------------------------------------------------------------------------

  insertOrg(record: {
    id: string;
    name: string;
    display_name: string;
    owner_uid: string;
    settings: string;
    created_at: number;
    updated_at: number;
  }): void {
    this.stmts.insertOrg.run(record);
  }

  getOrg(id: string): any | undefined {
    return this.stmts.getOrg.get(id);
  }

  getOrgByName(name: string): any | undefined {
    return this.stmts.getOrgByName.get(name);
  }

  getAllOrgs(): any[] {
    return this.stmts.getAllOrgs.all() as any[];
  }

  getOrgsByUser(userId: string): any[] {
    return this.stmts.getOrgsByUser.all(userId) as any[];
  }

  updateOrg(id: string, updates: { settings?: string; display_name?: string }): void {
    const existing = this.getOrg(id);
    if (!existing) return;
    this.stmts.updateOrg.run({
      id,
      settings: updates.settings ?? existing.settings,
      display_name: updates.display_name ?? existing.display_name,
      updated_at: Date.now(),
    });
  }

  deleteOrg(id: string): void {
    // Delete members and teams first
    this.db
      .prepare('DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE org_id = ?)')
      .run(id);
    this.db.prepare('DELETE FROM teams WHERE org_id = ?').run(id);
    this.db.prepare('DELETE FROM org_members WHERE org_id = ?').run(id);
    this.stmts.deleteOrg.run(id);
  }

  // Teams

  insertTeam(record: {
    id: string;
    org_id: string;
    name: string;
    description: string;
    created_at: number;
  }): void {
    this.stmts.insertTeam.run(record);
  }

  getTeam(id: string): any | undefined {
    return this.stmts.getTeam.get(id);
  }

  getTeamsByOrg(orgId: string): any[] {
    return this.stmts.getTeamsByOrg.all(orgId) as any[];
  }

  deleteTeam(id: string): void {
    this.db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
    this.stmts.deleteTeam.run(id);
  }

  // Org Members

  insertOrgMember(record: {
    id: string;
    org_id: string;
    user_id: string;
    role: string;
    joined_at: number;
  }): void {
    this.stmts.insertOrgMember.run(record);
  }

  getOrgMember(orgId: string, userId: string): any | undefined {
    return this.stmts.getOrgMember.get(orgId, userId);
  }

  getOrgMembers(orgId: string): any[] {
    return this.stmts.getOrgMembers.all(orgId) as any[];
  }

  updateOrgMemberRole(orgId: string, userId: string, role: string): void {
    this.stmts.updateOrgMemberRole.run(role, orgId, userId);
  }

  deleteOrgMember(orgId: string, userId: string): void {
    this.stmts.deleteOrgMember.run(orgId, userId);
  }

  // Team Members

  insertTeamMember(record: {
    id: string;
    team_id: string;
    user_id: string;
    role: string;
    joined_at: number;
  }): void {
    this.stmts.insertTeamMember.run(record);
  }

  getTeamMember(teamId: string, userId: string): any | undefined {
    return this.stmts.getTeamMember.get(teamId, userId);
  }

  getTeamMembers(teamId: string): any[] {
    return this.stmts.getTeamMembers.all(teamId) as any[];
  }

  deleteTeamMember(teamId: string, userId: string): void {
    this.stmts.deleteTeamMember.run(teamId, userId);
  }

  // ---------------------------------------------------------------------------
  // Skills (v0.4 — Lightweight Skill Format)
  // ---------------------------------------------------------------------------

  private _skillStmts?: {
    upsertSkill: Database.Statement;
    getSkill: Database.Statement;
    getAllSkills: Database.Statement;
    deleteSkill: Database.Statement;
  };

  /**
   * Create the skills table if it doesn't exist. Called by SkillManager.init().
   */
  ensureSkillsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        author TEXT DEFAULT '',
        category TEXT DEFAULT '',
        tags TEXT DEFAULT '[]',
        definition TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
    `);
    this._skillStmts = {
      upsertSkill: this.db.prepare(`
        INSERT OR REPLACE INTO skills (id, name, version, description, author, category, tags, definition, created_at)
        VALUES (@id, @name, @version, @description, @author, @category, @tags, @definition, @created_at)
      `),
      getSkill: this.db.prepare(`
        SELECT id, name, version, description, author, category, tags, definition, created_at
        FROM skills WHERE id = ?
      `),
      getAllSkills: this.db.prepare(`
        SELECT id, name, version, description, author, category, tags, definition, created_at
        FROM skills ORDER BY created_at ASC
      `),
      deleteSkill: this.db.prepare(`DELETE FROM skills WHERE id = ?`),
    };
  }

  upsertSkill(record: {
    id: string;
    name: string;
    version: string;
    description: string;
    author: string;
    category: string;
    tags: string;
    definition: string;
    created_at: number;
  }): void {
    this._skillStmts!.upsertSkill.run(record);
  }

  getSkill(id: string): any {
    return this._skillStmts!.getSkill.get(id);
  }

  getAllSkills(): any[] {
    return this._skillStmts!.getAllSkills.all() as any[];
  }

  deleteSkill(id: string): void {
    this._skillStmts!.deleteSkill.run(id);
  }

  /** Expose the underlying database for direct queries (used by MemoryManager for FTS5) */
  getDatabase(): Database.Database {
    return this.db;
  }

  // ---------------------------------------------------------------------------
  // Generic KV Store
  // ---------------------------------------------------------------------------

  getKV(key: string): string | null {
    const row = this.stmts.getKV.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setKV(key: string, value: string): void {
    this.stmts.setKV.run(key, value, Date.now());
  }

  deleteKV(key: string): void {
    this.stmts.deleteKV.run(key);
  }

  // ---------------------------------------------------------------------------
  // Audit Log (v0.5)
  // ---------------------------------------------------------------------------

  insertAuditLog(entry: {
    timestamp: number;
    event_type: string;
    actor_pid: number | null;
    actor_uid: string | null;
    action: string;
    target: string | null;
    args_sanitized: string | null;
    result_hash: string | null;
    metadata: string | null;
  }): void {
    this.stmts.insertAuditLog.run(entry);
  }

  queryAuditLog(
    filters: {
      pid?: number;
      uid?: string;
      action?: string;
      event_type?: string;
      startTime?: number;
      endTime?: number;
    },
    limit: number,
    offset: number,
  ): { entries: any[]; total: number } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.pid !== undefined) {
      conditions.push('actor_pid = ?');
      params.push(filters.pid);
    }
    if (filters.uid !== undefined) {
      conditions.push('actor_uid = ?');
      params.push(filters.uid);
    }
    if (filters.action !== undefined) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters.event_type !== undefined) {
      conditions.push('event_type = ?');
      params.push(filters.event_type);
    }
    if (filters.startTime !== undefined) {
      conditions.push('timestamp >= ?');
      params.push(filters.startTime);
    }
    if (filters.endTime !== undefined) {
      conditions.push('timestamp <= ?');
      params.push(filters.endTime);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) as count FROM audit_log ${where}`)
      .get(...params) as { count: number };
    const total = countRow.count;

    const entries = this.db
      .prepare(
        `SELECT id, timestamp, event_type, actor_pid, actor_uid, action, target, args_sanitized, result_hash, metadata, created_at
         FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset);

    return { entries, total };
  }

  pruneAuditLog(cutoffTimestamp: number): number {
    const result = this.stmts.pruneAuditLog.run(cutoffTimestamp);
    return result.changes;
  }

  // ---------------------------------------------------------------------------
  // Permission Policies (v0.5 Phase 4)
  // ---------------------------------------------------------------------------

  insertPermissionPolicy(record: {
    id: string;
    subject: string;
    action: string;
    resource: string;
    effect: string;
    created_at: number;
    created_by: string | null;
  }): void {
    this.stmts.insertPermissionPolicy.run(record);
  }

  deletePermissionPolicy(id: string): boolean {
    const result = this.stmts.deletePermissionPolicy.run(id);
    return result.changes > 0;
  }

  getPermissionPoliciesForSubject(subject: string): any[] {
    return this.stmts.getPermissionPoliciesForSubject.all(subject) as any[];
  }

  getPermissionPoliciesForAction(action: string): any[] {
    return this.stmts.getPermissionPoliciesForAction.all(action) as any[];
  }

  getAllPermissionPolicies(): any[] {
    return this.stmts.getAllPermissionPolicies.all() as any[];
  }

  // ---------------------------------------------------------------------------
  // Imported Tools (v0.5 Phase 4 — Tool Compatibility Layer)
  // ---------------------------------------------------------------------------

  private _importedToolStmts?: {
    upsertImportedTool: Database.Statement;
    getImportedTool: Database.Statement;
    getAllImportedTools: Database.Statement;
    deleteImportedTool: Database.Statement;
  };

  /**
   * Create the imported_tools table if it doesn't exist.
   * Called by ToolCompatLayer.init().
   */
  ensureImportedToolsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS imported_tools (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        parameters TEXT NOT NULL DEFAULT '{}',
        source_format TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    this._importedToolStmts = {
      upsertImportedTool: this.db.prepare(`
        INSERT OR REPLACE INTO imported_tools (id, name, description, parameters, source_format, created_at)
        VALUES (@id, @name, @description, @parameters, @source_format, @created_at)
      `),
      getImportedTool: this.db.prepare(`
        SELECT id, name, description, parameters, source_format, created_at
        FROM imported_tools WHERE name = ?
      `),
      getAllImportedTools: this.db.prepare(`
        SELECT id, name, description, parameters, source_format, created_at
        FROM imported_tools ORDER BY created_at ASC
      `),
      deleteImportedTool: this.db.prepare(`DELETE FROM imported_tools WHERE name = ?`),
    };
  }

  upsertImportedTool(record: {
    id: string;
    name: string;
    description: string;
    parameters: string;
    source_format: string;
    created_at: number;
  }): void {
    this._importedToolStmts!.upsertImportedTool.run(record);
  }

  getImportedTool(name: string): any {
    return this._importedToolStmts!.getImportedTool.get(name);
  }

  getAllImportedTools(): any[] {
    return this._importedToolStmts!.getAllImportedTools.all() as any[];
  }

  deleteImportedTool(name: string): void {
    this._importedToolStmts!.deleteImportedTool.run(name);
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
