/**
 * Aether OS - Kernel Protocol
 *
 * This defines the message protocol between the UI (window system) and the
 * kernel (backend server). All communication happens over WebSocket using
 * JSON-encoded messages.
 *
 * Design principles:
 * - Unix-inspired: processes, file descriptors, signals
 * - Event-driven: kernel emits events, UI sends commands
 * - Typed: every message has a discriminated union type
 * - Stateless messages: each message is self-contained
 */

// ---------------------------------------------------------------------------
// Core Primitives
// ---------------------------------------------------------------------------

/** Process ID - unique identifier for a running process */
export type PID = number;

/** Branded type for auth tokens */
export type AuthToken = string & { readonly __brand: 'AuthToken' };

/** File descriptor number */
export type FD = number;

/** Unix-style signal */
export type Signal =
  | 'SIGTERM'
  | 'SIGKILL'
  | 'SIGSTOP'
  | 'SIGCONT'
  | 'SIGINT'
  | 'SIGUSR1'
  | 'SIGUSR2';

/** Process states following Unix conventions */
export type ProcessState =
  | 'created' // Process object exists, not yet started
  | 'running' // Actively executing
  | 'sleeping' // Waiting for I/O or event
  | 'stopped' // Paused by signal (SIGSTOP)
  | 'paused' // Agent paused for human takeover
  | 'zombie' // Terminated but not yet reaped
  | 'dead'; // Fully cleaned up

/** Agent-specific states layered on top of process states */
export type AgentPhase =
  | 'booting' // Initializing sandbox and tools
  | 'thinking' // LLM is reasoning
  | 'executing' // Running a tool/command
  | 'waiting' // Waiting for human approval
  | 'observing' // Reading tool output
  | 'idle' // Waiting for next task
  | 'completed' // Goal achieved
  | 'failed'; // Unrecoverable error

/** File types in the virtual filesystem */
export type FileType = 'file' | 'directory' | 'symlink' | 'pipe' | 'device';

/** Permission mode (simplified Unix permissions) */
export interface FileMode {
  owner: { read: boolean; write: boolean; execute: boolean };
  group: { read: boolean; write: boolean; execute: boolean };
  other: { read: boolean; write: boolean; execute: boolean };
}

// ---------------------------------------------------------------------------
// User & Auth Types
// ---------------------------------------------------------------------------

export interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
  mfaEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// RBAC & Organization Types (v0.5)
// ---------------------------------------------------------------------------

/** Fine-grained permissions for org-level RBAC */
export type Permission =
  | 'org.manage'
  | 'org.delete'
  | 'org.view'
  | 'org.settings'
  | 'members.invite'
  | 'members.remove'
  | 'members.update'
  | 'members.view'
  | 'teams.create'
  | 'teams.delete'
  | 'teams.manage'
  | 'teams.view'
  | 'agents.spawn'
  | 'agents.kill'
  | 'agents.view'
  | 'fs.read'
  | 'fs.write'
  | 'fs.delete'
  | 'cron.create'
  | 'cron.delete'
  | 'cron.view'
  | 'webhooks.manage'
  | 'webhooks.view'
  | 'integrations.manage'
  | 'integrations.view'
  | 'plugins.manage'
  | 'plugins.view';

/** Organization roles (hierarchical) */
export type OrgRole = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

/** Team roles */
export type TeamRole = 'lead' | 'member';

/** Permissions granted to each org role */
export const ROLE_PERMISSIONS: Record<OrgRole, Permission[]> = {
  owner: [
    'org.manage',
    'org.delete',
    'org.view',
    'org.settings',
    'members.invite',
    'members.remove',
    'members.update',
    'members.view',
    'teams.create',
    'teams.delete',
    'teams.manage',
    'teams.view',
    'agents.spawn',
    'agents.kill',
    'agents.view',
    'fs.read',
    'fs.write',
    'fs.delete',
    'cron.create',
    'cron.delete',
    'cron.view',
    'webhooks.manage',
    'webhooks.view',
    'integrations.manage',
    'integrations.view',
    'plugins.manage',
    'plugins.view',
  ],
  admin: [
    'org.manage',
    'org.view',
    'org.settings',
    'members.invite',
    'members.remove',
    'members.update',
    'members.view',
    'teams.create',
    'teams.delete',
    'teams.manage',
    'teams.view',
    'agents.spawn',
    'agents.kill',
    'agents.view',
    'fs.read',
    'fs.write',
    'fs.delete',
    'cron.create',
    'cron.delete',
    'cron.view',
    'webhooks.manage',
    'webhooks.view',
    'integrations.manage',
    'integrations.view',
    'plugins.manage',
    'plugins.view',
  ],
  manager: [
    'org.view',
    'members.invite',
    'members.view',
    'teams.create',
    'teams.manage',
    'teams.view',
    'agents.spawn',
    'agents.kill',
    'agents.view',
    'fs.read',
    'fs.write',
    'cron.create',
    'cron.view',
    'webhooks.view',
    'integrations.view',
    'plugins.view',
  ],
  member: [
    'org.view',
    'members.view',
    'teams.view',
    'agents.spawn',
    'agents.view',
    'fs.read',
    'fs.write',
    'cron.view',
    'webhooks.view',
    'integrations.view',
    'plugins.view',
  ],
  viewer: [
    'org.view',
    'members.view',
    'teams.view',
    'agents.view',
    'fs.read',
    'cron.view',
    'webhooks.view',
    'integrations.view',
    'plugins.view',
  ],
};

// ---------------------------------------------------------------------------
// Fine-grained Permission Policy (v0.5 Phase 4)
// ---------------------------------------------------------------------------

export interface PermissionPolicy {
  id: string;
  subject: string; // userId or roleId (e.g., 'user:abc123' or 'role:member')
  action: string; // e.g., 'tool.run_command.execute', 'llm.gemini.use', 'fs./home/agent_1.read'
  resource: string; // the resource path/name being controlled
  effect: 'allow' | 'deny';
  created_at: number;
  created_by?: string; // userId who created this policy
}

export interface Organization {
  id: string;
  name: string;
  displayName: string;
  ownerUid: string;
  settings: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface Team {
  id: string;
  orgId: string;
  name: string;
  description: string;
  createdAt: number;
}

export interface OrgMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  joinedAt: number;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: number;
}

