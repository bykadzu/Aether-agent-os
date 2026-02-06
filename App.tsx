import React, { useState, useEffect, useRef } from 'react';
import { AppID, WindowState, Agent, AgentStatus } from './types';
import { Window } from './components/os/Window';
import { Dock } from './components/os/Dock';
import { SmartBar } from './components/apps/SmartBar';
import { NotesApp } from './components/apps/NotesApp';
import { PhotosApp } from './components/apps/PhotosApp';
import { ChatApp } from './components/apps/ChatApp';
import { FileExplorer } from './components/apps/FileExplorer';
import { SettingsApp } from './components/apps/SettingsApp';
import { TerminalApp } from './components/apps/TerminalApp';
import { BrowserApp } from './components/apps/BrowserApp';
import { CalculatorApp } from './components/apps/CalculatorApp';
import { CodeEditorApp } from './components/apps/CodeEditorApp';
import { VideoPlayerApp } from './components/apps/VideoPlayerApp';
import { AgentDashboard } from './components/apps/AgentDashboard';
import { AgentVM } from './components/apps/AgentVM';
import { DesktopWidgets } from './components/os/DesktopWidgets';
import { ContextMenu } from './components/os/ContextMenu';
import { Battery, Wifi, Search, Command, RefreshCw, FolderPlus, Monitor, Image as ImageIcon } from 'lucide-react';
import { FileSystemItem, mockFileSystem } from './data/mockFileSystem';
import { generateText, GeminiModel, getAgentDecision } from './services/geminiService';

