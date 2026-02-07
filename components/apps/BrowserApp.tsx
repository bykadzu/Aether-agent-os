import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Lock,
  Plus,
  X,
  ZoomIn,
  ZoomOut,
  Globe,
  AlertTriangle,
} from 'lucide-react';
import { getKernelClient, KernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowserTab {
  sessionId: string;
  title: string;
  url: string;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _tabSeq = 0;
function nextSessionId(): string {
  return `btab_${Date.now()}_${++_tabSeq}`;
}

/**
 * Fire-and-forget command to the kernel.
 * Accesses the private `send` method on KernelClient because there are no
 * public browser-specific helpers yet. The message format matches the
 * KernelCommand union from @aether/shared protocol.ts.
 */
function sendCmd(
  client: KernelClient,
  type: string,
  payload: Record<string, any> = {},
): void {
  const id = `brow_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  (client as any).send({ type, id, ...payload });
}

/**
 * Request/response command to the kernel. Returns a promise that resolves
 * when the kernel sends a matching `response.ok`.
 */
function requestCmd<T = any>(
  client: KernelClient,
  type: string,
  payload: Record<string, any> = {},
): Promise<T> {
  return (client as any).request({ type, ...payload });
}

const DEFAULT_URL = 'https://www.google.com';
const SCROLL_THROTTLE_MS = 50;
const SCREENCAST_FPS = 10;
const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BrowserApp: React.FC = () => {
  // ---- Connection state ----
  const [kernelConnected, setKernelConnected] = useState(false);
  const clientRef = useRef<KernelClient | null>(null);

  // ---- Kernel-mode state ----
  const [tabs, setTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [zoom, setZoom] = useState(100);
  const [viewportLoading, setViewportLoading] = useState(true);

  // ---- Fallback (iframe) state ----
  const [iframeUrl, setIframeUrl] = useState('https://www.wikipedia.org');
  const [iframeInput, setIframeInput] = useState('https://www.wikipedia.org');
  const [iframeLoading, setIframeLoading] = useState(false);

  // ---- Refs ----
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef(0);
  const viewportLoadingRef = useRef(true);

  // Keep mutable mirrors of React state so event-listener closures
  // always read the latest values without re-subscribing.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // =========================================================================
  // 1. Detect kernel connection & track changes
  // =========================================================================

  useEffect(() => {
    const client = getKernelClient();
    clientRef.current = client;
    setKernelConnected(client.connected);

    const unsub = client.on('connection', (ev: any) => {
      setKernelConnected(!!ev.connected);
    });

    return unsub;
  }, []);

  // =========================================================================
  // 2. Subscribe to browser:* events (kernel mode only)
  // =========================================================================

  useEffect(() => {
    if (!kernelConnected) return;
    const client = clientRef.current;
    if (!client) return;

    const unsubs: Array<() => void> = [];

    // --- Screenshot frames (high-frequency) ---
    // Mutate img.src directly to avoid React re-renders on every frame.
    unsubs.push(
      client.on('browser:screenshot', (ev: any) => {
        if (ev.sessionId === activeTabIdRef.current && imgRef.current) {
          imgRef.current.src = `data:image/png;base64,${ev.data}`;
          // Dismiss the loading overlay on the very first frame.
          if (viewportLoadingRef.current) {
            viewportLoadingRef.current = false;
            setViewportLoading(false);
          }
        }
      }),
    );

    // --- Page info (title, url, loading) ---
    unsubs.push(
      client.on('browser:page_info', (ev: any) => {
        const info = ev.info;
        setTabs((prev) =>
          prev.map((t) =>
            t.sessionId === ev.sessionId
              ? {
                  ...t,
                  title: info.title ?? t.title,
                  url: info.url ?? t.url,
                  isLoading: info.isLoading ?? false,
                }
              : t,
          ),
        );
        if (ev.sessionId === activeTabIdRef.current && info.url) {
          setUrlInput(info.url);
        }
      }),
    );

    // --- Navigation completed ---
    unsubs.push(
      client.on('browser:navigated', (ev: any) => {
        setTabs((prev) =>
          prev.map((t) =>
            t.sessionId === ev.sessionId
              ? { ...t, url: ev.url, title: ev.title ?? t.title, isLoading: false }
              : t,
          ),
        );
        if (ev.sessionId === activeTabIdRef.current) {
          setUrlInput(ev.url ?? '');
        }
      }),
    );

    // --- Session destroyed (server-side) ---
    unsubs.push(
      client.on('browser:destroyed', (ev: any) => {
        setTabs((prev) => prev.filter((t) => t.sessionId !== ev.sessionId));
      }),
    );

    // --- Errors ---
    unsubs.push(
      client.on('browser:error', (ev: any) => {
        console.error('[BrowserApp] Session error:', ev.sessionId, ev.error);
        setTabs((prev) =>
          prev.map((t) =>
            t.sessionId === ev.sessionId ? { ...t, isLoading: false } : t,
          ),
        );
      }),
    );

    return () => unsubs.forEach((fn) => fn());
  }, [kernelConnected]);

  // =========================================================================
  // 3. Create a new browser tab
  // =========================================================================

  const createNewTab = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected) return;

    const sessionId = nextSessionId();
    const tab: BrowserTab = {
      sessionId,
      title: 'New Tab',
      url: DEFAULT_URL,
      isLoading: true,
    };

    setTabs((prev) => [...prev, tab]);
    setActiveTabId(sessionId);
    setUrlInput(DEFAULT_URL);
    viewportLoadingRef.current = true;
    setViewportLoading(true);
    if (imgRef.current) imgRef.current.src = '';

    try {
      await requestCmd(client, 'browser:create', {
        sessionId,
        options: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });
      sendCmd(client, 'browser:navigate', { sessionId, url: DEFAULT_URL });
    } catch (err) {
      console.error('[BrowserApp] Failed to create tab:', err);
    }
  }, []);

  // Auto-create the first tab when the kernel connects.
  useEffect(() => {
    if (kernelConnected && tabs.length === 0) {
      createNewTab();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernelConnected]);

  // =========================================================================
  // 4. Screencast lifecycle — start on active tab, stop on switch / unmount
  // =========================================================================

  useEffect(() => {
    if (!kernelConnected || !activeTabId) return;
    const client = clientRef.current;
    if (!client) return;

    sendCmd(client, 'browser:screencast_start', {
      sessionId: activeTabId,
      fps: SCREENCAST_FPS,
    });

    return () => {
      sendCmd(client, 'browser:screencast_stop', { sessionId: activeTabId });
    };
  }, [activeTabId, kernelConnected]);

  // =========================================================================
  // 5. Destroy every session on unmount (belt-and-suspenders cleanup)
  // =========================================================================

  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (!client?.connected) return;
      for (const tab of tabsRef.current) {
        sendCmd(client, 'browser:screencast_stop', { sessionId: tab.sessionId });
        sendCmd(client, 'browser:destroy', { sessionId: tab.sessionId });
      }
    };
  }, []);

  // =========================================================================
  // Tab actions
  // =========================================================================

  const closeTab = useCallback(
    (sessionId: string) => {
      const client = clientRef.current;
      if (client?.connected) {
        sendCmd(client, 'browser:screencast_stop', { sessionId });
        sendCmd(client, 'browser:destroy', { sessionId });
      }

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.sessionId !== sessionId);

        if (activeTabIdRef.current === sessionId) {
          if (remaining.length > 0) {
            const closedIdx = prev.findIndex((t) => t.sessionId === sessionId);
            const newActive = remaining[Math.min(closedIdx, remaining.length - 1)];
            setActiveTabId(newActive.sessionId);
            setUrlInput(newActive.url);
            viewportLoadingRef.current = true;
            setViewportLoading(true);
            if (imgRef.current) imgRef.current.src = '';
          } else {
            // Last tab closed — immediately open a fresh one.
            setTimeout(() => createNewTab(), 0);
          }
        }

        return remaining;
      });
    },
    [createNewTab],
  );

  const switchTab = useCallback((sessionId: string) => {
    if (sessionId === activeTabIdRef.current) return;
    setActiveTabId(sessionId);
    const tab = tabsRef.current.find((t) => t.sessionId === sessionId);
    if (tab) setUrlInput(tab.url);
    viewportLoadingRef.current = true;
    setViewportLoading(true);
    if (imgRef.current) imgRef.current.src = '';
  }, []);

  // =========================================================================
  // Navigation commands
  // =========================================================================

  const handleNavigate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const client = clientRef.current;
      if (!client?.connected || !activeTabId) return;

      let target = urlInput.trim();
      if (!/^https?:\/\//i.test(target)) {
        target = `https://${target}`;
      }

      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === activeTabId ? { ...t, isLoading: true } : t,
        ),
      );
      sendCmd(client, 'browser:navigate', { sessionId: activeTabId, url: target });
    },
    [activeTabId, urlInput],
  );

  const navBack = useCallback(() => {
    const client = clientRef.current;
    if (client?.connected && activeTabId) {
      sendCmd(client, 'browser:back', { sessionId: activeTabId });
    }
  }, [activeTabId]);

  const navForward = useCallback(() => {
    const client = clientRef.current;
    if (client?.connected && activeTabId) {
      sendCmd(client, 'browser:forward', { sessionId: activeTabId });
    }
  }, [activeTabId]);

  const navReload = useCallback(() => {
    const client = clientRef.current;
    if (client?.connected && activeTabId) {
      setTabs((prev) =>
        prev.map((t) =>
          t.sessionId === activeTabId ? { ...t, isLoading: true } : t,
        ),
      );
      sendCmd(client, 'browser:reload', { sessionId: activeTabId });
    }
  }, [activeTabId]);

  // =========================================================================
  // Viewport input forwarding
  // =========================================================================

  /** Convert a mouse event's client coordinates to page-space coordinates. */
  const toPageCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } | null => {
      const img = imgRef.current;
      if (!img) return null;
      const rect = img.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;
      const x = Math.round(((e.clientX - rect.left) / rect.width) * VIEWPORT_WIDTH);
      const y = Math.round(((e.clientY - rect.top) / rect.height) * VIEWPORT_HEIGHT);
      return {
        x: Math.max(0, Math.min(VIEWPORT_WIDTH, x)),
        y: Math.max(0, Math.min(VIEWPORT_HEIGHT, y)),
      };
    },
    [],
  );

  const onViewportClick = useCallback(
    (e: React.MouseEvent) => {
      const client = clientRef.current;
      if (!client?.connected || !activeTabId) return;
      const pos = toPageCoords(e);
      if (!pos) return;
      sendCmd(client, 'browser:click', {
        sessionId: activeTabId,
        x: pos.x,
        y: pos.y,
        button: e.button === 2 ? 'right' : 'left',
      });
    },
    [activeTabId, toPageCoords],
  );

  const onViewportWheel = useCallback(
    (e: React.WheelEvent) => {
      const client = clientRef.current;
      if (!client?.connected || !activeTabId) return;
      const now = Date.now();
      if (now - lastScrollTime.current < SCROLL_THROTTLE_MS) return;
      lastScrollTime.current = now;
      sendCmd(client, 'browser:scroll', {
        sessionId: activeTabId,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
      });
    },
    [activeTabId],
  );

  const onViewportKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const client = clientRef.current;
      if (!client?.connected || !activeTabId) return;

      // Prevent browser-default shortcuts while the viewport is focused.
      e.preventDefault();
      e.stopPropagation();

      const SPECIAL_KEYS = new Set([
        'Enter',
        'Tab',
        'Escape',
        'Backspace',
        'Delete',
        'ArrowUp',
        'ArrowDown',
        'ArrowLeft',
        'ArrowRight',
        'Home',
        'End',
        'PageUp',
        'PageDown',
        'F1',
        'F2',
        'F3',
        'F4',
        'F5',
        'F6',
        'F7',
        'F8',
        'F9',
        'F10',
        'F11',
        'F12',
      ]);

      if (SPECIAL_KEYS.has(e.key)) {
        sendCmd(client, 'browser:keypress', { sessionId: activeTabId, key: e.key });
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        // Printable character — use browser:type for text insertion.
        sendCmd(client, 'browser:type', { sessionId: activeTabId, text: e.key });
      } else if (e.ctrlKey || e.metaKey) {
        // Modifier combos (Ctrl+C, Cmd+V, etc.)
        const parts: string[] = [];
        if (e.ctrlKey) parts.push('Control');
        if (e.metaKey) parts.push('Meta');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        parts.push(e.key);
        sendCmd(client, 'browser:keypress', {
          sessionId: activeTabId,
          key: parts.join('+'),
        });
      }
    },
    [activeTabId],
  );

  // =========================================================================
  // Zoom controls
  // =========================================================================

  const zoomIn = () => setZoom((z) => Math.min(200, z + 10));
  const zoomOut = () => setZoom((z) => Math.max(25, z - 10));
  const zoomReset = () => setZoom(100);

  // =========================================================================
  // Derived values
  // =========================================================================

  const activeTab = tabs.find((t) => t.sessionId === activeTabId);
  const isHttps = activeTab?.url?.startsWith('https://') ?? false;

  // *************************************************************************
  // RENDER — Fallback mode (kernel not connected)
  // *************************************************************************

  if (!kernelConnected) {
    return (
      <div className="flex flex-col h-full bg-gray-900">
        {/* Warning banner */}
        <div className="px-3 py-1.5 bg-amber-900/50 border-b border-amber-700/50 flex items-center gap-2 text-amber-200 text-xs">
          <AlertTriangle size={12} className="shrink-0" />
          <span>
            Limited mode: some sites may not load. Connect kernel for full
            browser.
          </span>
        </div>

        {/* Navigation chrome */}
        <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-2 gap-2">
          <div className="flex gap-0.5 text-gray-400">
            <button className="p-1.5 hover:bg-gray-700 rounded transition-colors">
              <ArrowLeft size={16} />
            </button>
            <button className="p-1.5 hover:bg-gray-700 rounded transition-colors">
              <ArrowRight size={16} />
            </button>
            <button
              className="p-1.5 hover:bg-gray-700 rounded transition-colors"
              onClick={() => {
                setIframeLoading(true);
                const u = iframeUrl;
                setIframeUrl('');
                setTimeout(() => setIframeUrl(u), 10);
              }}
            >
              <RotateCw
                size={14}
                className={iframeLoading ? 'animate-spin' : ''}
              />
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              let target = iframeInput;
              if (!/^https?:\/\//.test(target)) target = `https://${target}`;
              setIframeUrl(target);
              setIframeLoading(true);
            }}
            className="flex-1 relative"
          >
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
              <Globe size={12} />
            </div>
            <input
              type="text"
              value={iframeInput}
              onChange={(e) => setIframeInput(e.target.value)}
              className="w-full bg-gray-700/60 hover:bg-gray-700 focus:bg-gray-600 border border-transparent focus:border-blue-500/50 rounded-lg pl-8 pr-4 py-1.5 text-sm outline-none transition-all text-gray-200 focus:ring-1 focus:ring-blue-500/30"
            />
          </form>
        </div>

        {/* Content — iframe fallback */}
        <div className="flex-1 relative bg-white">
          <iframe
            src={iframeUrl}
            className="w-full h-full border-none"
            title="Browser"
            onLoad={() => setIframeLoading(false)}
            sandbox="allow-same-origin allow-scripts allow-forms"
          />
          {iframeLoading && (
            <div className="absolute inset-0 bg-white flex flex-col items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
              <span className="text-gray-400 text-sm">Loading...</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // *************************************************************************
  // RENDER — Kernel mode (full browser via WebSocket)
  // *************************************************************************

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white select-none">
      {/* ---- Tab bar ---- */}
      <div className="h-9 bg-gray-800 flex items-end px-1 pt-1 border-b border-gray-700 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.sessionId}
            onClick={() => switchTab(tab.sessionId)}
            className={`
              group flex items-center gap-1.5 min-w-[120px] max-w-[200px] px-3 py-1.5
              text-xs rounded-t-lg cursor-pointer transition-colors border-x border-t
              ${
                tab.sessionId === activeTabId
                  ? 'bg-gray-900 text-white border-gray-700'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700/50 hover:text-gray-300 border-transparent'
              }
            `}
          >
            {tab.isLoading ? (
              <RotateCw
                size={10}
                className="animate-spin shrink-0 text-blue-400"
              />
            ) : (
              <Globe size={10} className="shrink-0 text-gray-500" />
            )}
            <span className="truncate flex-1">
              {tab.title || 'New Tab'}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.sessionId);
              }}
              className="p-0.5 rounded hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button
          onClick={createNewTab}
          className="p-1.5 mx-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors shrink-0"
          title="New Tab"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ---- Navigation chrome ---- */}
      <div className="h-10 bg-gray-800/80 border-b border-gray-700 flex items-center px-2 gap-2">
        <div className="flex gap-0.5 text-gray-400">
          <button
            onClick={navBack}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={navForward}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            onClick={navReload}
            className="p-1.5 hover:bg-gray-700 rounded transition-colors"
            title="Reload"
          >
            <RotateCw
              size={14}
              className={
                activeTab?.isLoading ? 'animate-spin text-blue-400' : ''
              }
            />
          </button>
        </div>

        <form onSubmit={handleNavigate} className="flex-1 relative">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {isHttps ? (
              <Lock size={12} className="text-green-500" />
            ) : (
              <Globe size={12} className="text-gray-500" />
            )}
          </div>
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="Enter URL..."
            className="w-full bg-gray-700/60 hover:bg-gray-700 focus:bg-gray-600 border border-transparent focus:border-blue-500/50 rounded-lg pl-8 pr-4 py-1.5 text-sm outline-none transition-all text-gray-200 focus:ring-1 focus:ring-blue-500/30"
          />
        </form>
      </div>

      {/* ---- Page viewport ---- */}
      <div
        ref={viewportRef}
        className="flex-1 relative bg-gray-950 overflow-hidden flex items-center justify-center cursor-default outline-none"
        onClick={onViewportClick}
        onWheel={onViewportWheel}
        onKeyDown={onViewportKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={0}
      >
        <img
          ref={imgRef}
          alt=""
          className="max-w-full max-h-full object-contain"
          style={{
            imageRendering: 'auto',
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: 'center center',
          }}
          draggable={false}
        />

        {/* Loading overlay — visible until the first screencast frame arrives */}
        {viewportLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-950">
            <Globe size={48} className="text-gray-700 mb-3" />
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs text-gray-500">
              Connecting to page...
            </span>
          </div>
        )}
      </div>

      {/* ---- Status bar ---- */}
      <div className="h-7 bg-gray-800 border-t border-gray-700 flex items-center justify-between px-3 text-[10px] text-gray-500">
        <span className="truncate max-w-[50%]">
          {activeTab?.url ?? ''}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={zoomOut}
            className="p-0.5 hover:text-white transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <button
            onClick={zoomReset}
            className="px-1 hover:text-white transition-colors min-w-[36px] text-center"
            title="Reset zoom"
          >
            {zoom}%
          </button>
          <button
            onClick={zoomIn}
            className="p-0.5 hover:text-white transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
