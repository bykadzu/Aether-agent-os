import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Shuffle,
  Repeat,
  Repeat1,
  Music,
  List,
  MessageSquare,
  Mic,
  Plus,
  Trash2,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Search,
  Square,
  GripVertical,
  AlertCircle,
  Loader2,
  X,
  Music2,
} from 'lucide-react';
import { getKernelClient, KernelFileStat } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  url: string;
  path?: string;
}

type RepeatMode = 'off' | 'all' | 'one';
type SidebarTab = 'files' | 'playlist' | 'tts';
type ViewMode = 'player' | 'tts';

interface FolderNode {
  name: string;
  path: string;
  children: (FolderNode | AudioFileNode)[];
  expanded: boolean;
}

interface AudioFileNode {
  name: string;
  path: string;
  type: 'audio';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];

const SAMPLE_TRACKS: Track[] = [
  {
    id: 'demo-1',
    title: 'Midnight Reverie',
    artist: 'Aether Collective',
    album: 'Digital Dreams',
    duration: 234,
    url: '',
  },
  {
    id: 'demo-2',
    title: 'Neon Cascade',
    artist: 'Synth Wave',
    album: 'Electric Horizons',
    duration: 198,
    url: '',
  },
  {
    id: 'demo-3',
    title: 'Quiet Storm',
    artist: 'Ambient Flow',
    album: 'Tranquil Spaces',
    duration: 312,
    url: '',
  },
  {
    id: 'demo-4',
    title: 'Binary Sunset',
    artist: 'Code & Keys',
    album: 'Algorithm',
    duration: 267,
    url: '',
  },
  {
    id: 'demo-5',
    title: 'Deep Focus',
    artist: 'Neural Beats',
    album: 'Concentration',
    duration: 445,
    url: '',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function trackFromPath(filePath: string): Track {
  const name = filePath.split('/').pop() || 'Unknown';
  const titleWithoutExt = name.replace(/\.[^.]+$/, '');
  return {
    id: `file-${filePath}`,
    title: titleWithoutExt,
    artist: 'Unknown Artist',
    album: 'Unknown Album',
    duration: 0,
    url: `/api/fs/raw?path=${encodeURIComponent(filePath)}`,
    path: filePath,
  };
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Animated gradient background tied to playback state */
const AnimatedBackground: React.FC<{ isPlaying: boolean }> = ({ isPlaying }) => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <div
      className={`absolute -top-1/2 -left-1/2 w-[200%] h-[200%] transition-opacity duration-1000 ${
        isPlaying ? 'opacity-30' : 'opacity-10'
      }`}
      style={{
        background:
          'radial-gradient(ellipse at 30% 50%, rgba(99,102,241,0.4) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 70% 30%, rgba(168,85,247,0.3) 0%, transparent 50%), ' +
          'radial-gradient(ellipse at 50% 80%, rgba(59,130,246,0.2) 0%, transparent 50%)',
        animation: isPlaying ? 'musicBgPulse 8s ease-in-out infinite' : 'none',
      }}
    />
    <style>{`
      @keyframes musicBgPulse {
        0%, 100% { transform: translate(0, 0) scale(1); }
        33% { transform: translate(-2%, 1%) scale(1.02); }
        66% { transform: translate(1%, -1%) scale(0.98); }
      }
      @keyframes vinylSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `}</style>
  </div>
);

/** Frequency bar / waveform visualizer using canvas */
const AudioVisualizer: React.FC<{
  analyserRef: React.MutableRefObject<AnalyserNode | null>;
  isPlaying: boolean;
}> = ({ analyserRef, isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      animFrameRef.current = requestAnimationFrame(draw);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // Use a subset of bars for visual clarity
      const barCount = 64;
      const step = Math.floor(bufferLength / barCount);
      const barWidth = (width / barCount) * 0.7;
      const gap = (width / barCount) * 0.3;

      for (let i = 0; i < barCount; i++) {
        const value = dataArray[i * step];
        const percent = value / 255;
        const barHeight = percent * height * 0.9;

        // Gradient color based on frequency
        const hue = 220 + (i / barCount) * 80; // blue to purple
        const saturation = 70 + percent * 30;
        const lightness = 45 + percent * 25;

        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${0.6 + percent * 0.4})`;

        const x = i * (barWidth + gap);
        const radius = Math.min(barWidth / 2, 3);

        // Rounded top bar
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x, height - barHeight + radius);
        ctx.quadraticCurveTo(x, height - barHeight, x + radius, height - barHeight);
        ctx.lineTo(x + barWidth - radius, height - barHeight);
        ctx.quadraticCurveTo(
          x + barWidth,
          height - barHeight,
          x + barWidth,
          height - barHeight + radius,
        );
        ctx.lineTo(x + barWidth, height);
        ctx.fill();

        // Reflection
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, ${percent * 0.15})`;
        const reflectionHeight = barHeight * 0.3;
        ctx.fillRect(x, height, barWidth, -reflectionHeight * 0.05);
      }
    };

    if (isPlaying) {
      draw();
    } else {
      // Draw idle state -- low ambient bars
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      const barCount = 64;
      const barWidth = (width / barCount) * 0.7;
      const gapWidth = (width / barCount) * 0.3;
      for (let i = 0; i < barCount; i++) {
        const idleHeight = 2 + Math.sin(i * 0.3) * 2;
        ctx.fillStyle = 'rgba(99,102,241,0.25)';
        const x = i * (barWidth + gapWidth);
        ctx.fillRect(x, height - idleHeight, barWidth, idleHeight);
      }
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [analyserRef, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={512}
      height={100}
      className="w-full h-20 rounded-lg opacity-90"
    />
  );
};

/** Album art placeholder with spinning vinyl animation */
const AlbumArt: React.FC<{ track: Track | null; isPlaying: boolean }> = ({ track, isPlaying }) => (
  <div className="relative w-56 h-56 mx-auto mb-6 group">
    {/* Vinyl disc behind the album */}
    <div
      className={`absolute inset-2 rounded-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 border-4 border-gray-700/50 ${
        isPlaying ? 'animate-[vinylSpin_3s_linear_infinite]' : ''
      }`}
      style={{ zIndex: 0 }}
    >
      <div className="absolute inset-0 rounded-full flex items-center justify-center">
        <div className="w-6 h-6 rounded-full bg-gray-600 border-2 border-gray-500" />
      </div>
      {/* Grooves */}
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="absolute rounded-full border border-gray-700/30"
          style={{
            inset: `${16 + i * 12}%`,
          }}
        />
      ))}
    </div>
    {/* Cover */}
    <div
      className={`relative z-10 w-full h-full rounded-2xl overflow-hidden shadow-2xl transition-transform duration-500 ${
        isPlaying ? 'translate-x-4 scale-95' : 'translate-x-0 scale-100'
      }`}
    >
      <div className="w-full h-full bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center">
        <Music2 size={72} className="text-white/40" />
      </div>
      {track && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <div className="text-white text-sm font-semibold truncate">{track.album}</div>
        </div>
      )}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const MusicApp: React.FC = () => {
  // -- Refs --
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const dragIndexRef = useRef<number | null>(null);

  // -- Playback State --
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');

  // -- Playlist --
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(-1);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // -- UI --
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [viewMode, setViewMode] = useState<ViewMode>('player');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // -- File Browser --
  const [kernelConnected, setKernelConnected] = useState(false);
  const [fileBrowserPath, setFileBrowserPath] = useState('/home');
  const [fileBrowserEntries, setFileBrowserEntries] = useState<KernelFileStat[]>([]);
  const [fileBrowserLoading, setFileBrowserLoading] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['/home']));
  const [dirContents, setDirContents] = useState<Map<string, KernelFileStat[]>>(new Map());

  // -- TTS --
  const [ttsText, setTtsText] = useState('');
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsSelectedVoice, setTtsSelectedVoice] = useState('');
  const [ttsRate, setTtsRate] = useState(1);
  const [ttsPitch, setTtsPitch] = useState(1);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);

  const currentTrack = useMemo(
    () =>
      currentTrackIndex >= 0 && currentTrackIndex < playlist.length
        ? playlist[currentTrackIndex]
        : null,
    [currentTrackIndex, playlist],
  );

  // -----------------------------------------------------------------------
  // Audio Element Setup
  // -----------------------------------------------------------------------

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.volume = volume;
    audioRef.current = audio;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration);
    const onEnded = () => handleTrackEnd();
    const onError = () => {
      if (audio.src && audio.src !== window.location.href) {
        setError('Failed to load audio file. The file may be missing or in an unsupported format.');
        setIsPlaying(false);
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.pause();
      audio.src = '';

      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Web Audio API - Analyser
  // -----------------------------------------------------------------------

  const ensureAudioContext = useCallback(() => {
    if (audioContextRef.current && analyserRef.current) return;

    const audio = audioRef.current;
    if (!audio) return;

    try {
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);

      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      sourceRef.current = source;
    } catch (err) {
      console.warn('[MusicApp] Web Audio API setup failed:', err);
    }
  }, []);

  // -----------------------------------------------------------------------
  // Kernel / File Browser
  // -----------------------------------------------------------------------

  useEffect(() => {
    const client = getKernelClient();
    setKernelConnected(client.connected);

    if (client.connected) {
      loadDirectory('/home');
    }

    const unsub = client.on('connection', (data: any) => {
      setKernelConnected(data.connected);
      if (data.connected) {
        loadDirectory('/home');
      }
    });

    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDirectory = useCallback(async (path: string) => {
    const client = getKernelClient();
    if (!client.connected) return;

    setFileBrowserLoading(true);
    try {
      const entries = await client.listDir(path);
      setFileBrowserEntries(entries);
      setFileBrowserPath(path);

      setDirContents((prev) => {
        const next = new Map(prev);
        next.set(path, entries);
        return next;
      });
    } catch (err) {
      console.error('[MusicApp] Failed to list directory:', err);
    } finally {
      setFileBrowserLoading(false);
    }
  }, []);

  const toggleDir = useCallback(
    (path: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          // Load if not already loaded
          if (!dirContents.has(path)) {
            loadDirectory(path);
          }
        }
        return next;
      });
    },
    [dirContents, loadDirectory],
  );

  // -----------------------------------------------------------------------
  // TTS voices
  // -----------------------------------------------------------------------

  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setTtsVoices(voices);
      if (voices.length > 0 && !ttsSelectedVoice) {
        const defaultVoice = voices.find((v) => v.default) || voices[0];
        setTtsSelectedVoice(defaultVoice.name);
      }
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------------------------------------------------
  // Playback Controls
  // -----------------------------------------------------------------------

  const playTrack = useCallback(
    (index: number) => {
      const audio = audioRef.current;
      if (!audio || index < 0 || index >= playlist.length) return;

      const track = playlist[index];
      if (!track.url) {
        setError('This is a demo track. Connect to the kernel to play real audio files.');
        return;
      }

      setError(null);
      setCurrentTrackIndex(index);
      audio.src = track.url;
      audio.load();

      ensureAudioContext();

      // Resume AudioContext if suspended (browser autoplay policy)
      if (audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }

      audio.play().catch((err) => {
        console.warn('[MusicApp] Play failed:', err);
        setIsPlaying(false);
      });
    },
    [playlist, ensureAudioContext],
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (currentTrackIndex < 0 && playlist.length > 0) {
      playTrack(0);
      return;
    }

    ensureAudioContext();

    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => setIsPlaying(false));
    }
  }, [isPlaying, currentTrackIndex, playlist.length, playTrack, ensureAudioContext]);

  const handleTrackEnd = useCallback(() => {
    if (repeatMode === 'one') {
      const audio = audioRef.current;
      if (audio) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
      return;
    }

    // Move to next
    if (playlist.length === 0) return;

    let nextIndex: number;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * playlist.length);
      if (nextIndex === currentTrackIndex && playlist.length > 1) {
        nextIndex = (nextIndex + 1) % playlist.length;
      }
    } else {
      nextIndex = currentTrackIndex + 1;
    }

    if (nextIndex >= playlist.length) {
      if (repeatMode === 'all') {
        nextIndex = 0;
      } else {
        setIsPlaying(false);
        return;
      }
    }

    playTrack(nextIndex);
  }, [repeatMode, shuffle, currentTrackIndex, playlist.length, playTrack]);

  // Re-register the ended handler when dependencies change
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => handleTrackEnd();
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [handleTrackEnd]);

  const skipNext = useCallback(() => {
    if (playlist.length === 0) return;
    let nextIndex: number;
    if (shuffle) {
      nextIndex = Math.floor(Math.random() * playlist.length);
      if (nextIndex === currentTrackIndex && playlist.length > 1) {
        nextIndex = (nextIndex + 1) % playlist.length;
      }
    } else {
      nextIndex = (currentTrackIndex + 1) % playlist.length;
    }
    playTrack(nextIndex);
  }, [shuffle, currentTrackIndex, playlist.length, playTrack]);

  const skipPrev = useCallback(() => {
    if (playlist.length === 0) return;
    const audio = audioRef.current;
    // If more than 3s into the track, restart it instead
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    let prevIndex = currentTrackIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    playTrack(prevIndex);
  }, [currentTrackIndex, playlist.length, playTrack]);

  const seek = useCallback((fraction: number) => {
    const audio = audioRef.current;
    if (!audio || !isFinite(audio.duration)) return;
    audio.currentTime = fraction * audio.duration;
  }, []);

  const handleSeekBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const bar = seekBarRef.current;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(fraction);
    },
    [seek],
  );

  const changeVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolume(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
    if (clamped > 0) setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isMuted) {
      audio.volume = volume;
      setIsMuted(false);
    } else {
      audio.volume = 0;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => {
      if (prev === 'off') return 'all';
      if (prev === 'all') return 'one';
      return 'off';
    });
  }, []);

  // -----------------------------------------------------------------------
  // Playlist Management
  // -----------------------------------------------------------------------

  const addToPlaylist = useCallback((track: Track) => {
    setPlaylist((prev) => [...prev, { ...track, id: generateId() }]);
  }, []);

  const addFileToPlaylist = useCallback(
    (fileStat: KernelFileStat) => {
      if (!isAudioFile(fileStat.name)) return;
      const track = trackFromPath(fileStat.path);
      addToPlaylist(track);
    },
    [addToPlaylist],
  );

  const addAllAudioInDir = useCallback(() => {
    const entries = dirContents.get(fileBrowserPath) || fileBrowserEntries;
    const audioFiles = entries.filter((e) => e.type === 'file' && isAudioFile(e.name));
    audioFiles.forEach((f) => {
      const track = trackFromPath(f.path);
      addToPlaylist(track);
    });
  }, [fileBrowserPath, dirContents, fileBrowserEntries, addToPlaylist]);

  const removeFromPlaylist = useCallback(
    (index: number) => {
      setPlaylist((prev) => {
        const next = [...prev];
        next.splice(index, 1);
        return next;
      });
      // Adjust current index
      if (index < currentTrackIndex) {
        setCurrentTrackIndex((prev) => prev - 1);
      } else if (index === currentTrackIndex) {
        // Current track removed; stop
        const audio = audioRef.current;
        if (audio) {
          audio.pause();
          audio.src = '';
        }
        setIsPlaying(false);
        setCurrentTrackIndex(-1);
      }
    },
    [currentTrackIndex],
  );

  const clearPlaylist = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    setPlaylist([]);
    setCurrentTrackIndex(-1);
    setIsPlaying(false);
  }, []);

  // Drag reorder
  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback(
    (targetIndex: number) => {
      const fromIndex = dragIndexRef.current;
      if (fromIndex === null || fromIndex === targetIndex) {
        setDragOverIndex(null);
        return;
      }

      setPlaylist((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(targetIndex, 0, moved);
        return next;
      });

      // Adjust current track index
      if (currentTrackIndex === fromIndex) {
        setCurrentTrackIndex(targetIndex);
      } else if (fromIndex < currentTrackIndex && targetIndex >= currentTrackIndex) {
        setCurrentTrackIndex((prev) => prev - 1);
      } else if (fromIndex > currentTrackIndex && targetIndex <= currentTrackIndex) {
        setCurrentTrackIndex((prev) => prev + 1);
      }

      setDragOverIndex(null);
      dragIndexRef.current = null;
    },
    [currentTrackIndex],
  );

  // -----------------------------------------------------------------------
  // Keyboard Shortcuts
  // -----------------------------------------------------------------------

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (audioRef.current) {
            audioRef.current.currentTime = Math.min(
              audioRef.current.currentTime + 5,
              audioRef.current.duration || 0,
            );
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (audioRef.current) {
            audioRef.current.currentTime = Math.max(audioRef.current.currentTime - 5, 0);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(volume + 0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(volume - 0.05);
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [togglePlay, toggleMute, changeVolume, volume]);

  // -----------------------------------------------------------------------
  // TTS
  // -----------------------------------------------------------------------

  const ttsSpeak = useCallback(() => {
    if (!ttsText.trim()) return;

    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(ttsText);
    const voice = ttsVoices.find((v) => v.name === ttsSelectedVoice);
    if (voice) utterance.voice = voice;
    utterance.rate = ttsRate;
    utterance.pitch = ttsPitch;

    utterance.onstart = () => setTtsSpeaking(true);
    utterance.onend = () => setTtsSpeaking(false);
    utterance.onerror = () => setTtsSpeaking(false);

    speechSynthesis.speak(utterance);
  }, [ttsText, ttsVoices, ttsSelectedVoice, ttsRate, ttsPitch]);

  const ttsStop = useCallback(() => {
    speechSynthesis.cancel();
    setTtsSpeaking(false);
  }, []);

  // -----------------------------------------------------------------------
  // Filtered file browser entries
  // -----------------------------------------------------------------------

  const filteredEntries = useMemo(() => {
    const entries = dirContents.get(fileBrowserPath) || fileBrowserEntries;
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) && (e.type === 'directory' || isAudioFile(e.name)),
    );
  }, [fileBrowserPath, dirContents, fileBrowserEntries, searchQuery]);

  // Audio files only (for quick display)
  const audioFilesInDir = useMemo(
    () => filteredEntries.filter((e) => e.type === 'file' && isAudioFile(e.name)),
    [filteredEntries],
  );
  const dirsInDir = useMemo(
    () => filteredEntries.filter((e) => e.type === 'directory'),
    [filteredEntries],
  );

  // -----------------------------------------------------------------------
  // Render Helpers
  // -----------------------------------------------------------------------

  const renderFileBrowser = () => (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search audio files..."
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-indigo-500/50 transition-colors"
          />
        </div>
      </div>

      {kernelConnected ? (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
          {/* Current path */}
          <div className="flex items-center justify-between px-2 py-1 mb-1">
            <span className="text-[10px] text-white/30 font-mono truncate">{fileBrowserPath}</span>
            {audioFilesInDir.length > 0 && (
              <button
                onClick={addAllAudioInDir}
                className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-1 flex-shrink-0"
                title="Add all audio files in this directory"
              >
                <Plus size={10} />
                Add all
              </button>
            )}
          </div>

          {/* Parent directory */}
          {fileBrowserPath !== '/' && (
            <button
              onClick={() => {
                const parent = fileBrowserPath.split('/').slice(0, -1).join('/') || '/';
                loadDirectory(parent);
              }}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-white/60 hover:bg-white/5 transition-colors"
            >
              <FolderOpen size={14} className="text-yellow-400/60" />
              <span>..</span>
            </button>
          )}

          {fileBrowserLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 size={16} className="animate-spin text-white/30" />
            </div>
          )}

          {/* Directories */}
          {dirsInDir.map((entry) => (
            <button
              key={entry.path}
              onClick={() => loadDirectory(entry.path)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5 transition-colors group"
            >
              <FolderOpen size={14} className="text-yellow-400/70 flex-shrink-0" />
              <span className="truncate">{entry.name}</span>
              <ChevronRight
                size={12}
                className="ml-auto text-white/20 group-hover:text-white/40 flex-shrink-0"
              />
            </button>
          ))}

          {/* Audio files */}
          {audioFilesInDir.map((entry) => (
            <button
              key={entry.path}
              onClick={() => addFileToPlaylist(entry)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5 transition-colors group"
            >
              <Music size={14} className="text-indigo-400/70 flex-shrink-0" />
              <span className="truncate">{entry.name}</span>
              <Plus
                size={12}
                className="ml-auto text-white/0 group-hover:text-white/40 flex-shrink-0 transition-colors"
              />
            </button>
          ))}

          {!fileBrowserLoading && dirsInDir.length === 0 && audioFilesInDir.length === 0 && (
            <div className="text-center py-6 text-white/20 text-xs">No audio files found</div>
          )}
        </div>
      ) : (
        /* Mock mode */
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          <div className="bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-3 mb-3 mx-1">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <div className="text-[11px] text-indigo-300/80 leading-relaxed">
                Connect to the Aether kernel to browse real audio files from your filesystem.
              </div>
            </div>
          </div>

          <div className="px-1 mb-2">
            <span className="text-[10px] text-white/30 uppercase tracking-wider font-semibold">
              Sample Tracks
            </span>
          </div>

          {SAMPLE_TRACKS.map((track) => (
            <button
              key={track.id}
              onClick={() => addToPlaylist(track)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-xs text-white/70 hover:bg-white/5 transition-colors group"
            >
              <Music size={14} className="text-purple-400/70 flex-shrink-0" />
              <div className="flex flex-col items-start truncate">
                <span className="truncate w-full text-left">{track.title}</span>
                <span className="text-[10px] text-white/30">{track.artist}</span>
              </div>
              <Plus
                size={12}
                className="ml-auto text-white/0 group-hover:text-white/40 flex-shrink-0 transition-colors"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderPlaylist = () => (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-xs text-white/40">
          {playlist.length} track{playlist.length !== 1 ? 's' : ''}
        </span>
        {playlist.length > 0 && (
          <button
            onClick={clearPlaylist}
            className="text-[10px] text-red-400/60 hover:text-red-400 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Tracks */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-white/20">
            <List size={32} className="mb-2 opacity-50" />
            <span className="text-xs">Playlist is empty</span>
            <span className="text-[10px] mt-1">Add tracks from the Files tab</span>
          </div>
        ) : (
          playlist.map((track, index) => (
            <div
              key={track.id}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={() => setDragOverIndex(null)}
              onClick={() => playTrack(index)}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-all group ${
                index === currentTrackIndex
                  ? 'bg-indigo-500/20 text-white border border-indigo-500/30'
                  : dragOverIndex === index
                    ? 'bg-white/10 border border-white/20'
                    : 'text-white/70 hover:bg-white/5 border border-transparent'
              }`}
            >
              <GripVertical
                size={12}
                className="text-white/10 group-hover:text-white/30 cursor-grab flex-shrink-0"
              />

              {index === currentTrackIndex && isPlaying ? (
                <div className="flex items-end gap-px w-3.5 h-3.5 flex-shrink-0">
                  <div
                    className="w-1 bg-indigo-400 rounded-full animate-pulse"
                    style={{ height: '60%', animationDelay: '0ms' }}
                  />
                  <div
                    className="w-1 bg-indigo-400 rounded-full animate-pulse"
                    style={{ height: '100%', animationDelay: '150ms' }}
                  />
                  <div
                    className="w-1 bg-indigo-400 rounded-full animate-pulse"
                    style={{ height: '40%', animationDelay: '300ms' }}
                  />
                </div>
              ) : (
                <span className="w-3.5 text-center text-white/30 flex-shrink-0 text-[10px]">
                  {index + 1}
                </span>
              )}

              <div className="flex flex-col min-w-0 flex-1">
                <span className="truncate font-medium">{track.title}</span>
                <span className="text-[10px] text-white/30 truncate">{track.artist}</span>
              </div>

              <span className="text-[10px] text-white/20 flex-shrink-0">
                {track.duration > 0 ? formatTime(track.duration) : '--:--'}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromPlaylist(index);
                }}
                className="text-white/0 group-hover:text-white/30 hover:!text-red-400 transition-colors flex-shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderTTSSidebar = () => (
    <div className="flex-1 flex flex-col min-h-0 px-3 pb-2">
      <div className="flex items-center gap-2 mb-3">
        <Mic size={14} className="text-emerald-400" />
        <span className="text-xs text-white/60 font-semibold uppercase tracking-wider">
          Text to Speech
        </span>
      </div>

      {/* Text Input */}
      <textarea
        value={ttsText}
        onChange={(e) => setTtsText(e.target.value)}
        placeholder="Enter text to speak..."
        className="w-full bg-white/5 border border-white/10 rounded-lg p-2.5 text-xs text-white placeholder-white/30 resize-none focus:outline-none focus:border-emerald-500/50 transition-colors mb-3"
        rows={5}
      />

      {/* Voice selector */}
      <label className="text-[10px] text-white/30 uppercase tracking-wider mb-1 block">Voice</label>
      <select
        value={ttsSelectedVoice}
        onChange={(e) => setTtsSelectedVoice(e.target.value)}
        className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white mb-3 focus:outline-none focus:border-emerald-500/50 appearance-none"
      >
        {ttsVoices.map((voice) => (
          <option key={voice.name} value={voice.name} className="bg-[#252830] text-white">
            {voice.name} ({voice.lang})
          </option>
        ))}
      </select>

      {/* Rate */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">Rate</label>
          <span className="text-[10px] text-white/40">{ttsRate.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={ttsRate}
          onChange={(e) => setTtsRate(parseFloat(e.target.value))}
          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-400"
        />
      </div>

      {/* Pitch */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-white/30 uppercase tracking-wider">Pitch</label>
          <span className="text-[10px] text-white/40">{ttsPitch.toFixed(1)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={ttsPitch}
          onChange={(e) => setTtsPitch(parseFloat(e.target.value))}
          className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-emerald-400"
        />
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        <button
          onClick={ttsSpeak}
          disabled={!ttsText.trim() || ttsSpeaking}
          className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg py-2 text-xs font-medium hover:bg-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {ttsSpeaking ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {ttsSpeaking ? 'Speaking...' : 'Speak'}
        </button>
        <button
          onClick={ttsStop}
          disabled={!ttsSpeaking}
          className="flex items-center justify-center gap-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg px-3 py-2 text-xs font-medium hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Square size={12} />
          Stop
        </button>
      </div>
    </div>
  );

  // -----------------------------------------------------------------------
  // Volume icon helper
  // -----------------------------------------------------------------------

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  // -----------------------------------------------------------------------
  // Main Render
  // -----------------------------------------------------------------------

  return (
    <div className="flex h-full bg-[#1a1d26] text-white font-sans select-none relative overflow-hidden">
      <AnimatedBackground isPlaying={isPlaying} />

      {/* ================================================================== */}
      {/* LEFT SIDEBAR                                                       */}
      {/* ================================================================== */}
      <div className="relative z-10 w-64 flex flex-col bg-white/[0.03] border-r border-white/[0.06] flex-shrink-0">
        {/* Sidebar Tabs */}
        <div className="flex border-b border-white/[0.06] flex-shrink-0">
          {[
            { key: 'files' as SidebarTab, icon: FolderOpen, label: 'Files' },
            { key: 'playlist' as SidebarTab, icon: List, label: 'Queue' },
            { key: 'tts' as SidebarTab, icon: MessageSquare, label: 'TTS' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSidebarTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium transition-all border-b-2 ${
                sidebarTab === tab.key
                  ? 'text-indigo-400 border-indigo-400 bg-indigo-400/5'
                  : 'text-white/40 border-transparent hover:text-white/60 hover:bg-white/[0.02]'
              }`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 flex flex-col min-h-0 pt-2">
          {sidebarTab === 'files' && renderFileBrowser()}
          {sidebarTab === 'playlist' && renderPlaylist()}
          {sidebarTab === 'tts' && renderTTSSidebar()}
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-white/[0.06] flex-shrink-0">
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              kernelConnected ? 'bg-emerald-400' : 'bg-white/20'
            }`}
          />
          <span className="text-[10px] text-white/30">
            {kernelConnected ? 'Kernel connected' : 'Offline mode'}
          </span>
        </div>
      </div>

      {/* ================================================================== */}
      {/* MAIN CONTENT                                                       */}
      {/* ================================================================== */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Now Playing View */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6 overflow-y-auto">
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 flex items-center gap-2 max-w-md z-20">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <span className="text-xs text-red-300">{error}</span>
              <button
                onClick={() => setError(null)}
                className="text-red-400/60 hover:text-red-400 ml-2"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Album Art */}
          <AlbumArt track={currentTrack} isPlaying={isPlaying} />

          {/* Track Info */}
          <div className="text-center mb-6 max-w-md">
            <h2 className="text-xl font-bold truncate mb-1">
              {currentTrack?.title || 'No Track Selected'}
            </h2>
            <p className="text-sm text-white/40 truncate">
              {currentTrack
                ? `${currentTrack.artist} \u2014 ${currentTrack.album}`
                : 'Add tracks to get started'}
            </p>
          </div>

          {/* Seek Bar */}
          <div className="w-full max-w-md mb-4">
            <div
              ref={seekBarRef}
              onClick={handleSeekBarClick}
              className="relative w-full h-1.5 bg-white/10 rounded-full cursor-pointer group"
            >
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
              {/* Thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                style={{
                  left: `calc(${duration > 0 ? (currentTime / duration) * 100 : 0}% - 6px)`,
                }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span className="text-[10px] text-white/30 tabular-nums">
                {formatTime(currentTime)}
              </span>
              <span className="text-[10px] text-white/30 tabular-nums">{formatTime(duration)}</span>
            </div>
          </div>

          {/* Main Controls */}
          <div className="flex items-center gap-4 mb-6">
            {/* Shuffle */}
            <button
              onClick={() => setShuffle((prev) => !prev)}
              className={`p-2 rounded-full transition-all ${
                shuffle ? 'text-indigo-400 bg-indigo-400/10' : 'text-white/30 hover:text-white/60'
              }`}
              title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
            >
              <Shuffle size={16} />
            </button>

            {/* Previous */}
            <button
              onClick={skipPrev}
              className="p-2 text-white/60 hover:text-white transition-colors"
              title="Previous (or restart)"
            >
              <SkipBack size={22} />
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40 transition-all hover:scale-105 active:scale-95"
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying ? <Pause size={24} /> : <Play size={24} className="ml-1" />}
            </button>

            {/* Next */}
            <button
              onClick={skipNext}
              className="p-2 text-white/60 hover:text-white transition-colors"
              title="Next"
            >
              <SkipForward size={22} />
            </button>

            {/* Repeat */}
            <button
              onClick={cycleRepeat}
              className={`p-2 rounded-full transition-all relative ${
                repeatMode !== 'off'
                  ? 'text-indigo-400 bg-indigo-400/10'
                  : 'text-white/30 hover:text-white/60'
              }`}
              title={`Repeat: ${repeatMode}`}
            >
              {repeatMode === 'one' ? <Repeat1 size={16} /> : <Repeat size={16} />}
              {repeatMode !== 'off' && (
                <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-400" />
              )}
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2 w-full max-w-xs">
            <button
              onClick={toggleMute}
              className="text-white/40 hover:text-white/60 transition-colors flex-shrink-0"
              title={`${isMuted ? 'Unmute' : 'Mute'} (M)`}
            >
              <VolumeIcon size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              className="flex-1 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-400"
            />
            <span className="text-[10px] text-white/30 w-8 text-right tabular-nums">
              {Math.round((isMuted ? 0 : volume) * 100)}%
            </span>
          </div>

          {/* Visualizer */}
          <div className="w-full max-w-md mt-6">
            <AudioVisualizer analyserRef={analyserRef} isPlaying={isPlaying} />
          </div>
        </div>

        {/* ================================================================ */}
        {/* BOTTOM BAR - Mini Player                                         */}
        {/* ================================================================ */}
        <div className="flex-shrink-0 h-16 bg-white/[0.03] backdrop-blur-sm border-t border-white/[0.06] flex items-center px-4 gap-4">
          {/* Track info */}
          <div className="flex items-center gap-3 w-56 flex-shrink-0">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-indigo-600/40 to-purple-600/40 flex items-center justify-center flex-shrink-0">
              <Music size={16} className="text-white/50" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">
                {currentTrack?.title || 'No track'}
              </div>
              <div className="text-[10px] text-white/30 truncate">{currentTrack?.artist || ''}</div>
            </div>
          </div>

          {/* Mini controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={skipPrev}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <SkipBack size={14} />
            </button>
            <button
              onClick={togglePlay}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center transition-colors"
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
            </button>
            <button
              onClick={skipNext}
              className="text-white/40 hover:text-white/70 transition-colors"
            >
              <SkipForward size={14} />
            </button>
          </div>

          {/* Mini seek bar */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
              {formatTime(currentTime)}
            </span>
            <div
              className="flex-1 h-1 bg-white/10 rounded-full cursor-pointer relative"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const fraction = (e.clientX - rect.left) / rect.width;
                seek(Math.max(0, Math.min(1, fraction)));
              }}
            >
              <div
                className="absolute inset-y-0 left-0 bg-indigo-500/60 rounded-full"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            <span className="text-[10px] text-white/30 tabular-nums flex-shrink-0">
              {formatTime(duration)}
            </span>
          </div>

          {/* Mini volume */}
          <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
            <button
              onClick={toggleMute}
              className="text-white/30 hover:text-white/50 transition-colors"
            >
              <VolumeIcon size={13} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => changeVolume(parseFloat(e.target.value))}
              className="flex-1 h-0.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-400"
            />
          </div>

          {/* Keyboard hint */}
          <div className="hidden lg:flex items-center gap-2 text-[9px] text-white/15 flex-shrink-0">
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-white/25">Space</kbd>
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-white/25">M</kbd>
            <kbd className="px-1 py-0.5 bg-white/5 rounded text-white/25">&larr;&rarr;</kbd>
          </div>
        </div>
      </div>
    </div>
  );
};
