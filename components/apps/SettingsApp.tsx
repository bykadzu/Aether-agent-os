import React, { useState, useEffect } from 'react';
import {
  Wifi,
  User,
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
} from 'lucide-react';
import { getKernelClient, GPUInfo, ClusterInfo } from '../../services/kernelClient';
import { useTheme, ThemeMode } from '../../services/themeManager';

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

  const categories = [
    { name: 'General', icon: Info, color: 'bg-gray-500' },
    { name: 'Kernel', icon: Server, color: 'bg-indigo-500' },
    { name: 'LLM Providers', icon: Bot, color: 'bg-purple-500' },
    { name: 'Appearance', icon: Moon, color: 'bg-blue-500' },
    { name: 'Network', icon: Wifi, color: 'bg-blue-400' },
    { name: 'Privacy', icon: Lock, color: 'bg-sky-500' },
    { name: 'Notifications', icon: Bell, color: 'bg-red-500' },
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
