/**
 * Aether OS - System Constants
 */

export const AETHER_VERSION = '0.1.0';

// Server defaults
export const DEFAULT_PORT = 3001;
export const DEFAULT_WS_PATH = '/kernel';

// Process limits
export const MAX_PROCESSES = 64;
export const MAX_AGENTS = 16;
export const DEFAULT_AGENT_TIMEOUT = 300_000;      // 5 minutes
export const DEFAULT_AGENT_MAX_STEPS = 50;
export const AGENT_STEP_INTERVAL = 3_000;           // 3 seconds between steps

// Filesystem
export const AETHER_ROOT = '/tmp/aether';            // Root of the virtual FS on disk
export const HOME_DIR = '/home';
export const TMP_DIR = '/tmp';
export const PROC_DIR = '/proc';
export const MAX_FILE_SIZE = 10 * 1024 * 1024;       // 10MB

// Terminal
export const DEFAULT_TTY_COLS = 120;
export const DEFAULT_TTY_ROWS = 36;

// IPC
export const WS_HEARTBEAT_INTERVAL = 30_000;
export const WS_RECONNECT_DELAY = 2_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const IPC_MESSAGE_MAX_SIZE = 1024 * 1024;    // 1MB per IPC message
export const IPC_QUEUE_MAX_LENGTH = 100;             // Max queued messages per process

// Container defaults
export const DEFAULT_CONTAINER_IMAGE = 'ubuntu:22.04';
export const DEFAULT_CONTAINER_MEMORY_MB = 512;
export const DEFAULT_CONTAINER_CPU_LIMIT = 0.5;      // 50% of one core
export const CONTAINER_STOP_TIMEOUT = 10;             // seconds

// Persistence
export const STATE_DB_PATH = '/tmp/aether/var/aether-state.db';

// Authentication
export const AUTH_TOKEN_EXPIRY = 24 * 60 * 60 * 1000;    // 24 hours in ms
export const AUTH_DEFAULT_ADMIN_USER = 'admin';
export const AUTH_DEFAULT_ADMIN_PASS = 'aether';

// Cluster
export const CLUSTER_HEARTBEAT_INTERVAL = 10_000;          // 10 seconds
export const CLUSTER_HEARTBEAT_TIMEOUT = 35_000;            // 3.5 missed = offline
export const CLUSTER_DEFAULT_CAPACITY = 16;                 // Max agents per node

// Agent roles
export const AGENT_ROLES = [
  'Researcher',
  'Coder',
  'Analyst',
  'Assistant',
  'DevOps',
  'Designer',
  'Tester',
] as const;

export type AgentRole = typeof AGENT_ROLES[number];
