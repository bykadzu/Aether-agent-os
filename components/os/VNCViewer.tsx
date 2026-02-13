import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Monitor, Loader2, AlertCircle, RefreshCw, Settings } from 'lucide-react';

type QualityPreset = 'low' | 'medium' | 'high';

const QUALITY_PRESETS: Record<QualityPreset, { quality: number; compression: number }> = {
  low: { quality: 2, compression: 9 },
  medium: { quality: 5, compression: 5 },
  high: { quality: 9, compression: 0 },
};

interface VNCViewerProps {
  wsUrl: string;
  width?: number;
  height?: number;
  scale?: number;
  viewOnly?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onResize?: (width: number, height: number) => void;
}

export interface VNCViewerHandle {
  sendCtrlAltDel: () => void;
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
export const VNCViewer = forwardRef<VNCViewerHandle, VNCViewerProps>(
  (
    { wsUrl, width, height, scale = 1, viewOnly = true, onConnect, onDisconnect, onResize },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rfbRef = useRef<any>(null);
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>(
      'connecting',
    );
    const [errorMsg, setErrorMsg] = useState('');
    const [quality, setQuality] = useState<QualityPreset>('medium');
    const [showQualityMenu, setShowQualityMenu] = useState(false);

    // Expose sendCtrlAltDel via ref
    useImperativeHandle(
      ref,
      () => ({
        sendCtrlAltDel: () => {
          if (rfbRef.current) {
            rfbRef.current.sendCtrlAltDel();
          }
        },
      }),
      [],
    );

    // Apply quality settings when quality or rfb changes
    const applyQuality = useCallback((preset: QualityPreset) => {
      const rfb = rfbRef.current;
      if (!rfb) return;
      const settings = QUALITY_PRESETS[preset];
      rfb.qualityLevel = settings.quality;
      rfb.compressionLevel = settings.compression;
    }, []);

    useEffect(() => {
      if (!containerRef.current || !wsUrl) return;

      setStatus('connecting');
      setErrorMsg('');

      let rfb: any = null;
      let destroyed = false;

      const initRFB = async () => {
        try {
          // Load noVNC RFB class from vendored ESM source (vendor/novnc/).
          // The npm package (@novnc/novnc) ships CJS with top-level await which
          // is incompatible with esbuild, so we vendor the original ESM source.
          // @ts-ignore - dynamic import of vendored ESM module
          const noVNC = await import(/* @vite-ignore */ '../../vendor/novnc/core/rfb.js').catch(
            () => null,
          );

          if (destroyed) return;

          if ((noVNC?.default || noVNC) && containerRef.current) {
            const RFB = noVNC.default || noVNC;
            rfb = new RFB(containerRef.current, wsUrl, {
              scaleViewport: true,
              resizeSession: false,
              showDotCursor: !viewOnly,
            });
            rfb.viewOnly = viewOnly;

            // Apply initial quality preset
            const settings = QUALITY_PRESETS[quality];
            rfb.qualityLevel = settings.quality;
            rfb.compressionLevel = settings.compression;

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

            // Clipboard sync: remote -> local
            rfb.addEventListener('clipboard', (e: any) => {
              const text = e.detail?.text;
              if (text && navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(text).catch(() => {
                  // Clipboard write may fail without user gesture or permissions
                });
              }
            });

            rfbRef.current = rfb;

            // Clipboard sync: local -> remote
            const handleLocalCopy = () => {
              if (navigator.clipboard?.readText) {
                navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (text && rfbRef.current) {
                      rfbRef.current.clipboardPasteFrom(text);
                    }
                  })
                  .catch(() => {
                    // Clipboard read may fail without permissions
                  });
              }
            };
            document.addEventListener('copy', handleLocalCopy);

            // Store cleanup ref for the copy listener
            (rfb as any).__cleanupCopyListener = () => {
              document.removeEventListener('copy', handleLocalCopy);
            };
          } else {
            // noVNC not available
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
          try {
            (rfb as any).__cleanupCopyListener?.();
            rfb.disconnect();
          } catch {}
        }
        rfbRef.current = null;
      };
    }, [wsUrl]);

    // Toggle viewOnly on the live RFB instance when prop changes
    useEffect(() => {
      const rfb = rfbRef.current;
      if (!rfb) return;
      rfb.viewOnly = viewOnly;
      rfb.showDotCursor = !viewOnly;
    }, [viewOnly]);

    // Handle resize with ResizeObserver and debounce
    useEffect(() => {
      if (!containerRef.current) return;

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;

      const observer = new ResizeObserver((entries) => {
        // Scale viewport when connected
        if (rfbRef.current?.scaleViewport !== undefined) {
          rfbRef.current.scaleViewport = true;
        }

        // Debounced resize callback
        if (onResize) {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const entry = entries[0];
            if (entry) {
              const { width: w, height: h } = entry.contentRect;
              onResize(Math.round(w), Math.round(h));
            }
          }, 500);
        }
      });

      observer.observe(containerRef.current);
      return () => {
        observer.disconnect();
        if (debounceTimer) clearTimeout(debounceTimer);
      };
    }, [status, onResize]);

    const handleReconnect = () => {
      // Force re-mount by toggling status
      setStatus('connecting');
      setErrorMsg('');
      // The useEffect will re-initialize
    };

    const handleQualityChange = (preset: QualityPreset) => {
      setQuality(preset);
      applyQuality(preset);
      setShowQualityMenu(false);
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

        {/* Connected indicator + quality selector */}
        {status === 'connected' && (
          <div className="absolute top-2 right-2 flex items-center gap-1.5 z-10">
            {/* Quality selector */}
            <div className="relative">
              <button
                onClick={() => setShowQualityMenu(!showQualityMenu)}
                className="flex items-center gap-1 px-2 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[9px] text-white/60 hover:text-white/90 border border-white/10 transition-colors"
              >
                <Settings size={10} />
                {quality.charAt(0).toUpperCase() + quality.slice(1)}
              </button>
              {showQualityMenu && (
                <div className="absolute top-full right-0 mt-1 bg-black/80 backdrop-blur-md border border-white/10 rounded-lg overflow-hidden min-w-[80px]">
                  {(['low', 'medium', 'high'] as QualityPreset[]).map((preset) => (
                    <button
                      key={preset}
                      onClick={() => handleQualityChange(preset)}
                      className={`block w-full text-left px-3 py-1.5 text-[10px] transition-colors ${
                        quality === preset
                          ? 'bg-indigo-600 text-white'
                          : 'text-white/60 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {preset.charAt(0).toUpperCase() + preset.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Live indicator */}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-black/50 backdrop-blur-sm rounded text-[9px] text-green-400 border border-green-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              VNC Live
            </div>
          </div>
        )}
      </div>
    );
  },
);

VNCViewer.displayName = 'VNCViewer';
