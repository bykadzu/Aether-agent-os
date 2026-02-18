import React, { useState, useEffect, useCallback } from 'react';
import {
  Plug,
  GitBranch,
  Check,
  X,
  RefreshCw,
  Activity,
  ExternalLink,
  Shield,
  ChevronRight,
  Search,
  ToggleLeft,
  ToggleRight,
  AlertCircle,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type IntegrationType = 'github' | 'gitlab' | 'slack' | 'jira' | 'linear' | 'custom';

interface IntegrationActionDef {
  name: string;
  description: string;
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
}

interface IntegrationInfo {
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

interface _IntegrationLogEntry {
  id: number;
  integration_id: string;
  action: string;
  status: 'success' | 'error';
  request_summary?: string;
  response_summary?: string;
  duration_ms: number;
  created_at: number;
}

interface IntegrationTypeInfo {
  type: IntegrationType;
  name: string;
  description: string;
  iconName: string;
  available: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INTEGRATION_TYPES: IntegrationTypeInfo[] = [
  {
    type: 'github',
    name: 'GitHub',
    description: 'Repositories, PRs, issues, and more',
    iconName: 'github',
    available: true,
  },
  {
    type: 'slack',
    name: 'Slack',
    description: 'Messages, channels, notifications',
    iconName: 'slack',
    available: false,
  },
  {
    type: 'gitlab',
    name: 'GitLab',
    description: 'Repositories, merge requests, CI/CD',
    iconName: 'gitlab',
    available: false,
  },
  {
    type: 'jira',
    name: 'Jira',
    description: 'Issues, sprints, project boards',
    iconName: 'jira',
    available: false,
  },
  {
    type: 'linear',
    name: 'Linear',
    description: 'Issues, cycles, team workflows',
    iconName: 'linear',
    available: false,
  },
];

// ---------------------------------------------------------------------------
// Icon resolver
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.FC<{ size?: number; className?: string }>> = {
  github: GitBranch,
  gitlab: GitBranch,
  slack: Activity,
  jira: Shield,
  linear: Activity,
};

function renderIcon(iconName: string, size: number, className: string): React.ReactNode {
  const Icon = ICON_MAP[iconName] || Plug;
  return <Icon size={size} className={className} />;
}

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

// ---------------------------------------------------------------------------
// Sub-Components
// ---------------------------------------------------------------------------

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, string> = {
    connected: 'bg-green-500/20 text-green-400 border-green-500/30',
    disconnected: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    error: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full border ${colors[status] || colors.disconnected}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${status === 'connected' ? 'bg-green-400' : status === 'error' ? 'bg-red-400' : 'bg-gray-400'}`}
      />
      {status}
    </span>
  );
};

const ActionCard: React.FC<{
  action: IntegrationActionDef;
  onExecute: () => void;
}> = ({ action, onExecute }) => (
  <div className="p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-medium text-white">{action.name}</span>
      <button
        onClick={onExecute}
        className="px-2 py-0.5 text-[10px] rounded bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 transition-colors"
      >
        Execute
      </button>
    </div>
    <p className="text-[10px] text-gray-500">{action.description}</p>
    {action.parameters && (
      <div className="mt-1.5 flex flex-wrap gap-1">
        {Object.entries(action.parameters).map(([key, def]) => (
          <span
            key={key}
            className={`px-1.5 py-0.5 text-[9px] rounded ${def.required ? 'bg-amber-500/10 text-amber-400' : 'bg-white/5 text-gray-500'}`}
          >
            {key}
            {def.required ? '*' : ''}
          </span>
        ))}
      </div>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const IntegrationsApp: React.FC = () => {
  const [kernelConnected, setKernelConnected] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedType, setSelectedType] = useState<IntegrationType>('github');
  const [tokenInput, setTokenInput] = useState('');
  const [nameInput, setNameInput] = useState('GitHub');
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Action execution state
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [actionParams, setActionParams] = useState<Record<string, string>>({});
  const [actionResult, setActionResult] = useState<any>(null);

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

  // Load integrations
  const loadIntegrations = useCallback(async () => {
    const kernel = getKernelClient();
    if (!kernel.connected) {
      setIntegrations([]);
      return;
    }

    setLoading(true);
    try {
      const ws = (kernel as any).ws as WebSocket | null;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setIntegrations([]);
        return;
      }

      const id = createMessageId();
      const responsePromise = new Promise<IntegrationInfo[]>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Timeout'));
        }, 10000);
        const handler = (event: any) => {
          if (event.id === id) {
            clearTimeout(timeout);
            cleanup();
            cleanupErr();
            if (event.type === 'response.ok') {
              resolve(event.data?.integrations || event.data || []);
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

      ws.send(JSON.stringify({ type: 'integration.list', id }));
      const data = await responsePromise;
      setIntegrations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[Integrations] Failed to load:', err);
      setIntegrations([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (kernelConnected) {
      loadIntegrations();
    }
  }, [kernelConnected, loadIntegrations]);

  // Register integration
  const handleRegister = useCallback(async () => {
    const kernel = getKernelClient();
    if (!kernel.connected) return;

    try {
      const ws = (kernel as any).ws as WebSocket | null;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const id = createMessageId();
      ws.send(
        JSON.stringify({
          type: 'integration.register',
          id,
          config: {
            type: selectedType,
            name: nameInput,
            credentials: { token: tokenInput },
          },
        }),
      );

      setTokenInput('');
      setTimeout(() => loadIntegrations(), 500);
    } catch (err) {
      console.error('[Integrations] Register failed:', err);
    }
  }, [selectedType, nameInput, tokenInput, loadIntegrations]);

  // Test connection
  const handleTest = useCallback(
    async (integrationId: string) => {
      const kernel = getKernelClient();
      if (!kernel.connected) return;

      setTesting(true);
      setTestResult(null);

      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const id = createMessageId();
        const responsePromise = new Promise<{ success: boolean; message: string }>(
          (resolve, reject) => {
            const timeout = setTimeout(() => {
              cleanup();
              reject(new Error('Timeout'));
            }, 15000);
            const handler = (event: any) => {
              if (event.id === id) {
                clearTimeout(timeout);
                cleanup();
                cleanupErr();
                if (event.type === 'response.ok') {
                  resolve(event.data || { success: false, message: 'No data' });
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
          },
        );

        ws.send(JSON.stringify({ type: 'integration.test', id, integrationId }));
        const result = await responsePromise;
        setTestResult(result);
        loadIntegrations();
      } catch (err: unknown) {
        setTestResult({
          success: false,
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setTesting(false);
      }
    },
    [loadIntegrations],
  );

  // Toggle integration
  const toggleIntegration = useCallback(
    async (integrationId: string, enabled: boolean) => {
      const kernel = getKernelClient();
      if (!kernel.connected) return;

      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const id = createMessageId();
        const type = enabled ? 'integration.enable' : 'integration.disable';
        ws.send(JSON.stringify({ type, id, integrationId }));
        setTimeout(() => loadIntegrations(), 300);
      } catch (err) {
        console.error('[Integrations] Toggle failed:', err);
      }
    },
    [loadIntegrations],
  );

  // Unregister integration
  const handleUnregister = useCallback(
    async (integrationId: string) => {
      const kernel = getKernelClient();
      if (!kernel.connected) return;

      try {
        const ws = (kernel as any).ws as WebSocket | null;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const id = createMessageId();
        ws.send(JSON.stringify({ type: 'integration.unregister', id, integrationId }));
        setTimeout(() => loadIntegrations(), 300);
      } catch (err) {
        console.error('[Integrations] Unregister failed:', err);
      }
    },
    [loadIntegrations],
  );

  // Get the active integration for the selected type
  const selectedTypeInfo = INTEGRATION_TYPES.find((t) => t.type === selectedType);
  const activeIntegration = integrations.find((i) => i.type === selectedType);

  // Filter actions by search
  const filteredActions = activeIntegration
    ? activeIntegration.available_actions.filter(
        (a) =>
          !searchQuery ||
          a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          a.description.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : [];

  return (
    <div className="flex h-full bg-[#0f111a] text-gray-300 font-sans overflow-hidden select-none">
      {/* Left Sidebar: Integration Types */}
      <div className="w-52 bg-[#0d0f14] border-r border-white/5 flex flex-col shrink-0">
        <div className="p-3 border-b border-white/5">
          <div className="flex items-center gap-2 mb-2">
            <Plug size={14} className="text-cyan-400" />
            <span className="text-xs font-semibold text-white tracking-wide">Integrations</span>
          </div>
        </div>

        {/* Integration type list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {INTEGRATION_TYPES.map((intType) => {
            const isActive = selectedType === intType.type;
            const hasIntegration = integrations.some((i) => i.type === intType.type);

            return (
              <button
                key={intType.type}
                onClick={() => {
                  if (intType.available) setSelectedType(intType.type);
                }}
                disabled={!intType.available}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all duration-150 flex items-center gap-2.5 ${
                  isActive
                    ? 'bg-indigo-500/15 border border-indigo-500/20 text-white'
                    : intType.available
                      ? 'border border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
                      : 'border border-transparent text-gray-600 cursor-not-allowed'
                }`}
              >
                <div className="w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                  {renderIcon(intType.iconName, 14, isActive ? 'text-indigo-400' : 'text-gray-500')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium truncate">{intType.name}</span>
                    {hasIntegration && <Check size={10} className="text-green-400 shrink-0" />}
                  </div>
                  {!intType.available && (
                    <span className="text-[9px] text-gray-600">Coming Soon</span>
                  )}
                </div>
                {intType.available && <ChevronRight size={12} className="text-gray-600 shrink-0" />}
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
        {/* Header */}
        <div className="px-4 py-2.5 bg-[#0d0f14]/80 border-b border-white/5 flex items-center gap-4">
          <div className="flex items-center gap-2">
            {selectedTypeInfo && renderIcon(selectedTypeInfo.iconName, 16, 'text-indigo-400')}
            <span className="text-sm font-medium text-white">
              {selectedTypeInfo?.name || 'Integration'}
            </span>
            {activeIntegration && <StatusBadge status={activeIntegration.status} />}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {!kernelConnected && (
              <span className="text-[10px] text-yellow-500/70 bg-yellow-500/10 px-2 py-0.5 rounded-full">
                Demo Mode
              </span>
            )}
            <button
              onClick={loadIntegrations}
              className="p-1 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {selectedTypeInfo && !selectedTypeInfo.available ? (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600 gap-3">
              <Plug size={32} className="opacity-30" />
              <div className="text-center">
                <p className="text-sm font-medium text-gray-500">
                  {selectedTypeInfo.name} Integration
                </p>
                <p className="text-[10px] text-gray-600 mt-1">
                  Coming soon. Stay tuned for updates.
                </p>
              </div>
            </div>
          ) : !activeIntegration ? (
            /* Setup form */
            <div className="max-w-md mx-auto space-y-4">
              <div className="text-center mb-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center mx-auto mb-3">
                  {selectedTypeInfo && renderIcon(selectedTypeInfo.iconName, 28, 'text-indigo-400')}
                </div>
                <h2 className="text-base font-medium text-white">
                  Connect {selectedTypeInfo?.name}
                </h2>
                <p className="text-[11px] text-gray-500 mt-1">{selectedTypeInfo?.description}</p>
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                  Integration Name
                </label>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="My GitHub"
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30 transition-all"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1.5">
                  <Shield size={10} className="inline mr-1" />
                  Personal Access Token
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30 transition-all font-mono"
                />
                <p className="text-[9px] text-gray-600 mt-1">
                  Generate a token at github.com/settings/tokens with repo, issues, and pull request
                  scopes.
                </p>
              </div>

              {testResult && (
                <div
                  className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                    testResult.success
                      ? 'bg-green-500/10 border-green-500/20 text-green-400'
                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                  }`}
                >
                  {testResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
                  {testResult.message}
                </div>
              )}

              <button
                onClick={handleRegister}
                disabled={!tokenInput.trim() || !nameInput.trim()}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-xs font-bold"
              >
                <Plug size={14} />
                Connect Integration
              </button>
            </div>
          ) : (
            /* Connected view */
            <div className="space-y-4">
              {/* Connection info card */}
              <div className="p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-white/10 flex items-center justify-center">
                      {selectedTypeInfo &&
                        renderIcon(selectedTypeInfo.iconName, 20, 'text-indigo-400')}
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">{activeIntegration.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        <StatusBadge status={activeIntegration.status} />
                        <span className="text-[10px] text-gray-600">
                          Connected {relativeTime(activeIntegration.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleTest(activeIntegration.id)}
                      disabled={testing}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-[11px] transition-colors"
                    >
                      <RefreshCw size={10} className={testing ? 'animate-spin' : ''} />
                      Test
                    </button>
                    <button
                      onClick={() =>
                        toggleIntegration(activeIntegration.id, !activeIntegration.enabled)
                      }
                      className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                      title={activeIntegration.enabled ? 'Disable' : 'Enable'}
                    >
                      {activeIntegration.enabled ? (
                        <ToggleRight size={18} className="text-green-400" />
                      ) : (
                        <ToggleLeft size={18} className="text-gray-500" />
                      )}
                    </button>
                    <button
                      onClick={() => handleUnregister(activeIntegration.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                      title="Remove"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {activeIntegration.last_error && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[10px]">
                    <AlertCircle size={12} />
                    {activeIntegration.last_error}
                  </div>
                )}

                {testResult && (
                  <div
                    className={`flex items-center gap-2 p-2 rounded-lg border text-[10px] mt-2 ${
                      testResult.success
                        ? 'bg-green-500/10 border-green-500/20 text-green-400'
                        : 'bg-red-500/10 border-red-500/20 text-red-400'
                    }`}
                  >
                    {testResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
                    {testResult.message}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                    <Activity size={10} className="inline mr-1" />
                    Available Actions ({filteredActions.length})
                  </label>
                  <div className="relative">
                    <Search
                      size={10}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter actions..."
                      className="bg-white/[0.03] border border-white/5 rounded pl-6 pr-2 py-1 text-[10px] text-gray-400 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30 w-40"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  {filteredActions.map((action) => (
                    <ActionCard
                      key={action.name}
                      action={action}
                      onExecute={() => setExecutingAction(action.name)}
                    />
                  ))}
                </div>
              </div>

              {/* Action execution modal */}
              {executingAction && (
                <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-indigo-400">{executingAction}</span>
                    <button
                      onClick={() => {
                        setExecutingAction(null);
                        setActionParams({});
                        setActionResult(null);
                      }}
                      className="p-1 rounded hover:bg-white/10 text-gray-500"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  {(() => {
                    const actionDef = activeIntegration.available_actions.find(
                      (a) => a.name === executingAction,
                    );
                    if (!actionDef?.parameters) return null;

                    return (
                      <div className="space-y-2 mb-3">
                        {Object.entries(actionDef.parameters).map(([key, def]) => (
                          <div key={key}>
                            <label className="text-[9px] text-gray-500 block mb-0.5">
                              {key}
                              {def.required && <span className="text-amber-400">*</span>}
                            </label>
                            <input
                              type="text"
                              value={actionParams[key] || ''}
                              onChange={(e) =>
                                setActionParams((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              placeholder={def.description}
                              className="w-full bg-white/[0.03] border border-white/5 rounded px-2 py-1 text-[10px] text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500/30"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()}

                  <button
                    onClick={async () => {
                      const kernel = getKernelClient();
                      if (!kernel.connected || !activeIntegration) return;
                      try {
                        const ws = (kernel as any).ws as WebSocket | null;
                        if (!ws || ws.readyState !== WebSocket.OPEN) return;
                        const id = createMessageId();
                        const responsePromise = new Promise<any>((resolve, reject) => {
                          const timeout = setTimeout(() => {
                            cleanup();
                            reject(new Error('Timeout'));
                          }, 30000);
                          const handler = (event: any) => {
                            if (event.id === id) {
                              clearTimeout(timeout);
                              cleanup();
                              cleanupErr();
                              resolve(event.data);
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

                        ws.send(
                          JSON.stringify({
                            type: 'integration.execute',
                            id,
                            integrationId: activeIntegration.id,
                            action: executingAction,
                            params: actionParams,
                          }),
                        );
                        const result = await responsePromise;
                        setActionResult(result);
                      } catch (err: unknown) {
                        setActionResult({
                          error: err instanceof Error ? err.message : String(err),
                        });
                      }
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/30 text-[11px] font-medium transition-colors"
                  >
                    <ExternalLink size={10} />
                    Execute Action
                  </button>

                  {actionResult && (
                    <div className="mt-3 p-2 rounded-lg bg-black/20 border border-white/5 max-h-40 overflow-y-auto">
                      <pre className="text-[9px] text-gray-400 whitespace-pre-wrap break-all">
                        {JSON.stringify(actionResult, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