// ---------------------------------------------------------------------------
// Process Types
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: PID;
  ppid: PID; // Parent process ID (0 = init)
  uid: string; // Owner (agent ID or 'root')
  ownerUid?: string; // User who spawned the agent
  name: string; // Process name
  command: string; // Full command string
  state: ProcessState;
  agentPhase?: AgentPhase; // Only for agent processes
  cwd: string; // Current working directory
  env: Record<string, string>;
  createdAt: number; // Unix timestamp ms
  priority: number; // 1-5, default 3 (1 = highest)
  cpuPercent: number; // 0-100
  memoryMB: number; // Memory usage in MB
  ttyId?: string; // Attached terminal ID
  containerId?: string; // Docker container ID (if sandboxed)
  containerStatus?: ContainerStatus;
}

export interface AgentConfig {
  role: string; // Agent role (Researcher, Coder, etc.)
  goal: string; // Primary directive
  model?: string; // LLM model to use
  tools?: string[]; // Allowed tools
  maxSteps?: number; // Max autonomous steps before pause
  priority?: number; // 1-5, default 3 (1 = highest)
  sandbox?: SandboxConfig;
}

export interface SandboxConfig {
  type: 'process' | 'container' | 'vm';
  memoryLimitMB?: number;
  cpuLimit?: number; // 0.0 - 1.0
  networkAccess?: boolean;
  allowedPaths?: string[]; // Filesystem paths the agent can access
  timeout?: number; // Max runtime in seconds
  image?: string; // Docker image to use
  graphical?: boolean; // Enable Xvfb + x11vnc for graphical apps
  gpu?: GPUConfig; // GPU passthrough configuration
}

export interface GPUConfig {
  enabled: boolean;
  count?: number; // Number of GPUs to allocate
  deviceIds?: string[]; // Specific GPU device IDs (e.g. ['0', '1'])
}

// ---------------------------------------------------------------------------
// Container Types
// ---------------------------------------------------------------------------

export type ContainerStatus = 'creating' | 'running' | 'paused' | 'stopped' | 'removing' | 'dead';

export interface ContainerInfo {
  containerId: string;
  pid: PID;
  image: string;
  status: ContainerStatus;
  mountedVolume: string; // Host path of mounted volume
  networkEnabled: boolean;
  memoryLimitMB: number;
  cpuLimit: number;
  createdAt: number;
  vncPort?: number; // Host-side VNC port (if graphical)
  gpuIds?: number[]; // Assigned GPU device IDs
}

// ---------------------------------------------------------------------------
// IPC Types
// ---------------------------------------------------------------------------

export interface IPCMessage {
  id: string;
  fromPid: PID;
  toPid: PID;
  fromUid: string;
  toUid: string;
  channel: string; // Message channel/topic
  payload: any; // Message content
  timestamp: number;
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// Filesystem Types
// ---------------------------------------------------------------------------

export interface FileStat {
  path: string;
  name: string;
  type: FileType;
  size: number; // Bytes
  mode: FileMode;
  uid: string; // Owner
  createdAt: number;
  modifiedAt: number;
  isHidden: boolean;
}

export interface FileContent {
  path: string;
  content: string; // UTF-8 text content
  encoding: 'utf-8' | 'base64';
  size: number;
}

// ---------------------------------------------------------------------------
// Terminal Types
// ---------------------------------------------------------------------------

export interface TerminalInfo {
  id: string;
  pid: PID; // Attached process
  cols: number;
  rows: number;
  title: string;
}

// ---------------------------------------------------------------------------
// Persistence Types
// ---------------------------------------------------------------------------

export interface ProcessRecord {
  pid: PID;
  uid: string;
  name: string;
  role: string;
  goal: string;
  state: ProcessState;
  agentPhase?: AgentPhase;
  exitCode?: number;
  createdAt: number;
  exitedAt?: number;
}

export interface AgentLogEntry {
  id?: number;
  pid: PID;
  step: number;
  phase: string; // 'thought' | 'action' | 'observation'
  tool?: string;
  content: string;
  timestamp: number;
}

export interface FileMetadataRecord {
  path: string;
  ownerUid: string;
  size: number;
  fileType: FileType;
  createdAt: number;
  modifiedAt: number;
}

export interface KernelMetricRecord {
  timestamp: number;
  processCount: number;
  cpuPercent: number;
  memoryMB: number;
  containerCount: number;
}

// ---------------------------------------------------------------------------
// Memory Types (v0.3 Wave 1)
// ---------------------------------------------------------------------------

/** Memory layers following cognitive architecture */
export type MemoryLayer = 'episodic' | 'semantic' | 'procedural' | 'social';

export interface MemoryRecord {
  id: string; // UUID
  agent_uid: string; // Owner agent
  layer: MemoryLayer;
  content: string; // The memory content
  tags: string[]; // Searchable tags
  importance: number; // 0.0 - 1.0
  access_count: number;
  created_at: number; // Unix timestamp ms
  last_accessed: number; // Unix timestamp ms
  expires_at?: number; // Optional expiration
  source_pid?: number; // PID that created this memory
  related_memories?: string[]; // IDs of related memories
}

export interface MemoryQuery {
  query?: string; // FTS5 search query
  layer?: MemoryLayer;
  tags?: string[];
  agent_uid: string;
  limit?: number;
  min_importance?: number;
}

export interface MemoryStoreRequest {
  agent_uid: string;
  layer: MemoryLayer;
  content: string;
  tags?: string[];
  importance?: number;
  source_pid?: number;
  expires_at?: number;
  related_memories?: string[];
}

// ---------------------------------------------------------------------------
// Cron & Scheduling Types (v0.3 Wave 1)
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string; // UUID
  name: string;
  cron_expression: string; // 5-field: min hour dom month dow
  agent_config: AgentConfig; // Full config for spawned agent
  enabled: boolean;
  owner_uid: string;
  last_run?: number;
  next_run: number;
  run_count: number;
  created_at: number;
}

