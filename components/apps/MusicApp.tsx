import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX,
  Shuffle, Repeat, Music, Folder, X, List,
  ChevronRight, ChevronDown, RefreshCw
} from 'lucide-react';
import { getKernelClient, KernelFileStat } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AudioTrack {
  name: string;
  path: string;
  displayName: string;
}

interface DirNode {
  name: string;
  path: string;
  children: DirNode[];
  files: AudioTrack[];
  expanded: boolean;
  loaded: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac', '.m4a'];
const BASE_URL = 'http://localhost:3001';

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function stripExtension(name: string): string {
  const lastDot = name.lastIndexOf('.');
  return lastDot > 0 ? name.substring(0, lastDot) : name;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildAudioUrl(filePath: string): string {
  const token = localStorage.getItem('aether_token') || '';
  return `${BASE_URL}/api/fs/raw?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Visualizer Component (Canvas-based frequency bars)
// ---------------------------------------------------------------------------

const Visualizer: React.FC<{
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}> = ({ analyser, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      if (!analyser) {
        // Draw idle bars
        const barCount = 48;
        const barWidth = w / barCount - 2;
        for (let i = 0; i < barCount; i++) {
          const barHeight = 4 + Math.sin(Date.now() / 600 + i * 0.3) * 3;
          const x = i * (barWidth + 2);
          const gradient = ctx.createLinearGradient(x, h, x, h - barHeight);
          gradient.addColorStop(0, 'rgba(139, 92, 246, 0.3)');
          gradient.addColorStop(1, 'rgba(59, 130, 246, 0.15)');
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.roundRect(x, h - barHeight, barWidth, barHeight, 2);
          ctx.fill();
        }
        return;
      }

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      const barCount = 64;
      const step = Math.floor(bufferLength / barCount);
      const barWidth = w / barCount - 2;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step] || 0;
        const barHeight = (value / 255) * h * 0.85 + 2;
        const x = i * (barWidth + 2);

        const gradient = ctx.createLinearGradient(x, h, x, h - barHeight);
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.9)');
        gradient.addColorStop(0.5, 'rgba(99, 102, 241, 0.7)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.5)');

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x, h - barHeight, barWidth, barHeight, 2);
        ctx.fill();
      }
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={384}
      height={120}
      className="w-full max-w-[384px] h-[120px] opacity-80"
    />
  );
};

// ---------------------------------------------------------------------------
// File Tree Item Component
// ---------------------------------------------------------------------------

const TreeItem: React.FC<{
  node: DirNode;
  onToggle: (path: string) => void;
  onFileClick: (track: AudioTrack) => void;
  depth: number;
}> = ({ node, onToggle, onFileClick, depth }) => {
  return (
    <div>
      <button
        onClick={() => onToggle(node.path)}
        className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-300 hover:bg-white/5 rounded transition-colors"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {node.expanded ? (
          <ChevronDown size={12} className="text-gray-500 shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-gray-500 shrink-0" />
        )}
        <Folder size={13} className="text-violet-400/70 shrink-0" />
        <span className="truncate">{node.name}</span>
      </button>

      {node.expanded && (
        <>
          {node.children.map(child => (
            <TreeItem
              key={child.path}
              node={child}
              onToggle={onToggle}
              onFileClick={onFileClick}
              depth={depth + 1}
            />
          ))}
          {node.files.map(file => (
            <button
              key={file.path}
              onClick={() => onFileClick(file)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:bg-white/5 hover:text-gray-200 rounded transition-colors"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
            >
              <Music size={12} className="text-pink-400/60 shrink-0" />
              <span className="truncate">{file.displayName}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MusicApp Component
// ---------------------------------------------------------------------------

export const MusicApp: React.FC = () => {
  // ---- Kernel / connection state ----
  const [useKernel, setUseKernel] = useState(false);

  // ---- File browser state ----
  const [tree, setTree] = useState<DirNode[]>([]);
  const [loadingDir, setLoadingDir] = useState(false);

  // ---- Queue state ----
  const [queue, setQueue] = useState<AudioTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);

  // ---- Playback state ----
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);

  // ---- Visualizer state ----
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // ---- Mock mode state ----
  const [mockPlaying, setMockPlaying] = useState(false);

  // ---- Refs ----
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserNodeRef = useRef<AnalyserNode | null>(null);
  const mockOscRef = useRef<OscillatorNode | null>(null);
  const mockGainRef = useRef<GainNode | null>(null);

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length
    ? queue[currentIndex]
    : null;

  // ---- Check kernel connection ----
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
    }
  }, []);

  // ---- Load root tree on kernel connect ----
  useEffect(() => {
    if (useKernel) {
      loadRootTree();
    }
  }, [useKernel]);

  // ---- Connect audio element to Web Audio API for visualization ----
  const ensureAudioContext = useCallback(() => {
    if (audioCtxRef.current) return;
    const audio = audioRef.current;
    if (!audio) return;

    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.8;

      source.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      audioCtxRef.current = ctx;
      sourceNodeRef.current = source;
      analyserNodeRef.current = analyserNode;
      setAnalyser(analyserNode);
    } catch (err) {
      console.error('[MusicApp] AudioContext setup failed:', err);
    }
  }, []);

  // ---- Cleanup on unmount ----
  useEffect(() => {
    return () => {
      stopMockTone();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  // ---- Sync volume changes to audio element ----
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  // ---------------------------------------------------------------------------
  // File browser helpers
  // ---------------------------------------------------------------------------

  const loadRootTree = async () => {
    const client = getKernelClient();
    if (!client.connected) return;
    setLoadingDir(true);
    try {
      const entries = await client.listDir('/home');
      const rootNode = buildDirNode('/home', 'home', entries);
      rootNode.expanded = true;
      rootNode.loaded = true;
      setTree([rootNode]);
    } catch (err) {
      console.error('[MusicApp] Failed to load /home:', err);
    } finally {
      setLoadingDir(false);
    }
  };

  const buildDirNode = (path: string, name: string, entries: KernelFileStat[]): DirNode => {
    const dirs = entries
      .filter(e => e.type === 'directory' && !e.isHidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => ({
        name: e.name,
        path: e.path,
        children: [],
        files: [],
        expanded: false,
        loaded: false,
      }));

    const audioFiles = entries
      .filter(e => e.type === 'file' && isAudioFile(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(e => ({
        name: e.name,
        path: e.path,
        displayName: stripExtension(e.name),
      }));

    return {
      name,
      path,
      children: dirs,
      files: audioFiles,
      expanded: false,
      loaded: true,
    };
  };

  const toggleDir = useCallback(async (dirPath: string) => {
    const toggle = async (nodes: DirNode[]): Promise<DirNode[]> => {
      const result: DirNode[] = [];
      for (const node of nodes) {
        if (node.path === dirPath) {
          if (!node.loaded) {
            // Load directory contents from kernel
            try {
              const client = getKernelClient();
              const entries = await client.listDir(dirPath);
              const loaded = buildDirNode(dirPath, node.name, entries);
              loaded.expanded = true;
              loaded.loaded = true;
              result.push(loaded);
            } catch {
              result.push({ ...node, expanded: !node.expanded });
            }
          } else {
            result.push({ ...node, expanded: !node.expanded });
          }
        } else {
          const updatedChildren = await toggle(node.children);
          result.push({ ...node, children: updatedChildren });
        }
      }
      return result;
    };

    setTree(prev => {
      // We need to handle the async update
      toggle(prev).then(setTree);
      return prev;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Queue management
  // ---------------------------------------------------------------------------

  const addToQueueAndPlay = useCallback((track: AudioTrack) => {
    setQueue(prev => {
      const exists = prev.findIndex(t => t.path === track.path);
      if (exists >= 0) {
        // Already in queue, just jump to it
        setCurrentIndex(exists);
        return prev;
      }
      const newQueue = [...prev, track];
      setCurrentIndex(newQueue.length - 1);
      return newQueue;
    });
  }, []);

  const removeFromQueue = useCallback((index: number) => {
    setQueue(prev => {
      const newQueue = [...prev];
      newQueue.splice(index, 1);

      if (index === currentIndex) {
        // Removing current track
        if (newQueue.length === 0) {
          setCurrentIndex(-1);
          setIsPlaying(false);
        } else {
          setCurrentIndex(Math.min(index, newQueue.length - 1));
        }
      } else if (index < currentIndex) {
        setCurrentIndex(ci => ci - 1);
      }

      return newQueue;
    });
  }, [currentIndex]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
    setIsPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  }, []);

  const jumpToTrack = useCallback((index: number) => {
    setCurrentIndex(index);
  }, []);

  // ---------------------------------------------------------------------------
  // Playback controls
  // ---------------------------------------------------------------------------

  // Load track into audio element when currentIndex changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!currentTrack) {
      audio.src = '';
      setIsPlaying(false);
      return;
    }

    const url = buildAudioUrl(currentTrack.path);
    audio.src = url;
    audio.load();

    // Resume AudioContext if suspended (browser autoplay policy)
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    audio.play()
      .then(() => setIsPlaying(true))
      .catch(() => setIsPlaying(false));
  }, [currentIndex, currentTrack?.path]);

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    ensureAudioContext();

    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }

    if (audio.paused) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      audio.pause();
      setIsPlaying(false);
    }
  }, [currentTrack, ensureAudioContext]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;

    if (shuffleOn) {
      const next = Math.floor(Math.random() * queue.length);
      setCurrentIndex(next);
    } else if (currentIndex < queue.length - 1) {
      setCurrentIndex(currentIndex + 1);
    } else if (repeatOn) {
      setCurrentIndex(0);
    }
  }, [queue.length, currentIndex, shuffleOn, repeatOn]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    const audio = audioRef.current;

    // If more than 3s into track, restart it
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }

    if (shuffleOn) {
      const prev = Math.floor(Math.random() * queue.length);
      setCurrentIndex(prev);
    } else if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    } else if (repeatOn) {
      setCurrentIndex(queue.length - 1);
    }
  }, [queue.length, currentIndex, shuffleOn, repeatOn]);

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;
    const val = parseFloat(e.target.value);
    audio.currentTime = val;
    setCurrentTime(val);
  }, []);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setMuted(val === 0);
  }, []);

  // ---- Audio element event handlers ----
  const onTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const onLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      ensureAudioContext();
    }
  }, [ensureAudioContext]);

  const onEnded = useCallback(() => {
    setIsPlaying(false);
    if (repeatOn && queue.length === 1) {
      // Repeat single track
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    } else {
      playNext();
    }
  }, [repeatOn, queue.length, playNext]);

  // ---------------------------------------------------------------------------
  // Mock mode (demo sine wave)
  // ---------------------------------------------------------------------------

  const startMockTone = useCallback(() => {
    if (mockOscRef.current) return;

    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.8;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);

      osc.connect(gain);
      gain.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      osc.start();

      mockOscRef.current = osc;
      mockGainRef.current = gain;
      audioCtxRef.current = ctx;
      analyserNodeRef.current = analyserNode;
      setAnalyser(analyserNode);
      setMockPlaying(true);
    } catch (err) {
      console.error('[MusicApp] Mock tone failed:', err);
    }
  }, []);

  const stopMockTone = useCallback(() => {
    if (mockOscRef.current) {
      try { mockOscRef.current.stop(); } catch {}
      mockOscRef.current = null;
    }
    if (mockGainRef.current) {
      mockGainRef.current = null;
    }
    // Don't close the AudioContext here -- it may be shared.
    // Just null the mock refs.
    setMockPlaying(false);
    setAnalyser(null);
  }, []);

  const toggleMock = useCallback(() => {
    if (mockPlaying) {
      stopMockTone();
    } else {
      startMockTone();
    }
  }, [mockPlaying, startMockTone, stopMockTone]);

  // ---------------------------------------------------------------------------
  // Seek bar progress background
  // ---------------------------------------------------------------------------
  const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white font-sans select-none overflow-hidden">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        crossOrigin="anonymous"
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        preload="metadata"
      />

      {/* ================================================================== */}
      {/* LEFT SIDEBAR -- File Browser                                       */}
      {/* ================================================================== */}
      <div className="w-56 shrink-0 bg-black/30 backdrop-blur-md border-r border-white/5 flex flex-col">
        <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-white/5 flex items-center justify-between">
          <span>Library</span>
          {useKernel && (
            <button
              onClick={loadRootTree}
              className="p-0.5 hover:text-gray-300 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={11} className={loadingDir ? 'animate-spin' : ''} />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
          {!useKernel ? (
            <div className="px-3 py-6 text-center">
              <Music size={28} className="mx-auto mb-2 text-violet-400/40" />
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Connect kernel to browse and play audio files
              </p>
            </div>
          ) : loadingDir ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={16} className="animate-spin text-violet-400/50" />
            </div>
          ) : tree.length === 0 ? (
            <div className="px-3 py-6 text-center text-[11px] text-gray-500">
              No directories found
            </div>
          ) : (
            tree.map(node => (
              <TreeItem
                key={node.path}
                node={node}
                onToggle={toggleDir}
                onFileClick={addToQueueAndPlay}
                depth={0}
              />
            ))
          )}
        </div>
      </div>

      {/* ================================================================== */}
      {/* CENTER -- Now Playing                                              */}
      {/* ================================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mock mode banner */}
        {!useKernel && (
          <div className="px-4 py-2 bg-violet-500/10 border-b border-violet-500/20 text-center">
            <span className="text-[11px] text-violet-300/80">
              Connect kernel to browse and play audio files
            </span>
          </div>
        )}

        {/* Now Playing Display */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 min-h-0">
          {/* Album art placeholder with gradient */}
          <div className="w-44 h-44 rounded-2xl bg-gradient-to-br from-violet-600/30 via-indigo-600/20 to-blue-600/30 border border-white/10 flex items-center justify-center mb-5 shadow-2xl shadow-violet-500/10 backdrop-blur-sm">
            <Music size={56} className="text-white/20" />
          </div>

          {/* Track name */}
          <div className="text-center mb-4 w-full max-w-xs">
            <h2 className="text-sm font-semibold text-gray-200 truncate">
              {currentTrack ? currentTrack.displayName : (mockPlaying ? 'Demo Tone (440 Hz)' : 'No Track Selected')}
            </h2>
            <p className="text-[11px] text-gray-500 mt-0.5 truncate">
              {currentTrack ? 'Kernel Filesystem' : (mockPlaying ? 'Mock Mode' : 'Add tracks from the library')}
            </p>
          </div>

          {/* Waveform visualizer */}
          <div className="w-full max-w-sm mb-4">
            <Visualizer analyser={analyser} isPlaying={isPlaying || mockPlaying} />
          </div>

          {/* Seek bar */}
          <div className="w-full max-w-sm mb-1">
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              disabled={!currentTrack}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-default disabled:opacity-30"
              style={{
                background: currentTrack
                  ? `linear-gradient(to right, rgb(139, 92, 246) ${seekPercent}%, rgba(255,255,255,0.1) ${seekPercent}%)`
                  : 'rgba(255,255,255,0.1)',
              }}
            />
            <div className="flex justify-between text-[10px] text-gray-500 mt-1 px-0.5">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Transport controls */}
          <div className="flex items-center gap-3 mt-2">
            {/* Shuffle */}
            <button
              onClick={() => setShuffleOn(s => !s)}
              className={`p-2 rounded-full transition-colors ${shuffleOn ? 'text-violet-400 bg-violet-400/10' : 'text-gray-500 hover:text-gray-300'}`}
              title="Shuffle"
            >
              <Shuffle size={16} />
            </button>

            {/* Previous */}
            <button
              onClick={playPrev}
              disabled={queue.length === 0}
              className="p-2 rounded-full text-gray-300 hover:text-white disabled:text-gray-600 disabled:cursor-default transition-colors"
              title="Previous"
            >
              <SkipBack size={20} />
            </button>

            {/* Play / Pause (large) */}
            {useKernel ? (
              <button
                onClick={togglePlayPause}
                disabled={!currentTrack}
                className="w-12 h-12 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-default shadow-lg shadow-white/10"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>
            ) : (
              <button
                onClick={toggleMock}
                className="w-12 h-12 rounded-full bg-white text-gray-900 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-white/10"
                title={mockPlaying ? 'Stop Demo' : 'Play Demo'}
              >
                {mockPlaying ? <Pause size={22} /> : <Play size={22} className="ml-0.5" />}
              </button>
            )}

            {/* Next */}
            <button
              onClick={playNext}
              disabled={queue.length === 0}
              className="p-2 rounded-full text-gray-300 hover:text-white disabled:text-gray-600 disabled:cursor-default transition-colors"
              title="Next"
            >
              <SkipForward size={20} />
            </button>

            {/* Repeat */}
            <button
              onClick={() => setRepeatOn(r => !r)}
              className={`p-2 rounded-full transition-colors ${repeatOn ? 'text-violet-400 bg-violet-400/10' : 'text-gray-500 hover:text-gray-300'}`}
              title="Repeat"
            >
              <Repeat size={16} />
            </button>
          </div>

          {/* Volume control */}
          <div className="flex items-center gap-2 mt-4 w-full max-w-[180px]">
            <button
              onClick={() => setMuted(m => !m)}
              className="text-gray-500 hover:text-gray-300 transition-colors"
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
              className="flex-1 h-1 rounded-full appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, rgb(139, 92, 246) ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.1) ${(muted ? 0 : volume) * 100}%)`,
              }}
            />
          </div>
        </div>
      </div>

