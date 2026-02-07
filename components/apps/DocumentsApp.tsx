import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Search,
  Maximize,
  BookOpen,
  Sidebar,
  Download,
  Bot,
  Loader2,
  FolderOpen,
  File,
  Home,
  X,
  RefreshCw,
  ChevronDown,
  Folder,
  Sparkles,
  Grid,
  Minus,
  Plus,
} from 'lucide-react';
import { getKernelClient, KernelFileStat } from '../../services/kernelClient';
import { generateText, GeminiModel } from '../../services/geminiService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentsAppProps {
  initialFile?: string;
}

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
const MAX_THUMBNAIL_PAGES = 200;

const SAMPLE_FILES: FileEntry[] = [
  { name: 'Documents', path: '/home/Documents', type: 'directory', size: 0 },
  { name: 'Downloads', path: '/home/Downloads', type: 'directory', size: 0 },
  {
    name: 'Getting Started.pdf',
    path: '/home/Documents/Getting Started.pdf',
    type: 'file',
    size: 245760,
  },
  {
    name: 'Aether OS Manual.pdf',
    path: '/home/Documents/Aether OS Manual.pdf',
    type: 'file',
    size: 1258291,
  },
  {
    name: 'API Reference.pdf',
    path: '/home/Documents/API Reference.pdf',
    type: 'file',
    size: 892416,
  },
  {
    name: 'Research Paper.pdf',
    path: '/home/Documents/Research Paper.pdf',
    type: 'file',
    size: 524288,
  },
];

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(name: string): boolean {
  return name.toLowerCase().endsWith('.pdf');
}

/**
 * Attempt to extract the total page count from raw PDF bytes.
 * Searches for /Count entries in the PDF cross-reference / page tree.
 * Returns 1 if extraction fails.
 */
async function extractPageCount(url: string): Promise<number> {
  try {
    const response = await fetch(url);
    if (!response.ok) return 1;
    const blob = await response.blob();
    if (blob.size > 100 * 1024 * 1024) return 1; // Skip files over 100MB
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    // Search the tail of the file where the cross-reference table lives
    const searchLen = Math.min(bytes.length, 100000);
    const tail = new TextDecoder('latin1').decode(bytes.slice(bytes.length - searchLen));
    const matches = [...tail.matchAll(/\/Count\s+(\d+)/g)];
    if (matches.length > 0) {
      return Math.max(...matches.map((m) => parseInt(m[1], 10)));
    }
    // Fallback: search from the beginning
    const head = new TextDecoder('latin1').decode(bytes.slice(0, searchLen));
    const headMatches = [...head.matchAll(/\/Count\s+(\d+)/g)];
    if (headMatches.length > 0) {
      return Math.max(...headMatches.map((m) => parseInt(m[1], 10)));
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Attempt to extract readable text from a PDF for AI summarization.
 * Works for PDFs with uncompressed text streams (Tj/TJ operators).
 */
async function extractPdfText(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) return '';
    const blob = await response.blob();
    if (blob.size > 50 * 1024 * 1024) return '';
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const raw = new TextDecoder('latin1').decode(bytes);

    const textParts: string[] = [];
    // Extract parenthesized text from Tj operators
    const tjPattern = /\(([^)]{1,1000})\)\s*Tj/g;
    let match;
    while ((match = tjPattern.exec(raw)) !== null) {
      const cleaned = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      textParts.push(cleaned);
    }

    // Also extract TJ array text entries
    const tjArrayPattern = /\[([^\]]{1,5000})\]\s*TJ/g;
    while ((match = tjArrayPattern.exec(raw)) !== null) {
      const inner = match[1];
      const stringPattern = /\(([^)]{1,500})\)/g;
      let strMatch;
      while ((strMatch = stringPattern.exec(inner)) !== null) {
        textParts.push(strMatch[1]);
      }
    }

    if (textParts.length > 0) {
      return textParts.join(' ').substring(0, 8000);
    }
    return '';
  } catch {
    return '';
  }
}

