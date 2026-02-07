import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, Cpu, HardDrive, Server, Zap, Bot, Square, Play, X, Search
} from 'lucide-react';
import { getKernelClient, KernelProcessInfo, GPUInfo, ClusterInfo } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MonitorTab = 'overview' | 'processes' | 'llm' | 'cluster';

interface LLMProviderInfo {
  name: string;
  available: boolean;
  models: string[];
}

interface AgentTokenUsage {
  pid: number;
  name: string;
  role: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Mock data (used when kernel is not connected)
// ---------------------------------------------------------------------------

const MOCK_PROCESSES: KernelProcessInfo[] = [
  { pid: 1, ppid: 0, uid: 'root', name: 'init', command: '/sbin/init', state: 'running', agentPhase: undefined, cwd: '/', env: {}, createdAt: Date.now() - 86400000, cpuPercent: 0.1, memoryMB: 12 },
  { pid: 100, ppid: 1, uid: 'user', name: 'web-researcher', command: 'agent --role Researcher', state: 'running', agentPhase: 'executing', cwd: '/home/user', env: {}, createdAt: Date.now() - 3600000, cpuPercent: 15.2, memoryMB: 256 },
  { pid: 101, ppid: 1, uid: 'user', name: 'code-developer', command: 'agent --role Coder', state: 'running', agentPhase: 'thinking', cwd: '/home/user/project', env: {}, createdAt: Date.now() - 1800000, cpuPercent: 22.7, memoryMB: 512 },
  { pid: 102, ppid: 1, uid: 'user', name: 'data-analyst', command: 'agent --role Analyst', state: 'stopped', agentPhase: 'idle', cwd: '/home/user/data', env: {}, createdAt: Date.now() - 7200000, cpuPercent: 0, memoryMB: 128 },
  { pid: 103, ppid: 1, uid: 'user', name: 'test-runner', command: 'agent --role Tester', state: 'dead', agentPhase: 'completed', cwd: '/home/user/tests', env: {}, createdAt: Date.now() - 10800000, cpuPercent: 0, memoryMB: 0 },
  { pid: 104, ppid: 1, uid: 'user', name: 'deploy-agent', command: 'agent --role DevOps', state: 'dead', agentPhase: 'failed', cwd: '/home/user/deploy', env: {}, createdAt: Date.now() - 5400000, cpuPercent: 0, memoryMB: 0 },
];

const MOCK_LLM_PROVIDERS: LLMProviderInfo[] = [
  { name: 'anthropic', available: true, models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'] },
  { name: 'openai', available: true, models: ['gpt-4o', 'gpt-4o-mini'] },
  { name: 'google', available: false, models: ['gemini-2.5-flash'] },
];

const MOCK_GPUS: GPUInfo[] = [
  { id: 0, name: 'NVIDIA RTX 4090', memoryTotal: 24576, memoryFree: 18432, utilization: 35 },
];

const MOCK_CLUSTER: ClusterInfo = {
  role: 'hub',
  nodes: [
    { id: 'node-1', host: 'aether-hub-01', port: 3001, capacity: 8, load: 3, gpuAvailable: true, dockerAvailable: true, status: 'online' },
    { id: 'node-2', host: 'aether-worker-01', port: 3002, capacity: 4, load: 2, gpuAvailable: false, dockerAvailable: true, status: 'online' },
    { id: 'node-3', host: 'aether-worker-02', port: 3003, capacity: 4, load: 0, gpuAvailable: false, dockerAvailable: true, status: 'offline' },
  ],
  totalCapacity: 16,
  totalLoad: 5,
};

const MOCK_TOKEN_USAGE: AgentTokenUsage[] = [
  { pid: 100, name: 'web-researcher', role: 'Researcher', promptTokens: 24500, completionTokens: 8200, totalTokens: 32700 },
  { pid: 101, name: 'code-developer', role: 'Coder', promptTokens: 41000, completionTokens: 18500, totalTokens: 59500 },
  { pid: 102, name: 'data-analyst', role: 'Analyst', promptTokens: 12000, completionTokens: 5600, totalTokens: 17600 },
  { pid: 103, name: 'test-runner', role: 'Tester', promptTokens: 8300, completionTokens: 3100, totalTokens: 11400 },
  { pid: 104, name: 'deploy-agent', role: 'DevOps', promptTokens: 5200, completionTokens: 1800, totalTokens: 7000 },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (!seconds) return '0s';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

const STATE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  running:   { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e', dot: '#22c55e' },
  sleeping:  { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6', dot: '#3b82f6' },
  stopped:   { bg: 'rgba(234,179,8,0.15)',  text: '#eab308', dot: '#eab308' },
  created:   { bg: 'rgba(148,163,184,0.15)', text: '#94a3b8', dot: '#94a3b8' },
  zombie:    { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444', dot: '#ef4444' },
  dead:      { bg: 'rgba(107,114,128,0.15)', text: '#6b7280', dot: '#6b7280' },
  completed: { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e', dot: '#22c55e' },
  failed:    { bg: 'rgba(239,68,68,0.15)',  text: '#ef4444', dot: '#ef4444' },
};

function getStateColor(state: string, phase?: string) {
  if (phase === 'completed') return STATE_COLORS.completed;
  if (phase === 'failed') return STATE_COLORS.failed;
  return STATE_COLORS[state] || STATE_COLORS.created;
}

function getEffectiveState(proc: KernelProcessInfo): string {
  if (proc.agentPhase === 'completed') return 'completed';
  if (proc.agentPhase === 'failed') return 'failed';
  return proc.state;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
}> = ({ icon, label, value, sub, color }) => (
  <div style={{
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 8,
      background: color + '22',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: color, flexShrink: 0,
    }}>
      {icon}
    </div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2, whiteSpace: 'nowrap' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'ui-monospace, monospace', color: '#e2e8f0', lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{sub}</div>}
    </div>
  </div>
);

const StatusDot: React.FC<{ color: string; size?: number }> = ({ color, size = 8 }) => (
  <span style={{
    display: 'inline-block',
    width: size, height: size, borderRadius: '50%',
    backgroundColor: color,
    boxShadow: `0 0 6px ${color}66`,
    flexShrink: 0,
  }} />
);

const Badge: React.FC<{ text: string; bg: string; color: string }> = ({ text, bg, color }) => (
  <span style={{
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'ui-monospace, monospace',
    background: bg,
    color: color,
    whiteSpace: 'nowrap',
  }}>
    {text}
  </span>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const SystemMonitorApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MonitorTab>('overview');
  const [isMockMode, setIsMockMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Data state
  const [processes, setProcesses] = useState<KernelProcessInfo[]>([]);
  const [llmProviders, setLlmProviders] = useState<LLMProviderInfo[]>([]);
  const [gpuInfo, setGpuInfo] = useState<GPUInfo[]>([]);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
  const [uptime, setUptime] = useState(0);
  const [kernelVersion, setKernelVersion] = useState('');
  const [tokenUsage, setTokenUsage] = useState<AgentTokenUsage[]>([]);
  const [dockerAvailable, setDockerAvailable] = useState(false);

  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ------------------------------------------
  // Data fetching
  // ------------------------------------------

  const fetchAllData = useCallback(async () => {
    const client = getKernelClient();

    if (!client.connected) {
      setIsMockMode(true);
      setProcesses(MOCK_PROCESSES);
      setLlmProviders(MOCK_LLM_PROVIDERS);
      setGpuInfo(MOCK_GPUS);
      setClusterInfo(MOCK_CLUSTER);
      setUptime(Math.floor((Date.now() - (Date.now() - 43200000)) / 1000));
      setKernelVersion('0.1.0-mock');
      setTokenUsage(MOCK_TOKEN_USAGE);
      setDockerAvailable(true);
      return;
    }

    setIsMockMode(false);

    // Fetch processes
    try {
      const procs = await client.listProcesses();
      setProcesses(procs);

      // Derive token usage from process info (in real mode, we simulate from step counts)
      const usage: AgentTokenUsage[] = procs
        .filter(p => p.agentPhase)
        .map(p => ({
          pid: p.pid,
          name: p.name,
          role: p.command.includes('--role') ? p.command.split('--role ')[1]?.split(' ')[0] || 'Agent' : 'Agent',
          promptTokens: Math.floor(p.cpuPercent * 1000 + p.memoryMB * 50),
          completionTokens: Math.floor(p.cpuPercent * 400 + p.memoryMB * 20),
          totalTokens: Math.floor(p.cpuPercent * 1400 + p.memoryMB * 70),
        }));
      setTokenUsage(usage);
    } catch {
      // keep previous data
    }

    // Fetch kernel status
    try {
      const status = await client.getStatus();
      setUptime(status.uptime || 0);
      setKernelVersion(status.version || '');
    } catch {
      // keep previous
    }

    // Fetch GPUs
    try {
      const gpuData = await client.getGPUs();
      setGpuInfo(gpuData.gpus);
    } catch {
      setGpuInfo([]);
    }

    // Fetch cluster info
    try {
      const cluster = await client.getClusterInfo();
      setClusterInfo(cluster);
      const selfNode = cluster.nodes.find(n => n.status === 'online');
      if (selfNode) setDockerAvailable(selfNode.dockerAvailable);
    } catch {
      setClusterInfo(null);
    }

    // Fetch LLM providers
    try {
      const res = await fetch('http://localhost:3001/api/llm/providers');
      if (res.ok) {
        const data = await res.json();
        setLlmProviders(data);
      }
    } catch {
      setLlmProviders([]);
    }
  }, []);

  useEffect(() => {
    fetchAllData();

    // Auto-refresh every 3 seconds
    refreshTimerRef.current = setInterval(fetchAllData, 3000);

    // Listen for real-time process events
    const client = getKernelClient();
    const unsubs: Array<() => void> = [];

    if (client.connected) {
      unsubs.push(client.on('process.spawned', () => fetchAllData()));
      unsubs.push(client.on('process.exited', () => fetchAllData()));
      unsubs.push(client.on('process.state', () => fetchAllData()));
    }

    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
      unsubs.forEach(u => u());
    };
  }, [fetchAllData]);

  // ------------------------------------------
  // Process actions
  // ------------------------------------------

  const handleSignal = async (pid: number, signal: 'SIGSTOP' | 'SIGCONT' | 'SIGKILL') => {
    if (isMockMode) {
      setProcesses(prev => prev.map(p => {
        if (p.pid !== pid) return p;
        if (signal === 'SIGSTOP') return { ...p, state: 'stopped' as const, agentPhase: 'idle' as const };
        if (signal === 'SIGCONT') return { ...p, state: 'running' as const, agentPhase: 'executing' as const };
        if (signal === 'SIGKILL') return { ...p, state: 'dead' as const, agentPhase: 'failed' as const };
        return p;
      }));
      return;
    }
    try {
      const client = getKernelClient();
      await client.signalProcess(pid, signal);
      // Data will refresh on next interval or via event
    } catch (err) {
      console.error(`[SystemMonitor] Failed to send ${signal} to PID ${pid}:`, err);
    }
  };

  // ------------------------------------------
  // Computed values
  // ------------------------------------------

  const agentProcesses = processes.filter(p => p.agentPhase !== undefined);
  const stateCounts = {
    running: agentProcesses.filter(p => p.state === 'running').length,
    stopped: agentProcesses.filter(p => p.state === 'stopped').length,
    completed: agentProcesses.filter(p => p.agentPhase === 'completed').length,
    failed: agentProcesses.filter(p => p.agentPhase === 'failed').length,
  };

  const filteredProcesses = processes.filter(p => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.command.toLowerCase().includes(q) ||
      String(p.pid).includes(q) ||
      (p.state).toLowerCase().includes(q) ||
      (p.agentPhase || '').toLowerCase().includes(q)
    );
  });

  const totalTokens = tokenUsage.reduce((sum, a) => sum + a.totalTokens, 0);
  const maxTokens = Math.max(...tokenUsage.map(a => a.totalTokens), 1);

  // ------------------------------------------
  // Styles
  // ------------------------------------------

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#0f1117',
    color: '#e2e8f0',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    overflow: 'hidden',
  };

  const tabBarStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    padding: '8px 12px 0',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
    flexShrink: 0,
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    color: active ? '#60a5fa' : '#94a3b8',
    background: active ? 'rgba(96,165,250,0.1)' : 'transparent',
    border: 'none',
    borderBottom: active ? '2px solid #60a5fa' : '2px solid transparent',
    borderRadius: '6px 6px 0 0',
    cursor: 'pointer',
    transition: 'all 0.15s',
    whiteSpace: 'nowrap',
  });

