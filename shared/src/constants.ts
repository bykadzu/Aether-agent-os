/**
 * Aether OS - System Constants
 */

import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

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
export const DEFAULT_COMMAND_TIMEOUT = 120_000; // 2 minutes (was 30s — too short for installs & builds)
export const MAX_COMMAND_TIMEOUT = 600_000; // 10 minutes cap

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

// WebSocket backpressure & rate limiting
export const WS_MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB bufferedAmount threshold
export const WS_MAX_QUEUED_EVENTS = 500; // Max events in per-client buffer
export const WS_COMMANDS_PER_MIN = 600; // 10 commands/sec per client

// Container defaults
export const DEFAULT_CONTAINER_IMAGE = 'aether-agent:latest'; // Custom image with Python, Node.js, pip, git pre-installed
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

/**
 * Generate a cryptographically random admin password for first-boot.
 * Never use a hardcoded default — each deployment gets a unique password.
 */
export function generateDefaultAdminPassword(): string {
  return crypto.randomBytes(16).toString('base64url');
}

// Cluster
export const CLUSTER_HEARTBEAT_INTERVAL = 10_000; // 10 seconds
export const CLUSTER_HEARTBEAT_TIMEOUT = 35_000; // 3.5 missed = offline
export const CLUSTER_DEFAULT_CAPACITY = 16; // Max agents per node

// Context compaction
export const CONTEXT_COMPACTION_STEP_INTERVAL = 10; // Compact every N steps
export const CONTEXT_COMPACTION_TOKEN_THRESHOLD = 30_000; // Compact when estimated tokens exceed this
export const CONTEXT_COMPACTION_KEEP_RECENT = 8; // How many recent entries to preserve after compaction

// Audit Logger
export const AUDIT_RETENTION_DAYS = 30;
export const AUDIT_DEFAULT_PAGE_SIZE = 50;

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

// Resource Governor defaults (v0.5)
export const DEFAULT_MAX_TOKENS_PER_SESSION = 500_000;
export const DEFAULT_MAX_TOKENS_PER_DAY = 2_000_000;
export const DEFAULT_MAX_STEPS = 200;
export const DEFAULT_MAX_WALL_CLOCK_MS = 3_600_000; // 1 hour

// Rate limiting
export const RATE_LIMIT_REQUESTS_PER_MIN = 120; // Authenticated users
export const RATE_LIMIT_REQUESTS_UNAUTH_PER_MIN = 30; // Unauthenticated users
export const RATE_LIMIT_AGENT_TOOLS_PER_MIN = 60; // Per-agent tool executions

// MCP (Model Context Protocol) — v0.6
export const MCP_TOOL_CALL_TIMEOUT = 30_000; // 30 seconds per MCP tool call
export const MCP_CONNECT_TIMEOUT = 15_000; // 15 seconds to establish connection
export const MCP_RECONNECT_DELAY = 5_000; // Delay before reconnect attempt
export const MCP_MAX_RECONNECT_ATTEMPTS = 5;
export const MCP_PING_INTERVAL = 30_000; // Keepalive ping interval
export const MCP_MAX_TOOLS_PER_AGENT = 50; // Limit agent tool list to prevent LLM degradation
export const MCP_MAX_SERVERS = 10; // Max concurrent MCP server connections

// OpenClaw Skill Adapter — v0.6
export const OPENCLAW_SKILL_ID_PREFIX = 'openclaw-skill-';
export const OPENCLAW_DEFAULT_CATEGORY = 'tools';
export const OPENCLAW_DEFAULT_AUTHOR = 'OpenClaw Community';
export const OPENCLAW_DEFAULT_VERSION = '1.0.0';
export const OPENCLAW_MAX_SKILLS = 100; // Max imported skills

// SkillForge — Agent Self-Modification (v0.7)
export const SKILLFORGE_MAX_SKILLS_PER_AGENT = 20;
export const SKILLFORGE_MAX_CREATES_PER_HOUR = 5;
export const SKILLFORGE_SANDBOX_TIMEOUT = 30_000; // 30s per sandbox test
export const SKILLFORGE_MAX_RETRIES = 3; // Iterative refinement attempts
export const SKILLFORGE_DEFAULT_ENFORCEMENT: 'allow' | 'warn' | 'prompt' | 'deny' = 'warn';
export const SKILLFORGE_SKILL_ID_PREFIX = 'forge-';

// AetherMCPServer — v0.8
export const AETHER_MCP_SERVER_NAME = 'aether-os';
export const AETHER_MCP_SERVER_VERSION = '0.1.0';
export const SUBPROCESS_OUTPUT_MAX_BUFFER = 100_000; // Max chars to buffer from subprocess
export const SUBPROCESS_GRACEFUL_TIMEOUT = 10_000; // 10s before SIGKILL after SIGTERM

// ClawHub API cache TTL (v0.7 Sprint 2)
export const CLAWHUB_CACHE_TTL = 3_600_000; // 1 hour cache for ClawHub API responses
export const SKILLFORGE_EMBEDDING_DIMENSIONS = 64; // Lightweight embedding dimensions

// Event deduplication
export function createEventId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}
