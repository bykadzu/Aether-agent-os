import React, { useRef, useEffect, useState } from 'react';
import { Monitor, Loader2, AlertCircle, RefreshCw } from 'lucide-react';

interface VNCViewerProps {
  wsUrl: string;
  width?: number;
  height?: number;
  scale?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

/**
 * VNCViewer - Renders a remote VNC desktop using a canvas-based RFB client.
 *
 * Connects to a VNC WebSocket proxy (created by VNCManager) and renders
 * the remote framebuffer. Uses the noVNC RFB class when available, falling
 * back to a placeholder when the library isn't loaded.
 *
 * The noVNC library is loaded dynamically from node_modules or CDN.
 */
export const VNCViewer: React.FC<VNCViewerProps> = ({
  wsUrl,
  width,
  height,
  scale = 1,
  onConnect,
  onDisconnect,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<any>(null);
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!containerRef.current || !wsUrl) return;

    setStatus('connecting');
    setErrorMsg('');

    let rfb: any = null;
    let destroyed = false;

    const initRFB = async () => {
      try {
        // Attempt to load noVNC's RFB class
        // @ts-ignore - dynamic import of noVNC
        const noVNC = await import('@novnc/novnc/core/rfb.js').catch(() => null);

        if (destroyed) return;

        if (noVNC?.default && containerRef.current) {
          const RFB = noVNC.default;
          rfb = new RFB(containerRef.current, wsUrl, {
            scaleViewport: true,
            resizeSession: false,
            showDotCursor: true,
          });

          rfb.addEventListener('connect', () => {
            if (!destroyed) {
              setStatus('connected');
              onConnect?.();
            }
          });

          rfb.addEventListener('disconnect', (e: any) => {
            if (!destroyed) {
              setStatus('disconnected');
              onDisconnect?.();
              if (!e.detail.clean) {
                setErrorMsg('Connection lost unexpectedly');
              }
            }
          });

          rfb.addEventListener('securityfailure', (e: any) => {
            if (!destroyed) {
              setStatus('error');
              setErrorMsg(`Security error: ${e.detail.reason || 'unknown'}`);
            }
          });

          rfbRef.current = rfb;
        } else {
          // noVNC not available — use canvas-based raw VNC fallback
          // For now, show a status indicator that VNC is available but
          // the viewer library needs to be installed
          setStatus('error');
          setErrorMsg('noVNC library not loaded. Install with: npm install @novnc/novnc');
        }
      } catch (err: any) {
        if (!destroyed) {
          setStatus('error');
          setErrorMsg(err.message || 'Failed to initialize VNC viewer');
        }
      }
    };

    initRFB();

    return () => {
      destroyed = true;
      if (rfb) {
        try { rfb.disconnect(); } catch {}
      }
      rfbRef.current = null;
    };
  }, [wsUrl]);

  // Handle resize
  useEffect(() => {
    if (!containerRef.current || !rfbRef.current) return;

    const observer = new ResizeObserver(() => {
      if (rfbRef.current?.scaleViewport !== undefined) {
        rfbRef.current.scaleViewport = true;
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [status]);

  const handleReconnect = () => {
    // Force re-mount by toggling status
    setStatus('connecting');
    setErrorMsg('');
    // The useEffect will re-initialize
  };

  return (
    <div
      className="relative w-full h-full border border-white/10 rounded-lg overflow-hidden bg-black"
      style={{
        width: width ? `${width}px` : '100%',
        height: height ? `${height}px` : '100%',
        transform: scale !== 1 ? `scale(${scale})` : undefined,
        transformOrigin: 'top left',
      }}
    >
      {/* VNC Canvas Container */}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ display: status === 'connected' ? 'block' : 'none' }}
      />

      {/* Loading State */}
      {status === 'connecting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90">
          <Loader2 size={24} className="text-indigo-400 animate-spin" />
          <span className="text-xs text-white/60">Connecting to desktop...</span>
          <span className="text-[10px] text-white/30 font-mono">{wsUrl}</span>
        </div>
      )}

      {/* Error State */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
          <AlertCircle size={24} className="text-red-400" />
          <span className="text-xs text-red-300 text-center">{errorMsg}</span>
          <button
            onClick={handleReconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/10"
          >
            <RefreshCw size={10} />
            Retry
          </button>
        </div>
      )}

      {/* Disconnected State */}
      {status === 'disconnected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90">
          <Monitor size={24} className="text-gray-500" />
          <span className="text-xs text-white/40">Desktop disconnected</span>
          <button
            onClick={handleReconnect}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/10"
          >
            <RefreshCw size={10} />
            Reconnect
          </button>
        </div>
      )}

      {/* Connected indicator */}
      {status === 'connected' && (
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[9px] text-green-400 border border-green-500/20 z-10">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          VNC Live
        </div>
      )}
    </div>
  );
};