const App: React.FC = () => {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [isSmartBarOpen, setIsSmartBarOpen] = useState(false);
  const [time, setTime] = useState(new Date());
  const [isBooting, setIsBooting] = useState(true);
  
  // File System State
  const [files, setFiles] = useState<FileSystemItem[]>(mockFileSystem);
  
  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ isOpen: boolean; x: number; y: number } | null>(null);

  // Agent System State
  const [agents, setAgents] = useState<Agent[]>([]);
  
  // ---- REAL AI AGENT LOOP ----
  useEffect(() => {
    const runAgentStep = async (agent: Agent) => {
        // If agent is busy, skip
        if (agent.isWaiting) return;

        // Mark agent as waiting for network
        setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, isWaiting: true } : a));

        // Get File System context (names only)
        const fileNames = files.map(f => f.name);
        
        // Ask Gemini what to do
        const decision = await getAgentDecision(agent, fileNames);

        // Execute Decision
        setAgents(prev => prev.map(a => {
            if (a.id !== agent.id) return a;
            
            const newLogs = [...a.logs];
            let newStatus = a.status;
            let newUrl = a.currentUrl;
            let newCode = a.currentCode;

            // 1. Log the thought
            newLogs.push({ timestamp: Date.now(), type: 'thought', message: decision.thought });

            // 2. Perform Action
            if (decision.action === 'create_file' && decision.fileName && decision.fileContent) {
                // Side Effect: Create File in OS
                const newFile: FileSystemItem = {
                    id: `file_${Date.now()}`,
                    parentId: 'root', // Agents drop files in root for now
                    name: decision.fileName,
                    type: 'file',
                    kind: decision.fileName.endsWith('png') || decision.fileName.endsWith('jpg') ? 'image' : 'code',
                    date: 'Just now',
                    size: `${(decision.fileContent.length / 1024).toFixed(1)} KB`,
                    content: decision.fileContent
                };
                
                // We need to update the file system state, but we are inside setAgents map
                // We'll queue this update via a separate effect or just break purity slightly for the demo
                // Ideally we'd use a reducer, but let's use the setter from outside
                setFiles(currentFiles => {
                     // Check duplicates
                     if (currentFiles.some(f => f.name === decision.fileName)) return currentFiles;
                     return [...currentFiles, newFile];
                });

                newLogs.push({ timestamp: Date.now(), type: 'action', message: `Created file: ${decision.fileName}` });
                newCode = decision.fileContent;
            } 
            else if (decision.action === 'browse' && decision.url) {
                newUrl = decision.url;
                newLogs.push({ timestamp: Date.now(), type: 'action', message: `Browsing ${decision.url}... ${decision.webSummary ? `Found: ${decision.webSummary.substring(0, 50)}...` : ''}` });
            }
            else if (decision.action === 'complete') {
                newStatus = 'completed';
                newLogs.push({ timestamp: Date.now(), type: 'system', message: 'Goal achieved. Task complete.' });
            }

            // Sync simulation
            if (a.githubSync && decision.action !== 'think') {
                 newLogs.push({ timestamp: Date.now(), type: 'system', message: 'Synced changes to GitHub repository [main].' });
            }

            return {
                ...a,
                status: newStatus,
                currentUrl: newUrl,
                currentCode: newCode,
                logs: newLogs,
                isWaiting: false // Done
            };
        }));
    };

    const interval = setInterval(() => {
        agents.forEach(agent => {
            if (agent.status === 'working' || agent.status === 'thinking') {
                runAgentStep(agent);
            }
        });
    }, 4000); // Check every 4 seconds to be polite to the API

    return () => clearInterval(interval);
  }, [agents, files]); 
  // Dependency on 'agents' might cause too many re-renders if not careful, 
  // but since we only update 'isWaiting' inside runAgentStep initially, it should be stable enough for this demo.


  // Boot Effect
  useEffect(() => {
    const timer = setTimeout(() => setIsBooting(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Clock Update
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSmartBarOpen(prev => !prev);
      }
      if (e.key === 'Escape') {
          setIsSmartBarOpen(false);
          setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const openApp = (appId: AppID, initialData?: any) => {
    // If it's a VM window, we allow multiples, so we generate a unique ID based on agent ID
    if (appId === AppID.VM && initialData?.agentId) {
        const winId = `vm-${initialData.agentId}`;
        const existing = windows.find(w => w.id === winId);
        if (existing) {
            focusWindow(winId);
            if (existing.isMinimized) {
                setWindows(prev => prev.map(w => w.id === winId ? { ...w, isMinimized: false } : w));
            }
        } else {
             const agent = agents.find(a => a.id === initialData.agentId);
             const newWindow: WindowState = {
                id: winId,
                appId: AppID.VM,
                title: `VM: ${agent?.name || 'Agent'}`,
                isOpen: true,
                isMinimized: false,
                isMaximized: false,
                zIndex: windows.length + 1,
                position: { x: 150, y: 100 },
                size: { width: 1000, height: 700 },
                initialData
            };
            setWindows(prev => [...prev, newWindow]);
            setActiveWindowId(winId);
        }
        return;
    }

    // For standard apps (single instance mostly)
    const winId = appId;
    const existingWindow = windows.find(w => w.id === winId);
    
    if (existingWindow) {
      if (existingWindow.isMinimized) {
        setWindows(prev => prev.map(w => w.id === winId ? { ...w, isMinimized: false, initialData } : w));
      } else {
        if (initialData) {
            setWindows(prev => prev.map(w => w.id === winId ? { ...w, initialData } : w));
        }
      }
      focusWindow(winId);
    } else {
      const isCalculator = appId === AppID.CALCULATOR;
      const newWindow: WindowState = {
        id: winId,
        appId: appId,
        title: getAppTitle(appId),
        isOpen: true,
        isMinimized: false,
        isMaximized: false,
        zIndex: windows.length + 1,
        position: { x: 100 + (windows.length * 30), y: 100 + (windows.length * 30) },
        size: isCalculator ? { width: 320, height: 480 } : { width: 900, height: 650 },
        initialData
      };
      setWindows(prev => [...prev, newWindow]);
      setActiveWindowId(winId);
    }
  };

  const getAppTitle = (id: AppID) => {
    switch(id) {
      case AppID.NOTES: return 'Notes';
      case AppID.PHOTOS: return 'Photos';
      case AppID.FILES: return 'Finder';
      case AppID.CHAT: return 'Gemini Chat';
      case AppID.SETTINGS: return 'Settings';
      case AppID.TERMINAL: return 'Terminal';
      case AppID.BROWSER: return 'Safari';
      case AppID.CALCULATOR: return 'Calculator';
      case AppID.CODE: return 'Code - Untitled';
      case AppID.VIDEO: return 'Media Player';
      case AppID.AGENTS: return 'Agent Center';
      default: return 'App';
    }
  };

  const closeWindow = (id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
    if (activeWindowId === id) setActiveWindowId(null);
  };

  const minimizeWindow = (id: string) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, isMinimized: true } : w));
    setActiveWindowId(null);
  };

  const maximizeWindow = (id: string) => {
     setWindows(prev => prev.map(w => w.id === id ? { ...w, isMaximized: !w.isMaximized } : w));
  };

  const focusWindow = (id: string) => {
    setActiveWindowId(id);
    setWindows(prev => {
      const maxZ = Math.max(...prev.map(w => w.zIndex), 0);
      return prev.map(w => w.id === id ? { ...w, zIndex: maxZ + 1 } : w);
    });
  };

  const moveWindow = (id: string, x: number, y: number) => {
    setWindows(prev => prev.map(w => w.id === id ? { ...w, position: { x, y } } : w));
  };

  const resizeWindow = (id: string, width: number, height: number, x?: number, y?: number) => {
    setWindows(prev => prev.map(w => {
      if (w.id === id) {
        return { 
          ...w, 
          size: { width, height },
          position: (x !== undefined && y !== undefined) ? { x, y } : w.position
        };
      }
      return w;
    }));
  };

  // Agent Management
  const launchAgent = async (role: string, goal: string) => {
      const id = `agent_${Date.now()}`;
      const newAgent: Agent = {
          id,
          name: `${role} Alpha`,
          role,
          goal,
          status: 'thinking',
          progress: 0,
          logs: [{ timestamp: Date.now(), type: 'system', message: `Agent ${id} initialized.` }]
      };
      setAgents(prev => [...prev, newAgent]);

      // Trigger initial Gemini thought to kickstart simulation
      // We don't set status to 'working' immediately, let the loop pick it up
      setTimeout(() => {
          setAgents(prev => prev.map(a => a.id === id ? { ...a, status: 'working' } : a));
      }, 500);
  };

  const stopAgent = (id: string) => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, status: 'error', logs: [...a.logs, { timestamp: Date.now(), type: 'system', message: 'Process terminated by user.' }] } : a));
  };

  const approveAgent = (id: string) => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, status: 'working', logs: [...a.logs, { timestamp: Date.now(), type: 'system', message: 'Action approved by user.' }] } : a));
  };

  const rejectAgent = (id: string) => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, status: 'thinking', logs: [...a.logs, { timestamp: Date.now(), type: 'system', message: 'Action denied. Re-evaluating strategy...' }] } : a));
  };

  const syncGithub = (id: string) => {
      setAgents(prev => prev.map(a => a.id === id ? { ...a, githubSync: !a.githubSync, logs: [...a.logs, { timestamp: Date.now(), type: 'system', message: !a.githubSync ? 'Connected to GitHub repository.' : 'Disconnected from GitHub.' }] } : a));
  };

  const renderAppContent = (windowState: WindowState) => {
    switch (windowState.appId) {
      case AppID.NOTES: 
        return <NotesApp 
            initialContent={windowState.initialData?.content} 
            onSave={(content) => windowState.initialData?.fileId && handleSaveFile(windowState.initialData.fileId, content)}
        />;
      case AppID.PHOTOS: return <PhotosApp initialImage={windowState.initialData?.image} />;
      case AppID.CHAT: return <ChatApp />;
      case AppID.FILES: return <FileExplorer files={files} onOpenFile={handleOpenFile} />;
      case AppID.SETTINGS: return <SettingsApp />;
      case AppID.TERMINAL: return <TerminalApp files={files} setFiles={setFiles} />;
      case AppID.BROWSER: return <BrowserApp />;
      case AppID.CALCULATOR: return <CalculatorApp />;
      case AppID.CODE: 
        return <CodeEditorApp 
            initialContent={windowState.initialData?.content} 
            fileName={windowState.initialData?.fileName}
            onSave={(content) => windowState.initialData?.fileId && handleSaveFile(windowState.initialData.fileId, content)}
        />;
      case AppID.VIDEO:
        return <VideoPlayerApp url={windowState.initialData?.url} title={windowState.initialData?.title} />;
      case AppID.AGENTS:
        return <AgentDashboard 
            agents={agents} 
            onLaunchAgent={launchAgent} 
            onOpenVM={(agentId) => openApp(AppID.VM, { agentId })} 
            onStopAgent={stopAgent}
        />;
      case AppID.VM:
         const agent = agents.find(a => a.id === windowState.initialData?.agentId);
         if (!agent) return <div className="p-4 text-white">Agent not found or terminated.</div>;
         return <AgentVM agent={agent} onApprove={approveAgent} onReject={rejectAgent} onStop={stopAgent} onSyncGithub={syncGithub} />;
      default: return null;
    }
  };

  // Helper functions for existing apps
  const handleSaveFile = (fileId: string, content: string) => {
    setFiles(prev => prev.map(f => {
        if (f.id === fileId) {
            return { ...f, content, size: `${(content.length / 1024).toFixed(1)} KB`, date: 'Just now' };
        }
        return f;
    }));
  };

  const handleOpenFile = (file: FileSystemItem) => {
    if (file.kind === 'text') {
        openApp(AppID.NOTES, { content: file.content, fileId: file.id });
    } else if (file.kind === 'code') {
        openApp(AppID.CODE, { content: file.content, fileId: file.id, fileName: file.name });
    } else if (file.kind === 'image') {
        openApp(AppID.PHOTOS, { image: file.url });
    } else if (file.kind === 'video' || file.kind === 'audio') {
        openApp(AppID.VIDEO, { url: file.url, title: file.name });
    } else {
        openApp(AppID.NOTES, { content: `Cannot view file type: ${file.kind}\n\nMetadata:\nName: ${file.name}\nSize: ${file.size}` });
    }
  };

  if (isBooting) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white">
        <div className="text-6xl mb-8"></div>
        <div className="w-48 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-white animate-[width_2s_ease-out_forwards] w-0"></div>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="w-screen h-screen overflow-hidden bg-cover bg-center font-sans relative selection:bg-indigo-500/30"
      style={{ backgroundImage: `url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2670&auto=format&fit=crop')` }} // Changed to a darker, more tech-focused wallpaper
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY }); }}
      onClick={() => setContextMenu(null)}
    >
      
      {/* Menu Bar */}
      <div className="h-8 bg-black/40 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-4 text-xs font-medium text-white/90 z-[9990] relative shadow-sm select-none">
        <div className="flex items-center gap-4">
          <span className="font-bold text-sm hover:text-white cursor-pointer"></span>
          <span className="hidden sm:inline font-semibold cursor-default">Aether OS</span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">Agent Center</span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">Window</span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">Help</span>
        </div>
        <div className="flex items-center gap-4">
           <button 
             onClick={(e) => { e.stopPropagation(); setIsSmartBarOpen(true); }}
             className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded transition-colors"
           >
              <Search size={12} />
              <span className="opacity-70">Search</span>
              <div className="flex items-center text-[10px] opacity-50 ml-1">
                 <Command size={10} />
                 <span>K</span>
              </div>
           </button>
          <Wifi size={14} />
          <Battery size={14} />
          <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>

      {/* Desktop Area */}
      <div className="relative w-full h-[calc(100vh-32px)]">
        
        {/* Desktop Widgets */}
        <DesktopWidgets />

        {/* Windows */}
        {windows.map(window => (
          <Window
            key={window.id}
            windowState={window}
            onClose={closeWindow}
            onMinimize={minimizeWindow}
            onMaximize={maximizeWindow}
            onFocus={focusWindow}
            onMove={moveWindow}
            onResize={resizeWindow}
          >
            {renderAppContent(window)}
          </Window>
        ))}

        {/* Dock */}
        <Dock onAppClick={(id) => openApp(id)} openApps={windows.map(w => w.id)} />

        {/* Smart Bar (Spotlight) */}
        <SmartBar isOpen={isSmartBarOpen} onClose={() => setIsSmartBarOpen(false)} />

        {/* Context Menu */}
        {contextMenu && (
            <ContextMenu 
                x={contextMenu.x} 
                y={contextMenu.y} 
                onClose={() => setContextMenu(null)}
                actions={[
                    { label: 'New Folder', action: () => openApp(AppID.FILES), icon: <FolderPlus size={14}/> },
                    { label: 'Mission Control', action: () => openApp(AppID.AGENTS), icon: <Monitor size={14}/> },
                    { label: 'Change Wallpaper', action: () => openApp(AppID.SETTINGS), icon: <ImageIcon size={14}/> },
                    { label: '', action: () => {}, separator: true },
                    { label: 'Refresh', action: () => window.location.reload(), icon: <RefreshCw size={14}/> },
                ]}
            />
        )}
      </div>
    </div>
  );
};

export default App;