import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Monitor,
  Globe,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Lock,
  Maximize2,
  Minimize2,
  Code,
} from 'lucide-react';
import { Agent } from '../../types';
import { VNCViewer, VNCViewerHandle } from './VNCViewer';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentDesktopViewProps {
  agent: Agent;
  kernelConnected: boolean;
}

type ViewMode = 'vnc' | 'screencast' | 'mock';
type BadgeState = 'watching' | 'controlling' | 'agent_active';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function genId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sendInput(cmd: Record<string, unknown>): void {
  const withId = { ...cmd, id: genId() };
  const client = getKernelClient();
  (client as any).send(withId);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ state }: { state: BadgeState }) {
  switch (state) {
    case 'agent_active':
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/20 backdrop-blur-sm rounded-md text-[10px] font-bold text-green-400 border border-green-500/30">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          AGENT ACTIVE
        </div>
      );
    case 'controlling':
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-blue-500/20 backdrop-blur-sm rounded-md text-[10px] font-bold text-blue-400 border border-blue-500/30 animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          CONTROLLING
        </div>
      );
    case 'watching':
    default:
      return (
        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-500/20 backdrop-blur-sm rounded-md text-[10px] font-bold text-gray-400 border border-white/10">
          <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
          WATCHING
        </div>
      );
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const AgentDesktopView: React.FC<AgentDesktopViewProps> = ({ agent, kernelConnected }) => {
  const vncRef = useRef<VNCViewerHandle>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControlToast, setShowControlToast] = useState(false);
  const prevStatusRef = useRef(agent.status);

  // Determine view mode
  const viewMode: ViewMode = agent.vncWsUrl
    ? 'vnc'
    : kernelConnected && agent.pid
      ? 'screencast'
      : 'mock';

  // Determine if user is in control (agent paused/idle)
  const isAgentRunning = ['working', 'thinking'].includes(agent.status);
  const isUserControlling = agent.status === 'paused' || agent.status === 'idle';

  const badgeState: BadgeState = isUserControlling
    ? 'controlling'
    : isAgentRunning
      ? 'agent_active'
      : 'watching';

  // Show "You have control" toast when transitioning to control
  useEffect(() => {
    const wasBusy = ['working', 'thinking'].includes(prevStatusRef.current);
    const nowControlling = agent.status === 'paused' || agent.status === 'idle';
    if (wasBusy && nowControlling) {
      setShowControlToast(true);
      const timer = setTimeout(() => setShowControlToast(false), 2000);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = agent.status;
  }, [agent.status]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // --- Screencast mode: subscribe to kernel frames ---
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
    if (viewMode !== 'screencast' || !kernelConnected) return;
    const client = getKernelClient();

    const unsubFrame = client.on('browser:screencast_frame', (data: any) => {
      if (data.pid === agent.pid || data.agentPid === agent.pid) {
        if (data.frame) drawFrame(data.frame);
      }
    });

    return () => {
      unsubFrame();
    };
  }, [viewMode, kernelConnected, agent.pid, drawFrame]);

  // Screencast input forwarding (when user has control)
  useEffect(() => {
    if (viewMode !== 'screencast' || !isUserControlling) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const scaleCoords = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = VIEWPORT_WIDTH / rect.width;
      const scaleY = VIEWPORT_HEIGHT / rect.height;
      return {
        x: Math.round(Math.max(0, Math.min(VIEWPORT_WIDTH, (clientX - rect.left) * scaleX))),
        y: Math.round(Math.max(0, Math.min(VIEWPORT_HEIGHT, (clientY - rect.top) * scaleY))),
      };
    };

    const handleClick = (e: MouseEvent) => {
      const { x, y } = scaleCoords(e.clientX, e.clientY);
      sendInput({ type: 'browser:click', pid: agent.pid, x, y });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement !== canvas) return;
      e.preventDefault();
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        sendInput({ type: 'browser:type', pid: agent.pid, text: e.key });
      } else {
        sendInput({ type: 'browser:keypress', pid: agent.pid, key: e.key });
      }
    };

    canvas.addEventListener('click', handleClick);
    canvas.addEventListener('keydown', handleKeyDown);
    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.removeEventListener('keydown', handleKeyDown);
    };
  }, [viewMode, isUserControlling, agent.pid]);

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div ref={viewportRef} className="relative w-full h-full bg-[#0a0b10] overflow-hidden">
      {/* === Status Badge (top-left) === */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <StatusBadge state={badgeState} />
      </div>

      {/* === Fullscreen + Ctrl+Alt+Del (top-right) === */}
      <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        {viewMode === 'vnc' && isUserControlling && (
          <button
            onClick={() => vncRef.current?.sendCtrlAltDel()}
            className="px-2 py-1 bg-black/50 backdrop-blur-sm rounded text-[9px] text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
          >
            Ctrl+Alt+Del
          </button>
        )}
        <button
          onClick={toggleFullscreen}
          className="p-1.5 bg-black/50 backdrop-blur-sm rounded text-gray-400 border border-white/10 hover:bg-white/10 transition-colors"
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>
      </div>

      {/* === "You have control" Toast === */}
      {showControlToast && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none">
          <div className="bg-blue-600/90 backdrop-blur-md text-white px-6 py-3 rounded-xl text-sm font-medium shadow-2xl animate-pulse">
            You have control
          </div>
        </div>
      )}

      {/* === Priority 1: VNC Desktop === */}
      {viewMode === 'vnc' && agent.vncWsUrl && (
        <VNCViewer ref={vncRef} wsUrl={agent.vncWsUrl} viewOnly={!isUserControlling} />
      )}

      {/* === Priority 2: Browser Screencast === */}
      {viewMode === 'screencast' && (
        <div className="w-full h-full flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain"
            tabIndex={0}
            style={{ imageRendering: 'auto', outline: 'none' }}
          />
          {/* Placeholder when no frames received yet */}
          {!canvasRef.current?.width && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-600 gap-2 pointer-events-none">
              <Monitor size={32} />
              <span className="text-xs">Waiting for browser session...</span>
            </div>
          )}
        </div>
      )}

      {/* === Priority 3: Mock Browser View === */}
      {viewMode === 'mock' && (
        <MockBrowserView agent={agent} isUserControlling={isUserControlling} />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Mock Browser View (sub-component)
// ---------------------------------------------------------------------------

interface MockBrowserViewProps {
  agent: Agent;
  isUserControlling: boolean;
}

const MockBrowserView: React.FC<MockBrowserViewProps> = ({ agent, isUserControlling }) => {
  const [inputUrl, setInputUrl] = useState(agent.currentUrl || '');
  const [displayUrl, setDisplayUrl] = useState(agent.currentUrl || '');
  const [showCode, setShowCode] = useState(false);

  // Sync URL when agent browses
  useEffect(() => {
    if (agent.currentUrl) {
      setInputUrl(agent.currentUrl);
      setDisplayUrl(agent.currentUrl);
    }
  }, [agent.currentUrl]);

  const handleNavigate = (e: React.FormEvent) => {
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
    setDisplayUrl(target);
    setInputUrl(target);
  };

  const isAgentBusy = ['working', 'thinking'].includes(agent.status);

  return (
    <div className="flex flex-col h-full bg-[#1a1d26]">
      {/* Browser Chrome */}
      <div className="h-10 bg-[#12141c] border-b border-white/5 flex items-center px-2 gap-2 shrink-0">
        {/* Nav buttons */}
        <div className="flex gap-0.5 text-gray-400">
          <button
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
            disabled={!isUserControlling}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <button
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30"
            disabled={!isUserControlling}
            title="Forward"
          >
            <ArrowRight size={14} />
          </button>
          <button className="p-1.5 hover:bg-white/10 rounded-full transition-colors" title="Reload">
            <RotateCw size={12} />
          </button>
        </div>

        {/* URL bar */}
        <form onSubmit={handleNavigate} className="flex-1 relative">
          <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500">
            <Lock size={10} />
          </div>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            readOnly={!isUserControlling}
            className="w-full bg-[#0a0b12] border border-white/5 focus:border-blue-500/50 rounded-full pl-7 pr-3 py-1 text-[11px] outline-none transition-all text-gray-300 text-center focus:text-left"
            placeholder="Enter URL..."
            spellCheck={false}
          />
        </form>

        {/* Code toggle */}
        {agent.currentCode && (
          <button
            onClick={() => setShowCode(!showCode)}
            className={`p-1.5 rounded transition-colors ${showCode ? 'text-blue-400 bg-blue-500/20' : 'text-gray-500 hover:text-white hover:bg-white/10'}`}
            title="Toggle code view"
          >
            <Code size={14} />
          </button>
        )}

        {/* Mode badge */}
        <div className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20 shrink-0">
          <Globe size={9} />
          Mock
        </div>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative overflow-hidden">
        {showCode && agent.currentCode ? (
          /* Code preview panel */
          <div className="h-full overflow-auto bg-[#0d0e14] p-4">
            <pre className="text-[11px] leading-relaxed text-gray-300 font-mono whitespace-pre-wrap break-all">
              {agent.currentCode}
            </pre>
          </div>
        ) : displayUrl ? (
          /* Iframe browser view */
          <>
            <iframe
              key={displayUrl}
              src={displayUrl}
              className="w-full h-full border-none"
              title="Agent Browser"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              style={{ pointerEvents: isUserControlling ? 'auto' : 'none' }}
            />
            {/* Agent working overlay */}
            {isAgentBusy && (
              <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                <div className="bg-black/70 backdrop-blur-md px-4 py-2 rounded-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[11px] text-gray-300">Agent is browsing...</span>
                </div>
              </div>
            )}
          </>
        ) : (
          /* Idle desktop placeholder */
          <div className="h-full flex flex-col items-center justify-center text-gray-600 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center">
              <Monitor size={28} className="opacity-40" />
            </div>
            <div className="text-center">
              <div className="text-sm text-gray-400 font-medium">{agent.name || agent.role}</div>
              <div className="text-[11px] text-gray-600 mt-1 max-w-xs">{agent.goal}</div>
              <div className="text-[10px] text-gray-700 mt-2 uppercase tracking-wider">
                {agent.status}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
