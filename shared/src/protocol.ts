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

/** File descriptor number */
export type FD = number;

/** Unix-style signal */
export type Signal = 'SIGTERM' | 'SIGKILL' | 'SIGSTOP' | 'SIGCONT' | 'SIGINT' | 'SIGUSR1' | 'SIGUSR2';

/** Process states following Unix conventions */
export type ProcessState =
  | 'created'     // Process object exists, not yet started
  | 'running'     // Actively executing
  | 'sleeping'    // Waiting for I/O or event
  | 'stopped'     // Paused by signal (SIGSTOP)
  | 'zombie'      // Terminated but not yet reaped
  | 'dead';       // Fully cleaned up

/** Agent-specific states layered on top of process states */
export type AgentPhase =
  | 'booting'       // Initializing sandbox and tools
  | 'thinking'      // LLM is reasoning
  | 'executing'     // Running a tool/command
  | 'waiting'       // Waiting for human approval
  | 'observing'     // Reading tool output
  | 'idle'          // Waiting for next task
  | 'completed'     // Goal achieved
  | 'failed';       // Unrecoverable error

/** File types in the virtual filesystem */
export type FileType = 'file' | 'directory' | 'symlink' | 'pipe' | 'device';

/** Permission mode (simplified Unix permissions) */
export interface FileMode {
  owner: { read: boolean; write: boolean; execute: boolean };
  group: { read: boolean; write: boolean; execute: boolean };
  other: { read: boolean; write: boolean; execute: boolean };
}

// ---------------------------------------------------------------------------
// Process Types
// ---------------------------------------------------------------------------

export interface ProcessInfo {
  pid: PID;
  ppid: PID;                  // Parent process ID (0 = init)
  uid: string;                // Owner (agent ID or 'root')
  name: string;               // Process name
  command: string;             // Full command string
  state: ProcessState;
  agentPhase?: AgentPhase;    // Only for agent processes
  cwd: string;                // Current working directory
  env: Record<string, string>;
  createdAt: number;           // Unix timestamp ms
  cpuPercent: number;          // 0-100
  memoryMB: number;            // Memory usage in MB
  ttyId?: string;             // Attached terminal ID
}

export interface AgentConfig {
  role: string;                // Agent role (Researcher, Coder, etc.)
  goal: string;                // Primary directive
  model?: string;              // LLM model to use
  tools?: string[];            // Allowed tools
  maxSteps?: number;           // Max autonomous steps before pause
  sandbox?: SandboxConfig;
}

export interface SandboxConfig {
  type: 'process' | 'container' | 'vm';
  memoryLimitMB?: number;
  cpuLimit?: number;           // 0.0 - 1.0
  networkAccess?: boolean;
  allowedPaths?: string[];     // Filesystem paths the agent can access
  timeout?: number;            // Max runtime in seconds
}

// ---------------------------------------------------------------------------
// Filesystem Types
// ---------------------------------------------------------------------------

export interface FileStat {
  path: string;
  name: string;
  type: FileType;
  size: number;                // Bytes
  mode: FileMode;
  uid: string;                 // Owner
  createdAt: number;
  modifiedAt: number;
  isHidden: boolean;
}

export interface FileContent {
  path: string;
  content: string;             // UTF-8 text content
  encoding: 'utf-8' | 'base64';
  size: number;
}

// ---------------------------------------------------------------------------
// Terminal Types
// ---------------------------------------------------------------------------

export interface TerminalInfo {
  id: string;
  pid: PID;                    // Attached process
  cols: number;
  rows: number;
  title: string;
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

  // Filesystem events
  | { type: 'fs.changed'; path: string; changeType: 'create' | 'modify' | 'delete' }
  | { type: 'fs.list'; path: string; entries: FileStat[] }
  | { type: 'fs.content'; path: string; content: FileContent }
  | { type: 'fs.stat'; path: string; stat: FileStat }

  // Terminal events
  | { type: 'tty.opened'; ttyId: string; pid: PID }
  | { type: 'tty.output'; ttyId: string; data: string }
  | { type: 'tty.closed'; ttyId: string }

  // System events
  | { type: 'kernel.ready'; version: string; uptime: number }
  | { type: 'kernel.metrics'; processCount: number; cpuPercent: number; memoryMB: number };

// ---------------------------------------------------------------------------
// Utility Types
// ---------------------------------------------------------------------------

/** A message on the wire is either a command or an event */
export type WireMessage = KernelCommand | KernelEvent;

/** Generate a unique message ID */
export function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/** Standard result type for kernel operations */
export type KernelResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };
