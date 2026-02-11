/**
 * Aether OS - System Constants
 */

import * as os from 'node:os';
import * as path from 'node:path';

export const AETHER_VERSION = '0.1.0';

// Server defaults
export const DEFAULT_PORT = 3001;
export const DEFAULT_WS_PATH = '/kernel';

// Process limits
export const MAX_PROCESSES = 64;
export const MAX_AGENTS = 16;
export const DEFAULT_AGENT_TIMEOUT = 300_000; // 5 minutes
export const DEFAULT_AGENT_MAX_STEPS = 50;
export const AGENT_STEP_INTERVAL = 3_000; // 3 seconds between steps

// Command execution
export const DEFAULT_COMMAND_TIMEOUT = 30_000; // 30 seconds
export const MAX_COMMAND_TIMEOUT = 300_000; // 5 minutes cap

// Filesystem — defaults to ~/.aether for persistence across reboots
// Override with AETHER_FS_ROOT env var (e.g. /tmp/aether for testing)
export const AETHER_ROOT = process.env.AETHER_FS_ROOT || path.join(os.homedir(), '.aether');
export const HOME_DIR = '/home';
export const TMP_DIR = '/tmp';
export const PROC_DIR = '/proc';
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Terminal
export const DEFAULT_TTY_COLS = 120;
export const DEFAULT_TTY_ROWS = 36;

// IPC
export const WS_HEARTBEAT_INTERVAL = 30_000;
export const WS_RECONNECT_DELAY = 2_000;
export const WS_MAX_RECONNECT_ATTEMPTS = 10;
export const IPC_MESSAGE_MAX_SIZE = 1024 * 1024; // 1MB per IPC message
export const IPC_QUEUE_MAX_LENGTH = 100; // Max queued messages per process

// Container defaults
export const DEFAULT_CONTAINER_IMAGE = 'ubuntu:22.04';
export const DEFAULT_GRAPHICAL_IMAGE = 'aether-desktop:latest'; // Xvfb + x11vnc + X11 utils
export const DEFAULT_CONTAINER_MEMORY_MB = 512;
export const DEFAULT_CONTAINER_CPU_LIMIT = 0.5; // 50% of one core
export const CONTAINER_STOP_TIMEOUT = 10; // seconds

// VNC defaults
export const VNC_BASE_PORT = 5900; // Base VNC port (display :0 = 5900)
export const VNC_WS_BASE_PORT = 6080; // Base WebSocket proxy port for noVNC
export const VNC_DISPLAY = ':99'; // Default Xvfb display number

// Persistence
export const STATE_DB_PATH = path.join(AETHER_ROOT, 'var', 'aether-state.db');

// Authentication
export const AUTH_TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours in ms
export const AUTH_DEFAULT_ADMIN_USER = 'admin';
export const AUTH_DEFAULT_ADMIN_PASS = 'aether';

// Cluster
export const CLUSTER_HEARTBEAT_INTERVAL = 10_000; // 10 seconds
export const CLUSTER_HEARTBEAT_TIMEOUT = 35_000; // 3.5 missed = offline
export const CLUSTER_DEFAULT_CAPACITY = 16; // Max agents per node

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

export type AgentRole = (typeof AGENT_ROLES)[number];

// Event deduplication
let _eventCounter = 0;
export function createEventId(): string {
  return `evt_${Date.now()}_${_eventCounter++}`;
}
