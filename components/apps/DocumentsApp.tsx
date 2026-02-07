import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  FileText, FolderOpen, ZoomIn, ZoomOut, Search, Brain, X,
  ChevronLeft, ChevronRight, File, Upload, Loader2, Maximize,
  Clock, Hash, Type, Image as ImageIcon
} from 'lucide-react';
import { getKernelClient, KernelFileStat } from '../../services/kernelClient';
import { generateText } from '../../services/geminiService';
import { GeminiModel } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

type FileType = 'pdf' | 'text' | 'markdown' | 'csv' | 'json' | 'log' | 'image' | 'unknown';

const SUPPORTED_EXTENSIONS = ['.pdf', '.txt', '.md', '.csv', '.json', '.log'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'];
const RECENT_FILES_KEY = 'aether_documents_recent';
const MAX_RECENT = 12;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFileType(name: string): FileType {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.log')) return 'log';
  if (lower.endsWith('.txt')) return 'text';
  if (IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'image';
  return 'unknown';
}

function getFileName(path: string): string {
  return path.split('/').pop() || path;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function loadRecentFiles(): RecentFile[] {
  try {
    const raw = localStorage.getItem(RECENT_FILES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveRecentFiles(files: RecentFile[]): void {
  try {
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files.slice(0, MAX_RECENT)));
  } catch {}
}

function addToRecent(path: string, name: string): RecentFile[] {
  const recent = loadRecentFiles().filter(f => f.path !== path);
  recent.unshift({ path, name, openedAt: Date.now() });
  const trimmed = recent.slice(0, MAX_RECENT);
  saveRecentFiles(trimmed);
  return trimmed;
}

// ---------------------------------------------------------------------------
// Basic Markdown Renderer
// ---------------------------------------------------------------------------

function renderMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks (fenced)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre class="bg-gray-100 border border-gray-200 rounded-lg p-4 my-3 overflow-x-auto text-sm font-mono text-gray-800"><code>${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm font-mono">$1</code>');

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6 class="text-sm font-bold text-gray-700 mt-4 mb-1">$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="text-sm font-bold text-gray-800 mt-4 mb-1">$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4 class="text-base font-bold text-gray-800 mt-5 mb-2">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-lg font-bold text-gray-800 mt-5 mb-2">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-6 mb-2">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-3">$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del class="text-gray-400">$1</del>');

  // Blockquotes
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="border-l-4 border-blue-300 pl-4 py-1 my-2 text-gray-600 italic">$1</blockquote>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr class="my-4 border-gray-200" />');

  // Unordered lists
  html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li class="ml-6 list-disc text-gray-700">$1</li>');

  // Ordered lists
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li class="ml-6 list-decimal text-gray-700">$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 underline hover:text-blue-800" target="_blank" rel="noopener">$1</a>');

  // Line breaks: convert double newlines to paragraphs
  html = html.replace(/\n\n/g, '</p><p class="my-2 text-gray-700 leading-relaxed">');

  // Single newlines to <br>
  html = html.replace(/\n/g, '<br/>');

  return `<p class="my-2 text-gray-700 leading-relaxed">${html}</p>`;
}

// ---------------------------------------------------------------------------
// Search Bar Component
// ---------------------------------------------------------------------------

const SearchBar: React.FC<{
  visible: boolean;
  content: string;
  onClose: () => void;
  contentRef: React.RefObject<HTMLDivElement | null>;
}> = ({ visible, content, onClose, contentRef }) => {
  const [query, setQuery] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [visible]);

  // Highlight matches in content area
  const doSearch = useCallback((searchQuery: string) => {
    if (!contentRef.current) return;
    // Remove previous highlights
    const container = contentRef.current;
    const marks = container.querySelectorAll('mark[data-search-highlight]');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });

    if (!searchQuery.trim()) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode as Text);
    }

    let total = 0;
    const lowerQuery = searchQuery.toLowerCase();
    for (const node of textNodes) {
      const text = node.textContent || '';
      const lowerText = text.toLowerCase();
      let idx = lowerText.indexOf(lowerQuery);
      if (idx === -1) continue;

      const fragment = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        fragment.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.setAttribute('data-search-highlight', String(total));
        mark.className = total === currentMatch
          ? 'bg-orange-400 text-white rounded px-0.5'
          : 'bg-yellow-200 rounded px-0.5';
        mark.textContent = text.substring(idx, idx + searchQuery.length);
        fragment.appendChild(mark);
        total++;
        lastIdx = idx + searchQuery.length;
        idx = lowerText.indexOf(lowerQuery, lastIdx);
      }
      fragment.appendChild(document.createTextNode(text.substring(lastIdx)));
      node.parentNode?.replaceChild(fragment, node);
    }
    setMatchCount(total);
    if (total > 0 && currentMatch >= total) setCurrentMatch(0);
  }, [contentRef, currentMatch]);

  useEffect(() => {
    if (visible) doSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, visible, content]);

  const navigateMatch = (delta: number) => {
    if (matchCount === 0) return;
    const next = (currentMatch + delta + matchCount) % matchCount;
    setCurrentMatch(next);
    // Scroll into view
    if (contentRef.current) {
      const mark = contentRef.current.querySelector(`mark[data-search-highlight="${next}"]`);
      if (mark) mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateMatch(e.shiftKey ? -1 : 1);
    }
  };

  if (!visible) return null;

  return (
    <div className="absolute top-2 right-4 z-30 flex items-center gap-1.5 bg-white/95 backdrop-blur-md border border-gray-200 shadow-lg rounded-lg px-3 py-1.5">
      <Search size={14} className="text-gray-400 shrink-0" />
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="w-48 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"
      />
      {query && (
        <span className="text-xs text-gray-400 shrink-0">
          {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : 'No results'}
        </span>
      )}
      <button onClick={() => navigateMatch(-1)} className="p-0.5 hover:bg-gray-100 rounded" title="Previous">
        <ChevronLeft size={14} className="text-gray-500" />
      </button>
      <button onClick={() => navigateMatch(1)} className="p-0.5 hover:bg-gray-100 rounded" title="Next">
        <ChevronRight size={14} className="text-gray-500" />
      </button>
      <button onClick={onClose} className="p-0.5 hover:bg-gray-100 rounded" title="Close">
        <X size={14} className="text-gray-500" />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// File Browser Panel
// ---------------------------------------------------------------------------

const FileBrowserPanel: React.FC<{
  visible: boolean;
  useKernel: boolean;
  onOpenFile: (path: string) => void;
  onClose: () => void;
  recentFiles: RecentFile[];
}> = ({ visible, useKernel, onOpenFile, onClose, recentFiles }) => {
  const [currentDir, setCurrentDir] = useState('/home/root');
  const [entries, setEntries] = useState<KernelFileStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadDir = useCallback(async (dir: string) => {
    if (!useKernel) return;
    setLoading(true);
    setError('');
    try {
      const client = getKernelClient();
      const items = await client.listDir(dir);
      setEntries(items);
      setCurrentDir(dir);
    } catch (err: any) {
      setError(err.message || 'Failed to list directory');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [useKernel]);

  useEffect(() => {
    if (visible && useKernel) {
      loadDir(currentDir);
    }
  }, [visible, useKernel, loadDir]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateUp = () => {
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    loadDir(parent);
  };

  const isSupported = (name: string) => {
    const lower = name.toLowerCase();
    return [...SUPPORTED_EXTENSIONS, ...IMAGE_EXTENSIONS].some(ext => lower.endsWith(ext));
  };

  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-20 bg-white/98 backdrop-blur-sm flex flex-col">
      {/* Browser Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-gray-50/80">
        <FolderOpen size={16} className="text-gray-500" />
        <span className="text-sm font-semibold text-gray-700">Open Document</span>
        <div className="flex-1" />
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors">
          <X size={16} className="text-gray-500" />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Recent Files Sidebar */}
        <div className="w-52 border-r border-gray-100 p-3 overflow-y-auto bg-gray-50/50">
          <div className="flex items-center gap-1.5 mb-2">
            <Clock size={12} className="text-gray-400" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Recent</span>
          </div>
          {recentFiles.length === 0 && (
            <p className="text-xs text-gray-400 mt-2">No recent files</p>
          )}
          {recentFiles.map((rf) => (
            <button
              key={rf.path}
              onClick={() => { onOpenFile(rf.path); onClose(); }}
              className="w-full text-left p-2 rounded-lg text-xs hover:bg-blue-50 transition-colors flex items-center gap-2 group"
            >
              <FileText size={13} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
              <div className="truncate">
                <div className="text-gray-700 font-medium truncate">{rf.name}</div>
                <div className="text-gray-400 truncate text-[10px]">{rf.path}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Directory Listing */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {useKernel ? (
            <>
              {/* Path bar */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
                <button onClick={navigateUp} className="p-1 hover:bg-gray-100 rounded transition-colors" title="Go up">
                  <ChevronLeft size={14} className="text-gray-500" />
                </button>
                <span className="text-xs font-mono text-gray-500 truncate">{currentDir}</span>
              </div>

              {/* File list */}
              <div className="flex-1 overflow-y-auto p-2">
                {loading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 size={20} className="animate-spin text-gray-400" />
                  </div>
                )}
                {error && <p className="text-xs text-red-500 p-4">{error}</p>}
                {!loading && !error && entries.length === 0 && (
                  <p className="text-xs text-gray-400 p-4 text-center">Empty directory</p>
                )}
                {!loading && entries
                  .sort((a, b) => {
                    if (a.type === 'directory' && b.type !== 'directory') return -1;
                    if (a.type !== 'directory' && b.type === 'directory') return 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((entry) => {
                    const supported = entry.type === 'directory' || isSupported(entry.name);
                    return (
                      <button
                        key={entry.path}
                        onClick={() => {
                          if (entry.type === 'directory') {
                            loadDir(entry.path);
                          } else if (supported) {
                            onOpenFile(entry.path);
                            onClose();
                          }
                        }}
                        disabled={entry.type === 'file' && !supported}
                        className={`w-full text-left p-2 rounded-lg text-sm flex items-center gap-3 transition-colors ${
                          entry.type === 'file' && !supported
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-blue-50 cursor-pointer'
                        }`}
                      >
                        {entry.type === 'directory' ? (
                          <FolderOpen size={16} className="text-blue-400 shrink-0" />
                        ) : (
                          <File size={16} className="text-gray-400 shrink-0" />
                        )}
                        <span className="truncate text-gray-700">{entry.name}</span>
                        {entry.type === 'file' && (
                          <span className="text-xs text-gray-400 ml-auto shrink-0">
                            {formatFileSize(entry.size)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center text-gray-400">
                <FolderOpen size={32} className="mx-auto mb-2 opacity-50" />
                <p className="text-sm">Kernel not connected.</p>
                <p className="text-xs mt-1">Use the drop zone to open local files, or open a file from Recents.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// AI Summary Panel
// ---------------------------------------------------------------------------

const SummaryPanel: React.FC<{
  visible: boolean;
  summary: string;
  loading: boolean;
  onClose: () => void;
}> = ({ visible, summary, loading, onClose }) => {
  if (!visible) return null;

  return (
    <div className="w-80 border-l border-gray-200 bg-gray-50/90 flex flex-col shrink-0 animate-slide-in-right">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 bg-white/60">
        <Brain size={16} className="text-purple-500" />
        <span className="text-sm font-semibold text-gray-700">AI Summary</span>
        <div className="flex-1" />
        <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded transition-colors">
          <X size={14} className="text-gray-500" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-500">Generating summary...</span>
          </div>
        ) : summary ? (
          <div
            className="text-sm text-gray-700 leading-relaxed prose prose-sm"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(summary) }}
          />
        ) : (
          <p className="text-xs text-gray-400 text-center mt-8">
            Click "Summarize" to generate an AI summary of this document.
          </p>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main DocumentsApp Component
// ---------------------------------------------------------------------------

export const DocumentsApp: React.FC = () => {
  // State
  const [useKernel, setUseKernel] = useState(false);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [fileType, setFileType] = useState<FileType>('unknown');
  const [fileContent, setFileContent] = useState<string>('');
  const [fileSize, setFileSize] = useState<number>(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Zoom
  const [zoom, setZoom] = useState(100);

  // Panels
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Recent files
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecentFiles);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);

  // Refs
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  // Check kernel on mount
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
    }
  }, []);

  // Accept initialData.path from window state (via custom event or global)
  useEffect(() => {
    // Look for initialData passed through window context
    // The parent WindowManager sets data-initial-path on the app container
    const appEl = document.querySelector(`[data-app-id="documents"]`);
    const initialPath = appEl?.getAttribute('data-initial-path');
    if (initialPath) {
      openFile(initialPath);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Clean up blob URLs
  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // -----------------------------------------------------------------------
  // File Operations
  // -----------------------------------------------------------------------

  const getRawUrl = useCallback((path: string): string => {
    const token = getKernelClient().getToken();
    const base = 'http://localhost:3001/api/fs/raw';
    const params = new URLSearchParams({ path });
    if (token) params.set('token', token);
    return `${base}?${params.toString()}`;
  }, []);

  const openFile = useCallback(async (path: string) => {
    const name = getFileName(path);
    const type = getFileType(name);

    setFileName(name);
    setFilePath(path);
    setFileType(type);
    setFileContent('');
    setError('');
    setLoading(true);
    setShowFileBrowser(false);
    setShowSummary(false);
    setSummaryText('');

    // Clean up previous blob
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }

    // Update recent files
    const updated = addToRecent(path, name);
    setRecentFiles(updated);

    try {
      if (type === 'pdf' || type === 'image') {
        // For binary files, we use the raw endpoint URL directly
        // No need to read the file content ourselves
        if (useKernel) {
          // Verify the file exists via stat
          const client = getKernelClient();
          try {
            const stat = await client.statFile(path);
            setFileSize(stat.size);
          } catch {
            // If stat fails, still try to show it
          }
        }
        setLoading(false);
      } else {
        // Text-based files: read content
        const client = getKernelClient();
        if (client.connected) {
          const { content, size } = await client.readFile(path);
          setFileContent(content);
          setFileSize(size);
        } else {
          setError('Kernel not connected. Cannot read file.');
        }
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to open file');
      setLoading(false);
    }
  }, [useKernel, blobUrl, getRawUrl]);

  // Handle local file drops (mock mode)
  const handleLocalFile = useCallback((file: globalThis.File) => {
    const name = file.name;
    const type = getFileType(name);

    setFileName(name);
    setFilePath(null);
    setFileType(type);
    setFileContent('');
    setError('');
    setFileSize(file.size);
    setShowFileBrowser(false);
    setShowSummary(false);
    setSummaryText('');

    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }

    if (type === 'pdf' || type === 'image') {
      const url = URL.createObjectURL(file);
      setBlobUrl(url);
    } else {
      // Read as text
      const reader = new FileReader();
      reader.onload = () => {
        setFileContent(reader.result as string);
      };
      reader.onerror = () => {
        setError('Failed to read file');
      };
      reader.readAsText(file);
    }
  }, [blobUrl]);

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) handleLocalFile(file);
  };

  // -----------------------------------------------------------------------
  // Zoom
  // -----------------------------------------------------------------------

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 15, 300));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 15, 25));
  const handleZoomFit = () => setZoom(100);

  // -----------------------------------------------------------------------
  // AI Summarize
  // -----------------------------------------------------------------------

  const handleSummarize = async () => {
    setShowSummary(true);
    setSummaryLoading(true);
    setSummaryText('');

    let textToSummarize = fileContent;
    if (!textToSummarize && fileType === 'pdf') {
      setSummaryText('PDF summarization requires text extraction. This PDF is rendered natively by the browser. For AI summaries, try opening a text-based document (.txt, .md, .json, .csv).');
      setSummaryLoading(false);
      return;
    }

    if (!textToSummarize.trim()) {
      setSummaryText('No text content to summarize.');
      setSummaryLoading(false);
      return;
    }

    // Truncate very large documents for the prompt
    const maxChars = 30000;
    if (textToSummarize.length > maxChars) {
      textToSummarize = textToSummarize.slice(0, maxChars) + '\n\n[... truncated for summarization ...]';
    }

    try {
      const prompt = `You are a document summarization assistant. Provide a clear, well-structured summary of the following document. Include key points, main themes, and important details. Format your response with markdown headers and bullet points where appropriate.\n\nDocument name: ${fileName}\n\n---\n\n${textToSummarize}`;
      const result = await generateText(prompt, GeminiModel.FLASH);
      setSummaryText(result);
    } catch (err: any) {
      setSummaryText('Failed to generate summary: ' + (err.message || 'Unknown error'));
    } finally {
      setSummaryLoading(false);
    }
  };

  // -----------------------------------------------------------------------
  // Close document
  // -----------------------------------------------------------------------

  const handleCloseDocument = () => {
    setFilePath(null);
    setFileName('');
    setFileType('unknown');
    setFileContent('');
    setFileSize(0);
    setError('');
    setShowSearch(false);
    setShowSummary(false);
    setSummaryText('');
    setZoom(100);
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  };

  // -----------------------------------------------------------------------
  // Render Content
  // -----------------------------------------------------------------------

  const hasDocument = !!fileName;

  const renderDocumentContent = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-gray-400" />
            <span className="text-sm text-gray-500">Loading document...</span>
          </div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center p-8">
            <FileText size={32} className="mx-auto mb-3 text-red-300" />
            <p className="text-sm text-red-500 font-medium">Error opening document</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
          </div>
        </div>
      );
    }

    // PDF rendering
    if (fileType === 'pdf') {
      const src = blobUrl || (filePath ? getRawUrl(filePath) : '');
      if (!src) return null;
      return (
        <div className="flex-1 overflow-hidden bg-gray-200 relative">
          <div
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left',
              width: `${10000 / zoom}%`,
              height: `${10000 / zoom}%`,
            }}
          >
            <object
              data={src}
              type="application/pdf"
              className="w-full h-full"
            >
              <iframe
                src={src}
                className="w-full h-full border-none"
                title={fileName}
              />
            </object>
          </div>
        </div>
      );
    }

    // Image rendering
    if (fileType === 'image') {
      const src = blobUrl || (filePath ? getRawUrl(filePath) : '');
      if (!src) return null;
      return (
        <div className="flex-1 overflow-auto bg-gray-100 flex items-center justify-center p-8">
          <img
            src={src}
            alt={fileName}
            className="max-w-full shadow-lg rounded"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'center center',
            }}
          />
        </div>
      );
    }

    // Markdown rendering
    if (fileType === 'markdown') {
      return (
        <div className="flex-1 overflow-auto bg-white relative">
          <SearchBar
            visible={showSearch}
            content={fileContent}
            onClose={() => setShowSearch(false)}
            contentRef={contentAreaRef}
          />
          <div
            ref={contentAreaRef}
            className="max-w-3xl mx-auto p-8"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top center',
            }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(fileContent) }}
          />
        </div>
      );
    }

    // JSON rendering (pretty-printed)
    if (fileType === 'json') {
      let formattedContent = fileContent;
      try {
        const parsed = JSON.parse(fileContent);
        formattedContent = JSON.stringify(parsed, null, 2);
      } catch {
        // If JSON is invalid, show as-is
      }
      const lines = formattedContent.split('\n');
      return (
        <div className="flex-1 overflow-auto bg-white relative">
          <SearchBar
            visible={showSearch}
            content={formattedContent}
            onClose={() => setShowSearch(false)}
            contentRef={contentAreaRef}
          />
          <div
            ref={contentAreaRef}
            className="font-mono text-sm"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left',
            }}
          >
            <table className="w-full border-collapse">
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="hover:bg-blue-50/30">
                    <td className="w-12 text-right pr-4 pl-2 text-gray-400 text-xs select-none border-r border-gray-100 bg-gray-50/50 font-mono leading-6 align-top shrink-0">
                      {i + 1}
                    </td>
                    <td className="pl-4 pr-4 text-gray-800 leading-6 whitespace-pre">{line}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // CSV rendering
    if (fileType === 'csv') {
      const rows = fileContent.split('\n').filter(r => r.trim());
      const parsed = rows.map(row => {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < row.length; i++) {
          const ch = row[i];
          if (ch === '"') {
            inQuotes = !inQuotes;
          } else if (ch === ',' && !inQuotes) {
            cells.push(current.trim());
            current = '';
          } else {
            current += ch;
          }
        }
        cells.push(current.trim());
        return cells;
      });

      return (
        <div className="flex-1 overflow-auto bg-white relative">
          <SearchBar
            visible={showSearch}
            content={fileContent}
            onClose={() => setShowSearch(false)}
            contentRef={contentAreaRef}
          />
          <div
            ref={contentAreaRef}
            className="p-4"
            style={{
              transform: `scale(${zoom / 100})`,
              transformOrigin: 'top left',
            }}
          >
            <table className="w-full border-collapse text-sm">
              {parsed.length > 0 && (
                <thead>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-bold text-gray-500 bg-gray-50 border border-gray-200 w-10">#</th>
                    {parsed[0].map((cell, i) => (
                      <th key={i} className="px-3 py-2 text-left text-xs font-bold text-gray-700 bg-gray-50 border border-gray-200">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {parsed.slice(1).map((row, i) => (
                  <tr key={i} className="hover:bg-blue-50/30">
                    <td className="px-3 py-1.5 text-xs text-gray-400 border border-gray-100 bg-gray-50/30 font-mono">{i + 1}</td>
                    {row.map((cell, j) => (
                      <td key={j} className="px-3 py-1.5 text-gray-700 border border-gray-100">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    // Plain text / log rendering with line numbers
    const lines = fileContent.split('\n');
    return (
      <div className="flex-1 overflow-auto bg-white relative">
        <SearchBar
          visible={showSearch}
          content={fileContent}
          onClose={() => setShowSearch(false)}
          contentRef={contentAreaRef}
        />
        <div
          ref={contentAreaRef}
          className="font-mono text-sm"
          style={{
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top left',
          }}
        >
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((line, i) => (
                <tr key={i} className="hover:bg-blue-50/30">
                  <td className="w-12 text-right pr-4 pl-2 text-gray-400 text-xs select-none border-r border-gray-100 bg-gray-50/50 font-mono leading-6 align-top shrink-0">
                    {i + 1}
                  </td>
                  <td className="pl-4 pr-4 text-gray-800 leading-6 whitespace-pre-wrap break-all">{line || '\u00A0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // -----------------------------------------------------------------------
  // Welcome / Empty State
  // -----------------------------------------------------------------------

  const renderWelcome = () => (
    <div
      ref={dropZoneRef}
      className={`flex-1 flex flex-col items-center justify-center transition-colors ${
        isDragging ? 'bg-blue-50/80' : 'bg-gray-50/50'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className={`flex flex-col items-center p-12 rounded-2xl border-2 border-dashed transition-all ${
        isDragging ? 'border-blue-400 bg-blue-50 scale-105' : 'border-gray-200'
      }`}>
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mb-4">
          <FileText size={28} className="text-gray-400" />
        </div>
        <h2 className="text-lg font-semibold text-gray-700 mb-1">Documents</h2>
        <p className="text-sm text-gray-400 mb-6 text-center max-w-xs">
          View PDFs, text files, markdown, CSV, and JSON documents.
          {!useKernel && ' Drag and drop a file to get started.'}
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => setShowFileBrowser(true)}
            className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <FolderOpen size={15} />
            Open File
          </button>
        </div>

        {!useKernel && (
          <div className="mt-6 flex items-center gap-2 text-xs text-gray-400">
            <Upload size={14} />
            <span>Or drag & drop a file here</span>
          </div>
        )}

        {/* Recent files */}
        {recentFiles.length > 0 && (
          <div className="mt-8 w-full max-w-sm">
            <div className="flex items-center gap-1.5 mb-2">
              <Clock size={12} className="text-gray-400" />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Recent Documents</span>
            </div>
            <div className="space-y-0.5">
              {recentFiles.slice(0, 5).map(rf => (
                <button
                  key={rf.path}
                  onClick={() => openFile(rf.path)}
                  className="w-full text-left p-2 rounded-lg hover:bg-white/80 transition-colors flex items-center gap-2 group"
                >
                  <FileText size={14} className="text-gray-400 group-hover:text-blue-500 shrink-0" />
                  <div className="truncate">
                    <div className="text-sm text-gray-700 font-medium truncate">{rf.name}</div>
                    <div className="text-[10px] text-gray-400 truncate">{rf.path}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // -----------------------------------------------------------------------
  // File type icon helper
  // -----------------------------------------------------------------------
  const getTypeIcon = () => {
    switch (fileType) {
      case 'pdf': return <FileText size={14} className="text-red-500" />;
      case 'markdown': return <Type size={14} className="text-blue-500" />;
      case 'json': return <Hash size={14} className="text-green-500" />;
      case 'csv': return <FileText size={14} className="text-emerald-500" />;
      case 'image': return <ImageIcon size={14} className="text-purple-500" />;
      default: return <File size={14} className="text-gray-500" />;
    }
  };

  // -----------------------------------------------------------------------
  // Main Render
  // -----------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col bg-white overflow-hidden"
      onDragOver={hasDocument ? undefined : handleDragOver}
      onDragLeave={hasDocument ? undefined : handleDragLeave}
      onDrop={hasDocument ? undefined : handleDrop}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-gray-200/80 bg-gray-800/95 backdrop-blur-md shrink-0">
        {/* Open File */}
        <button
          onClick={() => setShowFileBrowser(true)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-gray-300 hover:bg-white/10 transition-colors"
          title="Open File"
        >
          <FolderOpen size={14} />
          <span className="hidden sm:inline">Open</span>
        </button>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-600/50 mx-1" />

        {/* File info */}
        {hasDocument ? (
          <div className="flex items-center gap-2 px-2 text-xs text-gray-300 min-w-0">
            {getTypeIcon()}
            <span className="font-medium text-gray-100 truncate max-w-[200px]">{fileName}</span>
            {fileSize > 0 && (
              <span className="text-gray-500 shrink-0">{formatFileSize(fileSize)}</span>
            )}
          </div>
        ) : (
          <span className="text-xs text-gray-500 px-2">No document open</span>
        )}

        <div className="flex-1" />

        {/* Zoom controls */}
        {hasDocument && (
          <>
            <button
              onClick={handleZoomOut}
              className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
              title="Zoom Out"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={handleZoomFit}
              className="px-2 py-1 rounded-md text-xs font-mono text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors min-w-[3rem] text-center"
              title="Fit Width"
            >
              {zoom}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-gray-200 transition-colors"
              title="Zoom In"
            >
              <ZoomIn size={14} />
            </button>

            <div className="w-px h-5 bg-gray-600/50 mx-1" />

            {/* Search toggle */}
            {fileType !== 'pdf' && fileType !== 'image' && (
              <button
                onClick={() => setShowSearch(prev => !prev)}
                className={`p-1.5 rounded-md transition-colors ${
                  showSearch ? 'bg-white/20 text-white' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
                }`}
                title="Search (Cmd+F)"
              >
                <Search size={14} />
              </button>
            )}

            {/* Summarize */}
            <button
              onClick={handleSummarize}
              disabled={summaryLoading}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showSummary
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              } disabled:opacity-50`}
              title="AI Summarize"
            >
              {summaryLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Brain size={14} />
              )}
              <span className="hidden sm:inline">Summarize</span>
            </button>

            <div className="w-px h-5 bg-gray-600/50 mx-1" />

            {/* Close document */}
            <button
              onClick={handleCloseDocument}
              className="p-1.5 rounded-md text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
              title="Close Document"
            >
              <X size={14} />
            </button>
          </>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {hasDocument ? renderDocumentContent() : renderWelcome()}

        {/* Summary side panel */}
        <SummaryPanel
          visible={showSummary}
          summary={summaryText}
          loading={summaryLoading}
          onClose={() => setShowSummary(false)}
        />

        {/* File browser overlay */}
        <FileBrowserPanel
          visible={showFileBrowser}
          useKernel={useKernel}
          onOpenFile={openFile}
          onClose={() => setShowFileBrowser(false)}
          recentFiles={recentFiles}
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1 border-t border-gray-200/80 bg-gray-50/80 text-xs text-gray-400 shrink-0">
        <div className="flex items-center gap-3">
          {hasDocument && (
            <>
              <span className="capitalize">{fileType}</span>
              {fileType !== 'pdf' && fileType !== 'image' && fileContent && (
                <>
                  <span>{fileContent.split('\n').length} lines</span>
                  <span>{fileContent.length.toLocaleString()} chars</span>
                </>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {hasDocument && <span>Zoom: {zoom}%</span>}
          <span>{useKernel ? 'Kernel FS' : 'Local'}</span>
        </div>
      </div>
    </div>
  );
};
