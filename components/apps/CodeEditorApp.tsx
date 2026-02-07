import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Save, Play, Search, GitBranch, Settings, X, FileCode } from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';

interface CodeEditorAppProps {
  initialContent?: string;
  fileName?: string;
  filePath?: string;
  onSave?: (content: string) => void;
}

// Regex-based syntax highlighting for common patterns
function highlightSyntax(code: string, language: string): string {
  let html = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Comments: // ... or # ...
  html = html.replace(/(\/\/.*$|#.*$)/gm, '<span style="color:#6A9955">$1</span>');
  // Multi-line comments: /* ... */
  html = html.replace(/(\/\*[\s\S]*?\*\/)/g, '<span style="color:#6A9955">$1</span>');
  // Strings: "..." or '...' or `...`
  html = html.replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span style="color:#CE9178">$1</span>');
  // Keywords
  const keywords = /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|extends|import|export|from|default|new|this|super|try|catch|finally|throw|async|await|yield|typeof|instanceof|in|of|void|null|undefined|true|false|def|self|print|None|True|False|lambda|with|as|elif|pass|raise|except)\b/g;
  html = html.replace(keywords, '<span style="color:#C586C0">$1</span>');
  // Types / class names (capitalized words)
  html = html.replace(/\b([A-Z][a-zA-Z0-9_]*)\b/g, '<span style="color:#4EC9B0">$1</span>');
  // Numbers
  html = html.replace(/\b(\d+\.?\d*)\b/g, '<span style="color:#B5CEA8">$1</span>');
  // Function calls
  html = html.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span style="color:#DCDCAA">$1</span>');

  return html;
}

function detectLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', css: 'css', html: 'html', sql: 'sql',
    sh: 'bash', bash: 'bash', zsh: 'bash',
    rb: 'ruby', php: 'php',
  };
  return map[ext] || 'text';
}