export interface EventTrigger {
  id: string; // UUID
  name: string;
  event_type: string; // Event bus event type to match
  event_filter?: Record<string, any>; // Optional filter on event data
  agent_config: AgentConfig;
  enabled: boolean;
  owner_uid: string;
  cooldown_ms: number; // Minimum time between firings (default 60000)
  last_fired?: number;
  fire_count: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Reflection Types (v0.3 Wave 2)
// ---------------------------------------------------------------------------

export interface ReflectionRecord {
  id: string; // UUID
  agent_uid: string;
  pid: number; // Process that triggered reflection
  goal: string; // The original goal
  summary: string; // What the agent did
  quality_rating: number; // 1-5 scale
  justification: string; // Why the agent gave this rating
  lessons_learned: string; // What to do differently
  created_at: number; // Unix timestamp ms
}

// ---------------------------------------------------------------------------
// Plan Types (v0.3 Wave 2)
// ---------------------------------------------------------------------------

export type PlanNodeStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped';

export interface PlanNode {
  id: string; // UUID
  title: string;
  description?: string;
  status: PlanNodeStatus;
  estimated_steps: number; // Agent's guess
  actual_steps: number; // Tracked during execution
  children: PlanNode[];
}

export interface PlanRecord {
  id: string; // UUID
  agent_uid: string;
  pid: number;
  goal: string;
  root_nodes: PlanNode[];
  status: 'active' | 'completed' | 'abandoned';
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Feedback Types (v0.3 Wave 2)
// ---------------------------------------------------------------------------

export interface FeedbackRecord {
  id: string; // UUID
  pid: number; // Process ID
  step: number; // Step number within the process
  rating: 1 | -1; // Thumbs up (+1) or down (-1)
  comment?: string; // Optional text (typically for negative feedback)
  agent_uid: string;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Agent Profile Types (v0.3 Wave 4)
// ---------------------------------------------------------------------------

export interface AgentProfile {
  agent_uid: string; // Primary key
  display_name: string; // Human-readable name
  total_tasks: number; // Total tasks attempted
  successful_tasks: number; // Tasks completed successfully
  failed_tasks: number; // Tasks that failed
  success_rate: number; // 0.0 - 1.0
  expertise: string[]; // Auto-detected areas of expertise (from tags/goals)
  personality_traits: string[]; // Inferred from behavior patterns
  avg_quality_rating: number; // Average reflection quality score (1-5)
  total_steps: number; // Total steps taken across all tasks
  first_seen: number; // Unix timestamp ms
  last_active: number; // Unix timestamp ms
  updated_at: number; // Unix timestamp ms
}

// ---------------------------------------------------------------------------
// App Framework Types (v0.4)
// ---------------------------------------------------------------------------

export type AppPermission =
  | 'filesystem'
  | 'filesystem:read'
  | 'network'
  | 'agents'
  | 'agents:read'
  | 'notifications'
  | 'system'
  | 'ipc'
  | 'memory'
  | 'cron';

export interface AetherAppManifest {
  id: string; // reverse-domain: "com.example.myapp"
  name: string;
  version: string;
  author: string;
  description: string;
  icon: string; // lucide-react icon name
  permissions: AppPermission[];
  entry: string;
  min_aether_version?: string;
  category?:
    | 'productivity'
    | 'development'
    | 'communication'
    | 'utilities'
    | 'monitoring'
    | 'entertainment'
    | 'ai'
    | 'other';
  keywords?: string[];
  screenshots?: string[];
  repository?: string;
}

export interface InstalledApp {
  id: string;
  manifest: AetherAppManifest;
  installed_at: number;
  updated_at: number;
  enabled: boolean;
  install_source: 'local' | 'registry' | 'url';
  owner_uid?: string;
}

// ---------------------------------------------------------------------------
// Plugin Registry Types (v0.4 Wave 2)
// ---------------------------------------------------------------------------

export type PluginCategory =
  | 'tools'
  | 'llm-providers'
  | 'data-sources'
  | 'notification-channels'
  | 'auth-providers'
  | 'themes'
  | 'widgets';

export interface PluginSettingSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  default?: any;
  options?: string[];
  description?: string;
}

export interface PluginRegistryManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: PluginCategory;
  icon: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, { type: string; description: string; required?: boolean }>;
  }>;
  dependencies?: string[];
  settings?: PluginSettingSchema[];
  events?: string[];
  min_aether_version?: string;
  keywords?: string[];
  repository?: string;
}

export interface RegisteredPlugin {
  id: string;
  manifest: PluginRegistryManifest;
  installed_at: number;
  updated_at: number;
  enabled: boolean;
  install_source: 'local' | 'registry' | 'url';
  owner_uid?: string;
  download_count: number;
  rating_avg: number;
  rating_count: number;
}

// ---------------------------------------------------------------------------
// Integration Types (v0.4 Wave 2)
// ---------------------------------------------------------------------------

export type IntegrationType = 'github' | 'gitlab' | 'slack' | 'jira' | 'linear' | 'custom';

