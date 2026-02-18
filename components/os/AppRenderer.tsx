import React, { Suspense } from 'react';
import { AppID, WindowState, Agent } from '../../types';
import { FileSystemItem } from '../../data/mockFileSystem';

// All lazy-loaded app components
const NotesApp = React.lazy(() =>
  import('../apps/NotesApp').then((m) => ({ default: m.NotesApp })),
);
const PhotosApp = React.lazy(() =>
  import('../apps/PhotosApp').then((m) => ({ default: m.PhotosApp })),
);
const ChatApp = React.lazy(() => import('../apps/ChatApp').then((m) => ({ default: m.ChatApp })));
const FileExplorer = React.lazy(() =>
  import('../apps/FileExplorer').then((m) => ({ default: m.FileExplorer })),
);
const SettingsApp = React.lazy(() =>
  import('../apps/SettingsApp').then((m) => ({ default: m.SettingsApp })),
);
const TerminalApp = React.lazy(() =>
  import('../apps/TerminalApp').then((m) => ({ default: m.TerminalApp })),
);
const CalculatorApp = React.lazy(() =>
  import('../apps/CalculatorApp').then((m) => ({ default: m.CalculatorApp })),
);
const VideoPlayerApp = React.lazy(() =>
  import('../apps/VideoPlayerApp').then((m) => ({ default: m.VideoPlayerApp })),
);
const AgentDashboard = React.lazy(() =>
  import('../apps/AgentDashboard').then((m) => ({ default: m.AgentDashboard })),
);
const WriterApp = React.lazy(() =>
  import('../apps/WriterApp').then((m) => ({ default: m.WriterApp })),
);
const SystemMonitorApp = React.lazy(() =>
  import('../apps/SystemMonitorApp').then((m) => ({ default: m.SystemMonitorApp })),
);
const MusicApp = React.lazy(() =>
  import('../apps/MusicApp').then((m) => ({ default: m.MusicApp })),
);
const MemoryInspectorApp = React.lazy(() =>
  import('../apps/MemoryInspectorApp').then((m) => ({ default: m.MemoryInspectorApp })),
);
const AppStoreApp = React.lazy(() =>
  import('../apps/AppStoreApp').then((m) => ({ default: m.AppStoreApp })),
);
const PluginMarketplaceApp = React.lazy(() =>
  import('../apps/PluginMarketplaceApp').then((m) => ({ default: m.PluginMarketplaceApp })),
);
const IntegrationsApp = React.lazy(() =>
  import('../apps/IntegrationsApp').then((m) => ({ default: m.IntegrationsApp })),
);
const OpenClawImporter = React.lazy(() =>
  import('../apps/OpenClawImporter').then((m) => ({ default: m.OpenClawImporter })),
);
const CodeEditorApp = React.lazy(() =>
  import('../apps/CodeEditorApp').then((m) => ({ default: m.CodeEditorApp })),
);
const BrowserApp = React.lazy(() =>
  import('../apps/BrowserApp').then((m) => ({ default: m.BrowserApp })),
);
const SheetsApp = React.lazy(() =>
  import('../apps/SheetsApp').then((m) => ({ default: m.SheetsApp })),
);
const CanvasApp = React.lazy(() =>
  import('../apps/CanvasApp').then((m) => ({ default: m.CanvasApp })),
);
const DocumentsApp = React.lazy(() =>
  import('../apps/DocumentsApp').then((m) => ({ default: m.DocumentsApp })),
);
const AgentVM = React.lazy(() => import('../apps/AgentVM').then((m) => ({ default: m.AgentVM })));

const LazyFallback = () => (
  <div className="flex items-center justify-center w-full h-full bg-[#1a1d26]">
    <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
  </div>
);

export interface AppRendererProps {
  windowState: WindowState;
  agents: Agent[];
  files: FileSystemItem[];
  setFiles: React.Dispatch<React.SetStateAction<FileSystemItem[]>>;
  openApp: (appId: AppID, initialData?: any) => void;
  launchAgent: (role: string, goal: string) => Promise<void>;
  stopAgent: (id: string) => void;
  approveAgent: (id: string) => void;
  rejectAgent: (id: string) => void;
  syncGithub: (id: string) => void;
  onSaveFile: (fileId: string, content: string) => void;
  onOpenFile: (file: FileSystemItem) => void;
  onPauseAgent: (pid: number) => void;
  onResumeAgent: (pid: number) => void;
  onSendAgentMessage: (pid: number, message: string) => Promise<void>;
}

