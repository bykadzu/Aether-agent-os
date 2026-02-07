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
// Snapshot Types
// ---------------------------------------------------------------------------

export interface SnapshotInfo {
  id: string;
  pid: PID;
  timestamp: number;
  size: number;
  description: string;
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

  // LLM Providers
  | { type: 'llm.list'; id: string }

  // System
  | { type: 'kernel.status'; id: string }
  | { type: 'kernel.shutdown'; id: string };

// ---------------------------------------------------------------------------
// Kernel -> UI Events (what the backend sends)
// ---------------------------------------------------------------------------

export type KernelEvent =
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

  // Agent-specific events
  | { type: 'agent.thought'; pid: PID; thought: string }
  | { type: 'agent.action'; pid: PID; tool: string; args: Record<string, any> }
  | { type: 'agent.observation'; pid: PID; result: string }
  | { type: 'agent.phaseChange'; pid: PID; phase: AgentPhase }
  | { type: 'agent.progress'; pid: PID; step: number; maxSteps: number; summary: string }
  | { type: 'agent.file_created'; pid: PID; path: string; content: string }
  | { type: 'agent.browsing'; pid: PID; url: string; summary?: string }

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

  // LLM events
  | { type: 'llm.list'; providers: LLMProviderInfo[] }

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
