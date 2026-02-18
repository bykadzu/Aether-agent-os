import React, { useState, useEffect, Suspense } from 'react';
import { AppID } from './types';
import { Window } from './components/os/Window';
import { Dock } from './components/os/Dock';
import { AppRenderer } from './components/os/AppRenderer';
import { GitHubCloneModal } from './components/os/GitHubCloneModal';
const SmartBar = React.lazy(() =>
  import('./components/apps/SmartBar').then((m) => ({ default: m.SmartBar })),
);
const DesktopWidgets = React.lazy(() =>
  import('./components/os/DesktopWidgets').then((m) => ({ default: m.DesktopWidgets })),
);
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
import { useKernel } from './services/useKernel';
import { getKernelClient } from './services/kernelClient';
import { useAuth } from './hooks/useAuth';
import { useWindowManager } from './hooks/useWindowManager';
import { useAgentBridge } from './hooks/useAgentBridge';
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts';

// Suspense fallback for lazy-loaded app components
const LazyFallback = () => (
  <div className="flex items-center justify-center w-full h-full bg-[#1a1d26]">
    <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
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

  // Kernel connection (real backend)
  const kernel = useKernel();

  // Auth (token validation, login/register/logout, runtime mode detection)
  const {
    authUser,
    authChecking,
    authError,
    runtimeMode,
    handleLogin,
    handleRegister,
    handleLogout,
  } = useAuth(kernel.connected);

  // Agent bridge (kernel ↔ mock agent bridging, GitHub sync)
  const {
    agents,
    launchAgent,
    stopAgent,
    approveAgent,
    rejectAgent,
    syncGithub,
    showGithubModal,
    setShowGithubModal,
    githubRepoUrl,
    setGithubRepoUrl,
    githubCloneStatus,
    handleGithubClone,
  } = useAgentBridge(runtimeMode, kernel, files, setFiles);

  // Window management (windows, workspaces, open/close/minimize/maximize/focus/move/resize)
  const {
    currentWorkspace,
    totalWorkspaces,
    showWorkspaceOverview,
    setShowWorkspaceOverview,
    workspaceTransitionDir,
    openApp,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    moveWindow,
    resizeWindow,
    cycleWindow,
    switchWorkspace,
    moveWindowToWorkspace,
    visibleWindows,
    workspaceWindowCounts,
    workspaceWindowsData,
    activeWindowId,
  } = useWindowManager(agents);

  // Notification system
  const { notify } = useNotifications();

  // Global keyboard shortcuts
  useGlobalShortcuts({
    openApp,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    cycleWindow,
    switchWorkspace,
    moveWindowToWorkspace,
    setIsSmartBarOpen,
    setIsShortcutOverlayOpen,
    isSmartBarOpen,
    isShortcutOverlayOpen,
    contextMenu,
    setContextMenu,
    activeWindowId,
    currentWorkspace,
    totalWorkspaces,
    setShowWorkspaceOverview,
  });

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
      if (!proc) return;
      notify({
        type: 'warning',
        title: 'Approval needed',
        body: `Agent '${proc.name}' wants to run: ${data.details || data.action || 'unknown action'}`,
        duration: 0,
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
        <div className="text-6xl mb-8"></div>
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
      className="w-screen h-screen overflow-hidden font-sans relative selection:bg-indigo-500/30"
      style={{
        background: 'linear-gradient(135deg, #0a0a0f 0%, #0d1117 40%, #0f0f18 70%, #0a0a0f 100%)',
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ isOpen: true, x: e.clientX, y: e.clientY });
      }}
      onClick={() => setContextMenu(null)}
    >
      {/* Menu Bar */}
      <div className="h-8 bg-black/40 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-4 text-xs font-medium text-white/90 z-[9990] relative shadow-sm select-none">
        <div className="flex items-center gap-4">
          <span className="font-bold text-sm hover:text-white cursor-pointer"></span>
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
          <Suspense fallback={<LazyFallback />}>
            <DesktopWidgets />
          </Suspense>
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
                <AppRenderer
                  windowState={window}
                  agents={agents}
                  files={files}
                  setFiles={setFiles}
                  openApp={openApp}
                  launchAgent={launchAgent}
                  stopAgent={stopAgent}
                  approveAgent={approveAgent}
                  rejectAgent={rejectAgent}
                  syncGithub={syncGithub}
                  onSaveFile={handleSaveFile}
                  onOpenFile={handleOpenFile}
                  onPauseAgent={(pid) => kernel.pauseAgent(pid)}
                  onResumeAgent={(pid) => kernel.resumeAgent(pid)}
                  onSendAgentMessage={(pid, msg) => kernel.sendAgentMessage(pid, msg)}
                />
              </ErrorBoundary>
            </Window>
          ))}
        </div>

        {/* Dock */}
        <ErrorBoundary fallbackTitle="Dock Error">
          <Dock onAppClick={(id) => openApp(id)} openApps={visibleWindows.map((w) => w.id)} />
        </ErrorBoundary>

        {/* Smart Bar (Spotlight) */}
        <Suspense fallback={<LazyFallback />}>
          <SmartBar isOpen={isSmartBarOpen} onClose={() => setIsSmartBarOpen(false)} />
        </Suspense>

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
          <GitHubCloneModal
            githubRepoUrl={githubRepoUrl}
            setGithubRepoUrl={setGithubRepoUrl}
            githubCloneStatus={githubCloneStatus}
            onClone={handleGithubClone}
            onClose={() => setShowGithubModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default App;
