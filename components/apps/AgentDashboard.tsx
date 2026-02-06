import React, { useState } from 'react';
import { Plus, Bot, Monitor } from 'lucide-react';
import { Agent, AgentStatus } from '../../types';
import { VirtualDesktop } from '../os/VirtualDesktop';

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

  const handleCreate = () => {
    if (!newGoal.trim()) return;
    onLaunchAgent(newRole, newGoal);
    setNewGoal('');
    setShowNewAgentModal(false);
  };

  return (
    <div className="h-full flex flex-col bg-[#1a1b26] text-gray-200 font-sans relative overflow-hidden">
      
      {/* Background Ambience */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1a1b26] via-[#1a1b26] to-[#0f111a] -z-10"></div>

      {/* Header */}
      <div className="p-8 pb-4 flex items-center justify-between z-10">
        <div>
          <h1 className="text-3xl font-light text-white tracking-tight flex items-center gap-3">
            Mission Control
            <span className="text-sm font-normal text-gray-500 bg-white/10 px-2 py-0.5 rounded-full">{agents.length} Active</span>
          </h1>
        </div>
        <button 
          onClick={() => setShowNewAgentModal(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-xl shadow-indigo-500/20 font-medium"
        >
          <Plus size={18} />
          Deploy Agent
        </button>
      </div>

      {/* Mission Control Grid */}
      <div className="flex-1 p-8 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 gap-6 opacity-60">
             <div className="w-32 h-32 rounded-3xl bg-white/5 border border-white/10 flex items-center justify-center">
                <Bot size={48} />
             </div>
             <div className="text-center">
                <p className="text-lg font-medium text-white">No Agents Deployed</p>
                <p className="text-sm">Create a new agent to see their virtual desktop.</p>
             </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-8">
            {agents.map(agent => (
              <div 
                key={agent.id} 
                className="group relative flex flex-col gap-3 animate-scale-in"
                onClick={() => onOpenVM(agent.id)}
              >
                {/* Desktop Preview Container */}
                <div className="aspect-video w-full rounded-2xl overflow-hidden border-[6px] border-[#2c2e3a] shadow-2xl bg-black relative transition-transform duration-300 group-hover:scale-[1.02] group-hover:border-indigo-500/50 cursor-pointer">
                    
                    {/* The Virtual Desktop Component */}
                    <VirtualDesktop agent={agent} scale={0.5} />

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <div className="bg-black/60 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 font-medium transform scale-90 group-hover:scale-100 transition-all">
                            <Monitor size={16} /> Enter VM
                        </div>
                    </div>
                </div>

                {/* Agent Meta Info under the desktop */}
                <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white shadow-lg text-xs font-bold">
                            {agent.role.substring(0,2).toUpperCase()}
                        </div>
                        <div>
                            <h3 className="text-sm font-medium text-white leading-none">{agent.name}</h3>
                            <p className="text-xs text-gray-400 mt-1 line-clamp-1">{agent.goal}</p>
                        </div>
                    </div>
                    <div className={`text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wide ${
                        agent.status === 'working' ? 'bg-green-500/20 text-green-400' :
                        agent.status === 'thinking' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-gray-700 text-gray-400'
                    }`}>
                        {agent.status}
                    </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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