function kernelStatToFileEntry(stat: KernelFileStat): FileEntry {
  return {
    name: stat.name,
    path: stat.path,
    type: stat.type === 'directory' ? 'directory' : 'file',
    size: stat.size,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DocumentsApp: React.FC<DocumentsAppProps> = ({ initialFile }) => {
  // ---- Document state ----
  const [currentFile, setCurrentFile] = useState<string | null>(initialFile || null);
  const [fileName, setFileName] = useState<string>('');
  const [totalPages, setTotalPages] = useState<number>(1);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');

  // ---- Zoom ----
  const [zoom, setZoom] = useState<number>(100);

  // ---- View mode ----
  const [viewMode, setViewMode] = useState<'single' | 'continuous'>('single');

  // ---- Sidebar ----
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true);
  const [sidebarTab, setSidebarTab] = useState<'files' | 'thumbnails'>('files');

  // ---- File browser ----
  const [files, setFiles] = useState<FileEntry[]>(SAMPLE_FILES);
  const [currentDir, setCurrentDir] = useState<string>('/home');
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);

  // ---- Search ----
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ---- AI panel ----
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  // ---- Kernel ----
  const [useKernel, setUseKernel] = useState<boolean>(false);

  // ---- Loading/Error ----
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Refs ----
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pageInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------

  const pdfBaseUrl = useMemo(() => {
    if (!currentFile) return '';
    return `/api/fs/raw?path=${encodeURIComponent(currentFile)}`;
  }, [currentFile]);

  const pdfEmbedUrl = useMemo(() => {
    if (!pdfBaseUrl) return '';
    const hash: string[] = [];
    hash.push('toolbar=0');
    if (currentPage > 1) hash.push(`page=${currentPage}`);
    if (viewMode === 'single') hash.push('view=Fit');
    else hash.push('view=FitH');
    return `${pdfBaseUrl}#${hash.join('&')}`;
  }, [pdfBaseUrl, currentPage, viewMode]);

  // -------------------------------------------------------------------
  // Effects
  // -------------------------------------------------------------------

  // Check kernel connection on mount
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadDirectory('/home');
    }
  }, []);

  // Load initial file if provided
  useEffect(() => {
    if (initialFile) {
      openFile(initialFile, initialFile.split('/').pop() || 'Document');
    }
  }, [initialFile]);

  // Extract page count when a file is opened
  useEffect(() => {
    if (!pdfBaseUrl) return;
    let cancelled = false;
    setLoading(true);
    extractPageCount(pdfBaseUrl)
      .then((count) => {
        if (!cancelled) {
          setTotalPages(count);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfBaseUrl]);

  // Sync page input with current page
  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F: toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      // Escape: close search or AI panel
      if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        if (aiPanelOpen) setAiPanelOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, aiPanelOpen]);

  // -------------------------------------------------------------------
  // Directory & file loading
  // -------------------------------------------------------------------

  const loadDirectory = useCallback(async (path: string) => {
    const client = getKernelClient();
    if (!client.connected) return;
    setLoadingFiles(true);
    try {
      const entries = await client.listDir(path);
      const mapped = entries.map(kernelStatToFileEntry);
      // Sort: directories first, then by name
      mapped.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });
      setFiles(mapped);
      setCurrentDir(path);
    } catch (err) {
      console.error('[DocumentsApp] Failed to list directory:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, []);

  const navigateDir = useCallback(
    (path: string) => {
      if (useKernel) {
        loadDirectory(path);
      }
    },
    [useKernel, loadDirectory],
  );

  const navigateUp = useCallback(() => {
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    navigateDir(parent);
  }, [currentDir, navigateDir]);

  // -------------------------------------------------------------------
  // File opening
  // -------------------------------------------------------------------

  const openFile = useCallback((path: string, name: string) => {
    setCurrentFile(path);
    setFileName(name);
    setCurrentPage(1);
    setPageInput('1');
    setZoom(100);
    setTotalPages(1);
    setError(null);
    setAiSummary('');
    setSidebarTab('thumbnails');
  }, []);

  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      if (entry.type === 'directory') {
        navigateDir(entry.path);
      } else if (isPdf(entry.name)) {
        if (!useKernel) {
          setError(
            'PDF viewing requires a kernel connection. Start the Aether kernel server to view documents.',
          );
          return;
        }
        openFile(entry.path, entry.name);
      }
    },
    [navigateDir, useKernel, openFile],
  );

  // -------------------------------------------------------------------
  // Page navigation
  // -------------------------------------------------------------------

  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(clamped);
    },
    [totalPages],
  );

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const handlePageInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const page = parseInt(pageInput, 10);
        if (!isNaN(page)) {
          goToPage(page);
        }
        (e.target as HTMLInputElement).blur();
      }
    },
    [pageInput, goToPage],
  );

  const handlePageInputBlur = useCallback(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  // -------------------------------------------------------------------
  // Zoom
  // -------------------------------------------------------------------

  const zoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, ZOOM_MAX));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, ZOOM_MIN));
  }, []);

  const fitToWidth = useCallback(() => {
    setZoom(100);
  }, []);

  const fitToPage = useCallback(() => {
    setZoom(75);
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(100);
  }, []);

  // -------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && searchQuery.trim()) {
        // Since we cannot search inside the embedded PDF viewer programmatically,
        // we hint the user to use the browser-native search (Ctrl+F).
        // A more advanced implementation would use PDF.js for text layer search.
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setSearchQuery('');
      }
    },
    [searchQuery],
  );

  // -------------------------------------------------------------------
  // AI summarization
  // -------------------------------------------------------------------

  const handleSummarize = useCallback(async () => {
    if (!currentFile || !pdfBaseUrl) return;
    setAiLoading(true);
    setAiSummary('');
    setAiPanelOpen(true);

    try {
      const text = await extractPdfText(pdfBaseUrl);
      if (text.trim().length > 50) {
        const summary = await generateText(
          `You are a document analysis assistant. Please provide a clear, structured summary of the following document text. Include the main topics, key findings, and important details:\n\n${text}`,
          GeminiModel.FLASH,
        );
        setAiSummary(summary);
      } else {
        const summary = await generateText(
          `The user has opened a PDF document named "${fileName}". The text could not be automatically extracted (it may be scanned or use compressed streams). Based on the filename, provide a helpful response explaining that you'd need the document text to provide a proper summary, and suggest what the document might be about based on its title.`,
          GeminiModel.FLASH,
        );
        setAiSummary(summary);
      }
    } catch (err) {
      setAiSummary(
        'Failed to generate a summary. Please check your AI service connection and try again.',
      );
    } finally {
      setAiLoading(false);
    }
  }, [currentFile, pdfBaseUrl, fileName]);

  // -------------------------------------------------------------------
  // Download
  // -------------------------------------------------------------------

  const handleDownload = useCallback(() => {
    if (!pdfBaseUrl) return;
    const a = document.createElement('a');
    a.href = pdfBaseUrl;
    a.download = fileName || 'document.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [pdfBaseUrl, fileName]);

  // -------------------------------------------------------------------
  // Render: Left Sidebar
  // -------------------------------------------------------------------

  const renderSidebar = () => {
    if (!sidebarOpen) return null;

    return (
      <div className="w-60 bg-[#1e2028] border-r border-white/10 flex flex-col shrink-0">
        {/* Sidebar tab switcher */}
        <div className="flex border-b border-white/10">
          <button
            onClick={() => setSidebarTab('files')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
              sidebarTab === 'files'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <FolderOpen size={13} />
              Files
            </span>
          </button>
          <button
            onClick={() => setSidebarTab('thumbnails')}
            className={`flex-1 px-3 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors ${
              sidebarTab === 'thumbnails'
                ? 'text-blue-400 border-b-2 border-blue-400 bg-white/5'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <span className="flex items-center justify-center gap-1.5">
              <Grid size={13} />
              Pages
            </span>
          </button>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === 'files' ? renderFileBrowser() : renderThumbnails()}
        </div>
      </div>
    );
  };

  const renderFileBrowser = () => (
    <div className="flex flex-col h-full">
      {/* Directory header */}
      <div className="p-2 border-b border-white/5 flex items-center gap-1">
        <button
          onClick={navigateUp}
          disabled={currentDir === '/'}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 disabled:opacity-30 transition-all"
          title="Go up"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          onClick={() => navigateDir('/home')}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
          title="Home"
        >
          <Home size={14} />
        </button>
        <span className="text-xs text-white/50 truncate flex-1 ml-1" title={currentDir}>
          {currentDir}
        </span>
        {useKernel && (
          <button
            onClick={() => loadDirectory(currentDir)}
            className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
            title="Refresh"
          >
            <RefreshCw size={12} className={loadingFiles ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto p-1">
        {loadingFiles && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-white/30" />
          </div>
        )}
        {!loadingFiles && files.length === 0 && (
          <div className="text-xs text-white/30 text-center py-8">No files found</div>
        )}
        {!loadingFiles &&
          files.map((entry) => {
            const isDir = entry.type === 'directory';
            const isPdfFile = isPdf(entry.name);
            const isActive = currentFile === entry.path;
            return (
              <button
                key={entry.path}
                onClick={() => handleFileClick(entry)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2.5 group transition-all ${
                  isActive
                    ? 'bg-blue-500/15 text-blue-400'
                    : 'text-white/60 hover:bg-white/5 hover:text-white/80'
                }`}
              >
                {isDir ? (
                  <Folder size={16} className="text-blue-400/70 shrink-0" />
                ) : isPdfFile ? (
                  <FileText size={16} className="text-red-400/70 shrink-0" />
                ) : (
                  <File size={16} className="text-white/30 shrink-0" />
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate text-xs font-medium">{entry.name}</span>
                  {!isDir && (
                    <span className="text-[10px] text-white/30">{formatFileSize(entry.size)}</span>
                  )}
                </div>
              </button>
            );
          })}
      </div>

      {/* Kernel status */}
      <div className="p-2 border-t border-white/5 text-[10px] text-white/30 flex items-center gap-1.5">
        <div className={`w-1.5 h-1.5 rounded-full ${useKernel ? 'bg-green-400' : 'bg-white/20'}`} />
        {useKernel ? 'Kernel FS' : 'Demo Mode'}
      </div>
    </div>
  );

  const renderThumbnails = () => {
    if (!currentFile) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/30 p-4">
          <FileText size={32} className="mb-3 opacity-40" />
          <span className="text-xs text-center">Open a PDF to see page thumbnails</span>
        </div>
      );
    }

    const pageCount = Math.min(totalPages, MAX_THUMBNAIL_PAGES);

    return (
      <div className="p-2 grid grid-cols-2 gap-2">
        {Array.from({ length: pageCount }, (_, i) => i + 1).map((pageNum) => (
          <button
            key={pageNum}
            onClick={() => goToPage(pageNum)}
            className={`aspect-[3/4] rounded-lg border-2 flex flex-col items-center justify-center transition-all ${
              currentPage === pageNum
                ? 'border-blue-500 bg-blue-500/10 text-blue-400 shadow-lg shadow-blue-500/10'
                : 'border-white/10 bg-white/5 text-white/40 hover:border-white/20 hover:bg-white/10'
            }`}
          >
            <FileText size={18} className="opacity-40 mb-1" />
            <span className="text-[10px] font-medium">{pageNum}</span>
          </button>
        ))}
        {totalPages > MAX_THUMBNAIL_PAGES && (
          <div className="col-span-2 text-[10px] text-white/30 text-center py-2">
            Showing first {MAX_THUMBNAIL_PAGES} of {totalPages} pages
          </div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render: Toolbar
  // -------------------------------------------------------------------

  const renderToolbar = () => (
    <div className="h-11 bg-[#252830] border-b border-white/10 flex items-center px-2 gap-1 shrink-0">
      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen((prev) => !prev)}
        className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        <Sidebar size={16} />
      </button>

      {/* Separator */}
      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* File name */}
      <div className="flex items-center gap-1.5 px-2 min-w-0 max-w-[180px]">
        <FileText size={14} className="text-red-400/70 shrink-0" />
        <span className="text-xs text-white/70 truncate font-medium">
          {fileName || 'No file open'}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Page navigation */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={prevPage}
          disabled={!currentFile || currentPage <= 1}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
          title="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-1 text-xs">
          <input
            ref={pageInputRef}
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handlePageInputKeyDown}
            onBlur={handlePageInputBlur}
            disabled={!currentFile}
            className="w-10 bg-white/5 border border-white/10 rounded px-1.5 py-1 text-center text-white/80 text-xs focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 disabled:opacity-30 transition-all"
          />
          <span className="text-white/40">/</span>
          <span className="text-white/50 min-w-[20px] text-center">{totalPages}</span>
        </div>
        <button
          onClick={nextPage}
          disabled={!currentFile || currentPage >= totalPages}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-all"
          title="Next page"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Separator */}
      <div className="w-px h-5 bg-white/10 mx-1" />

      {/* Zoom controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={zoomOut}
          disabled={!currentFile || zoom <= ZOOM_MIN}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all"
          title="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <button
          onClick={resetZoom}
          disabled={!currentFile}
          className="px-2 py-1 rounded-lg text-xs text-white/60 hover:text-white hover:bg-white/5 disabled:opacity-30 font-medium min-w-[44px] text-center transition-all"
          title="Reset zoom"
        >
          {zoom}%
        </button>
        <button
          onClick={zoomIn}
          disabled={!currentFile || zoom >= ZOOM_MAX}
          className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all"
          title="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          onClick={fitToWidth}
          disabled={!currentFile}
          className={`p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all ${
            zoom === 100 ? 'bg-white/5 text-white/80' : ''
          }`}
          title="Fit to width"
        >
          <Maximize size={14} />
        </button>
        <button
          onClick={fitToPage}
          disabled={!currentFile}
          className={`p-1.5 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 font-medium transition-all ${
            zoom === 75 ? 'bg-white/5 text-white/80' : ''
          }`}
          title="Fit to page"
        >
          <BookOpen size={14} />
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right side controls */}
      <div className="flex items-center gap-0.5">
        {/* Search toggle */}
        <button
          onClick={() => setSearchOpen((prev) => !prev)}
          className={`p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 transition-all ${
            searchOpen ? 'bg-white/5 text-white/80' : ''
          }`}
          title="Search (Ctrl+F)"
        >
          <Search size={15} />
        </button>

        {/* View mode toggle */}
        <button
          onClick={() => setViewMode((prev) => (prev === 'single' ? 'continuous' : 'single'))}
          disabled={!currentFile}
          className={`p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all flex items-center gap-1`}
          title={viewMode === 'single' ? 'Switch to continuous scroll' : 'Switch to single page'}
        >
          {viewMode === 'single' ? <FileText size={15} /> : <ChevronDown size={15} />}
          <span className="text-[10px] font-medium uppercase hidden xl:inline">
            {viewMode === 'single' ? 'Single' : 'Scroll'}
          </span>
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-white/10 mx-1" />

        {/* Download */}
        <button
          onClick={handleDownload}
          disabled={!currentFile}
          className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/5 disabled:opacity-30 transition-all"
          title="Download PDF"
        >
          <Download size={15} />
        </button>

        {/* AI Summarize */}
        <button
          onClick={handleSummarize}
          disabled={!currentFile || aiLoading}
          className={`p-2 rounded-lg hover:bg-white/5 disabled:opacity-30 transition-all flex items-center gap-1.5 ${
            aiPanelOpen ? 'text-blue-400 bg-blue-500/10' : 'text-white/50 hover:text-white'
          }`}
          title="AI Summarize"
        >
          {aiLoading ? <Loader2 size={15} className="animate-spin" /> : <Bot size={15} />}
          <span className="text-[10px] font-medium uppercase hidden lg:inline">AI</span>
        </button>
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Render: Search bar
  // -------------------------------------------------------------------

  const renderSearchBar = () => {
    if (!searchOpen) return null;

    return (
      <div className="bg-[#252830] border-b border-white/10 px-3 py-2 flex items-center gap-2 shrink-0">
        <Search size={14} className="text-white/40 shrink-0" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder="Search in document... (use Ctrl+F inside the viewer)"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-white/30 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
        />
        <button
          onClick={() => {
            setSearchOpen(false);
            setSearchQuery('');
          }}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
        >
          <X size={14} />
        </button>
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render: AI Panel
  // -------------------------------------------------------------------

  const renderAiPanel = () => {
    if (!aiPanelOpen) return null;

    return (
      <div className="w-72 bg-[#1e2028] border-l border-white/10 flex flex-col shrink-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-blue-400" />
            <span className="text-xs font-semibold text-white/80 uppercase tracking-wide">
              AI Summary
            </span>
          </div>
          <button
            onClick={() => setAiPanelOpen(false)}
            className="p-1 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/5 transition-all"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {aiLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={24} className="animate-spin text-blue-400" />
              <span className="text-xs text-white/40">Analyzing document...</span>
            </div>
          )}

          {!aiLoading && !aiSummary && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Bot size={32} className="text-white/20" />
              <span className="text-xs text-white/30">
                Click the AI button to generate a summary of the current document.
              </span>
              <button
                onClick={handleSummarize}
                disabled={!currentFile}
                className="mt-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/30 disabled:opacity-30 transition-all"
              >
                Summarize Document
              </button>
            </div>
          )}

          {!aiLoading && aiSummary && (
            <div className="space-y-3">
              <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-4">
                <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
                  {aiSummary}
                </p>
              </div>
              <button
                onClick={handleSummarize}
                disabled={!currentFile}
                className="w-full px-3 py-2 bg-white/5 text-white/50 rounded-lg text-xs font-medium hover:bg-white/10 hover:text-white/70 disabled:opacity-30 transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={12} />
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render: Welcome state
  // -------------------------------------------------------------------

  const renderWelcome = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-8">
      <div className="max-w-md w-full text-center">
        {/* Icon */}
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-red-500/20 to-orange-500/20 border border-white/10 flex items-center justify-center mx-auto mb-6">
          <FileText size={36} className="text-red-400/80" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white/90 mb-2">Aether Documents</h2>
        <p className="text-sm text-white/40 mb-8">
          Open and view PDF documents with AI-powered summarization.
        </p>

        {/* Quick actions */}
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl p-5 text-left space-y-3">
          <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wide mb-3">
            Get Started
          </h3>
          <div className="flex items-start gap-3 text-sm text-white/50">
            <FolderOpen size={16} className="text-blue-400/70 shrink-0 mt-0.5" />
            <span>Browse and open PDF files from the sidebar file browser</span>
          </div>
          <div className="flex items-start gap-3 text-sm text-white/50">
            <Search size={16} className="text-green-400/70 shrink-0 mt-0.5" />
            <span>Search within documents using Ctrl+F</span>
          </div>
          <div className="flex items-start gap-3 text-sm text-white/50">
            <Bot size={16} className="text-purple-400/70 shrink-0 mt-0.5" />
            <span>Generate AI summaries with Gemini</span>
          </div>
          <div className="flex items-start gap-3 text-sm text-white/50">
            <BookOpen size={16} className="text-orange-400/70 shrink-0 mt-0.5" />
            <span>Switch between single page and continuous scroll views</span>
          </div>
        </div>

        {/* Kernel status hint */}
        {!useKernel && (
          <div className="mt-6 bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-xs text-yellow-400/80 flex items-start gap-2">
            <RefreshCw size={14} className="shrink-0 mt-0.5" />
            <span>
              Connect to the Aether kernel to browse and view PDF files from the filesystem. Running
              in demo mode.
            </span>
          </div>
        )}
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Render: Error state
  // -------------------------------------------------------------------

  const renderError = () => {
    if (!error) return null;

    return (
      <div className="absolute inset-4 z-10 flex items-center justify-center">
        <div className="bg-[#252830] border border-white/10 rounded-xl p-6 max-w-sm text-center shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <X size={24} className="text-red-400" />
          </div>
          <h3 className="text-sm font-semibold text-white/80 mb-2">Unable to Open Document</h3>
          <p className="text-xs text-white/40 mb-4">{error}</p>
          <button
            onClick={() => setError(null)}
            className="px-4 py-2 bg-white/10 text-white/70 rounded-lg text-xs font-medium hover:bg-white/15 transition-all"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render: PDF Viewer
  // -------------------------------------------------------------------

  const renderViewer = () => {
    if (!currentFile) return renderWelcome();

    return (
      <div className="flex-1 relative overflow-hidden bg-[#1a1d26]" ref={scrollContainerRef}>
        {/* Loading overlay */}
        {loading && (
          <div className="absolute inset-0 bg-[#1a1d26]/80 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <Loader2 size={28} className="animate-spin text-blue-400" />
              <span className="text-xs text-white/40">Loading document...</span>
            </div>
          </div>
        )}

        {/* Error overlay */}
        {renderError()}

        {/* PDF embed with zoom */}
        <div
          className="w-full h-full"
          style={{
            transform: zoom !== 100 ? `scale(${zoom / 100})` : undefined,
            transformOrigin: 'top center',
            width: zoom > 100 ? `${10000 / zoom}%` : '100%',
            height: zoom > 100 ? `${10000 / zoom}%` : '100%',
          }}
        >
          <object data={pdfEmbedUrl} type="application/pdf" className="w-full h-full">
            {/* Fallback if the browser cannot display the PDF inline */}
            <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
              <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-white/10 flex items-center justify-center">
                <FileText size={32} className="text-red-400/60" />
              </div>
              <div className="text-center">
                <h3 className="text-sm font-semibold text-white/80 mb-1">
                  Cannot display PDF inline
                </h3>
                <p className="text-xs text-white/40 mb-4">
                  Your browser does not support embedded PDF viewing.
                </p>
                <a
                  href={pdfBaseUrl}
                  download={fileName}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/20 text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-500/30 transition-all"
                >
                  <Download size={14} />
                  Download PDF
                </a>
              </div>
            </div>
          </object>
        </div>
      </div>
    );
  };

  // -------------------------------------------------------------------
  // Render: Status bar
  // -------------------------------------------------------------------

  const renderStatusBar = () => (
    <div className="h-7 bg-[#1e2028] border-t border-white/10 flex items-center px-3 justify-between text-[10px] text-white/40 select-none shrink-0">
      <div className="flex items-center gap-3">
        {currentFile ? (
          <>
            <span className="font-medium text-white/50">{fileName}</span>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <span>Zoom: {zoom}%</span>
            <span className="capitalize">{viewMode} view</span>
          </>
        ) : (
          <span>No document open</span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <div
            className={`w-1.5 h-1.5 rounded-full ${useKernel ? 'bg-green-400' : 'bg-white/20'}`}
          />
          {useKernel ? 'Connected' : 'Offline'}
        </span>
        {currentFile && (
          <span title={currentFile} className="truncate max-w-[200px]">
            {currentFile}
          </span>
        )}
      </div>
    </div>
  );

  // -------------------------------------------------------------------
  // Main Render
  // -------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full bg-[#1a1d26] text-white overflow-hidden">
      {/* Toolbar */}
      {renderToolbar()}

      {/* Search bar (conditional) */}
      {renderSearchBar()}

      {/* Main content area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left sidebar */}
        {renderSidebar()}

        {/* PDF Viewer */}
        {renderViewer()}

        {/* AI Panel (right) */}
        {renderAiPanel()}
      </div>

      {/* Status bar */}
      {renderStatusBar()}
    </div>
  );
};
