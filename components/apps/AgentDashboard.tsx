import React, { useState, useEffect } from 'react';
import { Plus, Bot, Monitor, List, Grid3x3, Filter, ExternalLink, Activity, Cpu, HardDrive, Clock, Zap, History, ChevronRight, Eye, Server } from 'lucide-react';
import { Agent, AgentStatus } from '../../types';
import { VirtualDesktop } from '../os/VirtualDesktop';
import { getKernelClient, ClusterInfo } from '../../services/kernelClient';
import { AgentTimeline } from './AgentTimeline';

type ViewMode = 'grid' | 'list';
type FilterMode = 'all' | 'active' | 'completed' | 'failed';

interface AgentDashboardProps {
  agents: Agent[];
  onLaunchAgent: (role: string, goal: string) => void;
  onOpenVM: (agentId: string) => void;
  onStopAgent: (agentId: string) => void;
}

export const AgentDashboard: React.FC<AgentDashboardProps> = ({ agents, onLaunchAgent, onOpenVM, onStopAgent }) => {
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [newGoal, setNewGoal] = useState('');
  const [newRole, setNewRole] = useState('Researcher');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [kernelMetrics, setKernelMetrics] = useState<{ uptime: number; memoryMB: number; cpuPercent: number } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyProcesses, setHistoryProcesses] = useState<Array<{
    pid: number;
    uid: string;
    name: string;
    role: string;
    goal: string;
    state: string;
    agentPhase?: string;
    exitCode?: number;
    createdAt: number;
    exitedAt?: number;
  }>>([]);
  const [selectedHistoryPid, setSelectedHistoryPid] = useState<number | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);

  // Subscribe to kernel metrics
  useEffect(() => {
    const client = getKernelClient();
    const unsub = client.on('kernel.metrics', (data: any) => {
      setKernelMetrics({
        uptime: data.uptime || 0,
        memoryMB: data.memoryMB || 0,
        cpuPercent: data.cpuPercent || 0,
      });
    });

    // Try to get initial status
    if (client.connected) {
      client.getStatus().then(status => {
        if (status?.uptime) {
          setKernelMetrics(prev => ({ ...prev!, uptime: status.uptime, memoryMB: prev?.memoryMB || 0, cpuPercent: prev?.cpuPercent || 0 }));
        }
      }).catch(() => {});

      // Fetch cluster info
      client.getClusterInfo().then(info => {
        setClusterInfo(info);
      }).catch(() => {});
    }

    return unsub;
  }, []);

  // Load process history when history panel is shown
  useEffect(() => {
    if (!showHistory) return;
    const client = getKernelClient();
    if (!client.connected) return;

    setHistoryLoading(true);
    client.getProcessHistory()
      .then(processes => {
        // Filter to completed/failed agents
        const pastAgents = processes.filter(p =>
          p.state === 'zombie' || p.state === 'dead' || p.agentPhase === 'completed' || p.agentPhase === 'failed'
        );
        setHistoryProcesses(pastAgents);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, [showHistory]);

  const handleCreate = () => {
    if (!newGoal.trim()) return;
    onLaunchAgent(newRole, newGoal);
    setNewGoal('');
    setShowNewAgentModal(false);
  };

  const handleDetach = (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    const url = `${window.location.origin}?detached=true&agentId=${agentId}`;
    window.open(url, `aether-vm-${agentId}`, 'width=1200,height=800,menubar=no,toolbar=no');
  };

  // Filtered agents
  const filteredAgents = agents.filter(agent => {
    switch (filterMode) {
      case 'active':
        return agent.status === 'working' || agent.status === 'thinking' || agent.status === 'waiting_approval';
      case 'completed':
        return agent.status === 'completed';
      case 'failed':
        return agent.status === 'error';
      default:
        return true;
    }
  });

  // Counts
  const activeCount = agents.filter(a => a.status === 'working' || a.status === 'thinking').length;
  const idleCount = agents.filter(a => a.status === 'idle').length;
  const completedCount = agents.filter(a => a.status === 'completed').length;
  const failedCount = agents.filter(a => a.status === 'error').length;

  const formatUptime = (seconds: number) => {
    if (!seconds) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const getStatusStyles = (status: AgentStatus) => {
    switch (status) {
      case 'working': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'thinking': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'waiting_approval': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'completed': return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'error': return 'bg-red-500/20 text-red-400 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1b26] text-gray-200 font-sans relative overflow-hidden">

      {/* Background Ambience */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a1b26] via-[#1a1b26] to-[#0f111a] -z-10"></div>

      {/* Top Metrics Bar */}
      <div className="bg-[#0f111a] border-b border-white/5 px-8 py-3 flex items-center gap-6 text-[11px] z-10">
        <div className="flex items-center gap-2 text-white/60">
          <Bot size={14} className="text-indigo-400" />
          <span className="font-medium text-white">{agents.length}</span>
          <span>Total</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-green-400" />
          <span className="text-green-400 font-medium">{activeCount}</span>
          <span className="text-white/40">Active</span>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={12} className="text-gray-500" />
          <span className="text-gray-400 font-medium">{idleCount}</span>
          <span className="text-white/40">Idle</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity size={12} className="text-emerald-400" />
          <span className="text-emerald-400 font-medium">{completedCount}</span>
          <span className="text-white/40">Done</span>
        </div>
        {failedCount > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-medium">{failedCount}</span>
            <span className="text-white/40">Failed</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-6">
          {kernelMetrics && (
            <>
              <div className="flex items-center gap-2 text-white/40">
                <Clock size={12} />
                <span>Uptime: <span className="text-white/70 font-mono">{formatUptime(kernelMetrics.uptime)}</span></span>
              </div>
              <div className="flex items-center gap-2 text-white/40">
                <Cpu size={12} />
                <span>CPU: <span className="text-white/70 font-mono">{kernelMetrics.cpuPercent.toFixed(1)}%</span></span>
              </div>
              <div className="flex items-center gap-2 text-white/40">
                <HardDrive size={12} />
                <span>Mem: <span className="text-white/70 font-mono">{kernelMetrics.memoryMB.toFixed(0)} MB</span></span>
              </div>
            </>
          )}
          {clusterInfo && clusterInfo.role !== 'standalone' && (
            <>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2 text-white/40">
                <Server size={12} className="text-indigo-400" />
                <span>
                  {clusterInfo.role === 'hub'
                    ? <><span className="text-indigo-400 font-medium">Hub</span> · {clusterInfo.nodes.length} node{clusterInfo.nodes.length !== 1 ? 's' : ''}</>
                    : <span className="text-indigo-400 font-medium">Node</span>}
                </span>
              </div>
              <div className="flex items-center gap-2 text-white/40">
                <span>Capacity: <span className="text-white/70 font-mono">{clusterInfo.totalLoad}/{clusterInfo.totalCapacity}</span></span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="p-8 pb-4 flex items-center justify-between z-10">
        <div>
          <h1 className="text-3xl font-light text-white tracking-tight flex items-center gap-3">
            Mission Control
            <span className="text-sm font-normal text-gray-500 bg-white/10 px-2 py-0.5 rounded-full">{agents.length} Active</span>
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {/* Filter Buttons */}
          <div className="flex items-center bg-white/5 rounded-lg border border-white/5 p-0.5">
            {(['all', 'active', 'completed', 'failed'] as FilterMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all ${
                  filterMode === mode
                    ? 'bg-indigo-600 text-white shadow-lg'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center bg-white/5 rounded-lg border border-white/5 p-0.5">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              title="Grid View"
            >
              <Grid3x3 size={14} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              title="List View"
            >
              <List size={14} />
            </button>
          </div>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all font-medium border ${
              showHistory
                ? 'bg-white/10 border-white/20 text-white'
                : 'bg-white/5 border-white/5 text-gray-400 hover:text-white hover:bg-white/10'
            }`}
          >
            <History size={16} />
            History
          </button>
          <button
            onClick={() => setShowNewAgentModal(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-xl shadow-indigo-500/20 font-medium"
          >
            <Plus size={18} />
            Deploy Agent
          </button>
        </div>
      </div>

      {/* Mission Control Content */}
      <div className="flex-1 p-8 overflow-y-auto">
        {filteredAgents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-6 opacity-60">
             <div className="w-32 h-32 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Bot size={48} />
             </div>
             <div className="text-center">
                <p className="text-lg font-medium text-white">
                  {agents.length === 0 ? 'No Agents Deployed' : 'No agents match this filter'}
                </p>
                <p className="text-sm">
                  {agents.length === 0 ? 'Create a new agent to see their virtual desktop.' : 'Try selecting a different filter.'}
                </p>
             </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-8">
            {filteredAgents.map(agent => (
              <div
                key={agent.id}
                className={`group relative flex flex-col gap-3 animate-scale-in transition-all duration-500 ${
                  agent.status === 'completed' ? 'opacity-60' : ''
                } ${agent.status === 'error' ? 'opacity-50' : ''}`}
              >
                {/* Desktop Preview Container */}
                <div className={`aspect-video w-full rounded-2xl overflow-hidden border-[6px] shadow-2xl bg-black relative transition-all duration-300 group-hover:scale-[1.02] cursor-pointer ${
                  agent.status === 'working' || agent.status === 'thinking'
                    ? 'border-indigo-500/30 group-hover:border-indigo-500/60'
                    : agent.status === 'completed'
                    ? 'border-emerald-500/20 group-hover:border-emerald-500/40'
                    : agent.status === 'error'
                    ? 'border-red-500/20 group-hover:border-red-500/40'
                    : 'border-[#2c2e3a] group-hover:border-indigo-500/50'
                }`}
                  onClick={() => onOpenVM(agent.id)}
                >
                    {/* The Virtual Desktop Component */}
                    <VirtualDesktop agent={agent} scale={0.5} />

                    {/* Phase Change Pulse Overlay */}
                    {(agent.status === 'working' || agent.status === 'thinking') && (
                      <div className="absolute top-2 left-2 z-50">
                        <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-lg shadow-green-500/50" />
                      </div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 font-medium transform scale-90 group-hover:scale-100 transition-all">
                            <Monitor size={16} /> Enter VM
                        </div>
                    </div>

                    {/* Detach Button */}
                    <button
                      onClick={(e) => handleDetach(e, agent.id)}
                      className="absolute top-2 right-2 z-50 p-1.5 bg-black/50 backdrop-blur-sm rounded-lg border border-white/10 text-white/60 hover:text-white hover:bg-black/70 transition-all opacity-0 group-hover:opacity-100"
                      title="Open in new window"
                    >
                      <ExternalLink size={12} />
                    </button>
                </div>

                {/* Agent Meta Info under the desktop */}
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full bg-gradient-to-tr flex items-center justify-center text-white shadow-lg text-xs font-bold ${
                          agent.status === 'completed' ? 'from-emerald-500 to-green-500' :
                          agent.status === 'error' ? 'from-red-500 to-orange-500' :
                          'from-indigo-500 to-purple-500'
                        }`}>
                            {agent.role.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="text-sm font-medium text-white leading-none">{agent.name}</h3>
                            <p className="text-xs text-gray-400 mt-1 line-clamp-1">{agent.goal}</p>
                        </div>
                    </div>
                    <div className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide border ${getStatusStyles(agent.status)}`}>
                        {agent.phase || agent.status}
                    </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-500 border-b border-white/5">
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Agent</div>
              <div className="col-span-1">Role</div>
              <div className="col-span-4">Goal</div>
              <div className="col-span-1">PID</div>
              <div className="col-span-1">Phase</div>
              <div className="col-span-1">Steps</div>
              <div className="col-span-1">Actions</div>
            </div>
            {filteredAgents.map(agent => (
              <div
                key={agent.id}
                onClick={() => onOpenVM(agent.id)}
                className={`grid grid-cols-12 gap-4 px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-all animate-fade-in ${
                  agent.status === 'completed' ? 'opacity-60' : ''
                }`}
              >
                <div className="col-span-1 flex items-center">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    agent.status === 'working' ? 'bg-green-500 animate-pulse' :
                    agent.status === 'thinking' ? 'bg-blue-500 animate-pulse' :
                    agent.status === 'completed' ? 'bg-emerald-500' :
                    agent.status === 'error' ? 'bg-red-500' :
                    'bg-gray-500'
                  }`} />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-[9px] font-bold">
                    {agent.role.substring(0,2).toUpperCase()}
                  </div>
                  <span className="text-sm text-white font-medium truncate">{agent.name}</span>
                </div>
                <div className="col-span-1 flex items-center text-xs text-gray-400">{agent.role}</div>
                <div className="col-span-4 flex items-center text-xs text-gray-400 truncate">{agent.goal}</div>
                <div className="col-span-1 flex items-center text-xs font-mono text-cyan-400">{agent.pid || '--'}</div>
                <div className="col-span-1 flex items-center">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${getStatusStyles(agent.status)}`}>
                    {agent.phase || agent.status}
                  </span>
                </div>
                <div className="col-span-1 flex items-center text-xs font-mono text-gray-400">{agent.progress}</div>
                <div className="col-span-1 flex items-center gap-1">
                  <button
                    onClick={(e) => handleDetach(e, agent.id)}
                    className="p-1 rounded hover:bg-white/10 text-gray-500 hover:text-white transition-colors"
                    title="Detach"
                  >
                    <ExternalLink size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onStopAgent(agent.id); }}
                    className="p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors"
                    title="Stop"
                  >
                    <Activity size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="border-t border-white/5 bg-[#0f111a]">
          <div className="p-6">
            <h2 className="text-lg font-light text-white mb-4 flex items-center gap-2">
              <History size={18} className="text-gray-400" />
              Agent History
              <span className="text-xs text-gray-500 ml-2">{historyProcesses.length} past agents</span>
            </h2>

            {selectedHistoryPid !== null ? (
              /* Timeline view for selected agent */
              <div className="animate-fade-in">
                <button
                  onClick={() => setSelectedHistoryPid(null)}
                  className="text-[11px] text-gray-400 hover:text-white flex items-center gap-1 mb-3 transition-colors"
                >
                  <ChevronRight size={12} className="rotate-180" /> Back to history list
                </button>
                <div className="h-[400px] bg-[#1a1d26] rounded-xl border border-white/5 overflow-hidden">
                  <AgentTimeline pid={selectedHistoryPid} />
                </div>
              </div>
            ) : historyLoading ? (
              <div className="flex items-center justify-center py-12 text-gray-500">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                  <span className="text-xs">Loading history...</span>
                </div>
              </div>
            ) : historyProcesses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-500 gap-2">
                <History size={24} />
                <span className="text-xs">No past agent runs yet</span>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {historyProcesses.map(proc => (
                  <div
                    key={proc.pid}
                    onClick={() => setSelectedHistoryPid(proc.pid)}
                    className="flex items-center gap-4 p-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] cursor-pointer transition-all"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      proc.agentPhase === 'completed' ? 'bg-emerald-500' :
                      proc.agentPhase === 'failed' ? 'bg-red-500' :
                      'bg-gray-500'
                    }`} />
                    <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500/50 to-purple-500/50 flex items-center justify-center text-white text-[9px] font-bold shrink-0">
                      {proc.role.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-white font-medium truncate">{proc.name}</div>
                      <div className="text-[10px] text-gray-500 truncate">{proc.goal}</div>
                    </div>
                    <div className="text-[10px] font-mono text-cyan-400/60 shrink-0">PID {proc.pid}</div>
                    <div className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase shrink-0 ${
                      proc.agentPhase === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                      proc.agentPhase === 'failed' ? 'bg-red-500/20 text-red-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {proc.agentPhase || proc.state}
                    </div>
                    <div className="text-[10px] text-gray-600 shrink-0">
                      {new Date(proc.createdAt).toLocaleDateString()} {new Date(proc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <Eye size={14} className="text-gray-600 hover:text-white shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Agent Modal */}
      {showNewAgentModal && (
        <div className="absolute inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#1a1d26] border border-white/10 rounded-2xl shadow-2xl p-6 animate-scale-in">
             <h2 className="text-xl font-light text-white mb-6">Initialize New Agent</h2>

             <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Role Configuration</label>
                  <div className="grid grid-cols-2 gap-2">
                      {['Researcher', 'Coder', 'Analyst', 'Assistant'].map(role => (
                          <button
                            key={role}
                            onClick={() => setNewRole(role)}
                            className={`p-3 rounded-xl border text-sm font-medium transition-all ${newRole === role ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg' : 'bg-black/20 border-white/5 text-gray-400 hover:bg-white/5'}`}
                          >
                              {role}
                          </button>
                      ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">Primary Directive</label>
                  <textarea
                     value={newGoal}
                     onChange={(e) => setNewGoal(e.target.value)}
                     className="w-full bg-black/20 border border-white/10 rounded-xl p-4 text-sm text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 min-h-[100px] transition-all"
                     placeholder="Describe the task in detail..."
                  />
                </div>
             </div>

             <div className="flex justify-end gap-3 mt-8">
                <button
                  onClick={() => setShowNewAgentModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  className="bg-white text-black hover:bg-gray-200 px-6 py-2 rounded-xl text-sm font-bold transition-colors shadow-lg shadow-white/10"
                >
                  Boot Agent
                </button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
};
