import React, { useState, useMemo } from 'react';
import { 
  Folder, FileText, Image, Music, Video, 
  ChevronLeft, ChevronRight, Home, Search, 
  Download, HardDrive, Grid, List, Monitor,
  Code, Archive, ArrowUpDown, Star, FilePlus, FolderPlus
} from 'lucide-react';
import { FileSystemItem } from '../../data/mockFileSystem';

type SortField = 'name' | 'date' | 'size';
type SortOrder = 'asc' | 'desc';

interface FileExplorerProps {
  files: FileSystemItem[];
  onOpenFile: (file: FileSystemItem) => void;
  onNavigate?: (folderId: string) => void; // Optional hook for parent to know navigation
}

export const FileExplorer: React.FC<FileExplorerProps> = ({ files, onOpenFile }) => {
  const [currentPath, setCurrentPath] = useState<string>('root');
  const [history, setHistory] = useState<string[]>(['root']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Filter and Sort Logic
  const processedFiles = useMemo(() => {
    let currentFiles = [];
    
    if (searchQuery.trim()) {
      // Global Search
      currentFiles = files.filter(item => 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) && item.id !== 'root'
      );
    } else {
      // Current Directory
      currentFiles = files.filter(item => item.parentId === currentPath);
    }

    // Sorting
    return currentFiles.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'name':
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
  }, [currentPath, searchQuery, sortField, sortOrder, files]);

  const getBreadcrumbs = () => {
    if (searchQuery) return 'Search Results';
    if (currentPath === 'root') return 'Home';
    const folder = files.find(f => f.id === currentPath);
    return folder ? folder.name : 'Unknown';
  };

  const navigate = (id: string) => {
    setSearchQuery(''); 
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(id);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    setCurrentPath(id);
    setSelectedId(null);
  };

  const handleDoubleClick = (file: FileSystemItem) => {
    if (file.type === 'folder') {
      navigate(file.id);
    } else {
      onOpenFile(file);
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
      setCurrentPath(history[historyIndex - 1]);
      setSearchQuery('');
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(historyIndex + 1);
      setCurrentPath(history[historyIndex + 1]);
      setSearchQuery('');
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const getIcon = (kind: string) => {
    const size = viewMode === 'grid' ? 48 : 20;
    switch(kind) {
      case 'folder': return <Folder className="text-blue-400 fill-blue-400/20" size={size} />;
      case 'image': return <Image className="text-purple-400" size={size} />;
      case 'text': return <FileText className="text-gray-400" size={size} />;
      case 'app': return <HardDrive className="text-slate-500" size={size} />;
      case 'audio': return <Music className="text-pink-400" size={size} />;
      case 'video': return <Video className="text-orange-400" size={size} />;
      case 'code': return <Code className="text-green-500" size={size} />;
      case 'archive': return <Archive className="text-yellow-500" size={size} />;
      default: return <FileText className="text-gray-400" size={size} />;
    }
  };

  return (
    <div className="flex h-full bg-white/80 backdrop-blur-xl text-gray-800 font-sans">
      {/* Sidebar */}
      <div className="w-48 bg-gray-100/50 border-r border-gray-200/50 p-3 flex flex-col gap-1 backdrop-blur-md">
        <div className="text-xs font-semibold text-gray-400 px-3 py-2 mb-1 uppercase tracking-wider">Favorites</div>
        <button onClick={() => navigate('root')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'root' && !searchQuery ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <Home size={16} className="text-blue-500" /> Home
        </button>
        <button onClick={() => navigate('desktop')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'desktop' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <Monitor size={16} className="text-teal-500" /> Desktop
        </button>
        <button onClick={() => navigate('documents')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'documents' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <FileText size={16} className="text-blue-500" /> Documents
        </button>
        <button onClick={() => navigate('downloads')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'downloads' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <Download size={16} className="text-orange-500" /> Downloads
        </button>
        <button onClick={() => navigate('pictures')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'pictures' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <Image size={16} className="text-purple-500" /> Pictures
        </button>
        <button onClick={() => navigate('developer')} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${currentPath === 'developer' ? 'bg-black/5 font-medium' : 'hover:bg-black/5 text-gray-600'}`}>
          <Code size={16} className="text-green-600" /> Developer
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="h-12 border-b border-gray-200/50 flex items-center px-4 justify-between bg-white/40">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <button onClick={goBack} disabled={historyIndex === 0} className="p-1 rounded hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95">
                <ChevronLeft size={20} />
              </button>
              <button onClick={goForward} disabled={historyIndex === history.length - 1} className="p-1 rounded hover:bg-black/5 disabled:opacity-30 transition-all active:scale-95">
                <ChevronRight size={20} />
              </button>
            </div>
            <span className="font-semibold text-sm text-gray-700">{getBreadcrumbs()}</span>
          </div>

          <div className="flex items-center gap-3">
             {/* View Toggles */}
            <div className="bg-gray-100/50 rounded-lg p-1 flex">
               <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded transition-all ${viewMode === 'grid' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                 <Grid size={14} />
               </button>
               <button onClick={() => setViewMode('list')} className={`p-1.5 rounded transition-all ${viewMode === 'list' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}>
                 <List size={14} />
               </button>
            </div>

            {/* Sort Menu */}
            <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100/50 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-gray-200/50" onClick={() => toggleSort('name')}>
                <ArrowUpDown size={12} />
                <span className="capitalize">{sortField}</span>
            </div>

            {/* Search */}
            <div className="relative group">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" />
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
        <div 
          className="flex-1 overflow-y-auto p-4 relative" 
          onClick={() => setSelectedId(null)}
        >
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-4">
              {processedFiles.map(file => (
                <div 
                  key={file.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(file.id); }}
                  onDoubleClick={() => handleDoubleClick(file)}
                  className={`group flex flex-col items-center gap-2 p-3 rounded-xl border border-transparent transition-all cursor-default ${selectedId === file.id ? 'bg-blue-100/50 border-blue-200 shadow-sm' : 'hover:bg-gray-100/50'}`}
                >
                  <div className="w-16 h-14 flex items-center justify-center relative transition-transform group-hover:scale-105">
                    {getIcon(file.kind)}
                    {file.starred && <Star size={10} className="absolute top-0 right-0 text-yellow-400 fill-yellow-400" />}
                  </div>
                  <div className="flex flex-col items-center w-full">
                      <span className={`text-xs text-center truncate w-full px-1 ${selectedId === file.id ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>
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
                   <th className="px-4 py-2 cursor-pointer hover:bg-gray-100/50" onClick={() => toggleSort('name')}>Name</th>
                   <th className="px-4 py-2 cursor-pointer hover:bg-gray-100/50" onClick={() => toggleSort('date')}>Date Modified</th>
                   <th className="px-4 py-2 cursor-pointer hover:bg-gray-100/50" onClick={() => toggleSort('size')}>Size</th>
                   <th className="px-4 py-2 w-10"></th>
                 </tr>
               </thead>
               <tbody>
                  {processedFiles.map(file => (
                    <tr 
                      key={file.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(file.id); }}
                      onDoubleClick={() => handleDoubleClick(file)}
                      className={`cursor-default group ${selectedId === file.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-4 py-2">{getIcon(file.kind)}</td>
                      <td className="px-4 py-2 font-medium text-gray-700">
                          {file.name}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{file.date}</td>
                      <td className="px-4 py-2 text-gray-500">{file.size || '--'}</td>
                      <td className="px-4 py-2 text-center">
                          {file.starred && <Star size={12} className="text-yellow-400 fill-yellow-400 inline" />}
                      </td>
                    </tr>
                  ))}
               </tbody>
             </table>
          )}
          
          {processedFiles.length === 0 && (
             <div className="h-full flex flex-col items-center justify-center text-gray-400">
               <Search size={48} className="mb-4 opacity-20" />
               <p className="text-sm font-medium">No items found</p>
               {searchQuery && <p className="text-xs opacity-70 mt-1">Try a different search term</p>}
             </div>
          )}
        </div>
        
        {/* Footer Status */}
        <div className="h-8 bg-gray-50/50 border-t border-gray-200/50 flex items-center px-4 text-xs text-gray-500 justify-between select-none">
           <span>{processedFiles.length} item{processedFiles.length !== 1 && 's'}</span>
           {selectedId && <span className="font-medium text-gray-600">1 item selected</span>}
        </div>
      </div>
    </div>
  );
};