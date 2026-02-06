import React, { useMemo } from 'react';
import { Agent } from '../../types';
import { Wifi, Battery, Bot, FolderOpen, Globe, Terminal, Code, StickyNote, Image, MessageSquare, Calculator } from 'lucide-react';
import { WindowChromeStyle } from './Window';

// Simulated Apps
const VirtualWindow: React.FC<{ title: string; children: React.ReactNode; x: number; y: number; width: string; height: string; active?: boolean }> = ({ 
    title, children, x, y, width, height, active 
}) => {
    return (
        <div 
            className={`absolute flex flex-col rounded-lg overflow-hidden shadow-2xl transition-all duration-300 ${active ? 'z-20 ring-1 ring-white/20' : 'z-10 opacity-90'}`}
            style={{ 
                left: `${x}%`, 
                top: `${y}%`, 
                width: width, 
                height: height,
                backgroundColor: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(12px)'
            }}
        >
            {/* Title Bar */}
            <div className="h-6 bg-gray-200/50 flex items-center px-2 gap-2 border-b border-gray-300/30">
                <div className="flex gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-red-400"></div>
                    <div className="w-2 h-2 rounded-full bg-yellow-400"></div>
                    <div className="w-2 h-2 rounded-full bg-green-400"></div>
                </div>
                <div className="flex-1 text-[10px] text-center font-medium text-gray-500">{title}</div>
            </div>
            {/* Content */}
            <div className="flex-1 overflow-hidden relative">
                {children}
            </div>
        </div>
    );
};

interface VirtualDesktopProps {
    agent: Agent;
    scale?: number;
    interactive?: boolean;
}