export interface IntegrationActionDef {
  name: string;
  description: string;
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface IntegrationConfig {
  type: IntegrationType;
  name: string;
  credentials?: Record<string, string>;
  settings?: Record<string, any>;
  event_subscriptions?: string[];
}

export interface IntegrationInfo {
  id: string;
  type: IntegrationType;
  name: string;
  enabled: boolean;
  owner_uid?: string;
  created_at: number;
  updated_at: number;
  settings?: Record<string, any>;
  available_actions: IntegrationActionDef[];
  status: 'connected' | 'disconnected' | 'error';
  last_error?: string;
}

export interface IntegrationLogEntry {
  id: number;
  integration_id: string;
  action: string;
  status: 'success' | 'error';
  request_summary?: string;
  response_summary?: string;
  duration_ms: number;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Template Marketplace Types (v0.4 Wave 2)
// ---------------------------------------------------------------------------

export interface TemplateMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'development' | 'research' | 'data' | 'creative' | 'ops';
  config: Partial<AgentConfig>;
  suggestedGoals: string[];
  author: string;
  tags: string[];
  download_count: number;
  rating_avg: number;
  rating_count: number;
  published_at: number;
  updated_at: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Snapshot Types
// ---------------------------------------------------------------------------

export interface SnapshotInfo {
  id: string;
  pid: PID;
  timestamp: number;
  size: number;
  description: string;
}

export interface SnapshotManifest {
  version: number; // 1
  snapshotId: string;
  pid: PID;
  uid: string;
  timestamp: number;
  description: string;
  processState: { state: string; phase: string; config: any; metrics: any };
  memories: Array<{ key: string; value: string; layer: string; metadata?: any }>;
  planState?: any;
  resourceUsage?: { tokensUsed: number; costUsd: number; quotaRemaining: number };
  fsHash: string; // SHA-256 of tarball for integrity
  fsSize: number; // bytes
}

// ---------------------------------------------------------------------------
// VNC Types
// ---------------------------------------------------------------------------

export interface VNCInfo {
  pid: PID;
  wsPort: number;
  display: string;
}

// ---------------------------------------------------------------------------
// GPU Types
// ---------------------------------------------------------------------------

export interface GPUInfo {
  id: number;
  name: string;
  memoryTotal: number; // MB
  memoryFree: number; // MB
  utilization: number; // 0-100 percent
}

export interface GPUStats extends GPUInfo {
  temperature: number; // Celsius
  powerUsage: number; // Watts
}

export interface GPUAllocation {
  pid: PID;
  gpuIds: number[];
}

// ---------------------------------------------------------------------------
// Browser Types
// ---------------------------------------------------------------------------

export interface BrowserPageInfo {
  url: string;
  title: string;
  favicon?: string;
  isLoading: boolean;
}

export interface BrowserSessionOptions {
  width?: number;
  height?: number;
}

export interface DOMElement {
  tag: string;
  text?: string;
  href?: string;
  type?: string;
  name?: string;
  value?: string;
  role?: string;
  ariaLabel?: string;
  children?: DOMElement[];
}

export interface DOMSnapshot {
  url: string;
  title: string;
  elements: DOMElement[];
}

// ---------------------------------------------------------------------------
// Shared Filesystem Types
// ---------------------------------------------------------------------------

export interface SharedMountInfo {
  name: string;
  path: string;
  ownerPid: PID;
  mountedBy: PID[];
}

// ---------------------------------------------------------------------------
// Cluster Types
// ---------------------------------------------------------------------------

export type NodeStatus = 'online' | 'offline' | 'draining';

export interface NodeInfo {
  id: string;
  host: string;
  port: number;
  capacity: number;
  load: number;
  gpuAvailable: boolean;
  dockerAvailable: boolean;
  status: NodeStatus;
  lastHeartbeat?: number;
}

export type ClusterRole = 'hub' | 'node' | 'standalone';

export interface ClusterInfo {
  role: ClusterRole;
  hubUrl?: string;
  nodes: NodeInfo[];
  totalCapacity: number;
  totalLoad: number;
}

// ---------------------------------------------------------------------------
// Model Router Types (v0.5 Phase 2)
// ---------------------------------------------------------------------------

/** Model family tiers for smart routing */
export type ModelFamily = 'flash' | 'standard' | 'frontier';

/** A rule that maps tool patterns / step thresholds to a model family */
export interface ModelRoutingRule {
  pattern: string;
  tools?: string[];
  maxSteps?: number;
  family: ModelFamily;
}

/** Configuration for the ModelRouter */
export interface ModelRouterConfig {
  rules: ModelRoutingRule[];
  defaultFamily: ModelFamily;
}

/** Context passed to the model router for routing decisions */
export interface ModelRoutingContext {
  goal?: string;
  tools: string[];
  stepCount: number;
  maxSteps: number;
}

// ---------------------------------------------------------------------------
// Queued Spawn Request (v0.5 Phase 2)
// ---------------------------------------------------------------------------

export interface QueuedSpawnRequest {
  config: AgentConfig;
  ppid: PID;
  ownerUid?: string;
  priority: number;
  queuedAt: number;
}

// ---------------------------------------------------------------------------
// UI -> Kernel Commands (what the frontend sends)
// ---------------------------------------------------------------------------

export type KernelCommand =
  // Process management
  | { type: 'process.spawn'; id: string; config: AgentConfig }
  | { type: 'process.signal'; id: string; pid: PID; signal: Signal }
  | { type: 'process.list'; id: string }
  | { type: 'process.info'; id: string; pid: PID }
  | { type: 'process.approve'; id: string; pid: PID }
  | { type: 'process.reject'; id: string; pid: PID; reason?: string }
  | { type: 'process.setPriority'; id: string; pid: PID; priority: number }
  | { type: 'process.getQueue'; id: string }

  // Filesystem operations
  | { type: 'fs.read'; id: string; path: string }
  | { type: 'fs.write'; id: string; path: string; content: string }
  | { type: 'fs.mkdir'; id: string; path: string; recursive?: boolean }
  | { type: 'fs.rm'; id: string; path: string; recursive?: boolean }
  | { type: 'fs.ls'; id: string; path: string }
  | { type: 'fs.stat'; id: string; path: string }
  | { type: 'fs.mv'; id: string; from: string; to: string }
  | { type: 'fs.cp'; id: string; from: string; to: string }
  | { type: 'fs.watch'; id: string; path: string }
  | { type: 'fs.unwatch'; id: string; path: string }

  // Terminal operations
  | { type: 'tty.open'; id: string; pid: PID; cols?: number; rows?: number }
  | { type: 'tty.input'; id: string; ttyId: string; data: string }
  | { type: 'tty.resize'; id: string; ttyId: string; cols: number; rows: number }
  | { type: 'tty.close'; id: string; ttyId: string }

  // IPC
  | { type: 'ipc.send'; id: string; fromPid: PID; toPid: PID; channel: string; payload: any }
  | { type: 'ipc.list_agents'; id: string }

  // Plugins
  | { type: 'plugins.list'; id: string; pid: PID }

  // Snapshots
  | { type: 'snapshot.create'; id: string; pid: PID; description?: string }
  | { type: 'snapshot.list'; id: string; pid?: PID }
  | { type: 'snapshot.restore'; id: string; snapshotId: string }
  | { type: 'snapshot.delete'; id: string; snapshotId: string }