export const AppRenderer: React.FC<AppRendererProps> = React.memo(
  ({
    windowState,
    agents,
    files,
    setFiles,
    openApp,
    launchAgent,
    stopAgent,
    approveAgent,
    rejectAgent,
    syncGithub,
    onSaveFile,
    onOpenFile,
    onPauseAgent,
    onResumeAgent,
    onSendAgentMessage,
  }) => {
    switch (windowState.appId) {
      case AppID.NOTES:
        return (
          <Suspense fallback={<LazyFallback />}>
            <NotesApp
              initialContent={windowState.initialData?.content}
              onSave={(content) =>
                windowState.initialData?.fileId &&
                onSaveFile(windowState.initialData.fileId, content)
              }
            />
          </Suspense>
        );
      case AppID.PHOTOS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <PhotosApp initialImage={windowState.initialData?.image} />
          </Suspense>
        );
      case AppID.CHAT:
        return (
          <Suspense fallback={<LazyFallback />}>
            <ChatApp />
          </Suspense>
        );
      case AppID.FILES:
        return (
          <Suspense fallback={<LazyFallback />}>
            <FileExplorer files={files} onOpenFile={onOpenFile} />
          </Suspense>
        );
      case AppID.SETTINGS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <SettingsApp />
          </Suspense>
        );
      case AppID.TERMINAL:
        return (
          <Suspense fallback={<LazyFallback />}>
            <TerminalApp files={files} setFiles={setFiles} />
          </Suspense>
        );
      case AppID.BROWSER:
        return (
          <Suspense fallback={<LazyFallback />}>
            <BrowserApp />
          </Suspense>
        );
      case AppID.CALCULATOR:
        return (
          <Suspense fallback={<LazyFallback />}>
            <CalculatorApp />
          </Suspense>
        );
      case AppID.CODE:
        return (
          <Suspense fallback={<LazyFallback />}>
            <CodeEditorApp
              initialContent={windowState.initialData?.content}
              fileName={windowState.initialData?.fileName}
              onSave={(content) =>
                windowState.initialData?.fileId &&
                onSaveFile(windowState.initialData.fileId, content)
              }
            />
          </Suspense>
        );
      case AppID.VIDEO:
        return (
          <Suspense fallback={<LazyFallback />}>
            <VideoPlayerApp
              url={windowState.initialData?.url}
              title={windowState.initialData?.title}
            />
          </Suspense>
        );
      case AppID.AGENTS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <AgentDashboard
              agents={agents}
              onLaunchAgent={launchAgent}
              onOpenVM={(agentId) => openApp(AppID.VM, { agentId })}
              onStopAgent={stopAgent}
              onPauseAgent={(id) => {
                const agent = agents.find((a) => a.id === id);
                if (agent?.pid) onPauseAgent(agent.pid);
              }}
              onResumeAgent={(id) => {
                const agent = agents.find((a) => a.id === id);
                if (agent?.pid) onResumeAgent(agent.pid);
              }}
            />
          </Suspense>
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
        return (
          <Suspense fallback={<LazyFallback />}>
            <WriterApp />
          </Suspense>
        );
      case AppID.SYSTEM_MONITOR:
        return (
          <Suspense fallback={<LazyFallback />}>
            <SystemMonitorApp />
          </Suspense>
        );
      case AppID.MUSIC:
        return (
          <Suspense fallback={<LazyFallback />}>
            <MusicApp />
          </Suspense>
        );
      case AppID.DOCUMENTS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <DocumentsApp initialFile={windowState.initialData?.filePath} />
          </Suspense>
        );
      case AppID.MEMORY_INSPECTOR:
        return (
          <Suspense fallback={<LazyFallback />}>
            <MemoryInspectorApp />
          </Suspense>
        );
      case AppID.APP_STORE:
        return (
          <Suspense fallback={<LazyFallback />}>
            <AppStoreApp />
          </Suspense>
        );
      case AppID.PLUGIN_MARKETPLACE:
        return (
          <Suspense fallback={<LazyFallback />}>
            <PluginMarketplaceApp />
          </Suspense>
        );
      case AppID.INTEGRATIONS:
        return (
          <Suspense fallback={<LazyFallback />}>
            <IntegrationsApp />
          </Suspense>
        );
      case AppID.OPENCLAW:
        return (
          <Suspense fallback={<LazyFallback />}>
            <OpenClawImporter />
          </Suspense>
        );
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
              onPause={(id) => {
                const a = agents.find((ag) => ag.id === id);
                if (a?.pid) onPauseAgent(a.pid);
              }}
              onResume={(id) => {
                const a = agents.find((ag) => ag.id === id);
                if (a?.pid) onResumeAgent(a.pid);
              }}
              onSendMessage={async (id, message) => {
                const a = agents.find((ag) => ag.id === id);
                if (a?.pid) {
                  await onSendAgentMessage(a.pid, message);
                  await onResumeAgent(a.pid);
                }
              }}
            />
          </Suspense>
        );
      }
      default:
        return null;
    }
  },
);
