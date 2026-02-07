export enum AppID {
  NOTES = 'notes',
  PHOTOS = 'photos',
  FILES = 'files',
  CHAT = 'chat',
  SETTINGS = 'settings',
  TERMINAL = 'terminal',
  BROWSER = 'browser',
  CALCULATOR = 'calculator',
  CODE = 'code',
  VIDEO = 'video',
  AGENTS = 'agents', // The Dashboard
  VM = 'vm', // The Individual Agent View
  SHEETS = 'sheets',
  CANVAS = 'canvas',
  WRITER = 'writer',
  SYSTEM_MONITOR = 'system_monitor',
  MUSIC = 'music',
  DOCUMENTS = 'documents',
  MEMORY_INSPECTOR = 'memory_inspector',
  APP_STORE = 'app_store',
}

export interface WindowState {
  id: string; // Changed from AppID to string to allow multiple VM windows
  appId: AppID; // The type of app
  title: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
  position: { x: number; y: number };
  size: { width: number; height: number };
  initialData?: any; // To pass file content, URLs, agent IDs etc.
  workspaceId?: number; // Which workspace this window belongs to (0-based, undefined = workspace 0)
  stickyWorkspace?: boolean; // Show on all workspaces
}

export interface Note {
  id: string;
  title: string;
  content: string;
  lastModified: number;
}

export interface Photo {
  id: string;
  url: string;
  name: string;
  analysis?: string;
}

export enum GeminiModel {
  FLASH = 'gemini-2.5-flash',
  PRO = 'gemini-3-pro-preview',
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

// Agent System Types (legacy mock types, kept for backward compat)
export type AgentStatus =
  | 'idle'
  | 'thinking'
  | 'working'
  | 'waiting_approval'
  | 'completed'
  | 'error';

export interface AgentLog {
  timestamp: number;
  type: 'thought' | 'action' | 'observation' | 'system';
  message: string;
}

export interface Agent {
  id: string;
  pid?: number; // Kernel process ID (set when using real kernel)
  name: string;
  role: string;
  goal: string;
  status: AgentStatus;
  phase?: string; // Kernel AgentPhase (more granular than status)
  thumbnailUrl?: string;
  logs: AgentLog[];
  currentUrl?: string;
  currentCode?: string;
  progress: number;
  ttyId?: string; // Terminal session ID (set when using real kernel)
  isWaiting?: boolean;
  githubSync?: boolean;
}

// Runtime mode - determines if we use mock or real kernel
export type RuntimeMode = 'mock' | 'kernel';

/**
 * Map kernel phase to legacy AgentStatus for UI compatibility.
 */
export function phaseToStatus(phase: string, state: string): AgentStatus {
  if (state === 'zombie' || state === 'dead') {
    return phase === 'completed' ? 'completed' : 'error';
  }
  if (state === 'stopped') return 'idle';

  switch (phase) {
    case 'booting':
    case 'thinking':
    case 'observing':
      return 'thinking';
    case 'executing':
      return 'working';
    case 'waiting':
      return 'waiting_approval';
    case 'idle':
      return 'idle';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'error';
    default:
      return 'working';
  }
}
