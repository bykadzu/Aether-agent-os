import React, { useState, useEffect, useCallback } from 'react';
import {
  Store,
  Search,
  Download,
  Trash2,
  ToggleLeft,
  ToggleRight,
  BarChart3,
  GitBranch,
  MessageSquare,
  Clock,
  Cpu,
  X,
  Shield,
  Tag,
  ExternalLink,
  Package,
  RefreshCw,
  CheckCircle2,
  Star,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppPermission =
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

interface AetherAppManifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon: string;
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

interface InstalledApp {
  id: string;
  manifest: AetherAppManifest;
  installed_at: number;
  updated_at: number;
  enabled: boolean;
  install_source: 'local' | 'registry' | 'url';
  owner_uid?: string;
}

type AppCategory =
  | 'all'
  | 'productivity'
  | 'development'
  | 'communication'
  | 'utilities'
  | 'monitoring'
  | 'entertainment'
  | 'ai';
type ViewTab = 'browse' | 'installed';

// ---------------------------------------------------------------------------
// Icon resolver
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  BarChart3,
  GitBranch,
  MessageSquare,
  Clock,
  Cpu,
  Store,
  Star,
};

function renderIcon(iconName: string, size: number, className: string): React.ReactNode {
  const Icon = ICON_MAP[iconName] || Package;
  return <Icon size={size} className={className} />;
}

// ---------------------------------------------------------------------------
// Mock Registry
// ---------------------------------------------------------------------------

