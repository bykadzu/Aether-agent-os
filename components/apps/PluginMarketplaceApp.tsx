import React, { useState, useEffect, useCallback } from 'react';
import {
  Store,
  Search,
  Download,
  Trash2,
  ToggleLeft,
  ToggleRight,
  X,
  Tag,
  ExternalLink,
  Package,
  RefreshCw,
  CheckCircle2,
  Star,
  MessageSquare,
  GitBranch,
  Cpu,
  Database,
  Palette,
  Bell,
  Shield,
  Settings,
  Wrench,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types (local — mirrors kernel/src/PluginRegistryManager.ts)
// ---------------------------------------------------------------------------

type PluginCategory =
  | 'tools'
  | 'llm-providers'
  | 'data-sources'
  | 'notification-channels'
  | 'auth-providers'
  | 'themes'
  | 'widgets';

interface PluginSettingSchema {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required?: boolean;
  default?: any;
  options?: string[];
  description?: string;
}

interface PluginRegistryManifest {
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

interface RegisteredPlugin {
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

type FilterCategory = 'all' | PluginCategory;
type ViewTab = 'browse' | 'installed';

// ---------------------------------------------------------------------------
// Icon resolver
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  MessageSquare,
  GitBranch,
  Cpu,
  Database,
  Palette,
  Bell,
  Shield,
  Wrench,
  Package,
  Store,
  Star,
  Settings,
};

function renderIcon(iconName: string, size: number, className: string): React.ReactNode {
  const Icon = ICON_MAP[iconName] || Package;
  return <Icon size={size} className={className} />;
}

// ---------------------------------------------------------------------------
// Mock Registry
// ---------------------------------------------------------------------------

const MOCK_REGISTRY: PluginRegistryManifest[] = [
  {
    id: 'com.aether.slack-notifications',
    name: 'Slack Notifications',
    version: '1.3.0',
    author: 'Aether Labs',
    description:
      'Send and receive Slack messages directly from Aether agents. Configure webhook URLs, channel routing, and rich message formatting with thread support.',
    category: 'notification-channels',
    icon: 'Bell',
    tools: [
      {
        name: 'send_slack_message',
        description: 'Send a message to a Slack channel',
        parameters: {
          channel: { type: 'string', description: 'Target channel', required: true },
          message: { type: 'string', description: 'Message text', required: true },
        },
      },
      {
        name: 'read_slack_channel',
        description: 'Read recent messages from a Slack channel',
        parameters: {
          channel: { type: 'string', description: 'Channel to read', required: true },
          limit: { type: 'number', description: 'Number of messages' },
        },
      },
    ],
    settings: [
      {
        key: 'webhook_url',
        label: 'Webhook URL',
        type: 'string',
        required: true,
        description: 'Slack Incoming Webhook URL',
      },
      { key: 'default_channel', label: 'Default Channel', type: 'string', default: '#general' },
      { key: 'notify_on_error', label: 'Notify on Error', type: 'boolean', default: true },
    ],
    keywords: ['slack', 'notifications', 'messaging', 'webhooks'],
    repository: 'https://github.com/aether-labs/slack-notifications',
  },
  {
    id: 'com.aether.github-tools',
    name: 'GitHub Tools',
    version: '2.1.0',
    author: 'DevTools Inc.',
    description:
      'Full GitHub integration for Aether agents. Create issues, list pull requests, manage repositories, and automate code review workflows.',
    category: 'tools',
    icon: 'GitBranch',
    tools: [
      {
        name: 'create_github_issue',
        description: 'Create a new GitHub issue',
        parameters: {
          repo: { type: 'string', description: 'Repository (owner/repo)', required: true },
          title: { type: 'string', description: 'Issue title', required: true },
          body: { type: 'string', description: 'Issue body' },
        },
      },
      {
        name: 'list_github_prs',
        description: 'List pull requests for a repository',
        parameters: {
          repo: { type: 'string', description: 'Repository (owner/repo)', required: true },
          state: { type: 'string', description: 'PR state filter (open/closed/all)' },
        },
      },
    ],
    settings: [
      {
        key: 'access_token',
        label: 'Access Token',
        type: 'string',
        required: true,
        description: 'GitHub Personal Access Token',
      },
      { key: 'default_org', label: 'Default Org', type: 'string' },
    ],
    keywords: ['github', 'git', 'issues', 'pull-requests', 'development'],
    repository: 'https://github.com/devtools-inc/aether-github',
  },
  {
    id: 'com.aether.custom-llm',
    name: 'Custom LLM Provider',
    version: '1.0.0',
    author: 'AI Research Co.',
    description:
      'Connect custom or self-hosted LLM endpoints to Aether. Supports OpenAI-compatible APIs, local models via Ollama, and custom inference servers.',
    category: 'llm-providers',
    icon: 'Cpu',
    tools: [
      {
        name: 'query_custom_model',
        description: 'Send a prompt to the custom LLM endpoint',
        parameters: {
          prompt: { type: 'string', description: 'The prompt to send', required: true },
          model: { type: 'string', description: 'Model identifier' },
          temperature: { type: 'number', description: 'Sampling temperature' },
        },
      },
    ],
    settings: [
      {
        key: 'endpoint_url',
        label: 'Endpoint URL',
        type: 'string',
        required: true,
        description: 'LLM API endpoint URL',
      },
      {
        key: 'api_key',
        label: 'API Key',
        type: 'string',
        description: 'API key for authentication',
      },
      {
        key: 'model_name',
        label: 'Model',
        type: 'select',
        options: ['gpt-4', 'llama-3', 'mistral', 'custom'],
        default: 'gpt-4',
      },
    ],
    keywords: ['llm', 'ai', 'models', 'inference', 'custom'],
  },
  {
    id: 'com.aether.notion-connector',
    name: 'Notion Connector',
    version: '1.2.1',
    author: 'DataBridge',
    description:
      'Read and write Notion pages and databases from Aether agents. Sync knowledge bases, create task boards, and automate documentation workflows.',
    category: 'data-sources',
    icon: 'Database',
    tools: [
      {
        name: 'read_notion_page',
        description: 'Read content from a Notion page',
        parameters: {
          page_id: { type: 'string', description: 'Notion page ID', required: true },
        },
      },
      {
        name: 'write_notion_page',
        description: 'Write content to a Notion page',
        parameters: {
          page_id: { type: 'string', description: 'Notion page ID', required: true },
          content: { type: 'string', description: 'Content to write', required: true },
        },
      },
    ],
    settings: [
      {
        key: 'integration_token',
        label: 'Integration Token',
        type: 'string',
        required: true,
        description: 'Notion integration secret',
      },
    ],
    keywords: ['notion', 'database', 'knowledge-base', 'documentation'],
    repository: 'https://github.com/databridge/aether-notion',
  },
  {
    id: 'com.aether.dark-theme',
    name: 'Dark Theme',
    version: '0.9.0',
    author: 'Aether Labs',
    description:
      'A sleek dark theme for the Aether OS interface. Features deep blacks, muted accent colors, and reduced eye strain for extended coding sessions.',
    category: 'themes',
    icon: 'Palette',
    tools: [],
    keywords: ['theme', 'dark', 'ui', 'appearance'],
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

const CATEGORY_LABELS: Record<FilterCategory, string> = {
  all: 'All Plugins',
  tools: 'Tools',
  'llm-providers': 'LLM Providers',
  'data-sources': 'Data Sources',
  'notification-channels': 'Notifications',
  'auth-providers': 'Auth Providers',
  themes: 'Themes',
  widgets: 'Widgets',
};

const CATEGORY_COLORS: Record<string, string> = {
  tools: 'text-green-400',
  'llm-providers': 'text-cyan-400',
  'data-sources': 'text-blue-400',
  'notification-channels': 'text-purple-400',
  'auth-providers': 'text-amber-400',
  themes: 'text-pink-400',
  widgets: 'text-orange-400',
};

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

function renderStars(avg: number, count: number): React.ReactNode {
  const stars: React.ReactNode[] = [];
  for (let i = 1; i <= 5; i++) {
    const filled = i <= Math.round(avg);
    stars.push(
      <Star
        key={i}
        size={10}
        className={filled ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}
      />,
    );
  }
  return (
    <span className="flex items-center gap-0.5">
      {stars}
      {count > 0 && <span className="text-[9px] text-gray-500 ml-1">({count})</span>}
    </span>
  );
}

const PluginCard: React.FC<{
  manifest: PluginRegistryManifest;
  installed: boolean;
  enabled?: boolean;
  ratingAvg: number;
  ratingCount: number;
  downloadCount: number;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: () => void;
  onClick: () => void;
}> = ({
  manifest,
  installed,
  enabled,
  ratingAvg,
  ratingCount,
  downloadCount,
  onInstall,
  onUninstall,
  onToggle,
  onClick,
}) => {
  const categoryColor = CATEGORY_COLORS[manifest.category] || 'text-gray-400';

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
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-gray-500">{manifest.author}</span>
            <span className="text-[10px] text-gray-600">v{manifest.version}</span>
            <span className={`text-[10px] font-medium ${categoryColor}`}>
              {CATEGORY_LABELS[manifest.category] || manifest.category}
            </span>
          </div>
          <div className="flex items-center gap-3 mb-1.5">
            {renderStars(ratingAvg, ratingCount)}
            <span className="flex items-center gap-1 text-[9px] text-gray-500">
              <Download size={8} />
              {downloadCount}
            </span>
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

const PluginDetailPanel: React.FC<{
  manifest: PluginRegistryManifest;
  installed: boolean;
  plugin?: RegisteredPlugin;
  onClose: () => void;
  onInstall: () => void;
  onUninstall: () => void;
  onToggle: () => void;
}> = ({ manifest, installed, plugin, onClose, onInstall, onUninstall, onToggle }) => {
  const categoryColor = CATEGORY_COLORS[manifest.category] || 'text-gray-400';

  return (
    <div className="flex flex-col h-full animate-fade-in">
      <div className="p-4 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
          Plugin Details
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

        {/* Rating */}
        {plugin && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
              Rating
            </label>
            {renderStars(plugin.rating_avg, plugin.rating_count)}
          </div>
        )}

        {/* Category */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Category
          </label>
          <span className={`text-xs font-medium ${categoryColor}`}>
            {CATEGORY_LABELS[manifest.category] || manifest.category}
          </span>
        </div>

        {/* Description */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Description
          </label>
          <p className="text-xs text-gray-300 leading-relaxed">{manifest.description}</p>
        </div>

        {/* Plugin ID */}
        <div>
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Plugin ID
          </label>
          <span className="text-xs font-mono text-cyan-400/80">{manifest.id}</span>
        </div>

        {/* Tools */}
        {manifest.tools.length > 0 && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
              <Wrench size={10} className="inline mr-1" />
              Tools ({manifest.tools.length})
            </label>
            <div className="space-y-1.5">
              {manifest.tools.map((tool) => (
                <div
                  key={tool.name}
                  className="px-2 py-1.5 rounded bg-white/5 border border-white/5"
                >
                  <span className="text-[11px] font-mono text-indigo-400">{tool.name}</span>
                  <p className="text-[10px] text-gray-500 mt-0.5">{tool.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Settings Schema */}
        {manifest.settings && manifest.settings.length > 0 && (
          <div>
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
              <Settings size={10} className="inline mr-1" />
              Settings
            </label>
            <div className="space-y-2">
              {manifest.settings.map((setting) => (
                <div
                  key={setting.key}
                  className="px-2 py-1.5 rounded bg-white/5 border border-white/5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-gray-300">{setting.label}</span>
                    <span className="text-[9px] text-gray-600 font-mono">{setting.type}</span>
                    {setting.required && <span className="text-[9px] text-red-400">required</span>}
                  </div>
                  {setting.description && (
                    <p className="text-[10px] text-gray-500 mt-0.5">{setting.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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
        {installed && plugin && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Installed
              </label>
              <span className="text-xs text-gray-300">{relativeTime(plugin.installed_at)}</span>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Source
              </label>
              <span className="text-xs text-gray-300">{plugin.install_source}</span>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Status
              </label>
              <span
                className={`text-xs font-medium ${plugin.enabled ? 'text-green-400' : 'text-gray-500'}`}
              >
                {plugin.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div>
              <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                Downloads
              </label>
              <span className="text-xs text-gray-300">{plugin.download_count}</span>
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
              {plugin?.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
              {plugin?.enabled ? 'Disable' : 'Enable'}
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
            Install Plugin
          </button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const PluginMarketplaceApp: React.FC = () => {
  const [kernelConnected, setKernelConnected] = useState(false);
  const [installedPlugins, setInstalledPlugins] = useState<RegisteredPlugin[]>([]);
  const [loading, setLoading] = useState(false);

  const [activeTab, setActiveTab] = useState<ViewTab>('browse');
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

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

  // Load installed plugins from kernel
  const loadInstalledPlugins = useCallback(async () => {
    const kernel = getKernelClient();
    if (!kernel.connected) {
      setInstalledPlugins([]);
      return;
    }

    setLoading(true);
    try {
      const ws = (kernel as any).ws as WebSocket | null;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setInstalledPlugins([]);
        return;
      }

      const id = createMessageId();
      const responsePromise = new Promise<RegisteredPlugin[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, 10000);
        const handler = (event: any) => {
          if (event.id === id) {
            clearTimeout(timeout);
            cleanup();
            if (event.type === 'response.ok') {
              resolve(event.data?.plugins || event.data || []);
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

      ws.send(JSON.stringify({ type: 'plugin.registry.list', id }));
      const data = await responsePromise;
      setInstalledPlugins(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[PluginMarketplace] Failed to load plugins:', err);
      setInstalledPlugins([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kernelConnected) {
      loadInstalledPlugins();
    }
  }, [kernelConnected, loadInstalledPlugins]);

  // Install / uninstall / toggle
  const installPlugin = useCallback(async (manifest: PluginRegistryManifest) => {
    const kernel = getKernelClient();
    if (kernel.connected) {
      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const id = createMessageId();
          ws.send(
            JSON.stringify({ type: 'plugin.registry.install', id, manifest, source: 'registry' }),
          );
        }
      } catch (err) {
        console.error('[PluginMarketplace] Install failed:', err);
      }
    }
    // Optimistic update
    const now = Date.now();
    setInstalledPlugins((prev) => [
      ...prev,
      {
        id: manifest.id,
        manifest,
        installed_at: now,
        updated_at: now,
        enabled: true,
        install_source: 'registry',
        download_count: 0,
        rating_avg: 0,
        rating_count: 0,
      },
    ]);
  }, []);

  const uninstallPlugin = useCallback(
    async (pluginId: string) => {
      const kernel = getKernelClient();
      if (kernel.connected) {
        try {
          const ws = (kernel as any).ws as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN) {
            const id = createMessageId();
            ws.send(JSON.stringify({ type: 'plugin.registry.uninstall', id, pluginId }));
          }
        } catch (err) {
          console.error('[PluginMarketplace] Uninstall failed:', err);
        }
      }
      setInstalledPlugins((prev) => prev.filter((p) => p.id !== pluginId));
      if (selectedPluginId === pluginId) setSelectedPluginId(null);
    },
    [selectedPluginId],
  );

  const togglePlugin = useCallback(
    async (pluginId: string) => {
      const plugin = installedPlugins.find((p) => p.id === pluginId);
      if (!plugin) return;

      const kernel = getKernelClient();
      if (kernel.connected) {
        try {
          const ws = (kernel as any).ws as WebSocket | null;
          if (ws && ws.readyState === WebSocket.OPEN) {
            const id = createMessageId();
            const type = plugin.enabled ? 'plugin.registry.disable' : 'plugin.registry.enable';
            ws.send(JSON.stringify({ type, id, pluginId }));
          }
        } catch (err) {
          console.error('[PluginMarketplace] Toggle failed:', err);
        }
      }
      setInstalledPlugins((prev) =>
        prev.map((p) => (p.id === pluginId ? { ...p, enabled: !p.enabled } : p)),
      );
    },
    [installedPlugins],
  );

  // Computed data
  const installedIds = new Set(installedPlugins.map((p) => p.id));

  const allManifests: PluginRegistryManifest[] = MOCK_REGISTRY;

  const displayManifests =
    activeTab === 'installed' ? installedPlugins.map((p) => p.manifest) : allManifests;

  const filteredManifests = displayManifests.filter((m) => {
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
    allManifests.find((m) => m.id === selectedPluginId) ||
    installedPlugins.find((p) => p.id === selectedPluginId)?.manifest ||
    null;
  const selectedPlugin = installedPlugins.find((p) => p.id === selectedPluginId);

  const categories: FilterCategory[] = [
    'all',
    'tools',
    'llm-providers',
    'data-sources',
    'notification-channels',
    'auth-providers',
    'themes',
    'widgets',
  ];

  return (
    <div className="flex h-full bg-[#0f111a] text-gray-300 font-sans overflow-hidden select-none">
      {/* Left Sidebar: Categories */}
      <div className="w-52 bg-[#0d0f14] border-r border-white/5 flex flex-col shrink-0">
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Store size={14} className="text-cyan-400" />
            <span className="text-xs font-semibold text-white tracking-wide">
              Plugin Marketplace
            </span>
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
                  setSelectedPluginId(null);
                }}
                className={`flex-1 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                  activeTab === tab
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {tab === 'browse' ? 'Browse' : `Installed (${installedPlugins.length})`}
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
                ? displayManifests.length
                : displayManifests.filter((m) => m.category === cat).length;

            return (
              <button
                key={cat}
                onClick={() => {
                  setSelectedCategory(cat);
                  setSelectedPluginId(null);
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
            <span className="text-white font-medium">{filteredManifests.length}</span>
            <span className="text-gray-500">plugins</span>
          </div>
          <div className="w-px h-3.5 bg-white/10" />
          <div className="flex items-center gap-1.5 text-[11px]">
            <CheckCircle2 size={12} className="text-green-400" />
            <span className="text-white font-medium">{installedPlugins.length}</span>
            <span className="text-gray-500">installed</span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!kernelConnected && (
              <span className="text-[10px] text-yellow-500/70 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                Demo Mode
              </span>
            )}
            <button
              onClick={loadInstalledPlugins}
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
              placeholder="Search plugins by name, keyword, or author..."
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

        {/* Plugin Grid + Detail Panel */}
        <div className="flex-1 flex overflow-hidden">
          <div
            className={`flex-1 overflow-y-auto p-3 space-y-2 transition-all ${selectedManifest ? 'max-w-[55%]' : ''}`}
          >
            {filteredManifests.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600 gap-3">
                <Store size={32} className="opacity-30" />
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-500">No plugins found</p>
                  <p className="text-[10px] text-gray-600 mt-1">
                    {searchQuery
                      ? 'Try a different search query'
                      : activeTab === 'installed'
                        ? 'No plugins installed yet. Browse to find plugins.'
                        : 'No plugins in this category'}
                  </p>
                </div>
              </div>
            ) : (
              filteredManifests.map((manifest) => {
                const isInstalled = installedIds.has(manifest.id);
                const plugin = installedPlugins.find((p) => p.id === manifest.id);
                return (
                  <PluginCard
                    key={manifest.id}
                    manifest={manifest}
                    installed={isInstalled}
                    enabled={plugin?.enabled}
                    ratingAvg={plugin?.rating_avg || 0}
                    ratingCount={plugin?.rating_count || 0}
                    downloadCount={plugin?.download_count || 0}
                    onInstall={() => installPlugin(manifest)}
                    onUninstall={() => uninstallPlugin(manifest.id)}
                    onToggle={() => togglePlugin(manifest.id)}
                    onClick={() =>
                      setSelectedPluginId(manifest.id === selectedPluginId ? null : manifest.id)
                    }
                  />
                );
              })
            )}
          </div>

          {/* Detail Panel */}
          {selectedManifest && (
            <div className="w-[45%] max-w-[400px] border-l border-white/5 bg-[#0d0f14]/50">
              <PluginDetailPanel
                manifest={selectedManifest}
                installed={installedIds.has(selectedManifest.id)}
                plugin={selectedPlugin}
                onClose={() => setSelectedPluginId(null)}
                onInstall={() => installPlugin(selectedManifest)}
                onUninstall={() => uninstallPlugin(selectedManifest.id)}
                onToggle={() => togglePlugin(selectedManifest.id)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