  // Shared Filesystem
  | { type: 'fs.createShared'; id: string; name: string; ownerPid: PID }
  | { type: 'fs.mountShared'; id: string; pid: PID; name: string; mountPoint?: string }
  | { type: 'fs.unmountShared'; id: string; pid: PID; name: string }
  | { type: 'fs.listShared'; id: string }

  // VNC
  | { type: 'vnc.info'; id: string; pid: PID }
  | { type: 'vnc.exec'; id: string; pid: PID; command: string }

  // GPU
  | { type: 'gpu.list'; id: string }
  | { type: 'gpu.stats'; id: string }

  // Authentication
  | { type: 'auth.login'; id: string; username: string; password: string }
  | { type: 'auth.register'; id: string; username: string; password: string; displayName?: string }
  | { type: 'auth.validate'; id: string; token: string }
  | { type: 'user.list'; id: string }
  | { type: 'user.delete'; id: string; userId: string }

  // Cluster
  | { type: 'cluster.status'; id: string }
  | { type: 'cluster.nodes'; id: string }
  | { type: 'cluster.drain'; id: string; nodeId: string }

  // Browser
  | { type: 'browser:create'; id: string; sessionId: string; options?: BrowserSessionOptions }
  | { type: 'browser:navigate'; id: string; sessionId: string; url: string }
  | {
      type: 'browser:click';
      id: string;
      sessionId: string;
      x: number;
      y: number;
      button?: 'left' | 'right';
    }
  | { type: 'browser:type'; id: string; sessionId: string; text: string }
  | { type: 'browser:keypress'; id: string; sessionId: string; key: string }
  | { type: 'browser:scroll'; id: string; sessionId: string; deltaX: number; deltaY: number }
  | { type: 'browser:screenshot'; id: string; sessionId: string }
  | { type: 'browser:destroy'; id: string; sessionId: string }
  | { type: 'browser:screencast_start'; id: string; sessionId: string; fps?: number }
  | { type: 'browser:screencast_stop'; id: string; sessionId: string }
  | { type: 'browser:back'; id: string; sessionId: string }
  | { type: 'browser:forward'; id: string; sessionId: string }
  | { type: 'browser:reload'; id: string; sessionId: string }
  | { type: 'browser:dom_snapshot'; id: string; sessionId: string }

  // Memory (v0.3)
  | { type: 'memory.store'; id: string; memory: MemoryStoreRequest }
  | { type: 'memory.recall'; id: string; query: MemoryQuery }
  | { type: 'memory.forget'; id: string; memoryId: string; agent_uid: string }
  | { type: 'memory.share'; id: string; memoryId: string; from_uid: string; to_uid: string }
  | { type: 'memory.list'; id: string; agent_uid: string; layer?: MemoryLayer }
  | { type: 'memory.consolidate'; id: string; agent_uid: string }

  // Cron & Triggers (v0.3)
  | {
      type: 'cron.create';
      id: string;
      name: string;
      cron_expression: string;
      agent_config: AgentConfig;
      owner_uid: string;
    }
  | { type: 'cron.delete'; id: string; jobId: string }
  | { type: 'cron.enable'; id: string; jobId: string }
  | { type: 'cron.disable'; id: string; jobId: string }
  | { type: 'cron.list'; id: string }
  | {
      type: 'trigger.create';
      id: string;
      name: string;
      event_type: string;
      agent_config: AgentConfig;
      owner_uid: string;
      cooldown_ms?: number;
      event_filter?: Record<string, any>;
    }
  | { type: 'trigger.delete'; id: string; triggerId: string }
  | { type: 'trigger.list'; id: string }

  // Plan (v0.3 Wave 2)
  | {
      type: 'plan.create';
      id: string;
      pid: number;
      agent_uid: string;
      goal: string;
      root_nodes: PlanNode[];
    }
  | {
      type: 'plan.update';
      id: string;
      plan_id: string;
      updates: Partial<Pick<PlanRecord, 'status' | 'root_nodes'>>;
    }
  | { type: 'plan.get'; id: string; pid: number }

  // Feedback (v0.3 Wave 2)
  | {
      type: 'feedback.submit';
      id: string;
      pid: number;
      step: number;
      rating: 1 | -1;
      comment?: string;
      agent_uid: string;
    }
  | { type: 'feedback.get'; id: string; pid: number }
  | { type: 'feedback.query'; id: string; agent_uid: string; limit?: number }

  // Agent Profile (v0.3 Wave 4)
  | { type: 'profile.get'; id: string; agent_uid: string }
  | { type: 'profile.list'; id: string }
  | { type: 'profile.update'; id: string; agent_uid: string; updates: Partial<AgentProfile> }

  // Webhook commands (v0.4)
  | {
      type: 'webhook.register';
      id: string;
      name: string;
      url: string;
      events: string[];
      secret?: string;
      filters?: Record<string, any>;
      headers?: Record<string, string>;
      owner_uid?: string;
      retry_count?: number;
      timeout_ms?: number;
    }
  | { type: 'webhook.unregister'; id: string; webhookId: string }
  | { type: 'webhook.list'; id: string; owner_uid?: string }
  | { type: 'webhook.enable'; id: string; webhookId: string }
  | { type: 'webhook.disable'; id: string; webhookId: string }
  | { type: 'webhook.logs'; id: string; webhookId: string; limit?: number }
  | {
      type: 'webhook.inbound.create';
      id: string;
      name: string;
      agent_config: AgentConfig;
      transform?: string;
      owner_uid?: string;
    }
  | { type: 'webhook.inbound.delete'; id: string; inboundId: string }
  | { type: 'webhook.inbound.list'; id: string; owner_uid?: string }
  | { type: 'webhook.dlq.list'; id: string; limit?: number; offset?: number }
  | { type: 'webhook.dlq.retry'; id: string; dlqId: string }
  | { type: 'webhook.dlq.purge'; id: string; dlqId?: string }

  // App commands (v0.4)
  | {
      type: 'app.install';
      id: string;
      manifest: AetherAppManifest;
      source?: 'local' | 'registry' | 'url';
      owner_uid?: string;
    }
  | { type: 'app.uninstall'; id: string; appId: string }
  | { type: 'app.enable'; id: string; appId: string }
  | { type: 'app.disable'; id: string; appId: string }
  | { type: 'app.list'; id: string }
  | { type: 'app.get'; id: string; appId: string }

