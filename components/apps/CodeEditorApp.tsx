import React, { useState, useEffect, useRef, useCallback } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditor } from 'monaco-editor';
import {
  Save,
  X,
  FileCode,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  File,
  Search,
  GitBranch,
  Settings,
  Play,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CodeEditorAppProps {
  initialContent?: string;
  fileName?: string;
  filePath?: string;
  onSave?: (content: string) => void;
}

interface EditorTab {
  id: string;
  fileName: string;
  filePath: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  language: string;
}

interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  css: 'css',
  html: 'html',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
};

function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return EXTENSION_LANGUAGE_MAP[ext] || 'plaintext';
}

// ---------------------------------------------------------------------------
// Mock file tree (used when kernel is not connected)
// ---------------------------------------------------------------------------

const MOCK_FILE_TREE: FileTreeNode[] = [
  {
    name: 'src',
    path: '/src',
    type: 'directory',
    children: [
      {
        name: 'components',
        path: '/src/components',
        type: 'directory',
        children: [
          { name: 'App.tsx', path: '/src/components/App.tsx', type: 'file' },
          { name: 'Header.tsx', path: '/src/components/Header.tsx', type: 'file' },
          { name: 'Sidebar.tsx', path: '/src/components/Sidebar.tsx', type: 'file' },
        ],
      },
      {
        name: 'services',
        path: '/src/services',
        type: 'directory',
        children: [
          { name: 'api.ts', path: '/src/services/api.ts', type: 'file' },
          { name: 'kernelClient.ts', path: '/src/services/kernelClient.ts', type: 'file' },
        ],
      },
      { name: 'index.tsx', path: '/src/index.tsx', type: 'file' },
      { name: 'main.ts', path: '/src/main.ts', type: 'file' },
    ],
  },
  {
    name: 'public',
    path: '/public',
    type: 'directory',
    children: [
      { name: 'index.html', path: '/public/index.html', type: 'file' },
      { name: 'favicon.ico', path: '/public/favicon.ico', type: 'file' },
    ],
  },
  { name: 'package.json', path: '/package.json', type: 'file' },
  { name: 'tsconfig.json', path: '/tsconfig.json', type: 'file' },
  { name: 'README.md', path: '/README.md', type: 'file' },
];

// ---------------------------------------------------------------------------
// File Tree Item (recursive)
// ---------------------------------------------------------------------------

interface FileTreeItemProps {
  node: FileTreeNode;
  depth: number;
  onFileClick: (node: FileTreeNode) => void;
}

