import React, { useState, useEffect, useCallback } from 'react';
import {
  Wifi,
  Moon,
  Sun,
  Lock,
  Monitor,
  Bell,
  Search,
  Info,
  Server,
  Cpu,
  HardDrive,
  Zap,
  Bot,
  Key,
  Activity,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Play,
  Calendar,
} from 'lucide-react';
import { getKernelClient, GPUInfo, ClusterInfo } from '../../services/kernelClient';
import { useTheme, ThemeMode } from '../../services/themeManager';

interface AgentConfig {
  role: string;
  goal: string;
  model?: string;
  tools?: string[];
  maxSteps?: number;
}

interface CronJob {
  id: string;
  name: string;
  cron_expression: string;
  agent_config: AgentConfig;
  enabled: boolean;
  owner_uid: string;
  last_run?: number;
  next_run: number;
  run_count: number;
  created_at: number;
}

interface EventTrigger {
  id: string;
  name: string;
  event_type: string;
  event_filter?: Record<string, any>;
  agent_config: AgentConfig;
  enabled: boolean;
  owner_uid: string;
  cooldown_ms: number;
  last_fired?: number;
  fire_count: number;
  created_at: number;
}

const MOCK_CRON_JOBS: CronJob[] = [
  {
    id: 'cron-1',
    name: 'Daily Code Review',
    cron_expression: '0 9 * * *',
    agent_config: { role: 'Reviewer', goal: 'Review recent commits for code quality' },
    enabled: true,
    owner_uid: 'user-1',
    next_run: Date.now() + 3600000,
    run_count: 12,
    created_at: Date.now() - 86400000 * 7,
  },
  {
    id: 'cron-2',
    name: 'Hourly Health Check',
    cron_expression: '0 * * * *',
    agent_config: { role: 'Monitor', goal: 'Check system health and report issues' },
    enabled: false,
    owner_uid: 'user-1',
    next_run: Date.now() + 1800000,
    run_count: 168,
    created_at: Date.now() - 86400000 * 14,
  },
];

const MOCK_TRIGGERS: EventTrigger[] = [
  {
    id: 'trigger-1',
    name: 'New Error Handler',
    event_type: 'process.exit',
    agent_config: { role: 'Debugger', goal: 'Analyze the error and suggest fixes' },
    enabled: true,
    owner_uid: 'user-1',
    cooldown_ms: 60000,
    fire_count: 5,
    created_at: Date.now() - 86400000 * 3,
  },
];

const EVENT_TYPES = [
  'process.exit',
  'process.spawned',
  'process.stateChange',
  'fs.changed',
  'agent.completed',
  'agent.failed',
  'container.stopped',
  'ipc.message',
  'kernel.metrics',
];

interface LLMProviderInfo {
  name: string;
  available: boolean;
  models: string[];
}