  // Plugin Registry commands (v0.4 Wave 2)
  | {
      type: 'plugin.registry.install';
      id: string;
      manifest: PluginRegistryManifest;
      source?: 'local' | 'registry' | 'url';
      owner_uid?: string;
    }
  | { type: 'plugin.registry.uninstall'; id: string; pluginId: string }
  | { type: 'plugin.registry.enable'; id: string; pluginId: string }
  | { type: 'plugin.registry.disable'; id: string; pluginId: string }
  | { type: 'plugin.registry.list'; id: string; category?: PluginCategory }
  | { type: 'plugin.registry.search'; id: string; query: string; category?: PluginCategory }
  | {
      type: 'plugin.registry.rate';
      id: string;
      pluginId: string;
      rating: number;
      review?: string;
      user_id: string;
    }
  | { type: 'plugin.registry.settings.get'; id: string; pluginId: string }
  | { type: 'plugin.registry.settings.set'; id: string; pluginId: string; key: string; value: any }

  // Integration commands (v0.4 Wave 2)
  | {
      type: 'integration.register';
      id: string;
      config: IntegrationConfig;
      owner_uid?: string;
    }
  | { type: 'integration.unregister'; id: string; integrationId: string }
  | {
      type: 'integration.configure';
      id: string;
      integrationId: string;
      settings: Record<string, any>;
    }
  | { type: 'integration.enable'; id: string; integrationId: string }
  | { type: 'integration.disable'; id: string; integrationId: string }
  | { type: 'integration.list'; id: string }
  | { type: 'integration.test'; id: string; integrationId: string }
  | {
      type: 'integration.execute';
      id: string;
      integrationId: string;
      action: string;
      params?: Record<string, any>;
    }

  // Template Marketplace commands (v0.4 Wave 2)
  | {
      type: 'template.publish';
      id: string;
      template: {
        id: string;
        name: string;
        description: string;
        icon: string;
        category: 'development' | 'research' | 'data' | 'creative' | 'ops';
        config: Partial<AgentConfig>;
        suggestedGoals: string[];
        author: string;
        tags: string[];
      };
    }
  | { type: 'template.unpublish'; id: string; templateId: string }
  | { type: 'template.marketplace.list'; id: string; category?: string; tags?: string[] }
  | {
      type: 'template.rate';
      id: string;
      templateId: string;
      rating: number;
      review?: string;
      user_id: string;
    }
  | { type: 'template.fork'; id: string; templateId: string; user_id: string }

  // LLM Providers
  | { type: 'llm.list'; id: string }

  // Organization commands (v0.5)
  | { type: 'org.create'; id: string; name: string; displayName?: string }
  | { type: 'org.delete'; id: string; orgId: string }
  | { type: 'org.list'; id: string }
  | { type: 'org.get'; id: string; orgId: string }
  | { type: 'org.update'; id: string; orgId: string; settings: Record<string, any> }
  | { type: 'org.members.list'; id: string; orgId: string }
  | { type: 'org.members.invite'; id: string; orgId: string; userId: string; role: OrgRole }
  | { type: 'org.members.remove'; id: string; orgId: string; userId: string }
  | { type: 'org.members.update'; id: string; orgId: string; userId: string; role: OrgRole }
  | { type: 'org.teams.create'; id: string; orgId: string; name: string; description?: string }
  | { type: 'org.teams.delete'; id: string; teamId: string }
  | { type: 'org.teams.list'; id: string; orgId: string }
  | { type: 'org.teams.addMember'; id: string; teamId: string; userId: string; role?: TeamRole }
  | { type: 'org.teams.removeMember'; id: string; teamId: string; userId: string }

  // Permission Policy commands (v0.5 Phase 4)
  | {
      type: 'permission.grant';
      id: string;
      subject: string;
      action: string;
      resource: string;
      effect: 'allow' | 'deny';
    }
  | { type: 'permission.revoke'; id: string; policyId: string }
  | { type: 'permission.list'; id: string; subject?: string }
  | { type: 'permission.check'; id: string; userId: string; action: string; resource: string }

  // Workspace (v0.5)
  | { type: 'workspace.list'; id: string }
  | { type: 'workspace.cleanup'; id: string; agentName: string }

  // Resource Governor (v0.5)
  | { type: 'resource.getQuota'; id: string; pid: number }
  | { type: 'resource.setQuota'; id: string; pid: number; quota: Partial<ResourceQuota> }
  | { type: 'resource.getUsage'; id: string; pid: number }
  | { type: 'resource.getSummary'; id: string }

  // Audit Logger (v0.5)
  | {
      type: 'audit.query';
      id: string;
      filters?: {
        pid?: number;
        uid?: string;
        action?: string;
        event_type?: string;
        startTime?: number;
        endTime?: number;
        limit?: number;
        offset?: number;
      };
    }

  // Tool Compatibility Layer (v0.5 Phase 4)
  | { type: 'tools.import'; id: string; tools: any[]; format: 'langchain' | 'openai' }
  | { type: 'tools.export'; id: string; format: 'langchain' | 'openai' }
  | { type: 'tools.list'; id: string }

  // System
  | { type: 'kernel.status'; id: string }
  | { type: 'kernel.shutdown'; id: string };

// ---------------------------------------------------------------------------
// Kernel -> UI Events (what the backend sends)
// ---------------------------------------------------------------------------

export type KernelEvent = KernelEventBase & { __eventId?: string };

type KernelEventBase =
  // Responses (matched by id to the originating command)
  | { type: 'response.ok'; id: string; data?: any }
  | { type: 'response.error'; id: string; error: string; code?: string }

  // Process events
  | { type: 'process.spawned'; pid: PID; info: ProcessInfo }
  | { type: 'process.stateChange'; pid: PID; state: ProcessState; agentPhase?: AgentPhase }
  | { type: 'process.stdout'; pid: PID; data: string }
  | { type: 'process.stderr'; pid: PID; data: string }
  | { type: 'process.exit'; pid: PID; code: number; signal?: string }
  | { type: 'process.list'; processes: ProcessInfo[] }
  | { type: 'process.approval_required'; pid: PID; action: string; details: string }
  | { type: 'process.queued'; pid: PID; priority: number; position: number }
  | { type: 'process.dequeued'; pid: PID; priority: number }
  | { type: 'process.priorityChanged'; pid: PID; priority: number; previousPriority: number }

