import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Lock,
  Star,
  Plus,
  X,
  Globe,
  Loader2,
  Monitor,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrowserTab {
  id: string;
  sessionId: string;
  url: string;
  title: string;
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const DEFAULT_URL = 'https://www.wikipedia.org';
const SCREENSHOT_POLL_MS = 800;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a unique command ID. */
function genId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Create a fresh tab descriptor. */
function makeTab(url: string = DEFAULT_URL): BrowserTab {
  const id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    sessionId: id,
    url,
    title: 'New Tab',
    isLoading: false,
  };
}

/**
 * Send a command to the kernel and wait for its response.
 *
 * Uses the KernelClient's internal request/response mechanism (which tracks
 * pending commands by ID and resolves when the kernel responds).
 */
async function sendCommand(cmd: Record<string, unknown>): Promise<any> {
  const client = getKernelClient();
  // KernelClient.request is the private promise-based command sender.
  // We access it here because browser commands don't have dedicated public
  // methods yet. The method generates its own unique ID and sets up a
  // timeout automatically.
  return (client as any).request(cmd);
}

/**
 * Fire-and-forget: send a command without waiting for a response.
 *
 * Used for high-frequency input events (click, type, scroll) where we
 * don't want to accumulate pending promises.
 */
function sendInput(cmd: Record<string, unknown>): void {
  const withId = { ...cmd, id: genId() };
  const client = getKernelClient();
  (client as any).send(withId);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const BrowserApp: React.FC = () => {
  // -- State ----------------------------------------------------------------

  const initialTabRef = useRef(makeTab());
  const [tabs, setTabs] = useState<BrowserTab[]>([initialTabRef.current]);
  const [activeTabId, setActiveTabId] = useState(initialTabRef.current.id);
  const [inputUrl, setInputUrl] = useState(DEFAULT_URL);
  const [kernelConnected, setKernelConnected] = useState(false);

  // -- Refs -----------------------------------------------------------------

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  /** Set of session IDs for which we have created kernel browser sessions. */
  const createdSessions = useRef<Set<string>>(new Set());

  /** Mirrors `activeTab.sessionId` so event handlers always see current value. */
  const activeSessionRef = useRef<string>(initialTabRef.current.sessionId);

  /** Screenshot polling timer. */
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** True once the kernel starts pushing screencast frames (stops polling). */
  const receivingScreencastRef = useRef(false);

  /** Guard to stop async work after unmount. */
  const unmountedRef = useRef(false);

  // -- Derived --------------------------------------------------------------

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const isKernelMode = kernelConnected;

  // Keep the session ref in sync with React state.
  useEffect(() => {
    activeSessionRef.current = activeTab?.sessionId ?? '';
  }, [activeTab?.sessionId]);

  // =========================================================================
  // Kernel connection tracking
  // =========================================================================

  useEffect(() => {
    const client = getKernelClient();
    setKernelConnected(client.connected);

    const unsub = client.on('connection', (data: any) => {
      setKernelConnected(data.connected);
    });

    return unsub;
  }, []);

  // =========================================================================
  // Sync URL bar when switching tabs
  // =========================================================================

  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId]);

  // =========================================================================
  // Kernel: create / destroy browser sessions
  // =========================================================================

  const createSession = useCallback(async (tab: BrowserTab) => {
    if (!getKernelClient().connected) return;
    if (createdSessions.current.has(tab.sessionId)) return;

    createdSessions.current.add(tab.sessionId);

    try {
      await sendCommand({
        type: 'browser:create',
        sessionId: tab.sessionId,
        options: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      });

      // Start screencast streaming (the kernel will push frames via events).
      // If the kernel doesn't support this command it will simply be ignored.
      sendCommand({
        type: 'browser:startScreencast',
        sessionId: tab.sessionId,
      }).catch(() => {
        // Not all kernels support explicit screencast start; that's OK.
      });

      // Navigate to the tab's initial URL.
      if (tab.url) {
        setTabs((prev) => prev.map((t) => (t.id === tab.id ? { ...t, isLoading: true } : t)));
        await sendCommand({
          type: 'browser:navigate',
          sessionId: tab.sessionId,
          url: tab.url,
        });
      }
    } catch (err) {
      console.error('[BrowserApp] Failed to create session:', err);
      createdSessions.current.delete(tab.sessionId);
    }
  }, []);

  // Ensure the active tab has a kernel session.
  useEffect(() => {
    if (kernelConnected && activeTab) {
      createSession(activeTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernelConnected, activeTab?.id]);

  // =========================================================================
  // Screencast frames + screenshot polling
  // =========================================================================

  /** Draw a base64-encoded image onto the canvas. */
  const drawFrame = useCallback((base64: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
  }, []);

  useEffect(() => {
    if (!kernelConnected) return;

    const client = getKernelClient();

    // Listen for kernel-pushed screencast frames.
    receivingScreencastRef.current = false;
    const unsubFrame = client.on('browser:screencast_frame', (data: any) => {
      if (data.sessionId !== activeSessionRef.current) return;
      if (data.frame) {
        drawFrame(data.frame);
        // Stop polling once the kernel is actively pushing frames
        if (!receivingScreencastRef.current) {
          receivingScreencastRef.current = true;
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
        }
      }
    });

    // Listen for navigation events from the kernel.
    const unsubNav = client.on('browser:navigated', (data: any) => {
      setTabs((prev) =>
        prev.map((t) => {
          if (t.sessionId !== data.sessionId) return t;
          return {
            ...t,
            url: data.url || t.url,
            title: data.title || t.title,
            isLoading: false,
          };
        }),
      );
      if (data.sessionId === activeSessionRef.current) {
        setInputUrl(data.url || '');
      }
    });

    // Poll screenshots as a supplement / fallback if the kernel doesn't
    // push screencast frames automatically.
    const poll = async () => {
      if (unmountedRef.current) return;
      const sessionId = activeSessionRef.current;
      if (!sessionId || !createdSessions.current.has(sessionId)) return;

      try {
        const result = await sendCommand({
          type: 'browser:screenshot',
          sessionId,
        });
        if (result?.screenshot && sessionId === activeSessionRef.current) {
          drawFrame(result.screenshot);
        }
      } catch {
        // Ignore transient screenshot failures.
      }
    };

    // Kick off the first screenshot immediately, then poll.
    poll();
    pollTimerRef.current = setInterval(poll, SCREENSHOT_POLL_MS);

    return () => {
      unsubFrame();
      unsubNav();
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [kernelConnected, activeTabId, drawFrame]);

  // =========================================================================
  // Event forwarding (kernel mode)
  // =========================================================================

  /** Map client coordinates on the canvas to the virtual viewport coords.
   *  Uses the viewport container rect for accurate bounds when the canvas
   *  is scaled inside a windowed or iframe context. */
  const scaleCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    // Prefer the viewport container for accurate bounds (handles window chrome offsets)
    const el = viewportRef.current || canvasRef.current;
    if (!el) return { x: clientX, y: clientY };
    const rect = el.getBoundingClientRect();
    const scaleX = VIEWPORT_WIDTH / rect.width;
    const scaleY = VIEWPORT_HEIGHT / rect.height;
    return {
      x: Math.round(Math.max(0, Math.min(VIEWPORT_WIDTH, (clientX - rect.left) * scaleX))),
      y: Math.round(Math.max(0, Math.min(VIEWPORT_HEIGHT, (clientY - rect.top) * scaleY))),
    };
  }, []);

  useEffect(() => {
    if (!kernelConnected) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // --- Mouse click -------------------------------------------------------
    const handleClick = (e: MouseEvent) => {
      const { x, y } = scaleCoords(e.clientX, e.clientY);
      sendInput({
        type: 'browser:click',
        sessionId: activeSessionRef.current,
        x,
        y,
      });
    };

    // --- Mouse move (throttled) --------------------------------------------
    let lastMoveTime = 0;
    const handleMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastMoveTime < 100) return; // 10 Hz throttle
      lastMoveTime = now;
      const { x, y } = scaleCoords(e.clientX, e.clientY);
      sendInput({
        type: 'browser:mousemove',
        sessionId: activeSessionRef.current,
        x,
        y,
      });
    };

    // --- Scroll ------------------------------------------------------------
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      sendInput({
        type: 'browser:scroll',
        sessionId: activeSessionRef.current,
        deltaX: Math.round(e.deltaX),
        deltaY: Math.round(e.deltaY),
      });
    };

    // --- Keyboard ----------------------------------------------------------
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only forward when the canvas is focused (not the URL bar).
      if (document.activeElement !== canvas) return;
      e.preventDefault();

      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Printable character.
        sendInput({
          type: 'browser:type',
          sessionId: activeSessionRef.current,
          text: e.key,
        });
      } else {
        // Special / modifier key.
        sendInput({
          type: 'browser:keypress',
          sessionId: activeSessionRef.current,
          key: e.key,
        });
      }
    };

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('keydown', handleKeyDown);
    };
  }, [kernelConnected, activeTabId, scaleCoords]);

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  useEffect(() => {
    unmountedRef.current = false;

    return () => {
      unmountedRef.current = true;

      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }

      // Destroy every kernel browser session we created.
      const client = getKernelClient();
      if (client.connected) {
        for (const sessionId of createdSessions.current) {
          sendCommand({
            type: 'browser:destroy',
            sessionId,
          }).catch(() => {});
        }
      }
      createdSessions.current.clear();
    };
  }, []);

  // =========================================================================
  // Tab management
  // =========================================================================

  const addTab = useCallback(() => {
    const tab = makeTab(DEFAULT_URL);
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setInputUrl(DEFAULT_URL);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      // Destroy the kernel session for this tab.
      const tab = tabs.find((t) => t.id === tabId);
      if (tab && createdSessions.current.has(tab.sessionId)) {
        sendCommand({
          type: 'browser:destroy',
          sessionId: tab.sessionId,
        }).catch(() => {});
        createdSessions.current.delete(tab.sessionId);
      }

      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);

        // If we just closed the last tab, open a fresh one.
        if (next.length === 0) {
          const fresh = makeTab();
          setActiveTabId(fresh.id);
          setInputUrl(fresh.url);
          return [fresh];
        }

        // If we closed the active tab, activate the nearest sibling.
        if (activeTabId === tabId) {
          const idx = prev.findIndex((t) => t.id === tabId);
          const newActive = next[Math.min(idx, next.length - 1)];
          setActiveTabId(newActive.id);
          setInputUrl(newActive.url);
        }

        return next;
      });
    },
    [tabs, activeTabId],
  );

  const switchTab = useCallback(
    (tabId: string) => {
      setActiveTabId(tabId);
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) setInputUrl(tab.url);
    },
    [tabs],
  );

  // =========================================================================
  // Navigation controls
  // =========================================================================

  const handleNavigate = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      let target = inputUrl.trim();
      if (!target) return;

      if (!target.startsWith('http://') && !target.startsWith('https://')) {
        if (target.includes('.') && !target.includes(' ')) {
          target = `https://${target}`;
        } else {
          target = `https://www.google.com/search?q=${encodeURIComponent(target)}`;
        }
      }

      setInputUrl(target);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTabId ? { ...t, url: target, isLoading: true } : t)),
      );

      if (kernelConnected && activeTab && createdSessions.current.has(activeTab.sessionId)) {
        try {
          await sendCommand({
            type: 'browser:navigate',
            sessionId: activeTab.sessionId,
            url: target,
          });
        } catch (err) {
          console.error('[BrowserApp] Navigation failed:', err);
        }
        setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: false } : t)));
      }
    },
    [inputUrl, activeTabId, kernelConnected, activeTab],
  );

  const handleBack = useCallback(async () => {
    if (!kernelConnected || !activeTab) return;
    try {
      await sendCommand({
        type: 'browser:back',
        sessionId: activeTab.sessionId,
      });
    } catch {}
  }, [kernelConnected, activeTab]);

  const handleForward = useCallback(async () => {
    if (!kernelConnected || !activeTab) return;
    try {
      await sendCommand({
        type: 'browser:forward',
        sessionId: activeTab.sessionId,
      });
    } catch {}
  }, [kernelConnected, activeTab]);

  const handleReload = useCallback(async () => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: true } : t)));

    if (kernelConnected && activeTab && createdSessions.current.has(activeTab.sessionId)) {
      try {
        await sendCommand({
          type: 'browser:reload',
          sessionId: activeTab.sessionId,
        });
      } catch {}
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: false } : t)));
    } else {
      // Iframe fallback: re-trigger by briefly clearing and restoring URL.
      const currentUrl = activeTab?.url ?? '';
      setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, url: '' } : t)));
      setTimeout(() => {
        setTabs((prev) =>
          prev.map((t) => (t.id === activeTabId ? { ...t, url: currentUrl, isLoading: true } : t)),
        );
      }, 50);
    }
  }, [kernelConnected, activeTab, activeTabId]);

  // =========================================================================
  // Iframe fallback handlers
  // =========================================================================

  const handleIframeLoad = useCallback(() => {
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, isLoading: false } : t)));
  }, [activeTabId]);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="flex flex-col h-full bg-[#1a1d26] select-none">
      {/* ================================================================= */}
      {/* Tab bar                                                           */}
      {/* ================================================================= */}
      <div className="flex items-center bg-[#12141c] border-b border-white/5 h-9 shrink-0 overflow-x-auto">
        <div className="flex items-center min-w-0 flex-1 gap-px px-1">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`group flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 rounded-t-lg cursor-pointer min-w-[100px] max-w-[200px] text-[11px] transition-colors ${
                tab.id === activeTabId
                  ? 'bg-[#1a1d26] text-white'
                  : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'
              }`}
            >
              {tab.isLoading ? (
                <Loader2 size={12} className="animate-spin text-blue-400 shrink-0" />
              ) : (
                <Globe size={12} className="shrink-0 text-gray-500" />
              )}
              <span className="truncate flex-1 select-none">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-white/10 transition-all shrink-0"
                title="Close tab"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          {/* New-tab button */}
          <button
            onClick={addTab}
            className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded transition-colors shrink-0 ml-0.5"
            title="New Tab"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Mode indicator */}
        <div className="flex items-center gap-1.5 px-2 shrink-0">
          {isKernelMode ? (
            <div className="flex items-center gap-1 text-[9px] font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">
              <Monitor size={9} />
              <span>Kernel mode</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <Globe size={9} />
              <span>Iframe mode</span>
            </div>
          )}
        </div>
      </div>

      {/* ================================================================= */}
      {/* Navigation chrome                                                 */}
      {/* ================================================================= */}
      <div className="h-10 bg-[#1a1d26] border-b border-white/5 flex items-center px-2 gap-2 shrink-0">
        {/* Back / Forward / Reload */}
        <div className="flex gap-0.5 text-gray-400">
          <button
            onClick={handleBack}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
            disabled={!isKernelMode}
            title="Back"
          >
            <ArrowLeft size={16} />
          </button>
          <button
            onClick={handleForward}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
            disabled={!isKernelMode}
            title="Forward"
          >
            <ArrowRight size={16} />
          </button>
          <button
            onClick={handleReload}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
            title="Reload"
          >
            <RotateCw size={14} className={activeTab?.isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleNavigate} className="flex-1 relative group">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">
            <Lock size={12} />
          </div>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            className="w-full bg-[#12141c] hover:bg-[#1e2130] focus:bg-[#0f111a] border border-white/5 focus:border-blue-500/50 rounded-full pl-8 pr-8 py-1.5 text-sm outline-none transition-all text-gray-300 text-center focus:text-left focus:ring-2 focus:ring-blue-500/20"
            placeholder="Search or enter URL"
            spellCheck={false}
            autoComplete="off"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
            <Star size={12} />
          </div>
        </form>
      </div>

      {/* ================================================================= */}
      {/* Loading progress bar                                              */}
      {/* ================================================================= */}
      {activeTab?.isLoading && (
        <div className="h-0.5 bg-[#1a1d26] shrink-0 overflow-hidden">
          <div
            className="h-full bg-blue-500 rounded-r-full transition-all"
            style={{
              width: '70%',
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          />
        </div>
      )}

      {/* ================================================================= */}
      {/* Viewport                                                          */}
      {/* ================================================================= */}
      <div ref={viewportRef} className="flex-1 relative bg-[#0a0b12] overflow-hidden">
        {isKernelMode ? (
          /* ----- Kernel mode: canvas-based viewport ----- */
          <>
            <canvas
              ref={canvasRef}
              className="w-full h-full object-contain"
              tabIndex={0}
              style={{ imageRendering: 'auto', outline: 'none' }}
            />

            {/* Loading overlay */}
            {activeTab?.isLoading && (
              <div className="absolute inset-0 bg-[#1a1d26]/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <span className="text-gray-400 text-sm">Loading...</span>
              </div>
            )}

            {/* Hint when canvas has no content yet */}
            {!activeTab?.isLoading && !canvasRef.current?.width && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-2 pointer-events-none">
                <Monitor size={32} />
                <span className="text-xs">Waiting for browser session...</span>
              </div>
            )}
          </>
        ) : (
          /* ----- Iframe fallback mode ----- */
          <>
            {activeTab?.url && (
              <iframe
                key={activeTab.id}
                src={activeTab.url}
                className="w-full h-full border-none"
                title="Browser"
                onLoad={handleIframeLoad}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              />
            )}

            {/* Loading overlay */}
            {activeTab?.isLoading && (
              <div className="absolute inset-0 bg-[#1a1d26] flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
                <span className="text-gray-400 text-sm">Loading...</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
