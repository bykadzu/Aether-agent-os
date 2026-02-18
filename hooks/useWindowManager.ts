import { useState, useMemo, useCallback } from 'react';
import { AppID, WindowState, Agent } from '../types';

export interface UseWindowManagerReturn {
  windows: WindowState[];
  setWindows: React.Dispatch<React.SetStateAction<WindowState[]>>;
  activeWindowId: string | null;
  setActiveWindowId: React.Dispatch<React.SetStateAction<string | null>>;
  currentWorkspace: number;
  totalWorkspaces: number;
  showWorkspaceOverview: boolean;
  setShowWorkspaceOverview: React.Dispatch<React.SetStateAction<boolean>>;
  workspaceTransitionDir: 'left' | 'right' | null;
  openApp: (appId: AppID, initialData?: any) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  moveWindow: (id: string, x: number, y: number) => void;
  resizeWindow: (id: string, width: number, height: number, x?: number, y?: number) => void;
  cycleWindow: () => void;
  switchWorkspace: (targetIdx: number, direction?: 'left' | 'right') => void;
  moveWindowToWorkspace: (windowId: string, targetWorkspace: number) => void;
  visibleWindows: WindowState[];
  workspaceWindowCounts: number[];
  workspaceWindowsData: Array<{
    workspace: number;
    windows: Array<{
      id: string;
      title: string;
      appId: AppID;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>;
  }>;
  getAppTitle: (id: AppID) => string;
}

export function useWindowManager(agents: Agent[]): UseWindowManagerReturn {
  const [windows, setWindows] = useState<WindowState[]>([]);
  const [activeWindowId, setActiveWindowId] = useState<string | null>(null);
  const [currentWorkspace, setCurrentWorkspace] = useState(0);
  const [totalWorkspaces] = useState(3);
  const [showWorkspaceOverview, setShowWorkspaceOverview] = useState(false);
  const [workspaceTransitionDir, setWorkspaceTransitionDir] = useState<'left' | 'right' | null>(
    null,
  );

  const getAppTitle = useCallback((id: AppID) => {
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
      case AppID.OPENCLAW:
        return 'OpenClaw Importer';
      default:
        return 'App';
    }
  }, []);

  const focusWindow = useCallback((id: string) => {
    setActiveWindowId(id);
    setWindows((prev) => {
      const maxZ = Math.max(...prev.map((w) => w.zIndex), 0);
      return prev.map((w) => (w.id === id ? { ...w, zIndex: maxZ + 1 } : w));
    });
  }, []);

  const closeWindow = useCallback(
    (id: string) => {
      setWindows((prev) => prev.filter((w) => w.id !== id));
      if (activeWindowId === id) setActiveWindowId(null);
    },
    [activeWindowId],
  );

  const minimizeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, isMinimized: true } : w)));
    setActiveWindowId(null);
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w)),
    );
  }, []);

  const moveWindow = useCallback((id: string, x: number, y: number) => {
    setWindows((prev) => prev.map((w) => (w.id === id ? { ...w, position: { x, y } } : w)));
  }, []);

  const resizeWindow = useCallback(
    (id: string, width: number, height: number, x?: number, y?: number) => {
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
    },
    [],
  );

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
  }, [windows, activeWindowId, focusWindow]);

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

  const openApp = useCallback(
    (appId: AppID, initialData?: any) => {
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
          const maxZ = Math.max(...windows.map((w) => w.zIndex), 0);
          const newWindow: WindowState = {
            id: winId,
            appId: AppID.VM,
            title: `VM: ${agent?.name || 'Agent'}`,
            isOpen: true,
            isMinimized: false,
            isMaximized: false,
            zIndex: maxZ + 1,
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

      const winId = appId;
      const existingWindow = windows.find((w) => w.id === winId);

      if (existingWindow) {
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
        const maxZ = Math.max(...windows.map((w) => w.zIndex), 0);
        const newWindow: WindowState = {
          id: winId,
          appId: appId,
          title: getAppTitle(appId),
          isOpen: true,
          isMinimized: false,
          isMaximized: false,
          zIndex: maxZ + 1,
          position: { x: 100 + windows.length * 30, y: 100 + windows.length * 30 },
          size: isCalculator ? { width: 320, height: 480 } : { width: 900, height: 650 },
          initialData,
          workspaceId: currentWorkspace,
        };
        setWindows((prev) => [...prev, newWindow]);
        setActiveWindowId(winId);
      }
    },
    [windows, agents, currentWorkspace, focusWindow, switchWorkspace, getAppTitle],
  );

  const visibleWindows = useMemo(() => {
    return windows.filter((w) => {
      if (w.stickyWorkspace) return true;
      const wsId = w.workspaceId ?? 0;
      return wsId === currentWorkspace;
    });
  }, [windows, currentWorkspace]);

  const workspaceWindowCounts = useMemo(() => {
    const counts = Array(totalWorkspaces).fill(0);
    windows.forEach((w) => {
      if (w.stickyWorkspace) {
        counts.forEach((_: number, i: number) => counts[i]++);
      } else {
        const wsId = w.workspaceId ?? 0;
        if (wsId < totalWorkspaces) counts[wsId]++;
      }
    });
    return counts;
  }, [windows, totalWorkspaces]);

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

  return {
    windows,
    setWindows,
    activeWindowId,
    setActiveWindowId,
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
    getAppTitle,
  };
}