const MOCK_REGISTRY: AetherAppManifest[] = [
  {
    id: 'com.aether.agent-dashboard-pro',
    name: 'Agent Dashboard Pro',
    version: '1.2.0',
    author: 'Aether Labs',
    description:
      'Enhanced agent monitoring with real-time metrics, performance graphs, and multi-agent comparison views. Track agent efficiency, resource usage, and task completion rates across your entire fleet.',
    icon: 'BarChart3',
    permissions: ['agents:read', 'memory', 'notifications'],
    entry: 'index.tsx',
    category: 'monitoring',
    keywords: ['monitoring', 'agents', 'dashboard', 'metrics', 'analytics'],
    repository: 'https://github.com/aether-labs/agent-dashboard-pro',
  },
  {
    id: 'com.aether.git-integration',
    name: 'Git Integration',
    version: '2.0.1',
    author: 'DevTools Inc.',
    description:
      'Seamless GitHub and GitLab integration for Aether agents. Auto-commit, branch management, PR creation, and code review workflows. Supports both personal and organization repositories.',
    icon: 'GitBranch',
    permissions: ['filesystem', 'network', 'agents'],
    entry: 'index.tsx',
    category: 'development',
    keywords: ['git', 'github', 'gitlab', 'version-control', 'development'],
    repository: 'https://github.com/devtools-inc/aether-git',
  },
  {
    id: 'com.aether.slack-notifier',
    name: 'Slack Notifier',
    version: '1.0.3',
    author: 'CommTools',
    description:
      'Send notifications to Slack channels when agents complete tasks, encounter errors, or need approval. Configurable webhook templates with rich formatting and thread support.',
    icon: 'MessageSquare',
    permissions: ['network', 'notifications', 'agents:read'],
    entry: 'index.tsx',
    category: 'communication',
    keywords: ['slack', 'notifications', 'webhooks', 'messaging'],
  },
  {
    id: 'com.aether.cron-scheduler',
    name: 'Cron Scheduler',
    version: '1.1.0',
    author: 'Aether Labs',
    description:
      'Visual cron job editor with a drag-and-drop timeline. Create, edit, and monitor scheduled agent tasks with an intuitive calendar view. Supports complex scheduling patterns and timezone management.',
    icon: 'Clock',
    permissions: ['cron', 'agents', 'notifications'],
    entry: 'index.tsx',
    category: 'utilities',
    keywords: ['cron', 'scheduler', 'automation', 'tasks', 'calendar'],
  },
  {
    id: 'com.aether.model-benchmark',
    name: 'Model Benchmark',
    version: '0.9.0',
    author: 'AI Research Co.',
    description:
      'Benchmark and compare LLM performance across different models and tasks. Run standardized test suites, measure latency, token usage, and output quality. Generate detailed comparison reports.',
    icon: 'Cpu',
    permissions: ['agents', 'memory', 'system'],
    entry: 'index.tsx',
    category: 'ai',
    keywords: ['llm', 'benchmark', 'performance', 'testing', 'ai', 'models'],
    repository: 'https://github.com/ai-research-co/model-benchmark',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const CATEGORY_LABELS: Record<AppCategory, string> = {
  all: 'All Apps',
  productivity: 'Productivity',
  development: 'Development',
  communication: 'Communication',
  utilities: 'Utilities',
  monitoring: 'Monitoring',
  entertainment: 'Entertainment',
  ai: 'AI & ML',
};

const CATEGORY_COLORS: Record<string, string> = {
  productivity: 'text-blue-400',
  development: 'text-green-400',
  communication: 'text-purple-400',
  utilities: 'text-amber-400',
  monitoring: 'text-red-400',
  entertainment: 'text-pink-400',
  ai: 'text-cyan-400',
  other: 'text-gray-400',
};

const PERMISSION_LABELS: Record<AppPermission, string> = {
  filesystem: 'Full filesystem access',
  'filesystem:read': 'Read-only filesystem',
  network: 'Network access',
  agents: 'Agent management',
  'agents:read': 'Read agent data',
  notifications: 'Send notifications',
  system: 'System access',
  ipc: 'Inter-process communication',
  memory: 'Memory system',
  cron: 'Cron scheduling',
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

const PermissionBadge: React.FC<{ perm: AppPermission }> = ({ perm }) => (
  <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/5 border border-white/5">
    <Shield size={10} className="text-amber-400 shrink-0" />
    <span className="text-[10px] text-gray-400">{PERMISSION_LABELS[perm] || perm}</span>
  </div>
);

const AppCard: React.FC<{
  manifest: AetherAppManifest;
  installed: boolean;
  enabled?: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: () => void;
  onClick: () => void;
}> = ({ manifest, installed, enabled, onInstall, onUninstall, onToggle, onClick }) => {
  const categoryColor = CATEGORY_COLORS[manifest.category || 'other'];

  return (
    <div
      onClick={onClick}
      className="group p-4 rounded-xl border bg-white/[0.02] border-white/5 hover:bg-white/[0.04] hover:border-white/10 cursor-pointer transition-all duration-200"
    >
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center shrink-0">
          {renderIcon(manifest.icon, 20, 'text-indigo-400')}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-medium text-white truncate">{manifest.name}</h3>
            {installed && <CheckCircle2 size={12} className="text-green-400 shrink-0" />}
          </div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] text-gray-500">{manifest.author}</span>
            <span className="text-[10px] text-gray-600">v{manifest.version}</span>
            {manifest.category && (
              <span className={`text-[10px] font-medium ${categoryColor}`}>
                {CATEGORY_LABELS[manifest.category as AppCategory] || manifest.category}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2">
            {manifest.description}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
        {manifest.keywords &&
          manifest.keywords.slice(0, 3).map((kw) => (
            <span key={kw} className="px-1.5 py-0.5 text-[9px] rounded bg-white/5 text-gray-500">
              {kw}
            </span>
          ))}
        <div className="ml-auto flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {installed ? (
            <>
              <button
                onClick={onToggle}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                title={enabled ? 'Disable' : 'Enable'}
              >
                {enabled ? (
                  <ToggleRight size={18} className="text-green-400" />
                ) : (
                  <ToggleLeft size={18} className="text-gray-500" />
                )}
              </button>
              <button
                onClick={onUninstall}
                className="p-1.5 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                title="Uninstall"
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : (
            <button
              onClick={onInstall}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 text-xs font-medium transition-colors"
            >
              <Download size={12} />
              Install
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const AppDetailPanel: React.FC<{
  manifest: AetherAppManifest;
  installed: boolean;
  installedApp?: InstalledApp;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: () => void;
}> = ({ manifest, installed, installedApp, onClose, onInstall, onUninstall, onToggle }) => {
  const categoryColor = CATEGORY_COLORS[manifest.category || 'other'];

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          App Details
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
            {renderIcon(manifest.icon, 28, 'text-indigo-400')}
          </div>
          <div>
            <h2 className="text-base font-medium text-white">{manifest.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[11px] text-gray-500">{manifest.author}</span>
              <span className="text-[11px] text-gray-600">v{manifest.version}</span>
            </div>
          </div>
        </div>

        {/* Category */}
        {manifest.category && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              Category
            </label>
            <span className={`text-xs font-medium ${categoryColor}`}>
              {CATEGORY_LABELS[manifest.category as AppCategory] || manifest.category}
            </span>
          </div>
        )}

        {/* Description */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Description
          </label>
          <p className="text-xs text-gray-300 leading-relaxed">{manifest.description}</p>
        </div>

        {/* App ID */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            App ID
          </label>
          <span className="text-xs font-mono text-cyan-400/80">{manifest.id}</span>
        </div>

        {/* Permissions */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
            <Shield size={10} className="inline mr-1" />
            Permissions ({manifest.permissions.length})
          </label>
          <div className="flex flex-wrap gap-1.5">
            {manifest.permissions.map((perm) => (
              <PermissionBadge key={perm} perm={perm} />
            ))}
          </div>
        </div>

        {/* Keywords */}
        {manifest.keywords && manifest.keywords.length > 0 && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
              <Tag size={10} className="inline mr-1" />
              Keywords
            </label>
            <div className="flex flex-wrap gap-1.5">
              {manifest.keywords.map((kw) => (
                <span
                  key={kw}
                  className="px-2 py-0.5 text-[10px] rounded bg-white/5 text-gray-400 border border-white/5"
                >
                  {kw}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Repository */}
        {manifest.repository && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              <ExternalLink size={10} className="inline mr-1" />
              Repository
            </label>
            <span className="text-xs text-indigo-400 font-mono break-all">
              {manifest.repository}
            </span>
          </div>
        )}

        {/* Install info */}
        {installed && installedApp && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Installed
              </label>
              <span className="text-xs text-gray-300">
                {relativeTime(installedApp.installed_at)}
              </span>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Source
              </label>
              <span className="text-xs text-gray-300">{installedApp.install_source}</span>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Status
              </label>
              <span
                className={`text-xs font-medium ${installedApp.enabled ? 'text-green-400' : 'text-gray-500'}`}
              >
                {installedApp.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="p-4 border-t border-white/5 flex items-center gap-2">
        {installed ? (
          <>
            <button
              onClick={onToggle}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 hover:text-white transition-colors text-xs font-medium"
            >
              {installedApp?.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {installedApp?.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              onClick={onUninstall}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors text-xs font-medium"
            >
              <Trash2 size={12} />
              Uninstall
            </button>
          </>
        ) : (
          <button
            onClick={onInstall}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 transition-colors text-xs font-bold"
          >
            <Download size={14} />
            Install App
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const AppStoreApp: React.FC = () => {
  const [kernelConnected, setKernelConnected] = useState(false);
  const [installedApps, setInstalledApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<ViewTab>('browse');
  const [selectedCategory, setSelectedCategory] = useState<AppCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

  // Kernel connection tracking
  useEffect(() => {
    try {
      const kernel = getKernelClient();
      setKernelConnected(kernel.connected);
      const unsubscribe = kernel.on('connection', (data: { connected: boolean }) => {
        setKernelConnected(data.connected);
      });
      return () => {
        unsubscribe();
      };
    } catch {
      setKernelConnected(false);
    }
  }, []);

  // Load installed apps from kernel
  const loadInstalledApps = useCallback(async () => {
    const kernel = getKernelClient();
    if (!kernel.connected) {
      setInstalledApps([]);
      return;
    }

    setLoading(true);
    try {
      const ws = (kernel as any).ws as WebSocket | null;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setInstalledApps([]);
        return;
      }

      const id = createMessageId();
      const responsePromise = new Promise<InstalledApp[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, 10000);
        const handler = (event: any) => {
          if (event.id === id) {
            clearTimeout(timeout);
            cleanup();
            if (event.type === 'response.ok') {
              resolve(event.data?.apps || event.data || []);
            } else {
              reject(new Error(event.error || 'Unknown error'));
            }
          }
        };
        const cleanup = kernel.on('response.ok', handler);
        const cleanupErr = kernel.on('response.error', (event: any) => {
          if (event.id === id) {
            clearTimeout(timeout);
            cleanup();
            cleanupErr();
            reject(new Error(event.error));
          }
        });
      });

      ws.send(JSON.stringify({ type: 'app.list', id }));
      const data = await responsePromise;
      setInstalledApps(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[AppStore] Failed to load apps:', err);
      setInstalledApps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kernelConnected) {
      loadInstalledApps();
    }
  }, [kernelConnected, loadInstalledApps]);

  // Install / uninstall / toggle
  const installApp = useCallback(async (manifest: AetherAppManifest) => {
    const kernel = getKernelClient();
    if (kernel.connected) {
      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const id = createMessageId();
          ws.send(JSON.stringify({ type: 'app.install', id, manifest, source: 'registry' }));
        }
      } catch (err) {
        console.error('[AppStore] Install failed:', err);
      }
    }
    // Optimistic update
    const now = Date.now();
    setInstalledApps((prev) => [
      ...prev,
      {
        id: manifest.id,
        manifest,
        installed_at: now,
        updated_at: now,
        enabled: true,
        install_source: 'registry',
      },
    ]);
  }, []);

  const uninstallApp = useCallback(
    async (appId: string) => {
      const kernel = getKernelClient();
      if (kernel.connected) {
        try {
          const ws = (kernel as any).ws as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN) {
            const id = createMessageId();
            ws.send(JSON.stringify({ type: 'app.uninstall', id, appId }));
          }
        } catch (err) {
          console.error('[AppStore] Uninstall failed:', err);
        }
      }
      setInstalledApps((prev) => prev.filter((a) => a.id !== appId));
      if (selectedAppId === appId) setSelectedAppId(null);
    },
    [selectedAppId],
  );

  const toggleApp = useCallback(
    async (appId: string) => {
      const app = installedApps.find((a) => a.id === appId);
      if (!app) return;

      const kernel = getKernelClient();
      if (kernel.connected) {
        try {
          const ws = (kernel as any).ws as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN) {
            const id = createMessageId();
            const type = app.enabled ? 'app.disable' : 'app.enable';
            ws.send(JSON.stringify({ type, id, appId }));
          }
        } catch (err) {
          console.error('[AppStore] Toggle failed:', err);
        }
      }
      setInstalledApps((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, enabled: !a.enabled } : a)),
      );
    },
    [installedApps],
  );

  // Computed data
  const installedIds = new Set(installedApps.map((a) => a.id));

  const allApps: AetherAppManifest[] = MOCK_REGISTRY;

  const displayApps = activeTab === 'installed' ? installedApps.map((a) => a.manifest) : allApps;

  const filteredApps = displayApps.filter((m) => {
    if (selectedCategory !== 'all' && m.category !== selectedCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.author.toLowerCase().includes(q) ||
        (m.keywords && m.keywords.some((kw) => kw.toLowerCase().includes(q)))
      );
    }
    return true;
  });

  const selectedManifest =
    allApps.find((m) => m.id === selectedAppId) ||
    installedApps.find((a) => a.id === selectedAppId)?.manifest ||
    null;
  const selectedInstalledApp = installedApps.find((a) => a.id === selectedAppId);

  const categories: AppCategory[] = [
    'all',
    'productivity',
    'development',
    'communication',
    'utilities',
    'monitoring',
    'entertainment',
    'ai',
  ];

  return (
    <div className="flex h-full bg-[#0f111a] text-gray-300 font-sans overflow-hidden select-none">
      {/* Left Sidebar: Categories */}
      <div className="w-52 bg-[#0d0f14] border-r border-white/5 flex flex-col shrink-0">
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Store size={14} className="text-cyan-400" />
            <span className="text-xs font-semibold text-white tracking-wide">App Store</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="p-2 border-b border-white/5">
          <div className="flex bg-white/[0.03] rounded-lg border border-white/5 p-0.5">
            {(['browse', 'installed'] as ViewTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab);
                  setSelectedAppId(null);
                }}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {tab === 'browse' ? 'Browse' : `Installed (${installedApps.length})`}
              </button>
            ))}
          </div>
        </div>

        {/* Category list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {categories.map((cat) => {
            const isActive = selectedCategory === cat;
            const count =
              cat === 'all'
                ? displayApps.length
                : displayApps.filter((m) => m.category === cat).length;

            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setSelectedAppId(null);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg transition-all duration-150 flex items-center justify-between ${
                  isActive
                    ? 'bg-indigo-500/15 border border-indigo-500/20 text-white'
                    : 'border border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                <span className="text-[11px] font-medium">{CATEGORY_LABELS[cat]}</span>
                <span
                  className={`text-[10px] font-mono ${isActive ? 'text-indigo-400' : 'text-gray-600'}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Connection status */}
        <div className="p-3 border-t border-white/5 flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${kernelConnected ? 'bg-green-400' : 'bg-gray-600'}`}
          />
          <span className="text-[10px] text-gray-500">
            {kernelConnected ? 'Kernel Connected' : 'Demo Mode'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header Bar */}
        <div className="px-4 py-2.5 bg-[#0d0f14]/80 border-b border-white/5 flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-[11px]">
            <Package size={12} className="text-gray-500" />
            <span className="text-white font-medium">{filteredApps.length}</span>
            <span className="text-gray-500">apps</span>
          </div>
          <div className="w-px h-3.5 bg-white/10" />
          <div className="flex items-center gap-1.5 text-[11px]">
            <CheckCircle2 size={12} className="text-green-400" />
            <span className="text-white font-medium">{installedApps.length}</span>
            <span className="text-gray-500">installed</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!kernelConnected && (
              <span className="text-[10px] text-yellow-500/70 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                Demo Mode
              </span>
            )}
            <button
              onClick={loadInstalledApps}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-white/5">
          <div className="relative">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search apps by name, keyword, or author..."
              className="w-full bg-white/[0.03] border border-white/5 rounded-lg pl-8 pr-8 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30 focus:bg-white/[0.05] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-gray-300 transition-colors"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {/* App Grid + Detail Panel */}
        <div className="flex-1 flex overflow-hidden">
          <div
            className={`flex-1 overflow-y-auto p-3 space-y-2 transition-all ${selectedManifest ? 'max-w-[55%]' : ''}`}
          >
            {filteredApps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600 gap-3">
                <Store size={32} className="opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-500">No apps found</p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {searchQuery
                      ? 'Try a different search query'
                      : activeTab === 'installed'
                        ? 'No apps installed yet. Browse to find apps.'
                        : 'No apps in this category'}
                  </p>
                </div>
              </div>
            ) : (
              filteredApps.map((manifest) => {
                const isInstalled = installedIds.has(manifest.id);
                const installedApp = installedApps.find((a) => a.id === manifest.id);
                return (
                  <AppCard
                    key={manifest.id}
                    manifest={manifest}
                    installed={isInstalled}
                    enabled={installedApp?.enabled}
                    onInstall={() => installApp(manifest)}
                    onUninstall={() => uninstallApp(manifest.id)}
                    onToggle={() => toggleApp(manifest.id)}
                    onClick={() =>
                      setSelectedAppId(manifest.id === selectedAppId ? null : manifest.id)
                    }
                  />
                );
              })
            )}
          </div>

          {/* Detail Panel */}
          {selectedManifest && (
            <div className="w-[45%] max-w-[400px] border-l border-white/5 bg-[#0d0f14]/50">
              <AppDetailPanel
                manifest={selectedManifest}
                installed={installedIds.has(selectedManifest.id)}
                installedApp={selectedInstalledApp}
                onClose={() => setSelectedAppId(null)}
                onInstall={() => installApp(selectedManifest)}
                onUninstall={() => uninstallApp(selectedManifest.id)}
                onToggle={() => toggleApp(selectedManifest.id)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