  // Agent-specific events
  | { type: 'agent.thought'; pid: PID; thought: string }
  | { type: 'agent.action'; pid: PID; tool: string; args: Record<string, any> }
  | { type: 'agent.observation'; pid: PID; result: string }
  | { type: 'agent.phaseChange'; pid: PID; phase: AgentPhase }
  | { type: 'agent.progress'; pid: PID; step: number; maxSteps: number; summary: string }
  | { type: 'agent.file_created'; pid: PID; path: string; content: string }
  | { type: 'agent.browsing'; pid: PID; url: string; summary?: string }
  | { type: 'agent.sharedFileWritten'; pid: PID; path: string; size: number }
  | { type: 'agent.paused'; pid: PID }
  | { type: 'agent.resumed'; pid: PID }
  | { type: 'agent.userMessage'; pid: PID; content: string; timestamp: number }

  // IPC events
  | { type: 'ipc.message'; message: IPCMessage }
  | { type: 'ipc.delivered'; messageId: string; toPid: PID }

  // Container events
  | { type: 'container.created'; pid: PID; containerId: string; info: ContainerInfo }
  | { type: 'container.started'; pid: PID; containerId: string }
  | { type: 'container.stopped'; pid: PID; containerId: string }
  | { type: 'container.removed'; pid: PID; containerId: string }

  // Filesystem events
  | { type: 'fs.changed'; path: string; changeType: 'create' | 'modify' | 'delete' }
  | { type: 'fs.list'; path: string; entries: FileStat[] }
  | { type: 'fs.content'; path: string; content: FileContent }
  | { type: 'fs.stat'; path: string; stat: FileStat }

  // Terminal events
  | { type: 'tty.opened'; ttyId: string; pid: PID }
  | { type: 'tty.output'; ttyId: string; data: string }
  | { type: 'tty.closed'; ttyId: string }

  // Plugin events
  | { type: 'plugin.loaded'; pid: PID; name: string; version: string; tools: string[] }
  | { type: 'plugin.error'; pid: PID; plugin: string; error: string }
  | { type: 'plugins.list'; pid: PID; plugins: PluginInfo[] }

  // Snapshot events
  | { type: 'snapshot.created'; snapshot: SnapshotInfo }
  | { type: 'snapshot.restored'; snapshotId: string; newPid: PID }
  | { type: 'snapshot.list'; snapshots: SnapshotInfo[] }
  | { type: 'snapshot.deleted'; snapshotId: string }

  // Shared filesystem events
  | { type: 'fs.sharedCreated'; mount: SharedMountInfo }
  | { type: 'fs.sharedMounted'; pid: PID; name: string }
  | { type: 'fs.sharedUnmounted'; pid: PID; name: string }
  | { type: 'fs.sharedList'; mounts: SharedMountInfo[] }

  // VNC events
  | { type: 'vnc.started'; pid: PID; wsPort: number; display: string }
  | { type: 'vnc.stopped'; pid: PID }
  | { type: 'vnc.info'; pid: PID; wsPort: number; display: string }

  // GPU events
  | { type: 'gpu.list'; gpus: GPUInfo[] }
  | { type: 'gpu.stats'; stats: GPUStats[] }
  | { type: 'gpu.allocated'; pid: PID; gpuIds: number[] }
  | { type: 'gpu.released'; pid: PID; gpuIds: number[] }

  // Auth events
  | { type: 'auth.success'; user: UserInfo; token: string }
  | { type: 'auth.failure'; reason: string }
  | { type: 'user.created'; user: UserInfo }
  | { type: 'user.deleted'; userId: string }

  // Cluster events
  | { type: 'cluster.nodeJoined'; node: NodeInfo }
  | { type: 'cluster.nodeLeft'; nodeId: string }
  | { type: 'cluster.nodeOffline'; nodeId: string }
  | { type: 'cluster.status'; info: ClusterInfo }

  // Browser events
  | { type: 'browser:created'; sessionId: string }
  | { type: 'browser:navigated'; sessionId: string; url: string; title: string }
  | { type: 'browser:screenshot'; sessionId: string; data: string }
  | { type: 'browser:page_info'; sessionId: string; info: BrowserPageInfo }
  | { type: 'browser:destroyed'; sessionId: string }
  | { type: 'browser:error'; sessionId: string; error: string }

  // Memory events (v0.3)
  | { type: 'memory.stored'; memoryId: string; agent_uid: string; layer: MemoryLayer }
  | { type: 'memory.recalled'; agent_uid: string; memories: MemoryRecord[] }
  | { type: 'memory.forgotten'; memoryId: string; agent_uid: string }
  | { type: 'memory.shared'; memoryId: string; from_uid: string; to_uid: string }
  | { type: 'memory.consolidated'; agent_uid: string; removed: number }

  // Cron & Trigger events (v0.3)
  | { type: 'cron.created'; job: CronJob }
  | { type: 'cron.deleted'; jobId: string }
  | { type: 'cron.fired'; jobId: string; pid: PID }
  | { type: 'cron.list'; jobs: CronJob[] }
  | { type: 'trigger.created'; trigger: EventTrigger }
  | { type: 'trigger.deleted'; triggerId: string }
  | { type: 'trigger.fired'; triggerId: string; pid: PID; event_type: string }
  | { type: 'trigger.list'; triggers: EventTrigger[] }

  // Reflection events (v0.3 Wave 2)
  | { type: 'reflection.stored'; reflection: ReflectionRecord }

  // Plan events (v0.3 Wave 2)
  | { type: 'plan.created'; plan: PlanRecord }
  | { type: 'plan.updated'; plan: PlanRecord }

  // Feedback events (v0.3 Wave 2)
  | { type: 'feedback.submitted'; feedback: FeedbackRecord }

  // Profile events (v0.3 Wave 4)
  | { type: 'profile.data'; agent_uid: string; profile: AgentProfile }
  | { type: 'profile.list'; profiles: AgentProfile[] }
  | { type: 'profile.updated'; agent_uid: string; profile: AgentProfile }