      {/* ================================================================== */}
      {/* RIGHT PANEL -- Queue                                               */}
      {/* ================================================================== */}
      <div className="w-56 shrink-0 bg-black/30 backdrop-blur-md border-l border-white/5 flex flex-col">
        <div className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest text-gray-500 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <List size={11} />
            <span>Queue</span>
            {queue.length > 0 && (
              <span className="text-gray-600 font-normal">({queue.length})</span>
            )}
          </div>
          {queue.length > 0 && (
            <button
              onClick={clearQueue}
              className="text-gray-600 hover:text-red-400 transition-colors text-[10px] font-medium"
              title="Clear queue"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto py-1 scrollbar-thin">
          {queue.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <List size={24} className="mx-auto mb-2 text-gray-700" />
              <p className="text-[11px] text-gray-600">Queue is empty</p>
              <p className="text-[10px] text-gray-700 mt-0.5">
                Click a file to add it
              </p>
            </div>
          ) : (
            queue.map((track, index) => (
              <div
                key={`${track.path}-${index}`}
                onClick={() => jumpToTrack(index)}
                className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors ${
                  index === currentIndex
                    ? 'bg-violet-500/15 text-violet-300'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                <div className="w-5 shrink-0 flex items-center justify-center">
                  {index === currentIndex && isPlaying ? (
                    <div className="flex items-end gap-[2px] h-3">
                      <div className="w-[2px] bg-violet-400 rounded-full animate-pulse" style={{ height: '8px', animationDelay: '0ms' }} />
                      <div className="w-[2px] bg-violet-400 rounded-full animate-pulse" style={{ height: '12px', animationDelay: '150ms' }} />
                      <div className="w-[2px] bg-violet-400 rounded-full animate-pulse" style={{ height: '6px', animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <span className="text-[10px] text-gray-600">{index + 1}</span>
                  )}
                </div>
                <span className="text-xs truncate flex-1">{track.displayName}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeFromQueue(index); }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-600 hover:text-red-400 transition-all shrink-0"
                  title="Remove"
                >
                  <X size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
