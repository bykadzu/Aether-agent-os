import React, { useState, useEffect, useCallback } from 'react';
import { Cpu, HardDrive, Wifi, Activity, RefreshCw } from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SystemStats {
  cpu: { percent: number; cores: number };
  memory: { usedMB: number; totalMB: number; percent: number };
  disk: { usedGB: number; totalGB: number; percent: number };
  network: { bytesIn: number; bytesOut: number };
  timestamp: number;
}

interface AgentResourceInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryMB: number;
  state: string;
}

// ---------------------------------------------------------------------------
// SVG Line Chart Component
// ---------------------------------------------------------------------------

const LineChart: React.FC<{
  data: number[];
  maxVal: number;
  color: string;
  label: string;
  unit: string;
  icon: React.ReactNode;
  height?: number;
  subtitle?: string;
}> = ({ data, maxVal, color, label, unit, icon, height = 120, subtitle }) => {
  const width = 300;
  const h = height;
  const points = data
    .map((val, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = h - (val / Math.max(maxVal, 1)) * h;
      return `${x},${y}`;
    })
    .join(' ');

  const fillPoints = `0,${h} ${points} ${width},${h}`;
  const currentVal = data.length > 0 ? data[data.length - 1] : 0;

  return (
    <div className="bg-[#1a1d26] rounded-xl p-4 border border-white/5 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-medium text-gray-400">{label}</span>
        </div>
        <span className="text-sm font-mono" style={{ color }}>
          {currentVal.toFixed(1)}
          {unit}
        </span>
      </div>
      {subtitle && <div className="text-[10px] text-gray-500 mb-2">{subtitle}</div>}
      <svg
        viewBox={`0 0 ${width} ${h}`}
        className="w-full"
        style={{ height: `${h}px` }}
        preserveAspectRatio="none"
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0}
            y1={h * frac}
            x2={width}
            y2={h * frac}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        ))}
        {/* Fill area */}
        <polygon points={fillPoints} fill={color} opacity="0.1" />
        {/* Line */}
        {data.length > 1 && (
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* Current value dot */}
        {data.length > 0 && (
          <circle cx={width} cy={h - (currentVal / Math.max(maxVal, 1)) * h} r="3" fill={color} />
        )}
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dual-Line Chart (for Network I/O)
// ---------------------------------------------------------------------------

const DualLineChart: React.FC<{
  dataA: number[];
  dataB: number[];
  maxVal: number;
  colorA: string;
  colorB: string;
  labelA: string;
  labelB: string;
  label: string;
  unit: string;
  icon: React.ReactNode;
  height?: number;
}> = ({
  dataA,
  dataB,
  maxVal,
  colorA,
  colorB,
  labelA,
  labelB,
  label,
  unit,
  icon,
  height = 120,
}) => {
  const width = 300;
  const h = height;

  const toPoints = (data: number[]) =>
    data
      .map((val, i) => {
        const x = (i / Math.max(data.length - 1, 1)) * width;
        const y = h - (val / Math.max(maxVal, 1)) * h;
        return `${x},${y}`;
      })
      .join(' ');

  const pointsA = toPoints(dataA);
  const pointsB = toPoints(dataB);

  const currentA = dataA.length > 0 ? dataA[dataA.length - 1] : 0;
  const currentB = dataB.length > 0 ? dataB[dataB.length - 1] : 0;

  return (
    <div className="bg-[#1a1d26] rounded-xl p-4 border border-white/5 flex flex-col">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span style={{ color: colorA }}>{icon}</span>
          <span className="text-xs font-medium text-gray-400">{label}</span>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span style={{ color: colorA }}>
            {labelA}: {formatBytes(currentA)}
            {unit}
          </span>
          <span style={{ color: colorB }}>
            {labelB}: {formatBytes(currentB)}
            {unit}
          </span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${h}`}
        className="w-full mt-2"
        style={{ height: `${h}px` }}
        preserveAspectRatio="none"
      >
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0}
            y1={h * frac}
            x2={width}
            y2={h * frac}
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
          />
        ))}
        {/* In */}
        <polygon points={`0,${h} ${pointsA} ${width},${h}`} fill={colorA} opacity="0.08" />
        {dataA.length > 1 && (
          <polyline
            points={pointsA}
            fill="none"
            stroke={colorA}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* Out */}
        <polygon points={`0,${h} ${pointsB} ${width},${h}`} fill={colorB} opacity="0.08" />
        {dataB.length > 1 && (
          <polyline
            points={pointsB}
            fill="none"
            stroke={colorB}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
      </svg>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_HISTORY = 60;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateMockStats(tick: number): SystemStats {
  const cpuBase = 25 + 15 * Math.sin(tick * 0.1) + Math.random() * 10;
  const memUsed = 4096 + 512 * Math.sin(tick * 0.05) + Math.random() * 256;
  const memTotal = 16384;
  const diskUsed = 120 + tick * 0.001;
  const diskTotal = 512;
  return {
    cpu: {
      percent: Math.min(100, Math.max(0, cpuBase)),
      cores: 8,
    },
    memory: {
      usedMB: Math.round(memUsed),
      totalMB: memTotal,
      percent: (memUsed / memTotal) * 100,
    },
    disk: {
      usedGB: parseFloat(diskUsed.toFixed(1)),
      totalGB: diskTotal,
      percent: (diskUsed / diskTotal) * 100,
    },
    network: {
      bytesIn: Math.round(50000 + Math.random() * 100000),
      bytesOut: Math.round(20000 + Math.random() * 50000),
    },
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const SystemMonitorApp: React.FC = () => {
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [memHistory, setMemHistory] = useState<number[]>([]);
  const [diskHistory, setDiskHistory] = useState<number[]>([]);
  const [netInHistory, setNetInHistory] = useState<number[]>([]);
  const [netOutHistory, setNetOutHistory] = useState<number[]>([]);
  const [currentStats, setCurrentStats] = useState<SystemStats | null>(null);
  const [agents, setAgents] = useState<AgentResourceInfo[]>([]);
  const [kernelConnected, setKernelConnected] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [tickRef] = useState({ current: 0 });

  const pushValue = useCallback(
    (setter: React.Dispatch<React.SetStateAction<number[]>>, value: number) => {
      setter((prev) => {
        const next = [...prev, value];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
    },
    [],
  );

  // Check kernel connection
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

  // Fetch system stats every 2 seconds
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const baseUrl = 'http://localhost:3001';
        const token = localStorage.getItem('aether_token');
        const res = await fetch(`${baseUrl}/api/system/stats`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const stats: SystemStats & { processes?: AgentResourceInfo[] } = await res.json();
          setCurrentStats(stats);
          setFetchError(false);

          pushValue(setCpuHistory, stats.cpu.percent);
          pushValue(setMemHistory, stats.memory.usedMB);
          pushValue(setDiskHistory, stats.disk.usedGB);
          pushValue(setNetInHistory, stats.network.bytesIn);
          pushValue(setNetOutHistory, stats.network.bytesOut);

          if (stats.processes) {
            setAgents(stats.processes);
          }
          return;
        }
      } catch {
        // Server unavailable -- fall through to mock data
      }

      // Use mock data when server is unavailable
      setFetchError(true);
      tickRef.current += 1;
      const mock = generateMockStats(tickRef.current);
      setCurrentStats(mock);

      pushValue(setCpuHistory, mock.cpu.percent);
      pushValue(setMemHistory, mock.memory.usedMB);
      pushValue(setDiskHistory, mock.disk.usedGB);
      pushValue(setNetInHistory, mock.network.bytesIn);
      pushValue(setNetOutHistory, mock.network.bytesOut);
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, [pushValue, tickRef]);

  // Fetch agent process list from kernel when connected
  useEffect(() => {
    if (!kernelConnected) return;

    const fetchAgents = async () => {
      try {
        const baseUrl = 'http://localhost:3001';
        const token = localStorage.getItem('aether_token');
        const res = await fetch(`${baseUrl}/api/processes`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const procs = await res.json();
          setAgents(
            procs.map((p: any) => ({
              pid: p.pid,
              name: p.name || `Agent-${p.pid}`,
              cpuPercent: p.cpuPercent ?? 0,
              memoryMB: p.memoryMB ?? 0,
              state: p.state || 'unknown',
            })),
          );
        }
      } catch {
        // ignore
      }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [kernelConnected]);

  const memTotal = currentStats?.memory.totalMB ?? 16384;
  const diskTotal = currentStats?.disk.totalGB ?? 512;
  const netMax = Math.max(
    ...netInHistory,
    ...netOutHistory,
    1024, // minimum scale
  );

  return (
    <div className="h-full bg-[#0d0f14] text-white overflow-auto select-none">
      {/* Header */}
      <div className="sticky top-0 z-10 backdrop-blur-xl bg-[#0d0f14]/80 border-b border-white/5 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-green-400" />
          <h1 className="text-sm font-semibold tracking-wide">System Monitor</h1>
        </div>
        <div className="flex items-center gap-3">
          {fetchError && (
            <span className="text-[10px] text-yellow-500/70 bg-yellow-500/10 px-2 py-0.5 rounded-full">
              Demo Mode
            </span>
          )}
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              kernelConnected ? 'bg-green-400' : 'bg-gray-600'
            }`}
          />
          <span className="text-[10px] text-gray-500">
            {kernelConnected ? 'Kernel Connected' : 'Kernel Offline'}
          </span>
          <RefreshCw
            size={12}
            className="text-gray-600 animate-spin"
            style={{ animationDuration: '2s' }}
          />
        </div>
      </div>

      {/* Charts Grid */}
      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* CPU */}
        <LineChart
          data={cpuHistory}
          maxVal={100}
          color="#4ade80"
          label="CPU Usage"
          unit="%"
          icon={<Cpu size={14} />}
          subtitle={currentStats ? `${currentStats.cpu.cores} cores` : undefined}
        />

        {/* Memory */}
        <LineChart
          data={memHistory}
          maxVal={memTotal}
          color="#60a5fa"
          label="Memory Usage"
          unit=" MB"
          icon={<Activity size={14} />}
          subtitle={
            currentStats
              ? `${currentStats.memory.usedMB.toLocaleString()} / ${currentStats.memory.totalMB.toLocaleString()} MB (${currentStats.memory.percent.toFixed(1)}%)`
              : undefined
          }
        />

        {/* Disk */}
        <LineChart
          data={diskHistory}
          maxVal={diskTotal}
          color="#fb923c"
          label="Disk Usage"
          unit=" GB"
          icon={<HardDrive size={14} />}
          subtitle={
            currentStats
              ? `${currentStats.disk.usedGB.toFixed(1)} / ${currentStats.disk.totalGB} GB (${currentStats.disk.percent.toFixed(1)}%)`
              : undefined
          }
        />

        {/* Network I/O */}
        <DualLineChart
          dataA={netInHistory}
          dataB={netOutHistory}
          maxVal={netMax}
          colorA="#a78bfa"
          colorB="#c084fc"
          labelA="In"
          labelB="Out"
          label="Network I/O"
          unit="/s"
          icon={<Wifi size={14} />}
        />
      </div>

      {/* Agent Resource Table */}
      {agents.length > 0 && (
        <div className="px-4 pb-4">
          <div className="bg-[#1a1d26] rounded-xl border border-white/5 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <Cpu size={14} className="text-cyan-400" />
              <span className="text-xs font-medium text-gray-400">
                Per-Agent Resource Breakdown
              </span>
              <span className="ml-auto text-[10px] text-gray-600">
                {agents.length} process{agents.length !== 1 ? 'es' : ''}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-white/5">
                    <th className="text-left px-4 py-2 font-medium">PID</th>
                    <th className="text-left px-4 py-2 font-medium">Name</th>
                    <th className="text-right px-4 py-2 font-medium">CPU %</th>
                    <th className="text-right px-4 py-2 font-medium">Memory (MB)</th>
                    <th className="text-left px-4 py-2 font-medium">State</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr
                      key={agent.pid}
                      className="border-b border-white/[0.02] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-4 py-2 font-mono text-gray-400">{agent.pid}</td>
                      <td className="px-4 py-2 text-gray-300">{agent.name}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        <span
                          className={
                            agent.cpuPercent > 80
                              ? 'text-red-400'
                              : agent.cpuPercent > 50
                                ? 'text-yellow-400'
                                : 'text-green-400'
                          }
                        >
                          {agent.cpuPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-blue-400">
                        {agent.memoryMB.toFixed(1)}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            agent.state === 'running'
                              ? 'bg-green-500/10 text-green-400'
                              : agent.state === 'sleeping'
                                ? 'bg-blue-500/10 text-blue-400'
                                : agent.state === 'stopped'
                                  ? 'bg-yellow-500/10 text-yellow-400'
                                  : 'bg-gray-500/10 text-gray-400'
                          }`}
                        >
                          {agent.state}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