export const CodeEditorApp: React.FC<CodeEditorAppProps> = ({ initialContent = '', fileName = 'Untitled', filePath, onSave }) => {
  const [content, setContent] = useState(initialContent);
  const [savedContent, setSavedContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [lines, setLines] = useState(1);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [currentFilePath, setCurrentFilePath] = useState(filePath || '');
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  const language = detectLanguage(fileName);

  // Load file from kernel if filePath is provided
  useEffect(() => {
    if (filePath) {
      const client = getKernelClient();
      if (client.connected) {
        setLoading(true);
        client.readFile(filePath)
          .then(({ content: fileContent }) => {
            setContent(fileContent);
            setSavedContent(fileContent);
            setIsDirty(false);
            setCurrentFilePath(filePath);
          })
          .catch(() => {})
          .finally(() => setLoading(false));
      }
    }
  }, [filePath]);

  useEffect(() => {
    if (initialContent && !filePath) {
      setContent(initialContent);
      setSavedContent(initialContent);
      setIsDirty(false);
    }
  }, [initialContent, filePath]);

  useEffect(() => {
    setLines(content.split('\n').length);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
    syncScroll();
  };

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');

    // Try to save to kernel if connected
    const client = getKernelClient();
    if (client.connected && currentFilePath) {
      try {
        await client.writeFile(currentFilePath, content);
        setSavedContent(content);
        setIsDirty(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      } catch (err) {
        console.error('[CodeEditor] Failed to save to kernel:', err);
      }
    }

    // Fallback to prop callback
    if (onSave) {
      onSave(content);
      setSavedContent(content);
      setIsDirty(false);
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [content, currentFilePath, onSave, savedContent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      setIsDirty(newContent !== savedContent);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      });
    }
  };

  const handleCursorChange = () => {
    if (textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      const textBefore = content.substring(0, pos);
      const lineNum = textBefore.split('\n').length;
      const colNum = pos - textBefore.lastIndexOf('\n');
      setCursorLine(lineNum);
      setCursorCol(colNum);
    }
  };

  const syncScroll = () => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="flex h-full bg-[#1e1e1e] text-[#d4d4d4] font-mono overflow-hidden">
      {/* Activity Bar */}
      <div className="w-12 bg-[#333333] flex flex-col items-center py-4 gap-4 text-[#858585]">
        <div className="p-2 cursor-pointer text-white border-l-2 border-white"><FileCode size={24} /></div>
        <div className="p-2 cursor-pointer hover:text-white"><Search size={24} /></div>
        <div className="p-2 cursor-pointer hover:text-white"><GitBranch size={24} /></div>
        <div className="p-2 cursor-pointer hover:text-white"><Play size={24} /></div>
        <div className="flex-1"></div>
        <div className="p-2 cursor-pointer hover:text-white"><Settings size={24} /></div>
      </div>

      {/* Sidebar (Explorer) */}
      <div className="w-48 bg-[#252526] border-r border-[#1e1e1e] flex flex-col">
        <div className="h-8 flex items-center px-4 text-xs font-bold uppercase tracking-wide text-[#bbbbbb] bg-[#252526]">Explorer</div>
        <div className="flex-1 p-2">
          <div className="text-sm text-[#e7e7e7] font-medium flex items-center gap-1 cursor-pointer bg-[#37373d] py-1 px-2 -mx-2">
            <span className="text-[10px]">&#x25BC;</span> PROJECT
          </div>
          <div className="pl-4 mt-1 flex flex-col gap-1 text-sm text-[#cccccc]">
            <div className="flex items-center gap-2 py-0.5 bg-[#37373d] -mx-4 pl-8 border-l-2 border-[#007acc]">
              <span className="text-yellow-400 text-[10px] uppercase">{language.substring(0, 3)}</span>
              <span className="truncate">{fileName}</span>
              {isDirty && <div className="w-1.5 h-1.5 rounded-full bg-white/60 ml-auto shrink-0"></div>}
            </div>
          </div>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="h-9 bg-[#2d2d2d] flex items-center overflow-x-auto">
          <div className="h-full bg-[#1e1e1e] px-3 flex items-center gap-2 min-w-[120px] border-t-2 border-[#007acc] text-sm text-white">
            <span className="text-yellow-400 text-[10px] uppercase">{language.substring(0, 3)}</span>
            <span className="truncate">{fileName}</span>
            {isDirty && <div className="w-2 h-2 rounded-full bg-white ml-auto shrink-0"></div>}
            {!isDirty && <X size={14} className="ml-auto opacity-0 hover:opacity-100 cursor-pointer shrink-0" />}
          </div>
        </div>

        {/* Breadcrumbs / File Path */}
        <div className="h-6 bg-[#1e1e1e] flex items-center px-4 text-xs text-[#a9a9a9] gap-1 border-b border-transparent overflow-hidden">
          {currentFilePath ? (
            <span className="truncate text-[#a9a9a9]">{currentFilePath}</span>
          ) : (
            <>
              <span>src</span><span>&gt;</span><span className="text-white">{fileName}</span>
            </>
          )}
        </div>

        {/* Editor */}
        <div className="flex-1 relative flex overflow-hidden">
          {/* Line Numbers */}
          <div className="w-12 bg-[#1e1e1e] text-[#858585] text-right pr-4 pt-4 text-sm font-mono select-none leading-6 overflow-hidden shrink-0">
            {Array.from({ length: Math.max(lines, 15) }).map((_, i) => (
              <div key={i} className={i + 1 === cursorLine ? 'text-white' : ''}>{i + 1}</div>
            ))}
          </div>

          {/* Syntax Highlighted Overlay */}
          <pre
            ref={highlightRef}
            className="absolute left-12 right-16 top-0 bottom-0 p-4 pl-0 font-mono text-sm leading-6 whitespace-pre overflow-hidden pointer-events-none"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: highlightSyntax(content, language) }}
          />

          {/* Text Area (transparent text, visible caret) */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onClick={handleCursorChange}
            onKeyUp={handleCursorChange}
            onScroll={syncScroll}
            className="flex-1 bg-transparent text-transparent caret-white p-4 pl-0 outline-none resize-none font-mono text-sm leading-6 whitespace-pre z-10 relative"
            spellCheck={false}
          />

          {/* Minimap */}
          <div className="w-16 bg-[#252526] opacity-50 pointer-events-none hidden sm:block shrink-0">
            <div className="text-[2px] leading-[4px] text-gray-500 p-1 break-all overflow-hidden h-full">
              {content}
            </div>
          </div>

          {loading && (
            <div className="absolute inset-0 bg-[#1e1e1e]/80 flex items-center justify-center z-20">
              <span className="text-sm text-gray-400">Loading file...</span>
            </div>
          )}
        </div>

        {/* Status Bar */}
        <div className="h-6 bg-[#007acc] text-white flex items-center px-3 justify-between text-xs select-none">
          <div className="flex items-center gap-4">
            <span className="font-medium">main*</span>
            {saveStatus === 'saving' && <span className="text-yellow-200">Saving...</span>}
            {saveStatus === 'saved' && <span className="text-green-200">Saved</span>}
          </div>
          <div className="flex items-center gap-4">
            <span>Ln {cursorLine}, Col {cursorCol}</span>
            <span>UTF-8</span>
            <span className="capitalize">{language}</span>
            <button onClick={handleSave} className="hover:bg-white/20 px-1 rounded transition-colors" title="Save (Cmd+S)">
              <Save size={12} className="inline mr-1" />
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
