import React, { useMemo, useState, useEffect } from 'react';
import { Agent } from '../../types';
import {
  Wifi,
  Battery,
  Bot,
  FolderOpen,
  Globe,
  Terminal,
  Code,
  StickyNote,
  Cpu,
  Activity,
  File,
  Folder,
  Monitor,
} from 'lucide-react';
import { getKernelClient, KernelFileStat, VNCInfo } from '../../services/kernelClient';
import { VNCViewer } from './VNCViewer';

// Simulated window within the virtual desktop
const VirtualWindow: React.FC<{
  title: string;
  children: React.ReactNode;
  x: number;
  y: number;
  width: string;
  height: string;
  active?: boolean;
}> = ({ title, children, x, y, width, height, active }) => {
  return (
    <div
      className={`absolute flex flex-col rounded-lg overflow-hidden shadow-2xl transition-all duration-300 ${active ? 'z-20 ring-1 ring-white/20' : 'z-10 opacity-90'}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        width: width,
        height: height,
        backgroundColor: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
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
      <div className="flex-1 overflow-hidden relative">{children}</div>
    </div>
  );
};

interface VirtualDesktopProps {
  agent: Agent;
  scale?: number;
  interactive?: boolean;
}

export const VirtualDesktop: React.FC<VirtualDesktopProps> = ({
  agent,
  scale = 1,
  interactive = false,
}) => {
  // Terminal output buffer (real kernel output)
  const [ttyOutput, setTtyOutput] = useState<string[]>([]);

  // File listing from kernel
  const [fileList, setFileList] = useState<KernelFileStat[]>([]);
  const [filesLoaded, setFilesLoaded] = useState(false);

  // VNC state for graphical agents
  const [vncInfo, setVncInfo] = useState<VNCInfo | null>(null);

  // Agent paused state (human takeover)
  const [agentPaused, setAgentPaused] = useState(false);

  // GPU allocation for this agent
  const [gpuIds, setGpuIds] = useState<number[] | undefined>(undefined);

  // Check for VNC session on mount
  useEffect(() => {
    if (!agent.pid) return;

    const client = getKernelClient();
    if (!client.connected) return;

    // Check if this agent has a VNC session
    client.getVNCInfo(agent.pid).then((info) => {
      if (info) setVncInfo(info);
    });

    // Subscribe to VNC events
    const unsubStarted = client.on('vnc.started', (data: any) => {
      if (data.pid === agent.pid) {
        setVncInfo({ pid: data.pid, wsPort: data.wsPort, display: data.display });
      }
    });
    const unsubStopped = client.on('vnc.stopped', (data: any) => {
      if (data.pid === agent.pid) {
        setVncInfo(null);
      }
    });

    // Subscribe to pause/resume events
    const unsubPaused = client.on('agent.paused', (data: any) => {
      if (data.pid === agent.pid) setAgentPaused(true);
    });
    const unsubResumed = client.on('agent.resumed', (data: any) => {
      if (data.pid === agent.pid) setAgentPaused(false);
    });

    // Subscribe to GPU events
    const unsubGpuAlloc = client.on('gpu.allocated', (data: any) => {
      if (data.pid === agent.pid) setGpuIds(data.gpuIds);
    });
    const unsubGpuRelease = client.on('gpu.released', (data: any) => {
      if (data.pid === agent.pid) setGpuIds(undefined);
    });

    return () => {
      unsubStarted();
      unsubStopped();
      unsubPaused();
      unsubResumed();
      unsubGpuAlloc();
      unsubGpuRelease();
    };
  }, [agent.pid]);

  // Subscribe to tty output for this agent
  useEffect(() => {
    if (!agent.ttyId) return;

    const client = getKernelClient();
    const unsub = client.on('tty.output', (data: any) => {
      if (data.ttyId === agent.ttyId) {
        setTtyOutput((prev) => {
          const lines = [...prev, data.data];
          return lines.length > 50 ? lines.slice(-50) : lines;
        });
      }
    });

    return unsub;
  }, [agent.ttyId]);

  // Fetch file listing from kernel
  useEffect(() => {
    if (!agent.pid) return;

    const client = getKernelClient();
    if (!client.connected) return;

    const agentUid = agent.id.replace('agent_', 'agent-');
    const fetchFiles = async () => {
      try {
        const files = await client.listDir(`/home/${agentUid}`);
        setFileList(files);
        setFilesLoaded(true);
      } catch {
        setFilesLoaded(false);
      }
    };

    fetchFiles();
    const interval = setInterval(fetchFiles, 10000);
    return () => clearInterval(interval);
  }, [agent.pid, agent.id]);

  // Whether this agent has an active VNC desktop
  const hasVNC = vncInfo !== null;
  const vncWsUrl = vncInfo ? `ws://localhost:${vncInfo.wsPort}` : null;

  // Determine active windows based on agent logs/state
  const activeApp = useMemo(() => {
    const lastAction = agent.logs.filter((l) => l.type === 'action').pop()?.message || '';
    if (lastAction.includes('Browsing') || lastAction.includes('browse') || agent.currentUrl)
      return 'browser';
    if (
      lastAction.includes('file') ||
      lastAction.includes('write_file') ||
      lastAction.includes('code') ||
      agent.currentCode
    )
      return 'code';
    if (agent.status === 'thinking' || agent.phase === 'thinking') return 'terminal';
    if (lastAction.includes('run_command')) return 'terminal';
    return 'finder';
  }, [agent.logs, agent.currentUrl, agent.currentCode, agent.status, agent.phase]);

  // Status display - use phase if available (kernel mode), otherwise status
  const displayStatus = agent.phase || agent.status;
  const isActive =
    agent.status === 'working' ||
    agent.status === 'thinking' ||
    agent.phase === 'executing' ||
    agent.phase === 'thinking' ||
    agent.phase === 'observing';

  // Dock icon mapping for highlighting
  const dockIcons = [
    { Icon: Bot, id: 'agent' },
    ...(hasVNC ? [{ Icon: Monitor, id: 'vnc' }] : []),
    { Icon: FolderOpen, id: 'finder' },
    { Icon: Globe, id: 'browser' },
    { Icon: Terminal, id: 'terminal' },
    { Icon: Code, id: 'code' },
    { Icon: StickyNote, id: 'notes' },
  ];

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
          <span className="font-bold"></span>
          <span className="font-semibold">Aether OS</span>
          <span>File</span>
          <span>Edit</span>
          <span>View</span>
        </div>
        <div className="flex gap-3">
          {agent.pid && (
            <div className="flex items-center gap-1 text-[9px] opacity-50">
              <Cpu size={8} />
              <span>PID {agent.pid}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <div
              className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`}
            ></div>
            <span>{displayStatus}</span>
          </div>
          <Wifi size={10} />
          <Battery size={10} />
          <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Desktop Area */}
      <div className="absolute inset-0 pt-6 pb-16 p-4">
        {/* VNC Desktop Mode: render real graphical desktop when VNC is active */}
        {hasVNC && vncWsUrl ? (
          <div className="relative w-full h-full">
            <VNCViewer wsUrl={vncWsUrl} scale={scale} viewOnly={!agentPaused} />
          </div>
        ) : (
          /* Standard simulated windows mode (non-graphical agents) */
          <>
            {/* Background Icons */}
            <div className="absolute top-8 right-4 flex flex-col gap-4 items-center opacity-80">
              <div className="flex flex-col items-center gap-1">
                <div className="w-10 h-10 bg-blue-100/20 backdrop-blur rounded-lg flex items-center justify-center text-blue-300 border border-white/10">
                  <FolderOpen size={20} />
                </div>
                <span className="text-[9px] text-white font-medium shadow-black drop-shadow-md">
                  Project
                </span>
              </div>
              {agent.githubSync && (
                <div className="flex flex-col items-center gap-1">
                  <div className="w-10 h-10 bg-gray-800/40 backdrop-blur rounded-lg flex items-center justify-center text-white border border-white/10">
                    <Code size={20} />
                  </div>
                  <span className="text-[9px] text-white font-medium shadow-black drop-shadow-md">
                    Repo
                  </span>
                </div>
              )}
            </div>

            {/* Windows Layer */}
            <div className="relative w-full h-full">
              {/* Terminal Window - shows real tty output or falls back to logs */}
              <VirtualWindow
                title={`Terminal - ${agent.role}${agent.pid ? ` (PID ${agent.pid})` : ''}`}
                x={5}
                y={5}
                width="40%"
                height="45%"
                active={activeApp === 'terminal'}
              >
                <div className="h-full bg-[#1a1b26] p-2 font-mono text-[9px] text-blue-200 overflow-hidden leading-relaxed">
                  <div className="text-green-400 mb-1">$ agent-init --role="{agent.role}"</div>
                  <div className="opacity-50 mb-2">
                    {agent.pid
                      ? `Process ${agent.pid} started in sandbox`
                      : 'Initializing virtual environment...'}
                  </div>
                  {/* Show real TTY output if available */}
                  {agent.ttyId && ttyOutput.length > 0
                    ? ttyOutput.slice(-8).map((line, i) => (
                        <div key={i} className="mb-0.5 text-gray-300 whitespace-pre-wrap break-all">
                          {line}
                        </div>
                      ))
                    : /* Fall back to agent logs */
                      agent.logs.slice(-6).map((log, i) => (
                        <div key={i} className="mb-1">
                          <span className="text-gray-500">
                            [{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}]
                          </span>{' '}
                          <span
                            className={
                              log.type === 'thought'
                                ? 'text-purple-300'
                                : log.type === 'action'
                                  ? 'text-yellow-300'
                                  : log.type === 'observation'
                                    ? 'text-cyan-300'
                                    : 'text-gray-300'
                            }
                          >
                            {log.message}
                          </span>
                        </div>
                      ))}
                  {(agent.status === 'thinking' || agent.phase === 'thinking') && (
                    <div className="animate-pulse">_</div>
                  )}
                </div>
              </VirtualWindow>

              {/* File Manager Window - shows real files when kernel connected */}
              {(activeApp === 'finder' || filesLoaded) && (
                <VirtualWindow
                  title={`Finder - ${agent.role}`}
                  x={48}
                  y={5}
                  width="45%"
                  height="40%"
                  active={activeApp === 'finder'}
                >
                  <div className="h-full bg-white flex">
                    {/* Sidebar */}
                    <div className="w-1/4 bg-gray-50 border-r border-gray-200 p-1.5 text-[8px]">
                      <div className="text-gray-400 font-bold uppercase mb-1">Favorites</div>
                      <div className="flex items-center gap-1 text-gray-600 py-0.5 px-1 rounded bg-blue-50">
                        <FolderOpen size={8} className="text-blue-500" />
                        <span>Home</span>
                      </div>
                      <div className="flex items-center gap-1 text-gray-500 py-0.5 px-1">
                        <FolderOpen size={8} />
                        <span>Project</span>
                      </div>
                    </div>
                    {/* File List */}
                    <div className="flex-1 p-1.5 text-[8px] overflow-y-auto">
                      {filesLoaded && fileList.length > 0 ? (
                        fileList.slice(0, 10).map((f, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-blue-50 rounded"
                          >
                            {f.type === 'directory' ? (
                              <Folder size={8} className="text-blue-400" />
                            ) : (
                              <File size={8} className="text-gray-400" />
                            )}
                            <span className="text-gray-700 truncate">{f.name}</span>
                            <span className="ml-auto text-gray-400 text-[7px]">
                              {f.type === 'file' ? `${(f.size / 1024).toFixed(1)}K` : '--'}
                            </span>
                          </div>
                        ))
                      ) : (
                        /* Mock file display */
                        <>
                          <div className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-blue-50 rounded">
                            <Folder size={8} className="text-blue-400" />
                            <span className="text-gray-700">src/</span>
                          </div>
                          <div className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-blue-50 rounded">
                            <File size={8} className="text-gray-400" />
                            <span className="text-gray-700">package.json</span>
                          </div>
                          <div className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-blue-50 rounded">
                            <File size={8} className="text-gray-400" />
                            <span className="text-gray-700">README.md</span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </VirtualWindow>
              )}

              {/* Conditional: Browser Window */}
              {(agent.currentUrl || activeApp === 'browser') && (
                <VirtualWindow
                  title="Safari - Agent View"
                  x={30}
                  y={15}
                  width="60%"
                  height="70%"
                  active={activeApp === 'browser'}
                >
                  <div className="h-full flex flex-col bg-white">
                    <div className="h-6 border-b flex items-center px-2 bg-gray-50">
                      <div className="flex-1 bg-gray-200 h-4 rounded flex items-center px-2 text-[8px] text-gray-500 truncate">
                        {agent.currentUrl || 'about:blank'}
                      </div>
                    </div>
                    <div className="flex-1 p-4 overflow-hidden relative">
                      <div className="w-1/3 h-2 bg-gray-800 rounded mb-2"></div>
                      <div className="w-full h-1 bg-gray-200 rounded mb-1"></div>
                      <div className="w-5/6 h-1 bg-gray-200 rounded mb-4"></div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="h-20 bg-gray-100 rounded"></div>
                        <div className="h-20 bg-gray-100 rounded"></div>
                      </div>

                      {agent.currentUrl && (
                        <div className="mt-4 p-2 bg-blue-50 border border-blue-100 rounded text-[9px] text-blue-800">
                          {agent.logs.findLast(
                            (l) =>
                              l.type === 'action' &&
                              (l.message.includes('Browsing') || l.message.includes('browse')),
                          )?.message || 'Page Content Loaded'}
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
                  x={45}
                  y={25}
                  width="50%"
                  height="65%"
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
          </>
        )}

        {/* Activity Monitor Widget - shown over both VNC and simulated modes */}
        {agent.pid && (
          <div className="absolute bottom-20 right-4 bg-black/50 backdrop-blur-xl border border-white/10 rounded-lg p-2 text-[8px] text-white/70 z-30 w-32">
            <div className="flex items-center gap-1 mb-1.5 text-white/90 font-semibold">
              <Activity size={8} />
              <span>Activity</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span>PID</span>
                <span className="font-mono text-cyan-300">{agent.pid}</span>
              </div>
              <div className="flex justify-between">
                <span>Phase</span>
                <span className={`font-mono ${isActive ? 'text-green-300' : 'text-gray-400'}`}>
                  {agent.phase || agent.status}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Steps</span>
                <span className="font-mono text-blue-300">{agent.progress}</span>
              </div>
              {gpuIds && gpuIds.length > 0 && (
                <div className="flex justify-between">
                  <span>GPU</span>
                  <span className="font-mono text-yellow-300">{gpuIds.length}x</span>
                </div>
              )}
              {hasVNC && (
                <div className="flex justify-between">
                  <span>Display</span>
                  <span className="font-mono text-green-300">VNC</span>
                </div>
              )}
              {/* Mini progress bar */}
              <div className="mt-1">
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-500 rounded-full"
                    style={{ width: `${Math.min(100, (agent.progress / 50) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dock with active app highlighting */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-auto bg-white/20 backdrop-blur-xl border border-white/20 px-2 py-1.5 rounded-xl flex items-end gap-2 z-50">
        {dockIcons.map(({ Icon, id }, i) => {
          const isActiveIcon = activeApp === id;
          return (
            <div
              key={i}
              className={`w-6 h-6 rounded-lg flex items-center justify-center border shadow-sm transition-all duration-300
                                ${
                                  isActiveIcon
                                    ? 'bg-indigo-500/40 border-indigo-400/50 text-white ring-1 ring-indigo-400/30 scale-110'
                                    : 'bg-gray-400/20 border-white/10 text-white'
                                }
                                ${isActiveIcon && isActive ? 'animate-pulse' : ''}
                            `}
            >
              <Icon size={12} />
            </div>
          );
        })}
      </div>

      {/* Paused banner */}
      {agentPaused && hasVNC && (
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 bg-amber-500/20 backdrop-blur-sm border border-amber-500/30 rounded-full px-4 py-1.5">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="text-[11px] font-semibold text-amber-200">
            Agent Paused — You have control
          </span>
        </div>
      )}

      {/* Overlay for non-interactive mode */}
      {!interactive && !agentPaused && <div className="absolute inset-0 z-[100]"></div>}
    </div>
  );
};
