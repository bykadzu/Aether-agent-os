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
  VM = 'vm' // The Individual Agent View
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

// Agent System Types
export type AgentStatus = 'idle' | 'thinking' | 'working' | 'waiting_approval' | 'completed' | 'error';

export interface AgentLog {
  timestamp: number;
  type: 'thought' | 'action' | 'system';
  message: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string; // e.g., "Researcher", "Coder"
  goal: string;
  status: AgentStatus;
  thumbnailUrl?: string; // Snapshot of their "screen"
  logs: AgentLog[];
  currentUrl?: string; // If browsing
  currentCode?: string; // If coding
  progress: number;
  isWaiting?: boolean; // Prevents double-firing API calls
  githubSync?: boolean; // Mock GitHub connection
}