import React, { useState, useEffect } from 'react';
import { Save, Play, Search, GitBranch, Settings, Menu, X, FileCode } from 'lucide-react';

interface CodeEditorAppProps {
  initialContent?: string;
  fileName?: string;
  onSave?: (content: string) => void;
}

export const CodeEditorApp: React.FC<CodeEditorAppProps> = ({ initialContent = '', fileName = 'Untitled', onSave }) => {
  const [content, setContent] = useState(initialContent);
  const [isDirty, setIsDirty] = useState(false);
  const [lines, setLines] = useState(1);

  useEffect(() => {
    setContent(initialContent);
    setIsDirty(false);
  }, [initialContent]);

  useEffect(() => {
    setLines(content.split('\n').length);
  }, [content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    setIsDirty(true);
  };

  const handleSave = () => {
    if (onSave) {
      onSave(content);
      setIsDirty(false);
    }
  };

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
      // Need to defer setting selection range after render, omitted for brevity in this demo
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
                <span className="text-[10px]">▼</span> PROJECT
            </div>
            <div className="pl-4 mt-1 flex flex-col gap-1 text-sm text-[#cccccc]">
                 <div className="flex items-center gap-2 py-0.5 bg-[#37373d] -mx-4 pl-8 border-l-2 border-[#007acc]">
                    <span className="text-yellow-400">TS</span> {fileName}
                 </div>
                 <div className="flex items-center gap-2 py-0.5 opacity-50">
                    <span className="text-blue-400">JSON</span> package.json
                 </div>
                 <div className="flex items-center gap-2 py-0.5 opacity-50">
                    <span className="text-gray-400">MD</span> README.md
                 </div>
            </div>
        </div>
      </div>

      {/* Main Editor Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tabs */}
        <div className="h-9 bg-[#2d2d2d] flex items-center overflow-x-auto">
             <div className="h-full bg-[#1e1e1e] px-3 flex items-center gap-2 min-w-[120px] border-t-2 border-[#007acc] text-sm text-white">
                 <span className="text-yellow-400 text-xs">TS</span>
                 <span>{fileName}</span>
                 {isDirty && <div className="w-2 h-2 rounded-full bg-white ml-auto"></div>}
                 {!isDirty && <X size={14} className="ml-auto opacity-0 hover:opacity-100 cursor-pointer" />}
             </div>
             <div className="h-full bg-[#2d2d2d] px-3 flex items-center gap-2 min-w-[120px] border-r border-[#1e1e1e] text-sm text-[#969696] hover:bg-[#2d2d2d]">
                 <span className="text-blue-400 text-xs">JSON</span>
                 <span>package.json</span>
             </div>
        </div>

        {/* Breadcrumbs */}
        <div className="h-6 bg-[#1e1e1e] flex items-center px-4 text-xs text-[#a9a9a9] gap-2 border-b border-transparent">
            <span>src</span>
            <span>&gt;</span>
            <span>components</span>
            <span>&gt;</span>
            <span className="text-white">{fileName}</span>
        </div>

        {/* Editor */}
        <div className="flex-1 relative flex">
            {/* Line Numbers */}
            <div className="w-12 bg-[#1e1e1e] text-[#858585] text-right pr-4 pt-4 text-sm font-mono select-none leading-6">
                {Array.from({ length: Math.max(lines, 15) }).map((_, i) => (
                    <div key={i}>{i + 1}</div>
                ))}
            </div>

            {/* Text Area */}
            <textarea
                value={content}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                className="flex-1 bg-[#1e1e1e] text-[#d4d4d4] p-4 pl-0 outline-none resize-none font-mono text-sm leading-6 whitespace-pre"
                spellCheck={false}
            />

            {/* Minimap (Fake) */}
            <div className="w-16 bg-[#252526] opacity-50 pointer-events-none hidden sm:block">
                 <div className="text-[2px] leading-[4px] text-gray-500 p-1 break-all overflow-hidden h-full">
                     {content}
                 </div>
            </div>
        </div>

        {/* Status Bar */}
        <div className="h-6 bg-[#007acc] text-white flex items-center px-3 justify-between text-xs select-none">
            <div className="flex items-center gap-4">
                <span className="font-medium">main*</span>
                <span className="flex items-center gap-1"><div className="w-3 h-3 rounded-full border border-white flex items-center justify-center text-[8px]">x</div> 0</span>
                <span className="flex items-center gap-1">⚠ 0</span>
            </div>
            <div className="flex items-center gap-4">
                <span>Ln {lines}, Col {content.length}</span>
                <span>UTF-8</span>
                <span>TypeScript React</span>
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