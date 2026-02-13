import React, { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { AppID, WindowState, Agent, AgentStatus, RuntimeMode, phaseToStatus } from './types';
import { Window } from './components/os/Window';
import { Dock } from './components/os/Dock';
import { SmartBar } from './components/apps/SmartBar';
import { NotesApp } from './components/apps/NotesApp';
import { PhotosApp } from './components/apps/PhotosApp';
import { ChatApp } from './components/apps/ChatApp';
import { FileExplorer } from './components/apps/FileExplorer';
import { SettingsApp } from './components/apps/SettingsApp';
import { TerminalApp } from './components/apps/TerminalApp';
import { CalculatorApp } from './components/apps/CalculatorApp';
import { VideoPlayerApp } from './components/apps/VideoPlayerApp';
import { AgentDashboard } from './components/apps/AgentDashboard';
import { WriterApp } from './components/apps/WriterApp';
import { SystemMonitorApp } from './components/apps/SystemMonitorApp';
import { MusicApp } from './components/apps/MusicApp';
import { MemoryInspectorApp } from './components/apps/MemoryInspectorApp';
import { AppStoreApp } from './components/apps/AppStoreApp';
import { PluginMarketplaceApp } from './components/apps/PluginMarketplaceApp';
import { IntegrationsApp } from './components/apps/IntegrationsApp';

// Lazy-loaded heavy components (Monaco editor, browser, canvas, spreadsheet, PDF viewer, Agent VM)
const CodeEditorApp = React.lazy(() =>
  import('./components/apps/CodeEditorApp').then((m) => ({ default: m.CodeEditorApp })),
);
const BrowserApp = React.lazy(() =>
  import('./components/apps/BrowserApp').then((m) => ({ default: m.BrowserApp })),
);
const SheetsApp = React.lazy(() =>
  import('./components/apps/SheetsApp').then((m) => ({ default: m.SheetsApp })),
);
const CanvasApp = React.lazy(() =>
  import('./components/apps/CanvasApp').then((m) => ({ default: m.CanvasApp })),
);
const DocumentsApp = React.lazy(() =>
  import('./components/apps/DocumentsApp').then((m) => ({ default: m.DocumentsApp })),
);
const AgentVM = React.lazy(() =>
  import('./components/apps/AgentVM').then((m) => ({ default: m.AgentVM })),
);
import { DesktopWidgets } from './components/os/DesktopWidgets';
import { ContextMenu } from './components/os/ContextMenu';
import { LoginScreen } from './components/os/LoginScreen';
import { UserMenu } from './components/os/UserMenu';
import { ErrorBoundary } from './components/os/ErrorBoundary';
import { ShortcutOverlay } from './components/os/ShortcutOverlay';
import { WorkspaceSwitcher, WorkspaceOverview } from './components/os/WorkspaceSwitcher';
import {
  Battery,
  Wifi,
  Search,
  Command,
  RefreshCw,
  FolderPlus,
  Monitor,
  Image as ImageIcon,
  Server,
} from 'lucide-react';
import { NotificationBell, useNotifications } from './components/os/NotificationCenter';
import { ThemeToggle } from './components/os/ThemeToggle';
import { FileSystemItem, mockFileSystem } from './data/mockFileSystem';
import { generateText, GeminiModel, getAgentDecision } from './services/geminiService';
import { useKernel, AgentProcess } from './services/useKernel';
import { getKernelClient, UserInfo } from './services/kernelClient';
import { getShortcutManager } from './services/shortcutManager';

// Suspense fallback for lazy-loaded app components
const LazyFallback = () => (
  <div className="flex items-center justify-center w-full h-full bg-[#1a1d26]">
    <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
  </div>
);

// Dock app ordering — also used for Cmd+1..9 mapping
const DOCK_APPS: AppID[] = [
  AppID.AGENTS,
  AppID.FILES,
  AppID.BROWSER,
  AppID.TERMINAL,
  AppID.CODE,
  AppID.NOTES,
  AppID.SHEETS,
  AppID.CANVAS,
  AppID.WRITER,
  AppID.MUSIC,
  AppID.DOCUMENTS,
  AppID.SYSTEM_MONITOR,
  AppID.MEMORY_INSPECTOR,
  AppID.APP_STORE,
  AppID.PLUGIN_MARKETPLACE,
  AppID.INTEGRATIONS,
];

const App: React.FC = () => {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [isSmartBarOpen, setIsSmartBarOpen] = useState(false);
  const [isShortcutOverlayOpen, setIsShortcutOverlayOpen] = useState(false);
  const [time, setTime] = useState(new Date());
  const [isBooting, setIsBooting] = useState(true);

  // File System State
  const [files, setFiles] = useState<FileSystemItem[]>(mockFileSystem);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ isOpen: boolean; x: number; y: number } | null>(
    null,
  );

  // Workspace State
  const [currentWorkspace, setCurrentWorkspace] = useState(0);
  const [totalWorkspaces] = useState(3);
  const [showWorkspaceOverview, setShowWorkspaceOverview] = useState(false);
  const [workspaceTransitionDir, setWorkspaceTransitionDir] = useState<'left' | 'right' | null>(
    null,
  );

  // Auth state
  const [authUser, setAuthUser] = useState<UserInfo | null>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Runtime mode: 'kernel' when server is available, 'mock' as fallback
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('mock');

  // Kernel connection (real backend)
  const kernel = useKernel();

  // Notification system
  const { notify } = useNotifications();

  // Check for stored token on mount and connect WS only AFTER token is set
  useEffect(() => {
    const storedToken = localStorage.getItem('aether_token');
    if (storedToken) {
      const client = getKernelClient();
      client.setToken(storedToken);
      // Validate token via HTTP first
      const baseUrl = 'http://localhost:3001';
      fetch(`${baseUrl}/api/kernel`, {
        headers: { Authorization: `Bearer ${storedToken}` },
      })
        .then((res) => {
          if (res.ok) {
            // Token is valid — now connect WS with token already set
            // Use reconnect() to ensure a fresh connection with the token in the URL
            client.reconnect();
            // Decode user from token payload
            try {
              const parts = storedToken.split('.');
              if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
                if (payload.sub && payload.username && payload.exp > Date.now()) {
                  const user: UserInfo = {
                    id: payload.sub,
                    username: payload.username,
                    displayName: payload.username,
                    role: payload.role || 'user',
                  };
                  setAuthUser(user);
                  client.setCurrentUser(user);
                }
              }
            } catch {
              // Token decode failed, will need to re-login
            }
          } else {
            // Token invalid, clear it
            localStorage.removeItem('aether_token');
            client.setToken(null);
          }
          setAuthChecking(false);
        })
        .catch(() => {
          // Server not available - mock mode, no WS connection needed
          setAuthChecking(false);
        });
    } else {
      // No stored token — check if kernel server is reachable
      fetch('http://localhost:3001/health')
        .then((res) => {
          if (res.ok) {
            setRuntimeMode('kernel');
          }
          setAuthChecking(false);
        })
        .catch(() => {
          // Server not available — fall through to mock mode
          setAuthChecking(false);
        });
    }
  }, []);

  // Detect kernel availability
  useEffect(() => {
    if (kernel.connected) {
      setRuntimeMode('kernel');
    }
  }, [kernel.connected]);

  // Auth handlers
  const handleLogin = async (username: string, password: string): Promise<boolean> => {
    try {
      const client = getKernelClient();
      const result = await client.loginHttp(username, password);
      setAuthUser(result.user);
      setAuthError(null);
      // Connect WS with the new token (reconnect ensures fresh connection)
      client.reconnect();
      return true;
    } catch (err: any) {
      setAuthError(err.message);
      return false;
    }
  };

  const handleRegister = async (
    username: string,
    password: string,
    displayName: string,
  ): Promise<boolean> => {
    try {
      const client = getKernelClient();
      const result = await client.registerHttp(username, password, displayName);
      setAuthUser(result.user);
      setAuthError(null);
      // Connect WS with the new token (reconnect ensures fresh connection)
      client.reconnect();
      return true;
    } catch (err: any) {
      setAuthError(err.message);
      return false;
    }
  };

  const handleLogout = () => {
    const client = getKernelClient();
    client.logout();
    client.disconnect();
    setAuthUser(null);
  };

  // Bridge kernel processes to Agent type for UI compatibility
  const kernelAgents: Agent[] = useMemo(() => {
    return kernel.processes.map(
      (proc: AgentProcess): Agent => ({
        id: `agent_${proc.pid}`,
        pid: proc.pid,
        name: proc.name,
        role: proc.role,
        goal: proc.goal,
        status: phaseToStatus(proc.phase, proc.state),
        phase: proc.phase,
        logs: proc.logs,
        currentUrl: proc.currentUrl,
        currentCode: proc.currentCode,
        progress: proc.progress.step,
        ttyId: proc.ttyId,
        isWaiting: false,
        vncWsUrl: proc.vncInfo ? `ws://localhost:${proc.vncInfo.wsPort}` : undefined,
      }),
    );
  }, [kernel.processes]);

  // Agent System State (mock mode fallback)
  const [mockAgents, setMockAgents] = useState<Agent[]>([]);

  // Unified agent list depending on runtime mode
  const agents = runtimeMode === 'kernel' ? kernelAgents : mockAgents;
  const setAgents = setMockAgents; // Only used in mock mode

  // ---- MOCK AI AGENT LOOP (only runs when kernel is not connected) ----
  useEffect(() => {
    if (runtimeMode === 'kernel') return; // Skip mock loop when real kernel is connected

    const runAgentStep = async (agent: Agent) => {
      // If agent is busy, skip
      if (agent.isWaiting) return;

      // Mark agent as waiting for network
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? { ...a, isWaiting: true } : a)));

      // Get File System context (names only)
      const fileNames = files.map((f) => f.name);

      // Ask Gemini what to do
      const decision = await getAgentDecision(agent, fileNames);

      // Execute Decision
      setAgents((prev) =>
        prev.map((a) => {
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
              kind:
                decision.fileName.endsWith('png') || decision.fileName.endsWith('jpg')
                  ? 'image'
                  : 'code',
              date: 'Just now',
              size: `${(decision.fileContent.length / 1024).toFixed(1)} KB`,
              content: decision.fileContent,
            };

            // We need to update the file system state, but we are inside setAgents map
            // We'll queue this update via a separate effect or just break purity slightly for the demo
            // Ideally we'd use a reducer, but let's use the setter from outside
            setFiles((currentFiles) => {
              // Check duplicates
              if (currentFiles.some((f) => f.name === decision.fileName)) return currentFiles;
              return [...currentFiles, newFile];
            });

            newLogs.push({
              timestamp: Date.now(),
              type: 'action',
              message: `Created file: ${decision.fileName}`,
            });
            newCode = decision.fileContent;
          } else if (decision.action === 'browse' && decision.url) {
            newUrl = decision.url;
            newLogs.push({
              timestamp: Date.now(),
              type: 'action',
              message: `Browsing ${decision.url}... ${decision.webSummary ? `Found: ${decision.webSummary.substring(0, 50)}...` : ''}`,
            });
          } else if (decision.action === 'complete') {
            newStatus = 'completed';
            newLogs.push({
              timestamp: Date.now(),
              type: 'system',
              message: 'Goal achieved. Task complete.',
            });
          }

          // Sync simulation
          if (a.githubSync && decision.action !== 'think') {
            newLogs.push({
              timestamp: Date.now(),
              type: 'system',
              message: 'Synced changes to GitHub repository [main].',
            });
          }

          return {
            ...a,
            status: newStatus,
            currentUrl: newUrl,
            currentCode: newCode,
            logs: newLogs,
            isWaiting: false, // Done
          };
        }),
      );
    };

    const interval = setInterval(() => {
      agents.forEach((agent) => {
        if (agent.status === 'working' || agent.status === 'thinking') {
          runAgentStep(agent);
        }
      });
    }, 4000); // Check every 4 seconds to be polite to the API

    return () => clearInterval(interval);
  }, [mockAgents, files, runtimeMode]);

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

  // ── Keyboard shortcut system ──────────────────────────────────────────────

  // Keep the manager aware of which app is focused
  useEffect(() => {
    const mgr = getShortcutManager();
    if (activeWindowId) {
      // Standard apps use appId directly as window id; VM windows start with 'vm-'
      const win = windows.find((w) => w.id === activeWindowId);
      mgr.setFocusedApp(win ? win.appId : null);
    } else {
      mgr.setFocusedApp(null);
    }
  }, [activeWindowId, windows]);

  // Helper: get the next non-minimized window id for Cmd+Tab cycling
  const cycleWindow = useCallback(() => {
    const visible = windows.filter((w) => !w.isMinimized);
    if (visible.length === 0) return;
    if (visible.length === 1) {
      focusWindow(visible[0].id);
      return;
    }
    const currentIdx = visible.findIndex((w) => w.id === activeWindowId);
    const nextIdx = (currentIdx + 1) % visible.length;
    focusWindow(visible[nextIdx].id);
  }, [windows, activeWindowId]);

  // ── Workspace Management ──────────────────────────────────────────────
  const switchWorkspace = useCallback(
    (targetIdx: number, direction?: 'left' | 'right') => {
      if (targetIdx < 0 || targetIdx >= totalWorkspaces || targetIdx === currentWorkspace) return;
      const dir = direction || (targetIdx > currentWorkspace ? 'right' : 'left');
      setWorkspaceTransitionDir(dir);
      setActiveWindowId(null);
      setTimeout(() => {
        setCurrentWorkspace(targetIdx);
        setTimeout(() => setWorkspaceTransitionDir(null), 200);
      }, 10);
    },
    [currentWorkspace, totalWorkspaces],
  );

  const moveWindowToWorkspace = useCallback(
    (windowId: string, targetWorkspace: number) => {
      if (targetWorkspace < 0 || targetWorkspace >= totalWorkspaces) return;
      setWindows((prev) =>
        prev.map((w) =>
          w.id === windowId ? { ...w, workspaceId: targetWorkspace, stickyWorkspace: false } : w,
        ),
      );
    },
    [totalWorkspaces],
  );

  // Register all global shortcuts
  useEffect(() => {
    const mgr = getShortcutManager();

    // -- System --
    mgr.registerShortcut(
      'global:smart-bar',
      'Cmd+K',
      () => {
        setIsSmartBarOpen((prev) => !prev);
      },
      'Open Smart Bar',
      'global',
      'System',
    );

    mgr.registerShortcut(
      'global:shortcut-overlay',
      'Cmd+/',
      () => {
        setIsShortcutOverlayOpen((prev) => !prev);
      },
      'Show keyboard shortcuts',
      'global',
      'System',
    );

    mgr.registerShortcut(
      'global:shortcut-overlay-alt',
      'Cmd+?',
      () => {
        setIsShortcutOverlayOpen((prev) => !prev);
      },
      'Show keyboard shortcuts',
      'global',
      'System',
    );

    mgr.registerShortcut(
      'global:escape',
      'Escape',
      () => {
        if (isShortcutOverlayOpen) {
          setIsShortcutOverlayOpen(false);
        } else if (isSmartBarOpen) {
          setIsSmartBarOpen(false);
        } else if (contextMenu) {
          setContextMenu(null);
        }
      },
      'Close active overlay',
      'global',
      'System',
    );

    // -- Window Management --
    mgr.registerShortcut(
      'global:close-window',
      'Cmd+W',
      () => {
        if (activeWindowId) closeWindow(activeWindowId);
      },
      'Close focused window',
      'global',
      'Window Management',
    );

    mgr.registerShortcut(
      'global:close-window-q',
      'Cmd+Q',
      () => {
        if (activeWindowId) closeWindow(activeWindowId);
      },
      'Close focused window',
      'global',
      'Window Management',
    );

    mgr.registerShortcut(
      'global:minimize-window',
      'Cmd+M',
      () => {
        if (activeWindowId) minimizeWindow(activeWindowId);
      },
      'Minimize focused window',
      'global',
      'Window Management',
    );

    mgr.registerShortcut(
      'global:maximize-window',
      'Cmd+Shift+M',
      () => {
        if (activeWindowId) maximizeWindow(activeWindowId);
      },
      'Maximize / restore focused window',
      'global',
      'Window Management',
    );

    mgr.registerShortcut(
      'global:cycle-window',
      'Cmd+Tab',
      () => {
        cycleWindow();
      },
      'Cycle through open windows',
      'global',
      'Window Management',
    );

    // -- Navigation --
    mgr.registerShortcut(
      'global:open-terminal',
      'Cmd+N',
      () => {
        openApp(AppID.TERMINAL);
      },
      'Open new Terminal',
      'global',
      'Navigation',
    );

    mgr.registerShortcut(
      'global:open-settings',
      'Cmd+,',
      () => {
        openApp(AppID.SETTINGS);
      },
      'Open Settings',
      'global',
      'Navigation',
    );

    // -- Cmd+1..9: Focus / open Nth dock app --
    for (let i = 0; i < 9; i++) {
      mgr.registerShortcut(
        `global:dock-${i + 1}`,
        `Cmd+${i + 1}`,
        () => {
          if (DOCK_APPS[i]) openApp(DOCK_APPS[i]);
        },
        `Open ${DOCK_APPS[i] ? DOCK_APPS[i].charAt(0).toUpperCase() + DOCK_APPS[i].slice(1) : `dock app ${i + 1}`}`,
        'global',
        'Navigation',
      );
    }

    // -- Workspace shortcuts --
    mgr.registerShortcut(
      'global:ws-prev',
      'Ctrl+ArrowLeft',
      () => {
        switchWorkspace(currentWorkspace - 1, 'left');
      },
      'Previous workspace',
      'global',
      'Workspaces',
    );

    mgr.registerShortcut(
      'global:ws-next',
      'Ctrl+ArrowRight',
      () => {
        switchWorkspace(currentWorkspace + 1, 'right');
      },
      'Next workspace',
      'global',
      'Workspaces',
    );

    mgr.registerShortcut(
      'global:ws-overview',
      'Ctrl+ArrowUp',
      () => {
        setShowWorkspaceOverview((prev) => !prev);
      },
      'Workspace overview',
      'global',
      'Workspaces',
    );

    for (let i = 0; i < 9; i++) {
      mgr.registerShortcut(
        `global:ws-jump-${i + 1}`,
        `Alt+${i + 1}`,
        () => {
          if (i < totalWorkspaces) switchWorkspace(i);
        },
        `Switch to workspace ${i + 1}`,
        'global',
        'Workspaces',
      );
    }

    mgr.registerShortcut(
      'global:ws-move-left',
      'Ctrl+Shift+ArrowLeft',
      () => {
        if (activeWindowId && currentWorkspace > 0) {
          moveWindowToWorkspace(activeWindowId, currentWorkspace - 1);
          switchWorkspace(currentWorkspace - 1, 'left');
        }
      },
      'Move window to prev workspace',
      'global',
      'Workspaces',
    );

    mgr.registerShortcut(
      'global:ws-move-right',
      'Ctrl+Shift+ArrowRight',
      () => {
        if (activeWindowId && currentWorkspace < totalWorkspaces - 1) {
          moveWindowToWorkspace(activeWindowId, currentWorkspace + 1);
          switchWorkspace(currentWorkspace + 1, 'right');
        }
      },
      'Move window to next workspace',
      'global',
      'Workspaces',
    );

    // -- App-specific shortcuts (only register shortcuts with real handlers) --

    // Terminal: open a new Terminal window
    mgr.registerShortcut(
      'app:terminal:new-tab',
      'Cmd+T',
      () => openApp(AppID.TERMINAL),
      'New terminal window',
      'app:terminal',
      'Terminal',
    );

    // Code Editor: Cmd+S handled by Monaco internally — no registration needed
    // Quick-open (Cmd+P) and search-all (Cmd+Shift+F) not implemented — removed

    // Browser: reload active page via kernel client
    mgr.registerShortcut(
      'app:browser:reload',
      'Cmd+R',
      () => {
        /* Handled by BrowserApp component internally */
      },
      'Reload page',
      'app:browser',
      'Browser',
    );

    return () => {
      // Clean up all registered shortcuts
      const ids = [
        'global:smart-bar',
        'global:shortcut-overlay',
        'global:shortcut-overlay-alt',
        'global:escape',
        'global:close-window',
        'global:close-window-q',
        'global:minimize-window',
        'global:maximize-window',
        'global:cycle-window',
        'global:open-terminal',
        'global:open-settings',
        ...Array.from({ length: 9 }, (_, i) => `global:dock-${i + 1}`),
        'global:ws-prev',
        'global:ws-next',
        'global:ws-overview',
        ...Array.from({ length: 9 }, (_, i) => `global:ws-jump-${i + 1}`),
        'global:ws-move-left',
        'global:ws-move-right',
        'app:terminal:new-tab',
        'app:browser:reload',
      ];
      ids.forEach((id) => mgr.unregisterShortcut(id));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeWindowId,
    isSmartBarOpen,
    isShortcutOverlayOpen,
    contextMenu,
    cycleWindow,
    currentWorkspace,
    switchWorkspace,
    moveWindowToWorkspace,
    totalWorkspaces,
  ]);

  const openApp = (appId: AppID, initialData?: any) => {
    // If it's a VM window, we allow multiples, so we generate a unique ID based on agent ID
    if (appId === AppID.VM && initialData?.agentId) {
      const winId = `vm-${initialData.agentId}`;
      const existing = windows.find((w) => w.id === winId);
      if (existing) {
        focusWindow(winId);
        if (existing.isMinimized) {
          setWindows((prev) =>
            prev.map((w) => (w.id === winId ? { ...w, isMinimized: false } : w)),
          );
        }
      } else {
        const agent = agents.find((a) => a.id === initialData.agentId);
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
          initialData,
          workspaceId: currentWorkspace,
        };
        setWindows((prev) => [...prev, newWindow]);
        setActiveWindowId(winId);
      }
      return;
    }

    // For standard apps (single instance mostly)
    const winId = appId;
    const existingWindow = windows.find((w) => w.id === winId);

    if (existingWindow) {
      // If window is on a different workspace, switch to it
      const winWs = existingWindow.workspaceId ?? 0;
      if (winWs !== currentWorkspace && !existingWindow.stickyWorkspace) {
        switchWorkspace(winWs);
      }
      if (existingWindow.isMinimized) {
        setWindows((prev) =>
          prev.map((w) => (w.id === winId ? { ...w, isMinimized: false, initialData } : w)),
        );
      } else {
        if (initialData) {
          setWindows((prev) => prev.map((w) => (w.id === winId ? { ...w, initialData } : w)));
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
        position: { x: 100 + windows.length * 30, y: 100 + windows.length * 30 },
        size: isCalculator ? { width: 320, height: 480 } : { width: 900, height: 650 },
        initialData,
        workspaceId: currentWorkspace,
      };
      setWindows((prev) => [...prev, newWindow]);
      setActiveWindowId(winId);
    }
  };

  const getAppTitle = (id: AppID) => {
    switch (id) {
      case AppID.NOTES:
        return 'Notes';
      case AppID.PHOTOS:
        return 'Photos';
      case AppID.FILES:
        return 'Finder';
      case AppID.CHAT:
        return 'Gemini Chat';
      case AppID.SETTINGS:
        return 'Settings';
      case AppID.TERMINAL:
        return 'Terminal';
      case AppID.BROWSER:
        return 'Safari';
      case AppID.CALCULATOR:
        return 'Calculator';
      case AppID.CODE:
        return 'Code - Untitled';
      case AppID.VIDEO:
        return 'Media Player';
      case AppID.AGENTS:
        return 'Agent Center';
      case AppID.SHEETS:
        return 'Sheets';
      case AppID.CANVAS:
        return 'Canvas';
      case AppID.WRITER:
        return 'Writer';
      case AppID.SYSTEM_MONITOR:
        return 'System Monitor';
      case AppID.MUSIC:
        return 'Music';
      case AppID.DOCUMENTS:
        return 'Documents';
      case AppID.MEMORY_INSPECTOR:
        return 'Memory Inspector';
      case AppID.APP_STORE:
        return 'App Store';
      case AppID.PLUGIN_MARKETPLACE:
        return 'Plugin Marketplace';
      case AppID.INTEGRATIONS:
        return 'Integrations';
      default:
        return 'App';
    }
  };

  const closeWindow = (id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id));
    if (activeWindowId === id) setActiveWindowId(null);
  };

  const minimizeWindow = (id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)));
    setActiveWindowId(null);
  };

  const maximizeWindow = (id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w)),
    );
  };

  const focusWindow = (id: string) => {
    setActiveWindowId(id);
    setWindows((prev) => {
      const maxZ = Math.max(...prev.map((w) => w.zIndex), 0);
      return prev.map((w) => (w.id === id ? { ...w, zIndex: maxZ + 1 } : w));
    });
  };

  const moveWindow = (id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, position: { x, y } } : w)));
  };

  const resizeWindow = (id: string, width: number, height: number, x?: number, y?: number) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id === id) {
          return {
            ...w,
            size: { width, height },
            position: x !== undefined && y !== undefined ? { x, y } : w.position,
          };
        }
        return w;
      }),
    );
  };

  // Compute visible windows for current workspace
  const visibleWindows = useMemo(() => {
    return windows.filter((w) => {
      if (w.stickyWorkspace) return true;
      const wsId = w.workspaceId ?? 0;
      return wsId === currentWorkspace;
    });
  }, [windows, currentWorkspace]);

  // Window counts per workspace (for the switcher dots)
  const workspaceWindowCounts = useMemo(() => {
    const counts = Array(totalWorkspaces).fill(0);
    windows.forEach((w) => {
      if (w.stickyWorkspace) {
        // Count sticky windows in all workspaces
        counts.forEach((_, i) => counts[i]++);
      } else {
        const wsId = w.workspaceId ?? 0;
        if (wsId < totalWorkspaces) counts[wsId]++;
      }
    });
    return counts;
  }, [windows, totalWorkspaces]);

  // Workspace windows data for overview
  const workspaceWindowsData = useMemo(() => {
    return Array.from({ length: totalWorkspaces }, (_, i) => ({
      workspace: i,
      windows: windows
        .filter((w) => w.stickyWorkspace || (w.workspaceId ?? 0) === i)
        .map((w) => ({
          id: w.id,
          title: w.title,
          appId: w.appId,
          position: w.position,
          size: w.size,
        })),
    }));
  }, [windows, totalWorkspaces]);

  // Agent Management - routes to kernel or mock depending on runtime mode
  const launchAgent = async (role: string, goal: string) => {
    if (runtimeMode === 'kernel') {
      try {
        await kernel.spawnAgent({ role, goal });
      } catch (err) {
        console.error('Failed to spawn agent via kernel:', err);
      }
      return;
    }

    // Mock mode fallback
    const id = `agent_${Date.now()}`;
    const newAgent: Agent = {
      id,
      name: `${role} Alpha`,
      role,
      goal,
      status: 'thinking',
      progress: 0,
      logs: [{ timestamp: Date.now(), type: 'system', message: `Agent ${id} initialized.` }],
    };
    setAgents((prev) => [...prev, newAgent]);
    setTimeout(() => {
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'working' } : a)));
    }, 500);
  };

  const stopAgent = (id: string) => {
    if (runtimeMode === 'kernel') {
      const agent = agents.find((a) => a.id === id);
      if (agent?.pid) kernel.killProcess(agent.pid);
      return;
    }
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'error',
              logs: [
                ...a.logs,
                { timestamp: Date.now(), type: 'system', message: 'Process terminated by user.' },
              ],
            }
          : a,
      ),
    );
  };

  const approveAgent = (id: string) => {
    if (runtimeMode === 'kernel') {
      const agent = agents.find((a) => a.id === id);
      if (agent?.pid) kernel.approveAction(agent.pid);
      return;
    }
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'working',
              logs: [
                ...a.logs,
                { timestamp: Date.now(), type: 'system', message: 'Action approved by user.' },
              ],
            }
          : a,
      ),
    );
  };

  const rejectAgent = (id: string) => {
    if (runtimeMode === 'kernel') {
      const agent = agents.find((a) => a.id === id);
      if (agent?.pid) kernel.rejectAction(agent.pid);
      return;
    }
    setAgents((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              status: 'thinking',
              logs: [
                ...a.logs,
                {
                  timestamp: Date.now(),
                  type: 'system',
                  message: 'Action denied. Re-evaluating strategy...',
                },
              ],
            }
          : a,
      ),
    );
  };

  const [showGithubModal, setShowGithubModal] = useState(false);
  const [githubModalAgentId, setGithubModalAgentId] = useState<string | null>(null);
  const [githubRepoUrl, setGithubRepoUrl] = useState('');
  const [githubCloneStatus, setGithubCloneStatus] = useState<'idle' | 'cloning' | 'done' | 'error'>(
    'idle',
  );

  const syncGithub = (id: string) => {
    const agent = agents.find((a) => a.id === id);
    if (!agent) return;

    if (agent.githubSync) {
      // Push changes — only with approval
      if (runtimeMode === 'kernel' && agent.pid && agent.ttyId) {
        const client = getKernelClient();
        client.sendTerminalInput(
          agent.ttyId,
          'git add . && git commit -m "Agent changes" && echo "Push requires approval. Run: git push"\n',
        );
        setAgents((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  logs: [
                    ...a.logs,
                    {
                      timestamp: Date.now(),
                      type: 'system',
                      message: 'Staging and committing changes...',
                    },
                  ],
                }
              : a,
          ),
        );
      } else {
        setAgents((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  githubSync: false,
                  logs: [
                    ...a.logs,
                    { timestamp: Date.now(), type: 'system', message: 'Disconnected from GitHub.' },
                  ],
                }
              : a,
          ),
        );
      }
    } else {
      // Open modal to enter repo URL
      setGithubModalAgentId(id);
      setGithubRepoUrl('');
      setGithubCloneStatus('idle');
      setShowGithubModal(true);
    }
  };

  const handleGithubClone = async () => {
    if (!githubRepoUrl.trim() || !githubModalAgentId) return;
    const agent = agents.find((a) => a.id === githubModalAgentId);
    if (!agent) return;

    setGithubCloneStatus('cloning');

    if (runtimeMode === 'kernel' && agent.pid) {
      // Clone via kernel: write a clone script and use TTY if available
      try {
        const client = getKernelClient();
        const repoName = githubRepoUrl.split('/').pop()?.replace('.git', '') || 'repo';
        const homeDir = `/home/agent_${agent.pid}`;
        // Write clone script
        await client.writeFile(
          `${homeDir}/.clone_repo.sh`,
          `#!/bin/bash\ncd ${homeDir}\ngit clone ${githubRepoUrl}\necho "Clone complete: ${repoName}"\n`,
        );
        // Execute via TTY if the agent has one
        if (agent.ttyId) {
          client.sendTerminalInput(agent.ttyId, `cd ${homeDir} && git clone ${githubRepoUrl}\n`);
        }

        setAgents((prev) =>
          prev.map((a) =>
            a.id === githubModalAgentId
              ? {
                  ...a,
                  githubSync: true,
                  logs: [
                    ...a.logs,
                    {
                      timestamp: Date.now(),
                      type: 'system',
                      message: `Cloning ${githubRepoUrl} into workspace...`,
                    },
                  ],
                }
              : a,
          ),
        );

        setGithubCloneStatus('done');
        setTimeout(() => setShowGithubModal(false), 1500);
      } catch (err) {
        setGithubCloneStatus('error');
      }
    } else {
      // Mock mode
      setAgents((prev) =>
        prev.map((a) =>
          a.id === githubModalAgentId
            ? {
                ...a,
                githubSync: true,
                logs: [
                  ...a.logs,
                  {
                    timestamp: Date.now(),
                    type: 'system',
                    message: `Connected to GitHub: ${githubRepoUrl}`,
                  },
                ],
              }
            : a,
        ),
      );

      setGithubCloneStatus('done');
      setTimeout(() => setShowGithubModal(false), 1500);
    }
  };

  const renderAppContent = (windowState: WindowState) => {
    switch (windowState.appId) {
      case AppID.NOTES:
        return (
          <NotesApp
            initialContent={windowState.initialData?.content}
            onSave={(content) =>
              windowState.initialData?.fileId &&
              handleSaveFile(windowState.initialData.fileId, content)
            }
          />
        );
      case AppID.PHOTOS:
        return <PhotosApp initialImage={windowState.initialData?.image} />;
      case AppID.CHAT:
        return <ChatApp />;
      case AppID.FILES:
        return <FileExplorer files={files} onOpenFile={handleOpenFile} />;
      case AppID.SETTINGS:
        return <SettingsApp />;
      case AppID.TERMINAL:
        return <TerminalApp files={files} setFiles={setFiles} />;
      case AppID.BROWSER:
        return (
          <Suspense fallback={<LazyFallback />}>
            <BrowserApp />
          </Suspense>
        );
      case AppID.CALCULATOR:
        return <CalculatorApp />;
      case AppID.CODE:
        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeEditorApp
              initialContent={windowState.initialData?.content}
              fileName={windowState.initialData?.fileName}
              onSave={(content) =>
                windowState.initialData?.fileId &&
                handleSaveFile(windowState.initialData.fileId, content)
              }
            />
          </Suspense>
        );
      case AppID.VIDEO:
        return (
          <VideoPlayerApp
            url={windowState.initialData?.url}
            title={windowState.initialData?.title}
          />
        );
      case AppID.AGENTS:
        return (
          <AgentDashboard
            agents={agents}
            onLaunchAgent={launchAgent}
            onOpenVM={(agentId) => openApp(AppID.VM, { agentId })}
            onStopAgent={stopAgent}
          />
        );
      case AppID.SHEETS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <SheetsApp />
          </Suspense>
        );
      case AppID.CANVAS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <CanvasApp />
          </Suspense>
        );
      case AppID.WRITER:
        return <WriterApp />;
      case AppID.SYSTEM_MONITOR:
        return <SystemMonitorApp />;
      case AppID.MUSIC:
        return <MusicApp />;
      case AppID.DOCUMENTS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <DocumentsApp initialFile={windowState.initialData?.filePath} />
          </Suspense>
        );
      case AppID.MEMORY_INSPECTOR:
        return <MemoryInspectorApp />;
      case AppID.APP_STORE:
        return <AppStoreApp />;
      case AppID.PLUGIN_MARKETPLACE:
        return <PluginMarketplaceApp />;
      case AppID.INTEGRATIONS:
        return <IntegrationsApp />;
      case AppID.VM: {
        const agent = agents.find((a) => a.id === windowState.initialData?.agentId);
        if (!agent) return <div className="p-4 text-white">Agent not found or terminated.</div>;
        return (
          <Suspense fallback={<LazyFallback />}>
            <AgentVM
              agent={agent}
              onApprove={approveAgent}
              onReject={rejectAgent}
              onStop={stopAgent}
              onSyncGithub={syncGithub}
            />
          </Suspense>
        );
      }
      default:
        return null;
    }
  };

  // Helper functions for existing apps
  const handleSaveFile = (fileId: string, content: string) => {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.id === fileId) {
          return {
            ...f,
            content,
            size: `${(content.length / 1024).toFixed(1)} KB`,
            date: 'Just now',
          };
        }
        return f;
      }),
    );
  };

  const handleOpenFile = (file: FileSystemItem) => {
    if (file.kind === 'text') {
      openApp(AppID.NOTES, { content: file.content, fileId: file.id });
    } else if (file.kind === 'code') {
      openApp(AppID.CODE, { content: file.content, fileId: file.id, fileName: file.name });
    } else if (file.kind === 'image') {
      openApp(AppID.PHOTOS, { image: file.url });
    } else if (file.kind === 'audio') {
      openApp(AppID.MUSIC);
    } else if (file.kind === 'video') {
      openApp(AppID.VIDEO, { url: file.url, title: file.name });
    } else if (file.name?.endsWith('.pdf')) {
      openApp(AppID.DOCUMENTS, { filePath: file.url || file.name });
    } else {
      openApp(AppID.NOTES, {
        content: `Cannot view file type: ${file.kind}\n\nMetadata:\nName: ${file.name}\nSize: ${file.size}`,
      });
    }
  };

  // Wire kernel events to notification system
  useEffect(() => {
    const client = getKernelClient();

    const unsubExit = client.on('process.exit', (data: any) => {
      const proc = kernel.processes.find((p) => p.pid === data.pid);
      // Skip notifications for processes not in our list (e.g. already reaped,
      // or spawned before this client connected). Avoids confusing "PID 1" messages.
      if (!proc) return;
      const name = proc.name;
      if (data.code === 0) {
        notify({
          type: 'success',
          title: 'Agent completed',
          body: `Agent '${name}' finished${proc.goal ? ': ' + proc.goal : ''}`,
          action: () => openApp(AppID.VM, { agentId: `agent_${proc.pid}` }),
          actionLabel: 'Open VM',
        });
      } else {
        notify({
          type: 'error',
          title: 'Agent failed',
          body: `Agent '${name}' failed${data.signal ? ` (${data.signal})` : ` with code ${data.code}`}`,
          action: () => openApp(AppID.VM, { agentId: `agent_${proc.pid}` }),
          actionLabel: 'Open VM',
        });
      }
    });

    const unsubApproval = client.on('process.approval_required', (data: any) => {
      const proc = kernel.processes.find((p) => p.pid === data.pid);
      if (!proc) return; // Skip unknown processes
      notify({
        type: 'warning',
        title: 'Approval needed',
        body: `Agent '${proc.name}' wants to run: ${data.details || data.action || 'unknown action'}`,
        duration: 0, // Don't auto-dismiss approval requests
        action: () => openApp(AppID.VM, { agentId: `agent_${proc.pid}` }),
        actionLabel: 'Review',
      });
    });

    let wasConnected = client.connected;
    const unsubConnection = client.on('connection', (data: any) => {
      if (data.connected && !wasConnected) {
        notify({
          type: 'info',
          title: 'Kernel connected',
          body: `Connected to Aether kernel v${client.version}`,
        });
      } else if (!data.connected && wasConnected) {
        notify({
          type: 'error',
          title: 'Kernel disconnected',
          body: 'Lost connection to kernel. Attempting to reconnect...',
        });
      }
      wasConnected = data.connected;
    });

    return () => {
      unsubExit();
      unsubApproval();
      unsubConnection();
    };
  }, [kernel.processes, notify, openApp]);

  if (isBooting || authChecking) {
    return (
      <div className="w-screen h-screen bg-black flex flex-col items-center justify-center text-white">
        <div className="text-6xl mb-8"></div>
        <div className="w-48 h-1 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-white animate-progress-fill"></div>
        </div>
      </div>
    );
  }

  // Show login screen if not authenticated and kernel is available
  if (!authUser && runtimeMode === 'kernel') {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onRegister={handleRegister}
        registrationOpen={true}
        error={authError}
      />
    );
  }

  return (
    <div
      className="w-screen h-screen overflow-hidden bg-cover bg-center font-sans relative selection:bg-indigo-500/30"
      style={{
        backgroundImage: `url('https://images.unsplash.com/photo-1550684848-fac1c5b4e853?q=80&w=2670&auto=format&fit=crop')`,
      }} // Changed to a darker, more tech-focused wallpaper
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Menu Bar */}
      <div className="h-8 bg-black/40 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-4 text-xs font-medium text-white/90 z-[9990] relative shadow-sm select-none">
        <div className="flex items-center gap-4">
          <span className="font-bold text-sm hover:text-white cursor-pointer"></span>
          <span className="hidden sm:inline font-semibold cursor-default">Aether OS</span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">
            Agent Center
          </span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">
            Window
          </span>
          <span className="hidden sm:inline opacity-70 hover:opacity-100 cursor-pointer">Help</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          {/* Workspace Switcher */}
          <div className="hidden sm:block">
            <WorkspaceSwitcher
              currentWorkspace={currentWorkspace}
              totalWorkspaces={totalWorkspaces}
              windowCounts={workspaceWindowCounts}
              onSwitch={(idx) => switchWorkspace(idx)}
              onShowOverview={() => setShowWorkspaceOverview(true)}
            />
          </div>
          {/* Kernel Status Indicator */}
          {kernel.connected ? (
            <div
              className="flex items-center gap-1.5"
              title={`Kernel v${kernel.version} connected`}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-[10px] opacity-60 hidden sm:inline">Kernel</span>
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 rounded-full px-2.5 py-0.5"
              title="Kernel disconnected — running in mock mode. No real agents or processes."
            >
              <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-[10px] font-semibold text-amber-300">Mock Mode</span>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsSmartBarOpen(true);
            }}
            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-2 py-0.5 rounded transition-colors"
          >
            <Search size={12} />
            <span className="opacity-70 hidden sm:inline">Search</span>
            <div className="hidden sm:flex items-center text-[10px] opacity-50 ml-1">
              <Command size={10} />
              <span>K</span>
            </div>
          </button>
          {/* Cluster Status Badge */}
          {kernel.clusterInfo && kernel.clusterInfo.role !== 'standalone' && (
            <div className="hidden md:flex items-center gap-1 bg-white/5 px-2 py-0.5 rounded text-[10px]">
              <Server size={10} className="text-indigo-400" />
              <span className="opacity-60">
                {kernel.clusterInfo.role === 'hub'
                  ? `Hub · ${kernel.clusterInfo.nodes.length} node${kernel.clusterInfo.nodes.length !== 1 ? 's' : ''}`
                  : 'Node · Connected'}
              </span>
            </div>
          )}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <NotificationBell />
          <Wifi size={14} className="hidden sm:block" />
          <Battery size={14} className="hidden sm:block" />
          <span>{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {/* User Menu */}
          {authUser && (
            <UserMenu
              user={authUser}
              onLogout={handleLogout}
              onOpenSettings={() => openApp(AppID.SETTINGS)}
            />
          )}
        </div>
      </div>

      {/* WebSocket Reconnecting Banner */}
      {kernel.reconnecting && (
        <div
          style={{
            position: 'fixed',
            top: 32,
            left: 0,
            right: 0,
            zIndex: 9999,
            display: 'flex',
            justifyContent: 'center',
            padding: '8px',
            pointerEvents: 'none',
          }}
        >
          <div
            style={{
              background: 'rgba(255, 165, 0, 0.15)',
              backdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 165, 0, 0.3)',
              borderRadius: '8px',
              padding: '8px 20px',
              color: 'rgba(255, 200, 100, 0.95)',
              fontSize: '13px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>
              &#8635;
            </span>
            Kernel disconnected — reconnecting...
          </div>
        </div>
      )}

      {/* Desktop Area */}
      <div className="relative w-full h-[calc(100vh-32px)]">
        {/* Desktop Widgets */}
        <ErrorBoundary fallbackTitle="Widget Error">
          <DesktopWidgets />
        </ErrorBoundary>

        {/* Windows — filtered by current workspace */}
        <div
          className="absolute inset-0 transition-transform duration-200 ease-out"
          style={{
            transform:
              workspaceTransitionDir === 'left'
                ? 'translateX(40px)'
                : workspaceTransitionDir === 'right'
                  ? 'translateX(-40px)'
                  : 'translateX(0)',
            opacity: workspaceTransitionDir ? 0.7 : 1,
            transition: 'transform 200ms ease-out, opacity 150ms ease-out',
          }}
        >
          {visibleWindows.map((window) => (
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
              <ErrorBoundary fallbackTitle="Application Error">
                {renderAppContent(window)}
              </ErrorBoundary>
            </Window>
          ))}
        </div>

        {/* Dock */}
        <ErrorBoundary fallbackTitle="Dock Error">
          <Dock onAppClick={(id) => openApp(id)} openApps={visibleWindows.map((w) => w.id)} />
        </ErrorBoundary>

        {/* Smart Bar (Spotlight) */}
        <SmartBar isOpen={isSmartBarOpen} onClose={() => setIsSmartBarOpen(false)} />

        {/* Shortcut Overlay (Cmd+/) */}
        <ShortcutOverlay
          isOpen={isShortcutOverlayOpen}
          onClose={() => setIsShortcutOverlayOpen(false)}
        />

        {/* Workspace Overview (Ctrl+Up) */}
        {showWorkspaceOverview && (
          <WorkspaceOverview
            currentWorkspace={currentWorkspace}
            totalWorkspaces={totalWorkspaces}
            workspaceWindows={workspaceWindowsData}
            onSwitch={(idx) => switchWorkspace(idx)}
            onClose={() => setShowWorkspaceOverview(false)}
          />
        )}

        {/* Context Menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            actions={[
              {
                label: 'New Folder',
                action: () => openApp(AppID.FILES),
                icon: <FolderPlus size={14} />,
              },
              {
                label: 'Mission Control',
                action: () => openApp(AppID.AGENTS),
                icon: <Monitor size={14} />,
              },
              {
                label: 'Change Wallpaper',
                action: () => openApp(AppID.SETTINGS),
                icon: <ImageIcon size={14} />,
              },
              { label: '', action: () => {}, separator: true },
              {
                label: 'Refresh',
                action: () => window.location.reload(),
                icon: <RefreshCw size={14} />,
              },
            ]}
          />
        )}

        {/* GitHub Clone Modal */}
        {showGithubModal && (
          <div
            className="absolute inset-0 z-[10000] bg-black/60 backdrop-blur-sm flex items-center justify-center"
            onClick={() => setShowGithubModal(false)}
          >
            <div
              className="bg-[#1a1d26] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md animate-scale-in"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-light text-white mb-1">GitHub Sync</h2>
              <p className="text-xs text-gray-500 mb-6">
                Clone a repository into the agent's workspace
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-2 uppercase tracking-wider">
                    Repository URL
                  </label>
                  <input
                    type="text"
                    value={githubRepoUrl}
                    onChange={(e) => setGithubRepoUrl(e.target.value)}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full bg-black/20 border border-white/10 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500/50 transition-all"
                    disabled={githubCloneStatus === 'cloning'}
                  />
                </div>

                {githubCloneStatus === 'cloning' && (
                  <div className="flex items-center gap-2 text-xs text-indigo-400">
                    <div className="w-3 h-3 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                    Cloning repository...
                  </div>
                )}
                {githubCloneStatus === 'done' && (
                  <div className="text-xs text-green-400">Repository cloned successfully.</div>
                )}
                {githubCloneStatus === 'error' && (
                  <div className="text-xs text-red-400">
                    Failed to clone repository. Check the URL and try again.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setShowGithubModal(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGithubClone}
                  disabled={!githubRepoUrl.trim() || githubCloneStatus === 'cloning'}
                  className="bg-white text-black hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed px-6 py-2 rounded-xl text-sm font-bold transition-colors"
                >
                  Clone
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