  // Webhook events (v0.4)
  | { type: 'webhook.registered'; webhookId: string; name: string }
  | { type: 'webhook.unregistered'; webhookId: string }
  | { type: 'webhook.fired'; webhookId: string; eventType: string; success: boolean }
  | { type: 'webhook.failed'; webhookId: string; eventType: string; error: string }
  | { type: 'webhook.inbound.triggered'; inboundId: string; pid: number }
  | { type: 'webhook.inbound.created'; inboundId: string; name: string; token: string }
  | { type: 'webhook.inbound.deleted'; inboundId: string }
  | { type: 'webhook.dlq.added'; dlqId: string; webhookId: string; eventType: string }
  | { type: 'webhook.dlq.retried'; dlqId: string; success: boolean }
  | { type: 'webhook.dlq.purged'; dlqId?: string; count: number }

  // App events (v0.4)
  | { type: 'app.installed'; app: InstalledApp }
  | { type: 'app.uninstalled'; appId: string }
  | { type: 'app.enabled'; appId: string }
  | { type: 'app.disabled'; appId: string }
  | { type: 'app.list'; apps: InstalledApp[] }

  // Plugin Registry events (v0.4 Wave 2)
  | { type: 'plugin.registry.installed'; plugin: RegisteredPlugin }
  | { type: 'plugin.registry.uninstalled'; pluginId: string }
  | { type: 'plugin.registry.enabled'; pluginId: string }
  | { type: 'plugin.registry.disabled'; pluginId: string }
  | { type: 'plugin.registry.rated'; pluginId: string; rating: number; newAvg: number }
  | { type: 'plugin.registry.list'; plugins: RegisteredPlugin[] }

  // Integration events (v0.4 Wave 2)
  | { type: 'integration.registered'; integration: IntegrationInfo }
  | { type: 'integration.unregistered'; integrationId: string }
  | { type: 'integration.enabled'; integrationId: string }
  | { type: 'integration.disabled'; integrationId: string }
  | { type: 'integration.action_result'; integrationId: string; action: string; result: any }
  | { type: 'integration.error'; integrationId: string; action: string; error: string }
  | { type: 'integration.list'; integrations: IntegrationInfo[] }
  | { type: 'integration.tested'; integrationId: string; success: boolean; message: string }

  // Template Marketplace events (v0.4 Wave 2)
  | { type: 'template.published'; entry: TemplateMarketplaceEntry }
  | { type: 'template.unpublished'; templateId: string }
  | { type: 'template.rated'; templateId: string; rating: number; newAvg: number }
  | { type: 'template.forked'; originalId: string; newId: string }
  | { type: 'template.marketplace.list'; templates: TemplateMarketplaceEntry[] }

  // Permission Policy events (v0.5 Phase 4)
  | { type: 'permission.granted'; policy: PermissionPolicy }
  | { type: 'permission.revoked'; policyId: string }
  | { type: 'permission.list'; policies: PermissionPolicy[] }

  // Organization events (v0.5)
  | { type: 'org.created'; org: Organization }
  | { type: 'org.deleted'; orgId: string }
  | { type: 'org.updated'; org: Organization }
  | { type: 'org.member.invited'; orgId: string; userId: string; role: OrgRole }
  | { type: 'org.member.removed'; orgId: string; userId: string }
  | { type: 'org.member.updated'; orgId: string; userId: string; role: OrgRole }
  | { type: 'org.team.created'; team: Team }
  | { type: 'org.team.deleted'; teamId: string }

  // Workspace events (v0.5)
  | { type: 'workspace.list'; workspaces: string[] }
  | { type: 'workspace.cleaned'; agentName: string; success: boolean }

  // Collaboration events (v0.3 Wave 4)
  | { type: 'collaboration.message'; protocol: string; fromPid: PID; toPid: PID }

  // LLM events
  | { type: 'llm.list'; providers: LLMProviderInfo[] }

  // Resource Governor events (v0.5)
  | { type: 'resource.exceeded'; pid: number; reason: string; usage: AgentUsage }
  | { type: 'resource.usage'; pid: number; usage: AgentUsage }
  | { type: 'resource.quota'; pid: number; quota: ResourceQuota }

  // Audit Logger events (v0.5)
  | { type: 'audit.entries'; entries: AuditEntryInfo[] }

  // Tool Compatibility Layer events (v0.5 Phase 4)
  | { type: 'tools.imported'; count: number; format: string; names: string[] }
  | { type: 'tools.exported'; count: number; format: string }
  | { type: 'tools.list'; tools: Array<{ name: string; source: string; description: string }> }

  // System events
  | { type: 'kernel.ready'; version: string; uptime: number }
  | {
      type: 'kernel.metrics';
      processCount: number;
      cpuPercent: number;
      memoryMB: number;
      containerCount?: number;
    };

// ---------------------------------------------------------------------------
// Resource Governor Types (v0.5)
// ---------------------------------------------------------------------------

export interface AgentUsage {
  pid: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalSteps: number;
  startedAt: number;
  estimatedCostUSD: number;
  provider: string;
}

export interface ResourceQuota {
  maxTokensPerSession: number;
  maxTokensPerDay: number;
  maxSteps: number;
  maxWallClockMs: number;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  usage: AgentUsage;
}

// ---------------------------------------------------------------------------
// Audit Logger Types (v0.5)
// ---------------------------------------------------------------------------

export interface AuditEntryInfo {
  id: number;
  timestamp: number;
  event_type: string;
  actor_pid: number | null;
  actor_uid: string | null;
  action: string;
  target: string | null;
  args_sanitized: string | null;
  result_hash: string | null;
  metadata: string | null;
  created_at: number;
}

// ---------------------------------------------------------------------------
// Plugin Types
// ---------------------------------------------------------------------------

export interface PluginInfo {
  name: string;
  version: string;
  description: string;
  tools: string[];
}

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

/** LLM provider availability info */
export interface LLMProviderInfo {
  name: string;
  available: boolean;
  models: string[];
}

/** A message on the wire is either a command or an event */
export type WireMessage = KernelCommand | KernelEvent;

/** Generate a unique message ID */
export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** Standard result type for kernel operations */
export type KernelResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };
