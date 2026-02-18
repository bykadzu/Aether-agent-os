import { useEffect } from 'react';
import { AppID } from '../types';
import { getShortcutManager } from '../services/shortcutManager';

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
  AppID.OPENCLAW,
];

export interface UseGlobalShortcutsParams {
  openApp: (appId: AppID) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  cycleWindow: () => void;
  switchWorkspace: (targetIdx: number, direction?: 'left' | 'right') => void;
  moveWindowToWorkspace: (windowId: string, targetWorkspace: number) => void;
  setIsSmartBarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsShortcutOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isSmartBarOpen: boolean;
  isShortcutOverlayOpen: boolean;
  contextMenu: { isOpen: boolean; x: number; y: number } | null;
  setContextMenu: React.Dispatch<
    React.SetStateAction<{ isOpen: boolean; x: number; y: number } | null>
  >;
  activeWindowId: string | null;
  currentWorkspace: number;
  totalWorkspaces: number;
  setShowWorkspaceOverview: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useGlobalShortcuts(params: UseGlobalShortcutsParams) {
  const {
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
  } = params;

  // Keep the manager aware of which app is focused
  useEffect(() => {
    const mgr = getShortcutManager();
    if (activeWindowId) {
      mgr.setFocusedApp(activeWindowId);
    } else {
      mgr.setFocusedApp(null);
    }
  }, [activeWindowId]);

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

    // -- App-specific shortcuts --
    mgr.registerShortcut(
      'app:terminal:new-tab',
      'Cmd+T',
      () => openApp(AppID.TERMINAL),
      'New terminal window',
      'app:terminal',
      'Terminal',
    );

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
}