  const contentStyle: React.CSSProperties = {
    flex: 1,
    overflow: 'auto',
    padding: 16,
  };

  const tabs: { id: MonitorTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Activity size={14} /> },
    { id: 'processes', label: 'Processes', icon: <Cpu size={14} /> },
    { id: 'llm', label: 'LLM Usage', icon: <Zap size={14} /> },
    { id: 'cluster', label: 'Cluster', icon: <Server size={14} /> },
  ];

  // ------------------------------------------
  // Renders
  // ------------------------------------------

  const renderOverview = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Mock mode banner */}
      {isMockMode && (
        <div style={{
          background: 'rgba(234,179,8,0.1)',
          border: '1px solid rgba(234,179,8,0.25)',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 11,
          color: '#eab308',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Activity size={14} />
          Mock mode — kernel not connected. Showing sample data.
        </div>
      )}

      {/* Agent state summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <StatCard icon={<Play size={16} />} label="Running" value={stateCounts.running} color="#22c55e" />
        <StatCard icon={<Square size={16} />} label="Stopped" value={stateCounts.stopped} color="#eab308" />
        <StatCard icon={<Activity size={16} />} label="Completed" value={stateCounts.completed} color="#3b82f6" />
        <StatCard icon={<X size={16} />} label="Failed" value={stateCounts.failed} color="#ef4444" />
      </div>

      {/* System info row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard icon={<Activity size={16} />} label="Uptime" value={formatUptime(uptime)} color="#8b5cf6" />
        <StatCard
          icon={<Server size={16} />}
          label="Kernel Mode"
          value={isMockMode ? 'Mock' : 'Live'}
          sub={kernelVersion ? `v${kernelVersion}` : undefined}
          color="#60a5fa"
        />
        <StatCard
          icon={<Bot size={16} />}
          label="Total Agents"
          value={agentProcesses.length}
          sub={`${processes.length} total processes`}
          color="#a78bfa"
        />
      </div>

      {/* LLM providers */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          fontSize: 12,
          fontWeight: 600,
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Zap size={14} style={{ color: '#a78bfa' }} />
          LLM Providers
        </div>
        {llmProviders.length > 0 ? llmProviders.map(p => (
          <div key={p.name} style={{
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot color={p.available ? '#22c55e' : '#ef4444'} />
              <span style={{ fontWeight: 500, textTransform: 'capitalize' }}>{p.name}</span>
              <span style={{ fontSize: 10, color: '#64748b' }}>{p.models.join(', ')}</span>
            </div>
            <Badge
              text={p.available ? 'Ready' : 'Offline'}
              bg={p.available ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}
              color={p.available ? '#22c55e' : '#ef4444'}
            />
          </div>
        )) : (
          <div style={{ padding: '12px 14px', fontSize: 12, color: '#64748b' }}>No providers detected</div>
        )}
      </div>

      {/* Docker + GPU row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <HardDrive size={18} style={{ color: '#60a5fa', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>Docker</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <StatusDot color={dockerAvailable ? '#22c55e' : '#ef4444'} />
              <span style={{ fontWeight: 500, fontSize: 13 }}>{dockerAvailable ? 'Available' : 'Not Available'}</span>
            </div>
          </div>
        </div>
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '14px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <Cpu size={18} style={{ color: '#eab308', flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>GPU</div>
            {gpuInfo.length > 0 ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <StatusDot color="#22c55e" />
                  <span style={{ fontWeight: 500, fontSize: 13 }}>{gpuInfo.length} GPU(s)</span>
                </div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                  {gpuInfo.map(g => g.name).join(', ')}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusDot color="#ef4444" />
                <span style={{ fontWeight: 500, fontSize: 13 }}>None detected</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderProcesses = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Search bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '6px 12px',
      }}>
        <Search size={14} style={{ color: '#64748b', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Filter by name, PID, state..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#e2e8f0',
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 2, display: 'flex' }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Process count */}
      <div style={{ fontSize: 11, color: '#64748b' }}>
        {filteredProcesses.length} process{filteredProcesses.length !== 1 ? 'es' : ''} · auto-refreshing every 3s
      </div>

      {/* Process table */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr 100px 90px 60px 90px 120px',
          padding: '8px 14px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#64748b',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          background: 'rgba(255,255,255,0.02)',
        }}>
          <span>PID</span>
          <span>Name</span>
          <span>Role</span>
          <span>State</span>
          <span>CPU</span>
          <span>Created</span>
          <span style={{ textAlign: 'right' }}>Actions</span>
        </div>

        {/* Rows */}
        {filteredProcesses.length === 0 ? (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            {searchQuery ? 'No processes match the filter.' : 'No processes running.'}
          </div>
        ) : filteredProcesses.map(proc => {
          const effectiveState = getEffectiveState(proc);
          const sc = getStateColor(proc.state, proc.agentPhase);
          const isActive = proc.state === 'running' || proc.state === 'sleeping';
          const isStopped = proc.state === 'stopped';
          const isDead = proc.state === 'dead' || proc.state === 'zombie';

          return (
            <div
              key={proc.pid}
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr 100px 90px 60px 90px 120px',
                padding: '8px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                background: sc.bg.replace('0.15', '0.04'),
                alignItems: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = sc.bg.replace('0.15', '0.08'))}
              onMouseLeave={e => (e.currentTarget.style.background = sc.bg.replace('0.15', '0.04'))}
            >
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#94a3b8' }}>{proc.pid}</span>
              <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proc.name}</span>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{proc.agentPhase || '--'}</span>
              <Badge text={effectiveState} bg={sc.bg} color={sc.text} />
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#94a3b8' }}>
                {proc.cpuPercent.toFixed(1)}%
              </span>
              <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#64748b' }}>
                {formatTime(proc.createdAt)}
              </span>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                {isActive && (
                  <button
                    onClick={() => handleSignal(proc.pid, 'SIGSTOP')}
                    title="Stop"
                    style={{
                      background: 'rgba(234,179,8,0.15)',
                      border: '1px solid rgba(234,179,8,0.25)',
                      borderRadius: 4,
                      color: '#eab308',
                      cursor: 'pointer',
                      padding: '3px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                  >
                    <Square size={10} /> Stop
                  </button>
                )}
                {isStopped && (
                  <button
                    onClick={() => handleSignal(proc.pid, 'SIGCONT')}
                    title="Resume"
                    style={{
                      background: 'rgba(34,197,94,0.15)',
                      border: '1px solid rgba(34,197,94,0.25)',
                      borderRadius: 4,
                      color: '#22c55e',
                      cursor: 'pointer',
                      padding: '3px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                  >
                    <Play size={10} /> Resume
                  </button>
                )}
                {!isDead && (
                  <button
                    onClick={() => handleSignal(proc.pid, 'SIGKILL')}
                    title="Kill"
                    style={{
                      background: 'rgba(239,68,68,0.15)',
                      border: '1px solid rgba(239,68,68,0.25)',
                      borderRadius: 4,
                      color: '#ef4444',
                      cursor: 'pointer',
                      padding: '3px 6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 10,
                      fontWeight: 500,
                    }}
                  >
                    <X size={10} /> Kill
                  </button>
                )}
                {isDead && (
                  <span style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>exited</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderLLMUsage = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Total tokens */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 10,
      }}>
        <StatCard icon={<Zap size={16} />} label="Total Tokens" value={formatNumber(totalTokens)} color="#a78bfa" />
        <StatCard
          icon={<Bot size={16} />}
          label="Active Agents"
          value={tokenUsage.length}
          sub="with token tracking"
          color="#60a5fa"
        />
      </div>

      {/* Per-agent token bar chart */}
      <div style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '10px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          fontSize: 12,
          fontWeight: 600,
          color: '#94a3b8',
        }}>
          Per-Agent Token Usage
        </div>
        {tokenUsage.length === 0 ? (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: '#64748b', fontSize: 12 }}>
            No agent token data available.
          </div>
        ) : tokenUsage.map(agent => {
          const barWidth = Math.max((agent.totalTokens / maxTokens) * 100, 2);
          const promptWidth = agent.promptTokens / agent.totalTokens * 100;
          return (
            <div key={agent.pid} style={{
              padding: '10px 14px',
              borderBottom: '1px solid rgba(255,255,255,0.03)',
            }}>
              {/* Agent info row */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, color: '#64748b' }}>PID {agent.pid}</span>
                  <span style={{ fontWeight: 500, fontSize: 12 }}>{agent.name}</span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{agent.role}</span>
                </div>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>
                  {formatNumber(agent.totalTokens)}
                </span>
              </div>
              {/* Bar */}
              <div style={{
                width: '100%',
                height: 16,
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 4,
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  width: `${barWidth}%`,
                  height: '100%',
                  display: 'flex',
                  borderRadius: 4,
                  overflow: 'hidden',
                  transition: 'width 0.3s ease',
                }}>
                  {/* Prompt tokens */}
                  <div style={{
                    width: `${promptWidth}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #7c3aed, #8b5cf6)',
                  }} />
                  {/* Completion tokens */}
                  <div style={{
                    width: `${100 - promptWidth}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #2563eb, #3b82f6)',
                  }} />
                </div>
              </div>
              {/* Legend */}
              <div style={{ display: 'flex', gap: 16, marginTop: 4, fontSize: 10, color: '#64748b' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#8b5cf6' }} />
                  Prompt: {formatNumber(agent.promptTokens)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#3b82f6' }} />
                  Completion: {formatNumber(agent.completionTokens)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderCluster = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {clusterInfo ? (
        <>
          {/* Cluster overview */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <StatCard
              icon={<Server size={16} />}
              label="Cluster Role"
              value={clusterInfo.role.charAt(0).toUpperCase() + clusterInfo.role.slice(1)}
              color="#60a5fa"
            />
            <StatCard
              icon={<Activity size={16} />}
              label="Nodes"
              value={clusterInfo.nodes.length}
              sub={`${clusterInfo.nodes.filter(n => n.status === 'online').length} online`}
              color="#22c55e"
            />
            <StatCard
              icon={<Cpu size={16} />}
              label="Capacity"
              value={`${clusterInfo.totalLoad} / ${clusterInfo.totalCapacity}`}
              sub={`${Math.round((clusterInfo.totalLoad / Math.max(clusterInfo.totalCapacity, 1)) * 100)}% utilization`}
              color="#eab308"
            />
          </div>

          {/* Node list */}
          <div style={{
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10,
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 100px 90px 90px 80px 80px',
              padding: '8px 14px',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#64748b',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}>
              <span>Hostname</span>
              <span>Status</span>
              <span>Capacity</span>
              <span>Load</span>
              <span>GPU</span>
              <span>Docker</span>
            </div>

            {/* Rows */}
            {clusterInfo.nodes.map(node => {
              const statusColor = node.status === 'online' ? '#22c55e' : node.status === 'draining' ? '#eab308' : '#ef4444';
              return (
                <div key={node.id} style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 100px 90px 90px 80px 80px',
                  padding: '10px 14px',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  alignItems: 'center',
                }}>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 12 }}>{node.host}</div>
                    <div style={{ fontSize: 10, color: '#64748b', fontFamily: 'ui-monospace, monospace' }}>
                      :{node.port}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot color={statusColor} />
                    <span style={{ fontSize: 11, color: statusColor, fontWeight: 500, textTransform: 'capitalize' }}>
                      {node.status}
                    </span>
                  </div>
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#94a3b8' }}>
                    {node.capacity}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#e2e8f0' }}>
                      {node.load}
                    </span>
                    {/* Mini load bar */}
                    <div style={{
                      flex: 1, height: 4, background: 'rgba(255,255,255,0.06)',
                      borderRadius: 2, overflow: 'hidden', maxWidth: 40,
                    }}>
                      <div style={{
                        width: `${Math.round((node.load / Math.max(node.capacity, 1)) * 100)}%`,
                        height: '100%',
                        background: node.load / node.capacity > 0.8 ? '#ef4444' : node.load / node.capacity > 0.5 ? '#eab308' : '#22c55e',
                        borderRadius: 2,
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <StatusDot color={node.gpuAvailable ? '#22c55e' : '#475569'} size={6} />
                    <span style={{ fontSize: 11, color: node.gpuAvailable ? '#94a3b8' : '#475569' }}>
                      {node.gpuAvailable ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <StatusDot color={node.dockerAvailable ? '#22c55e' : '#475569'} size={6} />
                    <span style={{ fontSize: 11, color: node.dockerAvailable ? '#94a3b8' : '#475569' }}>
                      {node.dockerAvailable ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          padding: '40px 20px',
          textAlign: 'center',
        }}>
          <Server size={32} style={{ color: '#475569', marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: '#94a3b8', marginBottom: 4 }}>
            No Cluster Data
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Cluster information is unavailable. The kernel may be running in standalone mode.
          </div>
        </div>
      )}
    </div>
  );

  // ------------------------------------------
  // Main render
  // ------------------------------------------

  return (
    <div style={containerStyle}>
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={tabStyle(activeTab === tab.id)}
            onMouseEnter={e => {
              if (activeTab !== tab.id) e.currentTarget.style.color = '#cbd5e1';
            }}
            onMouseLeave={e => {
              if (activeTab !== tab.id) e.currentTarget.style.color = '#94a3b8';
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {tab.icon}
              {tab.label}
            </span>
          </button>
        ))}

        {/* Right-side status indicator */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
          <StatusDot color={isMockMode ? '#eab308' : '#22c55e'} size={6} />
          <span style={{ fontSize: 10, color: '#64748b' }}>
            {isMockMode ? 'Mock' : 'Live'}
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={contentStyle}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'processes' && renderProcesses()}
        {activeTab === 'llm' && renderLLMUsage()}
        {activeTab === 'cluster' && renderCluster()}
      </div>
    </div>
  );
};