export const VirtualDesktop: React.FC<VirtualDesktopProps> = ({ agent, scale = 1, interactive = false }) => {
    
    // Determine active windows based on agent logs/state
    const activeApp = useMemo(() => {
        const lastAction = agent.logs.filter(l => l.type === 'action').pop()?.message || '';
        if (lastAction.includes('Browsing') || agent.currentUrl) return 'browser';
        if (lastAction.includes('file') || lastAction.includes('code') || agent.currentCode) return 'code';
        if (agent.status === 'thinking') return 'terminal';
        return 'finder';
    }, [agent.logs, agent.currentUrl, agent.currentCode, agent.status]);

    return (
        <div 
            className="relative w-full h-full bg-cover bg-center overflow-hidden font-sans select-none"
            style={{ 
                backgroundImage: `url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2670&auto=format&fit=crop')`,
            }}
        >
            {/* Menu Bar */}
            <div className="h-6 bg-black/40 backdrop-blur-md flex items-center justify-between px-3 text-[10px] text-white/90 z-50 absolute top-0 left-0 right-0">
                <div className="flex gap-3">
                    <span className="font-bold"></span>
                    <span className="font-semibold">Agent OS</span>
                    <span>File</span>
                    <span>Edit</span>
                    <span>View</span>
                </div>
                <div className="flex gap-3">
                    <div className="flex items-center gap-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${agent.status === 'working' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}></div>
                        <span>{agent.status}</span>
                    </div>
                    <Wifi size={10} />
                    <Battery size={10} />
                    <span>{new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                </div>
            </div>

            {/* Desktop Area */}
            <div className="absolute inset-0 pt-6 pb-16 p-4">
                
                {/* Background Icons */}
                <div className="absolute top-8 right-4 flex flex-col gap-4 items-center opacity-80">
                    <div className="flex flex-col items-center gap-1">
                        <div className="w-10 h-10 bg-blue-100/20 backdrop-blur rounded-lg flex items-center justify-center text-blue-300 border border-white/10">
                            <FolderOpen size={20} />
                        </div>
                        <span className="text-[9px] text-white font-medium shadow-black drop-shadow-md">Project</span>
                    </div>
                    {agent.githubSync && (
                         <div className="flex flex-col items-center gap-1">
                            <div className="w-10 h-10 bg-gray-800/40 backdrop-blur rounded-lg flex items-center justify-center text-white border border-white/10">
                                <Code size={20} />
                            </div>
                            <span className="text-[9px] text-white font-medium shadow-black drop-shadow-md">Repo</span>
                        </div>
                    )}
                </div>

                {/* Windows Layer */}
                <div className="relative w-full h-full">
                    
                    {/* Always present: Terminal (Agent Brain) - positioned nicely */}
                    <VirtualWindow 
                        title={`Terminal - ${agent.role}`} 
                        x={5} y={5} width="40%" height="45%" 
                        active={activeApp === 'terminal'}
                    >
                        <div className="h-full bg-[#1a1b26] p-2 font-mono text-[9px] text-blue-200 overflow-hidden leading-relaxed">
                            <div className="text-green-400 mb-1">$ agent-init --role="{agent.role}"</div>
                            <div className="opacity-50 mb-2">Initializing virtual environment...</div>
                            {agent.logs.slice(-6).map((log, i) => (
                                <div key={i} className="mb-1">
                                    <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]</span>{' '}
                                    <span className={log.type === 'thought' ? 'text-purple-300' : log.type === 'action' ? 'text-yellow-300' : 'text-gray-300'}>
                                        {log.message}
                                    </span>
                                </div>
                            ))}
                            {agent.status === 'thinking' && <div className="animate-pulse">_</div>}
                        </div>
                    </VirtualWindow>

                    {/* Conditional: Browser Window */}
                    {(agent.currentUrl || activeApp === 'browser') && (
                        <VirtualWindow 
                            title="Safari - Agent View" 
                            x={30} y={15} width="60%" height="70%" 
                            active={activeApp === 'browser'}
                        >
                            <div className="h-full flex flex-col bg-white">
                                <div className="h-6 border-b flex items-center px-2 bg-gray-50">
                                    <div className="flex-1 bg-gray-200 h-4 rounded flex items-center px-2 text-[8px] text-gray-500 truncate">
                                        {agent.currentUrl || 'about:blank'}
                                    </div>
                                </div>
                                <div className="flex-1 p-4 overflow-hidden relative">
                                    {/* Mock Web Content */}
                                    <div className="w-1/3 h-2 bg-gray-800 rounded mb-2"></div>
                                    <div className="w-full h-1 bg-gray-200 rounded mb-1"></div>
                                    <div className="w-5/6 h-1 bg-gray-200 rounded mb-4"></div>
                                    
                                    <div className="grid grid-cols-2 gap-2">
                                        <div className="h-20 bg-gray-100 rounded"></div>
                                        <div className="h-20 bg-gray-100 rounded"></div>
                                    </div>
                                    
                                    {agent.currentUrl && (
                                        <div className="mt-4 p-2 bg-blue-50 border border-blue-100 rounded text-[9px] text-blue-800">
                                            {agent.logs.findLast(l => l.type === 'action' && l.message.includes('Browsing'))?.message || 'Page Content Loaded'}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </VirtualWindow>
                    )}

                    {/* Conditional: Code Editor Window */}
                    {(agent.currentCode || activeApp === 'code') && (
                        <VirtualWindow 
                            title={`VS Code - ${agent.role}`} 
                            x={45} y={25} width="50%" height="65%" 
                            active={activeApp === 'code'}
                        >
                            <div className="h-full flex bg-[#1e1e1e]">
                                <div className="w-8 bg-[#252526] border-r border-[#333]"></div>
                                <div className="flex-1 p-2 font-mono text-[9px] text-gray-300 whitespace-pre overflow-hidden">
                                    <div className="text-gray-500 mb-2">// Generated Code</div>
                                    {agent.currentCode ? (
                                        <span className="text-blue-300">{agent.currentCode.substring(0, 300)}</span>
                                    ) : (
                                        <span className="opacity-50">Waiting for code generation...</span>
                                    )}
                                </div>
                            </div>
                        </VirtualWindow>
                    )}

                </div>
            </div>

            {/* Dock */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-auto bg-white/20 backdrop-blur-xl border border-white/20 px-2 py-1.5 rounded-xl flex items-end gap-2 z-50">
                {[Bot, FolderOpen, Globe, Terminal, Code, StickyNote].map((Icon, i) => (
                    <div key={i} className="w-6 h-6 rounded-lg bg-gray-400/20 flex items-center justify-center text-white border border-white/10 shadow-sm">
                        <Icon size={12} />
                    </div>
                ))}
            </div>

            {/* Overlay for non-interactive mode */}
            {!interactive && <div className="absolute inset-0 z-[100]"></div>}
        </div>
    );
};