const FileTreeItem: React.FC<FileTreeItemProps> = ({ node, depth, onFileClick }) => {
  const [expanded, setExpanded] = useState(depth === 0);

  const handleClick = () => {
    if (node.type === 'directory') {
      setExpanded((prev) => !prev);
    } else {
      onFileClick(node);
    }
  };

  return (
    <div>
      <div
        className="flex items-center gap-1 py-0.5 px-2 cursor-pointer hover:bg-[#2a2d2e] text-sm text-[#cccccc] select-none"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        role="treeitem"
        aria-expanded={node.type === 'directory' ? expanded : undefined}
      >
        {node.type === 'directory' ? (
          <>
            {expanded ? (
              <ChevronDown size={14} className="shrink-0 text-[#858585]" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-[#858585]" />
            )}
            <FolderOpen size={14} className="shrink-0 text-[#dcb67a]" />
          </>
        ) : (
          <>
            <span className="w-[14px] shrink-0" />
            <File size={14} className="shrink-0 text-[#519aba]" />
          </>
        )}
        <span className="truncate ml-1">{node.name}</span>
      </div>
      {node.type === 'directory' && expanded && node.children && (
        <div role="group">
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileClick={onFileClick}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main CodeEditorApp Component
// ---------------------------------------------------------------------------

export const CodeEditorApp: React.FC<CodeEditorAppProps> = ({
  initialContent = '',
  fileName = 'Untitled',
  filePath,
  onSave,
}) => {
  // ---- Tab state ----
  const createTabId = (path: string) => `tab_${path}_${Date.now()}`;

  const initialTab: EditorTab = {
    id: createTabId(filePath || fileName),
    fileName,
    filePath: filePath || '',
    content: initialContent,
    savedContent: initialContent,
    isDirty: false,
    language: detectLanguage(fileName),
  };

  const [tabs, setTabs] = useState<EditorTab[]>([initialTab]);
  const [activeTabId, setActiveTabId] = useState<string>(initialTab.id);

  // ---- File tree state ----
  const [fileTree, setFileTree] = useState<FileTreeNode[]>(MOCK_FILE_TREE);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // ---- Cursor / editor state ----
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [loading, setLoading] = useState(false);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);

  // ---- Derived state ----
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // ---- Load file tree from kernel ----
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      client
        .listDir('/')
        .then((entries) => {
          const tree: FileTreeNode[] = entries.map((entry) => ({
            name: entry.name,
            path: entry.path,
            type: entry.type === 'directory' ? 'directory' : 'file',
            children: entry.type === 'directory' ? [] : undefined,
          }));
          if (tree.length > 0) {
            setFileTree(tree);
          }
        })
        .catch(() => {
          // Fall back to mock file tree (already set as default)
        });
    }
  }, []);

  // ---- Load initial file from kernel if filePath is provided ----
  useEffect(() => {
    if (filePath) {
      const client = getKernelClient();
      if (client.connected) {
        setLoading(true);
        client
          .readFile(filePath)
          .then(({ content: fileContent }) => {
            setTabs((prev) =>
              prev.map((tab) =>
                tab.id === initialTab.id
                  ? {
                      ...tab,
                      content: fileContent,
                      savedContent: fileContent,
                      isDirty: false,
                    }
                  : tab,
              ),
            );
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath]);

  // ---- Update tab content helper ----
  const updateActiveTab = useCallback(
    (updates: Partial<EditorTab>) => {
      setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? { ...tab, ...updates } : tab)));
    },
    [activeTabId],
  );

  // ---- Handle editor content change ----
  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const newContent = value ?? '';
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!tab) return;
      updateActiveTab({
        content: newContent,
        isDirty: newContent !== tab.savedContent,
      });
    },
    [activeTabId, tabs, updateActiveTab],
  );

  // ---- Handle save ----
  const handleSave = useCallback(async () => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    setSaveStatus('saving');

    const client = getKernelClient();
    if (client.connected && tab.filePath) {
      try {
        await client.writeFile(tab.filePath, tab.content);
        updateActiveTab({ savedContent: tab.content, isDirty: false });
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      } catch (err) {
        console.error('[CodeEditor] Failed to save to kernel:', err);
      }
    }

    // Fallback to prop callback
    if (onSave) {
      onSave(tab.content);
    }

    updateActiveTab({ savedContent: tab.content, isDirty: false });
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [activeTabId, tabs, updateActiveTab, onSave]);

  // ---- Monaco onMount ----
  const handleEditorMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      // Track cursor position changes
      editor.onDidChangeCursorPosition((e) => {
        setCursorLine(e.position.lineNumber);
        setCursorCol(e.position.column);
      });

      // Register Cmd+S / Ctrl+S
      editor.addCommand(
        // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
        2048 | 49, // CtrlCmd = 2048, KeyS = 49
        () => {
          handleSave();
        },
      );

      editor.focus();
    },
    [handleSave],
  );

  // ---- Global keyboard shortcut (backup for Cmd+S outside editor) ----
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ---- Open file in a new tab (or switch to existing) ----
  const openFile = useCallback(
    async (node: FileTreeNode) => {
      if (node.type !== 'file') return;

      // Check if file is already open
      const existingTab = tabs.find((t) => t.filePath === node.path);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        return;
      }

      // Try to load file content from kernel
      let content = '';
      const client = getKernelClient();
      if (client.connected) {
        try {
          const result = await client.readFile(node.path);
          content = result.content;
        } catch {
          content = `// Could not load ${node.path}`;
        }
      } else {
        content = `// ${node.name}\n// File content would be loaded from kernel FS\n`;
      }

      const language = detectLanguage(node.name);
      const newTab: EditorTab = {
        id: createTabId(node.path),
        fileName: node.name,
        filePath: node.path,
        content,
        savedContent: content,
        isDirty: false,
        language,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
    },
    [tabs],
  );

  // ---- Close a tab ----
  const closeTab = useCallback(
    (tabId: string, e?: React.MouseEvent) => {
      if (e) {
        e.stopPropagation();
      }

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        if (filtered.length === 0) {
          // Always keep at least one tab
          const emptyTab: EditorTab = {
            id: createTabId('untitled'),
            fileName: 'Untitled',
            filePath: '',
            content: '',
            savedContent: '',
            isDirty: false,
            language: 'plaintext',
          };
          return [emptyTab];
        }
        return filtered;
      });

      // If closing the active tab, switch to another
      if (tabId === activeTabId) {
        setTabs((prev) => {
          const remaining = prev.filter((t) => t.id !== tabId);
          if (remaining.length > 0) {
            setActiveTabId(remaining[remaining.length - 1].id);
          }
          return prev;
        });
      }
    },
    [activeTabId],
  );

  // ---- Load directory children from kernel (lazy) ----
  const loadDirectoryChildren = useCallback(async (dirPath: string): Promise<FileTreeNode[]> => {
    const client = getKernelClient();
    if (!client.connected) return [];
    try {
      const entries = await client.listDir(dirPath);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type === 'directory' ? ('directory' as const) : ('file' as const),
        children: entry.type === 'directory' ? [] : undefined,
      }));
    } catch {
      return [];
    }
  }, []);

  // ---- Render ----
  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono overflow-hidden">
      {/* Activity Bar */}
      <div
        className="w-12 bg-[#333333] flex flex-col items-center py-4 gap-4 text-[#858585]"
        data-testid="activity-bar"
      >
        <div
          className={`p-2 cursor-pointer ${sidebarVisible ? 'text-white border-l-2 border-white' : 'hover:text-white'}`}
          onClick={() => setSidebarVisible((v) => !v)}
          title="Explorer"
        >
          <FileCode size={24} />
        </div>
        <div className="p-2 cursor-pointer hover:text-white" title="Search">
          <Search size={24} />
        </div>
        <div className="p-2 cursor-pointer hover:text-white" title="Source Control">
          <GitBranch size={24} />
        </div>
        <div className="p-2 cursor-pointer hover:text-white" title="Run and Debug">
          <Play size={24} />
        </div>
        <div className="flex-1" />
        <div className="p-2 cursor-pointer hover:text-white" title="Settings">
          <Settings size={24} />
        </div>
      </div>

      {/* File Explorer Sidebar */}
      {sidebarVisible && (
        <div
          className="w-56 bg-[#252526] border-r border-[#1e1e1e] flex flex-col"
          data-testid="file-explorer"
        >
          <div className="h-8 flex items-center px-4 text-xs font-bold uppercase tracking-wide text-[#bbbbbb] bg-[#252526] shrink-0">
            Explorer
          </div>
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="text-xs font-semibold uppercase tracking-wide text-[#bbbbbb] px-4 py-1">
              Project
            </div>
            <div role="tree">
              {fileTree.map((node) => (
                <FileTreeItem key={node.path} node={node} depth={0} onFileClick={openFile} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div
          className="h-9 bg-[#2d2d2d] flex items-center overflow-x-auto shrink-0"
          data-testid="editor-tabs"
          role="tablist"
        >
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`h-full px-3 flex items-center gap-2 min-w-[120px] max-w-[200px] text-sm cursor-pointer border-r border-[#252526] select-none ${
                tab.id === activeTabId
                  ? 'bg-[#1e1e1e] text-white border-t-2 border-t-[#007acc]'
                  : 'bg-[#2d2d2d] text-[#969696] hover:bg-[#2a2a2a] border-t-2 border-t-transparent'
              }`}
              onClick={() => setActiveTabId(tab.id)}
              role="tab"
              aria-selected={tab.id === activeTabId}
              data-testid={`tab-${tab.fileName}`}
            >
              <span className="truncate">{tab.fileName}</span>
              {tab.isDirty && (
                <div
                  className="w-2 h-2 rounded-full bg-white/70 shrink-0"
                  title="Unsaved changes"
                  data-testid="dirty-indicator"
                />
              )}
              {!tab.isDirty && (
                <X
                  size={14}
                  className="ml-auto opacity-0 group-hover:opacity-100 hover:opacity-100 hover:bg-[#3c3c3c] rounded cursor-pointer shrink-0"
                  onClick={(e) => closeTab(tab.id, e)}
                  data-testid={`close-tab-${tab.fileName}`}
                />
              )}
              {tab.isDirty && (
                <X
                  size={14}
                  className="hover:bg-[#3c3c3c] rounded cursor-pointer shrink-0"
                  onClick={(e) => closeTab(tab.id, e)}
                  data-testid={`close-tab-${tab.fileName}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Breadcrumbs / File Path */}
        <div className="h-6 bg-[#1e1e1e] flex items-center px-4 text-xs text-[#a9a9a9] gap-1 border-b border-transparent overflow-hidden shrink-0">
          {activeTab.filePath ? (
            <span className="truncate text-[#a9a9a9]">{activeTab.filePath}</span>
          ) : (
            <>
              <span>src</span>
              <span>&gt;</span>
              <span className="text-white">{activeTab.fileName}</span>
            </>
          )}
        </div>

        {/* Monaco Editor */}
        <div className="flex-1 relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 bg-[#1e1e1e]/80 flex items-center justify-center z-20">
              <span className="text-sm text-gray-400">Loading file...</span>
            </div>
          )}
          <Editor
            theme="vs-dark"
            language={activeTab.language}
            value={activeTab.content}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
            loading={
              <div className="flex items-center justify-center h-full bg-[#1e1e1e] text-[#858585] text-sm">
                Loading editor...
              </div>
            }
            options={{
              minimap: { enabled: true },
              fontSize: 14,
              wordWrap: 'off',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              padding: { top: 8 },
              renderLineHighlight: 'all',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              cursorSmoothCaretAnimation: 'on',
              bracketPairColorization: { enabled: true },
              fontFamily:
                "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace",
              fontLigatures: true,
            }}
          />
        </div>

        {/* Status Bar */}
        <div className="h-6 bg-[#007acc] text-white flex items-center px-3 justify-between text-xs select-none shrink-0">
          <div className="flex items-center gap-4">
            <span className="font-medium">main*</span>
            {saveStatus === 'saving' && <span className="text-yellow-200">Saving...</span>}
            {saveStatus === 'saved' && <span className="text-green-200">Saved</span>}
          </div>
          <div className="flex items-center gap-4">
            <span>
              Ln {cursorLine}, Col {cursorCol}
            </span>
            <span>UTF-8</span>
            <span className="capitalize">{activeTab.language}</span>
            {activeTab.filePath && (
              <span className="opacity-70 truncate max-w-[200px]">{activeTab.filePath}</span>
            )}
            <button
              onClick={handleSave}
              className="hover:bg-white/20 px-1 rounded transition-colors flex items-center gap-1"
              title="Save (Cmd+S)"
            >
              <Save size={12} />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
