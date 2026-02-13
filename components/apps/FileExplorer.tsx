import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Folder,
  FileText,
  Image,
  Music,
  Video,
  ChevronLeft,
  ChevronRight,
  Home,
  Search,
  Download,
  HardDrive,
  Grid,
  List,
  Monitor,
  Code,
  Archive,
  ArrowUpDown,
  Star,
  RefreshCw,
  Upload,
  Share2,
} from 'lucide-react';
import { FileSystemItem } from '../../data/mockFileSystem';
import { getKernelClient, KernelFileStat } from '../../services/kernelClient';

type SortField = 'name' | 'date' | 'size';
type SortOrder = 'asc' | 'desc';

interface FileExplorerProps {
  files: FileSystemItem[];
  onOpenFile: (file: FileSystemItem) => void;
  onNavigate?: (folderId: string) => void;
}

// Convert kernel file stat to FileSystemItem for UI compatibility
function kernelStatToFile(stat: KernelFileStat, parentPath: string): FileSystemItem {
  const ext = stat.name.split('.').pop()?.toLowerCase() || '';
  let kind: string = 'text';
  if (stat.type === 'directory') kind = 'folder';
  else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) kind = 'image';
  else if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) kind = 'audio';
  else if (['mp4', 'webm', 'avi', 'mkv', 'mov'].includes(ext)) kind = 'video';
  else if (
    [
      'ts',
      'js',
      'tsx',
      'jsx',
      'py',
      'rs',
      'go',
      'c',
      'cpp',
      'h',
      'java',
      'sh',
      'json',
      'yaml',
      'toml',
      'css',
      'html',
      'sql',
      'rb',
      'php',
    ].includes(ext)
  )
    kind = 'code';
  else if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar'].includes(ext)) kind = 'archive';

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return {
    id: stat.path,
    parentId: parentPath,
    name: stat.name,
    type: stat.type === 'directory' ? 'folder' : 'file',
    kind,
    date: new Date(stat.modifiedAt).toLocaleDateString(),
    size: stat.type === 'directory' ? '--' : formatSize(stat.size),
  };
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ files, onOpenFile }) => {
  const [currentPath, setCurrentPath] = useState<string>('root');
  const [kernelPath, setKernelPath] = useState<string>('/home');
  const [history, setHistory] = useState<string[]>(['root']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [useKernel, setUseKernel] = useState(false);
  const [kernelFiles, setKernelFiles] = useState<FileSystemItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check kernel connection on mount
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadKernelDir('/home');
    }
  }, []);

  const loadKernelDir = useCallback(async (path: string) => {
    const client = getKernelClient();
    if (!client.connected) return;

    setLoading(true);
    try {
      const entries = await client.listDir(path);
      const items = entries.map((stat: KernelFileStat) => kernelStatToFile(stat, path));
      setKernelFiles(items);
      setKernelPath(path);
    } catch (err) {
      console.error('[FileExplorer] Failed to list directory:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0 || !useKernel) return;

      const client = getKernelClient();
      if (!client.connected) return;

      setUploading(true);
      try {
        for (let i = 0; i < files.length; i++) {
          await client.uploadFile(files[i], kernelPath);
        }
        // Refresh directory after upload
        await loadKernelDir(kernelPath);
      } catch (err) {
        console.error('[FileExplorer] Upload failed:', err);
      } finally {
        setUploading(false);
        // Reset input so same file can be re-uploaded
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [useKernel, kernelPath, loadKernelDir],
  );

  // Auto-refresh when files change in shared directory
  useEffect(() => {
    if (!useKernel || !kernelPath.startsWith('/shared')) return;

    const client = getKernelClient();
    const unsub = client.on('fs.changed', (data: any) => {
      if (data.path && data.path.startsWith('/shared')) {
        // Debounce: reload after a short delay
        setTimeout(() => loadKernelDir(kernelPath), 500);
      }
    });

    return unsub;
  }, [useKernel, kernelPath, loadKernelDir]);

  // Filtered and sorted files
  const processedFiles = useMemo(() => {
    let currentFiles: FileSystemItem[] = [];

    if (useKernel) {
      // Kernel mode: use loaded kernel files
      if (searchQuery.trim()) {
        currentFiles = kernelFiles.filter((item) =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase()),
        );
      } else {
        currentFiles = kernelFiles;
      }
    } else {
      // Mock mode: use prop-based files
      if (searchQuery.trim()) {
        currentFiles = files.filter(
          (item) =>
            item.name.toLowerCase().includes(searchQuery.toLowerCase()) && item.id !== 'root',
        );
      } else {
        currentFiles = files.filter((item) => item.parentId === currentPath);
      }
    }

    return currentFiles.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
          // Folders first
          if (a.type === 'folder' && b.type !== 'folder') return -1;
          if (a.type !== 'folder' && b.type === 'folder') return 1;
          comparison = a.name.localeCompare(b.name);
          break;
        case 'date':
          comparison = a.date.localeCompare(b.date);
          break;
        case 'size':
          comparison = (a.size || '').localeCompare(b.size || '');
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [currentPath, searchQuery, sortField, sortOrder, files, useKernel, kernelFiles]);

  const getBreadcrumbs = () => {
    if (searchQuery) return 'Search Results';
    if (useKernel) return kernelPath;
    if (currentPath === 'root') return 'Home';
    const folder = files.find((f) => f.id === currentPath);
    return folder ? folder.name : 'Unknown';
  };

  const navigate = (id: string) => {
    setSearchQuery('');
    setSelectedId(null);

    if (useKernel) {
      // In kernel mode, id is a filesystem path
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(id);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      loadKernelDir(id);
    } else {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(id);
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      setCurrentPath(id);
    }
  };

  const handleDoubleClick = async (file: FileSystemItem) => {
    if (file.type === 'folder') {
      if (useKernel) {
        // Kernel mode: navigate to the kernel path
        const newPath = file.id; // file.id is the full path from kernel
        navigate(newPath);
      } else {
        navigate(file.id);
      }
    } else {
      if (useKernel) {
        // Load file content from kernel for opening
        try {
          const client = getKernelClient();
          const { content } = await client.readFile(file.id);
          onOpenFile({ ...file, content });
        } catch {
          onOpenFile(file);
        }
      } else {
        onOpenFile(file);
      }
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prevEntry = history[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      setSearchQuery('');
      if (useKernel) {
        loadKernelDir(prevEntry);
      } else {
        setCurrentPath(prevEntry);
      }
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const nextEntry = history[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      setSearchQuery('');
      if (useKernel) {
        loadKernelDir(nextEntry);
      } else {
        setCurrentPath(nextEntry);
      }
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getIcon = (kind: string) => {
    const size = viewMode === 'grid' ? 48 : 20;
    switch (kind) {
      case 'folder':
        return <Folder className="text-blue-400 fill-blue-400/20" size={size} />;
      case 'image':
        return <Image className="text-purple-400" size={size} />;
      case 'text':
        return <FileText className="text-gray-400" size={size} />;
      case 'app':
        return <HardDrive className="text-slate-500" size={size} />;
      case 'audio':
        return <Music className="text-pink-400" size={size} />;
      case 'video':
        return <Video className="text-orange-400" size={size} />;
      case 'code':
        return <Code className="text-green-500" size={size} />;
      case 'archive':
        return <Archive className="text-yellow-500" size={size} />;
      default:
        return <FileText className="text-gray-400" size={size} />;
    }
  };

  return (
    <div className="flex h-full bg-white/80 backdrop-blur-xl text-gray-800 font-sans">
      {/* Sidebar */}
      <div className="w-48 bg-gray-100/50 border-r border-gray-200/50 p-3 flex flex-col gap-1 backdrop-blur-md">
        <div className="text-xs font-semibold text-gray-400 px-3 py-2 mb-1 uppercase tracking-wider">
          Favorites
        </div>
        {useKernel ? (
          <>
            <button
              onClick={() => navigate('/home')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath === '/home' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Home size={16} className="text-blue-500" /> Home
            </button>
            <button
              onClick={() => navigate('/home/root')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath === '/home/root' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Monitor size={16} className="text-teal-500" /> Root
            </button>
            <button
              onClick={() => navigate('/home/root/Documents')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath.includes('/Documents') ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <FileText size={16} className="text-blue-500" /> Documents
            </button>
            <button
              onClick={() => navigate('/home/root/Projects')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath.includes('/Projects') ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Code size={16} className="text-green-600" /> Projects
            </button>
            <button
              onClick={() => navigate('/tmp')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath === '/tmp' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Download size={16} className="text-orange-500" /> Tmp
            </button>
            <button
              onClick={() => navigate('/shared')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${kernelPath === '/shared' || kernelPath.startsWith('/shared/') ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Share2 size={16} className="text-indigo-500" /> Shared
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => navigate('root')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'root' && !searchQuery ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Home size={16} className="text-blue-500" /> Home
            </button>
            <button
              onClick={() => navigate('desktop')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'desktop' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Monitor size={16} className="text-teal-500" /> Desktop
            </button>
            <button
              onClick={() => navigate('documents')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'documents' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <FileText size={16} className="text-blue-500" /> Documents
            </button>
            <button
              onClick={() => navigate('downloads')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'downloads' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Download size={16} className="text-orange-500" /> Downloads
            </button>
            <button
              onClick={() => navigate('pictures')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'pictures' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Image size={16} className="text-purple-500" /> Pictures
            </button>
            <button
              onClick={() => navigate('developer')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'developer' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}
            >
              <Code size={16} className="text-green-600" /> Developer
            </button>
          </>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-12 border-b border-gray-200/50 flex items-center px-4 justify-between bg-white/40">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button
                onClick={goBack}
                disabled={historyIndex === 0}
                className="p-1 rounded hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={goForward}
                disabled={historyIndex === history.length - 1}
                className="p-1 rounded hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <span className="font-semibold text-sm text-gray-700 truncate max-w-[300px]">
              {getBreadcrumbs()}
            </span>
            {useKernel && (
              <button
                onClick={() => loadKernelDir(kernelPath)}
                className="p-1 rounded hover:bg-black/5 transition-all text-gray-400 hover:text-gray-700"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {useKernel && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={handleUpload}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 transition-all disabled:opacity-50"
                  title="Upload files"
                >
                  <Upload size={13} className={uploading ? 'animate-pulse' : ''} />
                  <span>{uploading ? 'Uploading...' : 'Upload'}</span>
                </button>
              </>
            )}

            <div className="bg-gray-100/50 rounded-lg p-1 flex">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <Grid size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
              >
                <List size={14} />
              </button>
            </div>

            <div
              className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100/50 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-200/50"
              onClick={() => toggleSort('name')}
            >
              <ArrowUpDown size={12} />
              <span className="capitalize">{sortField}</span>
            </div>

            <div className="relative group">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="bg-gray-100/50 pl-8 pr-3 py-1.5 rounded-lg text-sm w-40 focus:w-52 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all"
              />
            </div>
          </div>
        </div>

        {/* File Area */}
        <div className="flex-1 overflow-y-auto p-4 relative" onClick={() => setSelectedId(null)}>
          {loading && (
            <div className="absolute inset-0 bg-white/50 flex items-center justify-center z-10">
              <RefreshCw size={24} className="animate-spin text-blue-500" />
            </div>
          )}
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4">
              {processedFiles.map((file) => (
                <div
                  key={file.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(file.id);
                  }}
                  onDoubleClick={() => handleDoubleClick(file)}
                  className={`group flex flex-col items-center gap-2 p-3 rounded-xl border border-transparent transition-all cursor-default ${selectedId === file.id ? 'bg-blue-100/50 border-blue-200 shadow-sm' : 'hover:bg-gray-100/50'}`}
                >
                  <div className="w-16 h-14 flex items-center justify-center relative transition-transform group-hover:scale-105">
                    {getIcon(file.kind)}
                    {file.starred && (
                      <Star
                        size={10}
                        className="absolute top-0 right-0 text-yellow-400 fill-yellow-400"
                      />
                    )}
                  </div>
                  <div className="flex flex-col items-center w-full">
                    <span
                      className={`text-xs text-center truncate w-full px-1 ${selectedId === file.id ? 'text-blue-700 font-medium' : 'text-gray-600'}`}
                    >
                      {file.name}
                    </span>
                    <span className="text-[10px] text-gray-400">{file.date}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full text-sm text-left border-collapse">
              <thead className="text-xs text-gray-500 border-b border-gray-200/50 font-medium bg-gray-50/30 sticky top-0 backdrop-blur-sm">
                <tr>
                  <th className="px-4 py-2 w-10"></th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100/50"
                    onClick={() => toggleSort('name')}
                  >
                    Name
                  </th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100/50"
                    onClick={() => toggleSort('date')}
                  >
                    Date Modified
                  </th>
                  <th
                    className="px-4 py-2 cursor-pointer hover:bg-gray-100/50"
                    onClick={() => toggleSort('size')}
                  >
                    Size
                  </th>
                  <th className="px-4 py-2 w-10"></th>
                </tr>
              </thead>
              <tbody>
                {processedFiles.map((file) => (
                  <tr
                    key={file.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(file.id);
                    }}
                    onDoubleClick={() => handleDoubleClick(file)}
                    className={`cursor-default group ${selectedId === file.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-2">{getIcon(file.kind)}</td>
                    <td className="px-4 py-2 font-medium text-gray-700">{file.name}</td>
                    <td className="px-4 py-2 text-gray-500">{file.date}</td>
                    <td className="px-4 py-2 text-gray-500">{file.size || '--'}</td>
                    <td className="px-4 py-2 text-center">
                      {file.starred && (
                        <Star size={12} className="text-yellow-400 fill-yellow-400 inline" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {processedFiles.length === 0 && !loading && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Search size={48} className="mb-4 opacity-20" />
              <p className="text-sm font-medium">No items found</p>
              {searchQuery && (
                <p className="text-xs opacity-70 mt-1">Try a different search term</p>
              )}
            </div>
          )}
        </div>

        {/* Footer Status */}
        <div className="h-8 bg-gray-50/50 border-t border-gray-200/50 flex items-center px-4 text-xs text-gray-500 justify-between select-none">
          <span>
            {processedFiles.length} item{processedFiles.length !== 1 && 's'}
            {useKernel && <span className="ml-2 text-blue-500">Kernel FS</span>}
          </span>
          {selectedId && <span className="font-medium text-gray-600">1 item selected</span>}
        </div>
      </div>
    </div>
  );
};