export const SettingsApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState('General');
  const { mode: themeMode, setMode: setThemeMode, theme, isDark } = useTheme();
  const [kernelConnected, setKernelConnected] = useState(false);
  const [kernelMetrics, setKernelMetrics] = useState<{
    uptime: number;
    memoryMB: number;
    cpuPercent: number;
  } | null>(null);
  const [llmProviders, setLlmProviders] = useState<LLMProviderInfo[]>([]);
  const [gpuInfo, setGpuInfo] = useState<{ available: boolean; gpus: GPUInfo[] }>({
    available: false,
    gpus: [],
  });
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string } | null>(null);
  const [geminiKey, setGeminiKey] = useState(localStorage.getItem('gemini_api_key') || '');

  // Automation state
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [triggers, setTriggers] = useState<EventTrigger[]>([]);
  const [newCronName, setNewCronName] = useState('');
  const [newCronExpression, setNewCronExpression] = useState('');
  const [newCronRole, setNewCronRole] = useState('');
  const [newCronGoal, setNewCronGoal] = useState('');
  const [newCronModel, setNewCronModel] = useState('');
  const [newTriggerName, setNewTriggerName] = useState('');
  const [newTriggerEventType, setNewTriggerEventType] = useState('process.exit');
  const [newTriggerRole, setNewTriggerRole] = useState('');
  const [newTriggerGoal, setNewTriggerGoal] = useState('');
  const [newTriggerCooldown, setNewTriggerCooldown] = useState('60000');

  useEffect(() => {
    const client = getKernelClient();
    setKernelConnected(client.connected);

    if (client.connected) {
      // Subscribe to metrics
      const unsub = client.on('kernel.metrics', (data: any) => {
        setKernelMetrics({
          uptime: data.uptime || 0,
          memoryMB: data.memoryMB || 0,
          cpuPercent: data.cpuPercent || 0,
        });
      });

      client
        .getStatus()
        .then((status) => {
          if (status?.uptime) {
            setKernelMetrics((prev) => ({
              ...prev!,
              uptime: status.uptime,
              memoryMB: prev?.memoryMB || 0,
              cpuPercent: prev?.cpuPercent || 0,
            }));
          }
        })
        .catch(() => {});

      client
        .getGPUs()
        .then((data) => {
          setGpuInfo({ available: data.gpus.length > 0, gpus: data.gpus });
        })
        .catch(() => {});

      client
        .getClusterInfo()
        .then((info) => {
          setClusterInfo(info);
        })
        .catch(() => {});

      // Fetch user info from localStorage token
      const userStr = localStorage.getItem('aether_user');
      if (userStr) {
        try {
          setCurrentUser(JSON.parse(userStr));
        } catch {}
      }

      return unsub;
    }

    // Fetch LLM providers
    fetch('http://localhost:3001/api/llm/providers')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setLlmProviders(data))
      .catch(() => setLlmProviders([]));
  }, []);

  // Load automation data when tab is active
  useEffect(() => {
    if (activeTab !== 'Automation') return;

    const client = getKernelClient();

    if (client.connected) {
      // Load cron jobs
      client
        .listCronJobs()
        .then((jobs: CronJob[]) => setCronJobs(jobs))
        .catch(() => setCronJobs(MOCK_CRON_JOBS));

      // Load triggers
      client
        .listTriggers()
        .then((trigs: EventTrigger[]) => setTriggers(trigs))
        .catch(() => setTriggers(MOCK_TRIGGERS));

      // Subscribe to live updates
      const unsubCronList = client.on('cron.list', (data: any) => {
        if (data.jobs) setCronJobs(data.jobs);
      });
      const unsubCronCreated = client.on('cron.created', (data: any) => {
        if (data.job) setCronJobs((prev) => [...prev, data.job]);
      });
      const unsubCronDeleted = client.on('cron.deleted', (data: any) => {
        if (data.jobId) setCronJobs((prev) => prev.filter((j) => j.id !== data.jobId));
      });
      const unsubTriggerList = client.on('trigger.list', (data: any) => {
        if (data.triggers) setTriggers(data.triggers);
      });
      const unsubTriggerCreated = client.on('trigger.created', (data: any) => {
        if (data.trigger) setTriggers((prev) => [...prev, data.trigger]);
      });
      const unsubTriggerDeleted = client.on('trigger.deleted', (data: any) => {
        if (data.triggerId) setTriggers((prev) => prev.filter((t) => t.id !== data.triggerId));
      });

      return () => {
        unsubCronList();
        unsubCronCreated();
        unsubCronDeleted();
        unsubTriggerList();
        unsubTriggerCreated();
        unsubTriggerDeleted();
      };
    } else {
      // Use mock data when disconnected
      setCronJobs(MOCK_CRON_JOBS);
      setTriggers(MOCK_TRIGGERS);
    }
  }, [activeTab]);

  const handleSaveGeminiKey = () => {
    localStorage.setItem('gemini_api_key', geminiKey);
    // Also set it for the geminiService
    (window as any).__GEMINI_API_KEY = geminiKey;
  };

  const formatUptime = (seconds: number) => {
    if (!seconds) return '--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  const handleCreateCronJob = () => {
    if (!newCronName || !newCronExpression || !newCronRole || !newCronGoal) return;
    const client = getKernelClient();
    const agentConfig: AgentConfig = {
      role: newCronRole,
      goal: newCronGoal,
      ...(newCronModel ? { model: newCronModel } : {}),
    };

    if (client.connected) {
      client.createCronJob(newCronName, newCronExpression, agentConfig, 'user-1').catch(() => {});
    } else {
      // Mock: add locally
      const newJob: CronJob = {
        id: `cron-${Date.now()}`,
        name: newCronName,
        cron_expression: newCronExpression,
        agent_config: agentConfig,
        enabled: true,
        owner_uid: 'user-1',
        next_run: Date.now() + 3600000,
        run_count: 0,
        created_at: Date.now(),
      };
      setCronJobs((prev) => [...prev, newJob]);
    }

    setNewCronName('');
    setNewCronExpression('');
    setNewCronRole('');
    setNewCronGoal('');
    setNewCronModel('');
  };

  const handleDeleteCronJob = (jobId: string) => {
    const client = getKernelClient();
    if (client.connected) {
      client.deleteCronJob(jobId).catch(() => {});
    } else {
      setCronJobs((prev) => prev.filter((j) => j.id !== jobId));
    }
  };

  const handleToggleCronJob = (job: CronJob) => {
    const client = getKernelClient();
    if (client.connected) {
      if (job.enabled) {
        client.disableCronJob(job.id).catch(() => {});
      } else {
        client.enableCronJob(job.id).catch(() => {});
      }
    } else {
      setCronJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)));
    }
  };

  const handleCreateTrigger = () => {
    if (!newTriggerName || !newTriggerEventType || !newTriggerRole || !newTriggerGoal) return;
    const client = getKernelClient();
    const agentConfig: AgentConfig = {
      role: newTriggerRole,
      goal: newTriggerGoal,
    };
    const cooldown = parseInt(newTriggerCooldown) || 60000;

    if (client.connected) {
      client
        .createTrigger(newTriggerName, newTriggerEventType, agentConfig, 'user-1', cooldown)
        .catch(() => {});
    } else {
      const newTrigger: EventTrigger = {
        id: `trigger-${Date.now()}`,
        name: newTriggerName,
        event_type: newTriggerEventType,
        agent_config: agentConfig,
        enabled: true,
        owner_uid: 'user-1',
        cooldown_ms: cooldown,
        fire_count: 0,
        created_at: Date.now(),
      };
      setTriggers((prev) => [...prev, newTrigger]);
    }

    setNewTriggerName('');
    setNewTriggerEventType('process.exit');
    setNewTriggerRole('');
    setNewTriggerGoal('');
    setNewTriggerCooldown('60000');
  };

  const handleDeleteTrigger = (triggerId: string) => {
    const client = getKernelClient();
    if (client.connected) {
      client.deleteTrigger(triggerId).catch(() => {});
    } else {
      setTriggers((prev) => prev.filter((t) => t.id !== triggerId));
    }
  };

  const formatCronExpression = (expr: string): string => {
    const parts = expr.split(' ');
    if (parts.length !== 5) return expr;
    const [min, hour] = parts;
    const pieces: string[] = [];
    if (min === '0' && hour !== '*') pieces.push(`at ${hour}:00`);
    else if (min.startsWith('*/')) pieces.push(`every ${min.slice(2)} min`);
    else if (hour === '*' && min === '0') pieces.push('every hour');
    else pieces.push(expr);
    return pieces.join(' ');
  };

  const formatRelativeTime = useCallback((timestamp: number): string => {
    const diff = timestamp - Date.now();
    if (diff < 0) return 'overdue';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `in ${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `in ${hours}h ${mins % 60}m`;
    const days = Math.floor(hours / 24);
    return `in ${days}d ${hours % 24}h`;
  }, []);

  const formatCooldown = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    const secs = ms / 1000;
    if (secs < 60) return `${secs}s`;
    const mins = secs / 60;
    if (mins < 60) return `${mins}m`;
    return `${mins / 60}h`;
  };

  const categories = [
    { name: 'General', icon: Info, color: 'bg-gray-500' },
    { name: 'Kernel', icon: Server, color: 'bg-indigo-500' },
    { name: 'LLM Providers', icon: Bot, color: 'bg-purple-500' },
    { name: 'Appearance', icon: Moon, color: 'bg-blue-500' },
    { name: 'Network', icon: Wifi, color: 'bg-blue-400' },
    { name: 'Privacy', icon: Lock, color: 'bg-sky-500' },
    { name: 'Notifications', icon: Bell, color: 'bg-red-500' },
    { name: 'Automation', icon: Zap, color: 'bg-amber-500' },
  ];

  const renderContent = () => {
    return (
      <div className="space-y-6 animate-fade-in">
        {/* User Profile */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
            {currentUser ? currentUser.username[0].toUpperCase() : 'A'}
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-800">
              {currentUser?.username || 'Aether User'}
            </h2>
            <p className="text-sm text-gray-500">
              {currentUser?.role || 'admin'} · Aether OS v0.1.0
            </p>
          </div>
        </div>

        {/* General */}
        {activeTab === 'General' && (
          <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
            <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
              <span className="text-sm font-medium text-gray-700">Version</span>
              <span className="text-xs text-gray-400 font-mono">Aether OS v0.1.0</span>
            </div>
            <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
              <span className="text-sm font-medium text-gray-700">Kernel Status</span>
              <span
                className={`text-xs font-medium flex items-center gap-1 ${kernelConnected ? 'text-green-600' : 'text-red-500'}`}
              >
                <div
                  className={`w-2 h-2 rounded-full ${kernelConnected ? 'bg-green-500' : 'bg-red-500'}`}
                />
                {kernelConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
            {kernelMetrics && (
              <>
                <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
                  <span className="text-sm font-medium text-gray-700">Uptime</span>
                  <span className="text-xs text-gray-400 font-mono">
                    {formatUptime(kernelMetrics.uptime)}
                  </span>
                </div>
                <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
                  <span className="text-sm font-medium text-gray-700">CPU</span>
                  <span className="text-xs text-gray-400 font-mono">
                    {kernelMetrics.cpuPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="p-4 flex items-center justify-between hover:bg-white/60 transition-colors">
                  <span className="text-sm font-medium text-gray-700">Memory</span>
                  <span className="text-xs text-gray-400 font-mono">
                    {kernelMetrics.memoryMB.toFixed(0)} MB
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Kernel */}
        {activeTab === 'Kernel' && (
          <div className="space-y-4">
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1">Kernel Information</h3>
                <p className="text-xs text-gray-400">System processes and hardware status</p>
              </div>
              <div className="p-4 flex items-center justify-between border-b border-gray-100">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <Activity size={14} className="text-indigo-500" /> Status
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${kernelConnected ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
                >
                  {kernelConnected ? 'Running' : 'Offline'}
                </span>
              </div>

              {/* Docker */}
              <div className="p-4 flex items-center justify-between border-b border-gray-100">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <Server size={14} className="text-blue-500" /> Docker
                </span>
                <span className="text-xs text-gray-400">
                  {kernelConnected ? 'Available' : 'Unknown'}
                </span>
              </div>

              {/* GPU */}
              <div className="p-4 flex items-center justify-between">
                <span className="text-sm text-gray-600 flex items-center gap-2">
                  <Cpu size={14} className="text-yellow-500" /> GPU
                </span>
                {gpuInfo.available ? (
                  <span className="text-xs text-green-600 font-medium">
                    {gpuInfo.gpus.length} GPU(s): {gpuInfo.gpus.map((g) => g.name).join(', ')}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">Not available</span>
                )}
              </div>
            </div>

            {/* Cluster */}
            {clusterInfo && clusterInfo.role !== 'standalone' && (
              <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
                <div className="p-4 border-b border-gray-100">
                  <h3 className="text-sm font-bold text-gray-700">Cluster</h3>
                </div>
                <div className="p-4 flex items-center justify-between border-b border-gray-100">
                  <span className="text-sm text-gray-600">Role</span>
                  <span className="text-xs font-medium text-indigo-600 capitalize">
                    {clusterInfo.role}
                  </span>
                </div>
                <div className="p-4 flex items-center justify-between border-b border-gray-100">
                  <span className="text-sm text-gray-600">Nodes</span>
                  <span className="text-xs text-gray-400">{clusterInfo.nodes.length}</span>
                </div>
                <div className="p-4 flex items-center justify-between">
                  <span className="text-sm text-gray-600">Capacity</span>
                  <span className="text-xs text-gray-400 font-mono">
                    {clusterInfo.totalLoad} / {clusterInfo.totalCapacity}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* LLM Providers */}
        {activeTab === 'LLM Providers' && (
          <div className="space-y-4">
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1">Available LLM Providers</h3>
                <p className="text-xs text-gray-400">
                  Configure API keys in .env or set them below
                </p>
              </div>
              {llmProviders.length > 0 ? (
                llmProviders.map((provider) => (
                  <div
                    key={provider.name}
                    className="p-4 flex items-center justify-between border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2.5 h-2.5 rounded-full ${provider.available ? 'bg-green-500' : 'bg-red-400'}`}
                      />
                      <div>
                        <span className="text-sm font-medium text-gray-700 capitalize">
                          {provider.name}
                        </span>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          {provider.models.join(', ')}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${provider.available ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
                    >
                      {provider.available ? 'Ready' : 'Not Configured'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-gray-400">
                  No providers detected. Connect to the kernel to see available providers.
                </div>
              )}
            </div>

            {/* API Key Configuration (mock mode) */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Key size={14} /> API Key (Mock Mode)
                </h3>
              </div>
              <div className="p-4">
                <label className="text-xs text-gray-500 mb-1 block">Gemini API Key</label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => setGeminiKey(e.target.value)}
                    placeholder="Enter your Gemini API key..."
                    className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                  />
                  <button
                    onClick={handleSaveGeminiKey}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Save
                  </button>
                </div>
                <p className="text-[10px] text-gray-400 mt-2">
                  Stored in localStorage. Used by the Gemini service in mock mode.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Appearance */}
        {activeTab === 'Appearance' && (
          <div className="space-y-4">
            {/* Theme Mode Selector */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1">Theme Mode</h3>
                <p className="text-xs text-gray-400">Choose how Aether OS appears</p>
              </div>
              <div className="p-4">
                <div className="flex gap-4">
                  {[
                    {
                      value: 'dark' as ThemeMode,
                      label: 'Dark',
                      icon: Moon,
                      bgPreview: '#1a1d26',
                      textPreview: '#ffffff',
                    },
                    {
                      value: 'light' as ThemeMode,
                      label: 'Light',
                      icon: Sun,
                      bgPreview: '#f5f5f7',
                      textPreview: '#1d1d1f',
                    },
                    {
                      value: 'system' as ThemeMode,
                      label: 'System',
                      icon: Monitor,
                      bgPreview: 'linear-gradient(135deg, #1a1d26 50%, #f5f5f7 50%)',
                      textPreview: '#a9b1d6',
                    },
                  ].map((option) => {
                    const isActive = themeMode === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setThemeMode(option.value)}
                        className={`flex-1 rounded-xl border-2 transition-all overflow-hidden ${
                          isActive
                            ? 'border-blue-500 shadow-md shadow-blue-500/20'
                            : 'border-transparent hover:border-gray-300'
                        }`}
                      >
                        <div
                          className="aspect-video rounded-t-lg flex items-center justify-center relative"
                          style={{
                            background:
                              option.value === 'system' ? option.bgPreview : option.bgPreview,
                            backgroundColor:
                              option.value !== 'system' ? option.bgPreview : undefined,
                          }}
                        >
                          <option.icon size={20} style={{ color: option.textPreview }} />
                          {isActive && (
                            <div className="absolute bottom-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px]">
                              &#10003;
                            </div>
                          )}
                        </div>
                        <div className="bg-white/60 py-2 text-center">
                          <span className="text-xs font-medium text-gray-700">{option.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Color Preview */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1">Color Preview</h3>
                <p className="text-xs text-gray-400">Current theme: {isDark ? 'Dark' : 'Light'}</p>
              </div>
              <div className="p-4 grid grid-cols-4 gap-3">
                {[
                  { label: 'Primary BG', token: '--bg-primary' as keyof typeof theme },
                  { label: 'Secondary BG', token: '--bg-secondary' as keyof typeof theme },
                  { label: 'Tertiary BG', token: '--bg-tertiary' as keyof typeof theme },
                  { label: 'Surface', token: '--surface-color' as keyof typeof theme },
                  { label: 'Accent', token: '--accent-color' as keyof typeof theme },
                  { label: 'Danger', token: '--danger' as keyof typeof theme },
                  { label: 'Warning', token: '--warning' as keyof typeof theme },
                  { label: 'Success', token: '--success' as keyof typeof theme },
                ].map((swatch) => (
                  <div key={swatch.token} className="text-center">
                    <div
                      className="w-full aspect-square rounded-lg border border-gray-200 shadow-sm mb-1"
                      style={{ backgroundColor: theme[swatch.token] }}
                    />
                    <span className="text-[10px] text-gray-500 leading-tight block">
                      {swatch.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Text Preview */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1">Text & Border Preview</h3>
              </div>
              <div className="p-4 rounded-lg" style={{ backgroundColor: theme['--bg-secondary'] }}>
                <p
                  style={{
                    color: theme['--text-primary'],
                    fontSize: '14px',
                    fontWeight: 600,
                    marginBottom: '4px',
                  }}
                >
                  Primary text color
                </p>
                <p
                  style={{
                    color: theme['--text-secondary'],
                    fontSize: '12px',
                    marginBottom: '4px',
                  }}
                >
                  Secondary text color for descriptions
                </p>
                <p style={{ color: theme['--text-muted'], fontSize: '11px', marginBottom: '8px' }}>
                  Muted text for less important content
                </p>
                <div
                  style={{ borderTop: `1px solid ${theme['--border-color']}`, paddingTop: '8px' }}
                >
                  <span
                    style={{
                      backgroundColor: theme['--accent-color'],
                      color: '#ffffff',
                      padding: '4px 12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      fontWeight: 600,
                    }}
                  >
                    Accent Button
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Automation */}
        {activeTab === 'Automation' && (
          <div className="space-y-4">
            {/* Cron Jobs Section */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                  <Calendar size={14} className="text-amber-500" /> Cron Jobs
                </h3>
                <p className="text-xs text-gray-400">Schedule agents to run on a recurring basis</p>
              </div>

              {/* Existing cron jobs list */}
              {cronJobs.length > 0 ? (
                cronJobs.map((job) => (
                  <div
                    key={job.id}
                    className="p-4 flex items-center justify-between border-b border-gray-100"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${job.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-700 truncate">{job.name}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                            {job.cron_expression}
                          </span>
                          <span>{formatCronExpression(job.cron_expression)}</span>
                          <span className="text-gray-300">|</span>
                          <span>Next: {formatRelativeTime(job.next_run)}</span>
                          <span className="text-gray-300">|</span>
                          <span>Runs: {job.run_count}</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          <span className="text-indigo-500 font-medium">
                            {job.agent_config.role}
                          </span>
                          : {job.agent_config.goal}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <button
                        onClick={() => handleToggleCronJob(job)}
                        className="p-1 hover:bg-gray-100 rounded-lg transition-colors"
                        title={job.enabled ? 'Disable' : 'Enable'}
                      >
                        {job.enabled ? (
                          <ToggleRight size={20} className="text-green-500" />
                        ) : (
                          <ToggleLeft size={20} className="text-gray-400" />
                        )}
                      </button>
                      <button
                        onClick={() => handleDeleteCronJob(job.id)}
                        className="p-1 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-red-400 hover:text-red-600" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-gray-400">No cron jobs configured.</div>
              )}

              {/* Create Cron Job Form */}
              <div className="p-4 bg-gray-50/50">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Plus size={12} /> Create Cron Job
                </h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCronName}
                      onChange={(e) => setNewCronName(e.target.value)}
                      placeholder="Job name"
                      className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    />
                    <input
                      type="text"
                      value={newCronExpression}
                      onChange={(e) => setNewCronExpression(e.target.value)}
                      placeholder="*/5 * * * *"
                      className="w-36 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400 transition-colors"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newCronRole}
                      onChange={(e) => setNewCronRole(e.target.value)}
                      placeholder="Agent role (e.g., Reviewer)"
                      className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    />
                    <select
                      value={newCronModel}
                      onChange={(e) => setNewCronModel(e.target.value)}
                      className="w-40 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    >
                      <option value="">Default model</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="claude-sonnet-4-20250514">claude-sonnet</option>
                      <option value="gemini-pro">gemini-pro</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    value={newCronGoal}
                    onChange={(e) => setNewCronGoal(e.target.value)}
                    placeholder="Agent goal (e.g., Review recent commits for quality)"
                    className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                  />
                  <button
                    onClick={handleCreateCronJob}
                    disabled={!newCronName || !newCronExpression || !newCronRole || !newCronGoal}
                    className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    <Play size={12} /> Create Cron Job
                  </button>
                </div>
              </div>
            </div>

            {/* Event Triggers Section */}
            <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
                  <Zap size={14} className="text-amber-500" /> Event Triggers
                </h3>
                <p className="text-xs text-gray-400">Spawn agents in response to system events</p>
              </div>

              {/* Existing triggers list */}
              {triggers.length > 0 ? (
                triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="p-4 flex items-center justify-between border-b border-gray-100"
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${trigger.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-gray-700 truncate">
                          {trigger.name}
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                            {trigger.event_type}
                          </span>
                          <span className="text-gray-300">|</span>
                          <span>Cooldown: {formatCooldown(trigger.cooldown_ms)}</span>
                          <span className="text-gray-300">|</span>
                          <span>Fired: {trigger.fire_count}x</span>
                        </div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
                          <span className="text-indigo-500 font-medium">
                            {trigger.agent_config.role}
                          </span>
                          : {trigger.agent_config.goal}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <button
                        onClick={() => handleDeleteTrigger(trigger.id)}
                        className="p-1 hover:bg-red-50 rounded-lg transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-red-400 hover:text-red-600" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-sm text-gray-400">No event triggers configured.</div>
              )}

              {/* Create Event Trigger Form */}
              <div className="p-4 bg-gray-50/50">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                  <Plus size={12} /> Create Event Trigger
                </h4>
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTriggerName}
                      onChange={(e) => setNewTriggerName(e.target.value)}
                      placeholder="Trigger name"
                      className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    />
                    <select
                      value={newTriggerEventType}
                      onChange={(e) => setNewTriggerEventType(e.target.value)}
                      className="w-48 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    >
                      {EVENT_TYPES.map((et) => (
                        <option key={et} value={et}>
                          {et}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTriggerRole}
                      onChange={(e) => setNewTriggerRole(e.target.value)}
                      placeholder="Agent role (e.g., Debugger)"
                      className="flex-1 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                    />
                    <input
                      type="text"
                      value={newTriggerCooldown}
                      onChange={(e) => setNewTriggerCooldown(e.target.value)}
                      placeholder="Cooldown (ms)"
                      className="w-36 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-400 transition-colors"
                    />
                  </div>
                  <input
                    type="text"
                    value={newTriggerGoal}
                    onChange={(e) => setNewTriggerGoal(e.target.value)}
                    placeholder="Agent goal (e.g., Analyze the error and suggest fixes)"
                    className="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 transition-colors"
                  />
                  <button
                    onClick={handleCreateTrigger}
                    disabled={
                      !newTriggerName || !newTriggerEventType || !newTriggerRole || !newTriggerGoal
                    }
                    className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
                  >
                    <Zap size={12} /> Create Trigger
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-gray-50/80 backdrop-blur-xl">
      {/* Sidebar */}
      <div className="w-60 bg-white/30 border-r border-gray-200/50 flex flex-col">
        <div className="p-4 pb-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder="Search"
              className="w-full bg-black/5 pl-8 pr-3 py-1.5 rounded-lg text-sm focus:outline-none focus:bg-black/10 transition-colors"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveTab(cat.name)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeTab === cat.name ? 'bg-blue-500 text-white shadow-sm' : 'hover:bg-black/5 text-gray-700'}`}
            >
              <div
                className={`w-6 h-6 rounded-md ${cat.color} flex items-center justify-center text-white shrink-0 shadow-sm`}
              >
                <cat.icon size={14} />
              </div>
              <span className="font-medium">{cat.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 bg-gray-50/50">{renderContent()}</div>
    </div>
  );
};
