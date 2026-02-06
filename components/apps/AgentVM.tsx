import React, { useState, useEffect, useRef } from 'react';
import { Terminal, AlertTriangle, Check, StopCircle, Github, ChevronRight, Layout, Cpu, HardDrive, Activity } from 'lucide-react';
import { Agent } from '../../types';
import { VirtualDesktop } from '../os/VirtualDesktop';
import { getKernelClient } from '../../services/kernelClient';
import { XTerminal } from '../os/XTerminal';

interface AgentVMProps {
  agent: Agent;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onStop: (id: string) => void;
  onSyncGithub: (id: string) => void;
}

export const AgentVM: React.FC<AgentVMProps> = ({ agent, onApprove, onReject, onStop, onSyncGithub }) => {
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'terminal'>('logs');
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agent.logs.length]);

  const statusColor = agent.status === 'working' ? 'bg-green-500' :
    agent.status === 'thinking' ? 'bg-blue-500' :
    agent.status === 'waiting_approval' ? 'bg-yellow-500' :
    agent.status === 'completed' ? 'bg-emerald-500' :
    agent.status === 'error' ? 'bg-red-500' : 'bg-gray-500';

  const phaseLabel = agent.phase || agent.status;

  return (
    <div className="flex h-full bg-[#000] text-gray-300 font-sans overflow-hidden relative">

      {/* Main Area: The Virtual Desktop */}
      <div className="flex-1 relative transition-all duration-300 ease-in-out">
         <VirtualDesktop agent={agent} interactive={false} />

         {/* Floating Control Bar */}
         <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full px-4 py-2 flex items-center gap-3 shadow-2xl z-[100] hover:bg-black/70 transition-colors">
             <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${statusColor} ${agent.status === 'working' ? 'animate-pulse' : ''}`}></div>
                <span className="text-xs font-bold text-white tracking-wide uppercase">{phaseLabel}</span>
             </div>

             {/* PID Badge (when connected to real kernel) */}
             {agent.pid && (
               <div className="text-[10px] text-gray-400 bg-white/5 px-1.5 py-0.5 rounded font-mono">
                 PID {agent.pid}
               </div>
             )}

             <div className="w-[1px] h-4 bg-white/20"></div>
             <button
                onClick={() => onSyncGithub(agent.id)}
                className={`p-1.5 rounded-full transition-colors ${agent.githubSync ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
                title="GitHub Sync"
             >
                 <Github size={14} />
             </button>
             <button
                onClick={() => onStop(agent.id)}
                className="p-1.5 rounded-full text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                title="Emergency Stop (SIGTERM)"
             >
                 <StopCircle size={14} />
             </button>
             <div className="w-[1px] h-4 bg-white/20"></div>
             <button
                onClick={() => setSidebarOpen(!isSidebarOpen)}
                className="p-1.5 rounded-full text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Toggle Debug Console"
             >
                 <Layout size={14} />
             </button>
         </div>

         {/* Approval Modal (Overlay on VM) */}
         {agent.status === 'waiting_approval' && (
             <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[200] animate-slide-up">
                <div className="bg-[#1a1d26]/90 backdrop-blur-xl border border-yellow-500/50 rounded-2xl shadow-2xl p-4 w-[400px] flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                        <div className="p-2 bg-yellow-500/20 rounded-lg text-yellow-400">
                            <AlertTriangle size={20} />
                        </div>
                        <div>
                            <h3 className="text-white font-medium">Permission Request</h3>
                            <p className="text-xs text-gray-400">Agent needs authorization to proceed.</p>
                        </div>
                    </div>

                    <div className="bg-black/50 p-3 rounded-lg border border-white/5 font-mono text-[10px] text-yellow-100">
                        {agent.logs[agent.logs.length - 1]?.message}
                    </div>

                    <div className="flex justify-end gap-2 mt-1">
                        <button
                           onClick={() => onReject(agent.id)}
                           className="px-4 py-1.5 rounded-lg hover:bg-white/5 text-gray-400 hover:text-white transition-colors text-xs font-medium"
                        >
                            Deny
                        </button>
                        <button
                           onClick={() => onApprove(agent.id)}
                           className="bg-white text-black hover:bg-gray-200 px-4 py-1.5 rounded-lg font-bold text-xs transition-colors flex items-center gap-2"
                        >
                            <Check size={12} /> Approve
                        </button>
                    </div>
                </div>
             </div>
        )}
      </div>

      {/* Sidebar: Debug Console */}
      <div
        className={`bg-[#0f111a] border-l border-white/10 flex flex-col transition-all duration-300 ease-in-out ${isSidebarOpen ? 'w-80' : 'w-0 opacity-0 pointer-events-none'}`}
      >
        {/* Tab Bar */}
        <div className="flex border-b border-white/10 bg-[#1a1d26]">
          <button
            onClick={() => setActiveTab('logs')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'logs' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Activity size={10} /> Agent Logs
          </button>
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex-1 p-2.5 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'terminal' ? 'text-white border-b-2 border-green-500' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <Terminal size={10} /> Terminal
            {agent.ttyId && <div className="w-1 h-1 rounded-full bg-green-500" />}
          </button>
        </div>

        {/* Sidebar close button */}
        <div className="absolute top-12 right-1 z-10">
          <button onClick={() => setSidebarOpen(false)} className="text-gray-600 hover:text-white p-1">
              <ChevronRight size={12} />
          </button>
        </div>

        {/* Agent Logs Tab */}
        {activeTab === 'logs' && (
          <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[10px]">
             {agent.logs.map((log, idx) => (
               <div key={idx} className="flex gap-2 animate-fade-in pb-2 border-b border-white/5 last:border-0">
                  <span className="text-gray-600 shrink-0 select-none">
                      {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
                  </span>
                  <span className={`${
                      log.type === 'thought' ? 'text-purple-300' :
                      log.type === 'action' ? 'text-blue-300' :
                      log.type === 'observation' ? 'text-cyan-300' :
                      'text-gray-400'
                  }`}>
                      {log.type === 'thought' && <span className="text-purple-500 font-bold block mb-0.5">THOUGHT</span>}
                      {log.type === 'action' && <span className="text-blue-500 font-bold block mb-0.5">ACTION</span>}
                      {log.type === 'observation' && <span className="text-cyan-500 font-bold block mb-0.5">OBSERVE</span>}
                      {log.message}
                  </span>
               </div>
             ))}
             <div ref={logEndRef} />
          </div>
        )}

        {/* Terminal Tab */}
        {activeTab === 'terminal' && (
          <div className="flex-1 overflow-hidden bg-[#0a0b12]">
            {agent.ttyId ? (
              <XTerminal ttyId={agent.ttyId} className="h-full" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2 p-3">
                <Terminal size={24} />
                <span className="text-[10px]">No terminal session</span>
                <span className="text-[9px]">Connect to kernel for live terminal</span>
              </div>
            )}
          </div>
        )}

        {/* Process Info Footer */}
        {agent.pid && (
          <div className="p-2 border-t border-white/10 bg-[#1a1d26] text-[9px] text-gray-500 flex items-center gap-3">
            <span className="flex items-center gap-1"><Cpu size={8} /> PID {agent.pid}</span>
            <span className="flex items-center gap-1"><HardDrive size={8} /> {agent.phase}</span>
            <span className="flex items-center gap-1"><Activity size={8} /> Step {agent.progress}</span>
          </div>
        )}
      </div>
    </div>
  );
};
