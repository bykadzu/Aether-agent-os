import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bold,
  Italic,
  Heading,
  Code,
  Link,
  Image,
  List,
  Quote,
  Table,
  Save,
  FileText,
  FolderOpen,
  Plus,
  Trash2,
  Eye,
  SplitSquareHorizontal,
  PenLine,
  Wand2,
  ChevronDown,
  RefreshCw,
  X,
} from 'lucide-react';
import { getKernelClient } from '../../services/kernelClient';
import { generateText, GeminiModel } from '../../services/geminiService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WriterFile {
  name: string;
  path: string;
}

type ViewMode = 'editor' | 'preview' | 'split';

type AiAction = 'continue' | 'summarize' | 'rewrite' | 'grammar';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WRITING_DIR = '/home/root/Documents/writing';
const LOCAL_STORAGE_KEY = 'aether_writer';
const WORDS_PER_MINUTE = 200;

// ---------------------------------------------------------------------------
// Markdown-to-HTML renderer (no external libraries)
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseInline(text: string): string {
  let result = escapeHtml(text);

  // Images: ![alt](url) - must be processed before links
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;border-radius:4px;margin:8px 0;" />');

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:underline;">$1</a>');

  // Bold + Italic: ***text*** or ___text___
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  result = result.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  result = result.replace(/__(.+?)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  result = result.replace(/\*(.+?)\*/g, '<em>$1</em>');
  result = result.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough: ~~text~~
  result = result.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Inline code: `code`
  result = result.replace(/`([^`]+)`/g, '<code style="background:#1e1e2e;color:#cdd6f4;padding:2px 6px;border-radius:3px;font-size:0.875em;">$1</code>');

  return result;
}

function parseMarkdownToHtml(markdown: string): string {
  const lines = markdown.split('\n');
  const htmlParts: string[] = [];
  let i = 0;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = '';
  let inTable = false;
  let tableRows: string[][] = [];
  let _tableHasHeader = false;

  const flushTable = () => {
    if (tableRows.length === 0) return;
    let tableHtml = '<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:0.95em;">';
    for (let r = 0; r < tableRows.length; r++) {
      const row = tableRows[r];
      // Check if this is a separator row (e.g., |---|---|)
      const isSeparator = row.every(cell => /^[-:]+$/.test(cell.trim()));
      if (isSeparator) {
        _tableHasHeader = true;
        continue;
      }
      const tag = r === 0 ? 'th' : 'td';
      const bgStyle = r === 0 ? 'background:#1a1d26;color:#e2e8f0;font-weight:600;' : (r % 2 === 0 ? 'background:#f8fafc;' : 'background:#ffffff;');
      tableHtml += '<tr>';
      for (const cell of row) {
        tableHtml += `<${tag} style="border:1px solid #e2e8f0;padding:8px 12px;text-align:left;${bgStyle}">${parseInline(cell.trim())}</${tag}>`;
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</table>';
    htmlParts.push(tableHtml);
    tableRows = [];
    _tableHasHeader = false;
    inTable = false;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks: ```lang
    if (line.trimStart().startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        const code = escapeHtml(codeBlockContent.join('\n'));
        htmlParts.push(
          `<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow-x:auto;margin:16px 0;font-size:0.875em;line-height:1.6;"><code class="language-${codeBlockLang}">${code}</code></pre>`
        );
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = '';
      } else {
        // Flush table if active
        if (inTable) flushTable();
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim() || 'text';
      }
      i++;
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      i++;
      continue;
    }

    // Table rows: | col1 | col2 | ...
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      const cells = line.trim().slice(1, -1).split('|');
      tableRows.push(cells);
      i++;
      continue;
    } else if (inTable) {
      flushTable();
      // Don't increment i; re-process this line
      continue;
    }

    // Blank line
    if (line.trim() === '') {
      if (inTable) flushTable();
      i++;
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^(\s*[-*_]\s*){3,}$/.test(line)) {
      htmlParts.push('<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />');
      i++;
      continue;
    }

    // Headings: # ## ### ####
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = parseInline(headingMatch[2]);
      const sizes: Record<number, string> = {
        1: 'font-size:2em;font-weight:800;margin:24px 0 16px 0;padding-bottom:8px;border-bottom:2px solid #e2e8f0;',
        2: 'font-size:1.5em;font-weight:700;margin:20px 0 12px 0;padding-bottom:4px;border-bottom:1px solid #e2e8f0;',
        3: 'font-size:1.25em;font-weight:600;margin:16px 0 8px 0;',
        4: 'font-size:1.1em;font-weight:600;margin:12px 0 8px 0;color:#64748b;',
      };
      htmlParts.push(`<h${level} style="${sizes[level]}line-height:1.3;">${text}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote: > text
    if (line.trimStart().startsWith('> ')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
        quoteLines.push(lines[i].trimStart().slice(2));
        i++;
      }
      const quoteContent = quoteLines.map(l => parseInline(l)).join('<br/>');
      htmlParts.push(
        `<blockquote style="border-left:4px solid #818cf8;padding:12px 16px;margin:16px 0;background:#f0f0ff;color:#475569;border-radius:0 8px 8px 0;font-style:italic;">${quoteContent}</blockquote>`
      );
      continue;
    }

    // Task list: - [ ] or - [x]
    if (/^\s*[-*]\s+\[([ xX])\]\s/.test(line)) {
      const taskItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+\[([ xX])\]\s/.test(lines[i])) {
        const taskMatch = lines[i].match(/^\s*[-*]\s+\[([ xX])\]\s(.+)$/);
        if (taskMatch) {
          const checked = taskMatch[1] !== ' ';
          const text = parseInline(taskMatch[2]);
          const checkboxStyle = checked
            ? 'width:16px;height:16px;accent-color:#818cf8;margin-right:8px;'
            : 'width:16px;height:16px;margin-right:8px;';
          const textStyle = checked ? 'text-decoration:line-through;color:#94a3b8;' : '';
          taskItems.push(
            `<li style="list-style:none;display:flex;align-items:center;padding:4px 0;"><input type="checkbox" ${checked ? 'checked' : ''} disabled style="${checkboxStyle}" /><span style="${textStyle}">${text}</span></li>`
          );
        }
        i++;
      }
      htmlParts.push(`<ul style="padding:0;margin:12px 0;">${taskItems.join('')}</ul>`);
      continue;
    }

    // Unordered list: - item or * item
    if (/^\s*[-*]\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*[-*]\s+/, '');
        listItems.push(`<li style="margin:4px 0;">${parseInline(itemText)}</li>`);
        i++;
      }
      htmlParts.push(`<ul style="padding-left:24px;margin:12px 0;">${listItems.join('')}</ul>`);
      continue;
    }

    // Ordered list: 1. item
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        const itemText = lines[i].replace(/^\s*\d+\.\s+/, '');
        listItems.push(`<li style="margin:4px 0;">${parseInline(itemText)}</li>`);
        i++;
      }
      htmlParts.push(`<ol style="padding-left:24px;margin:12px 0;">${listItems.join('')}</ol>`);
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^#{1,4}\s/) && !lines[i].trimStart().startsWith('> ') && !lines[i].trimStart().startsWith('```') && !lines[i].match(/^\s*[-*]\s+/) && !lines[i].match(/^\s*\d+\.\s+/) && !(lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) && !/^(\s*[-*_]\s*){3,}$/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const paraText = paraLines.map(l => parseInline(l)).join('<br/>');
      htmlParts.push(`<p style="margin:12px 0;line-height:1.8;">${paraText}</p>`);
    }
  }

  // Flush any remaining table
  if (inTable) flushTable();

  // If still in a code block (unclosed), flush it
  if (inCodeBlock && codeBlockContent.length > 0) {
    const code = escapeHtml(codeBlockContent.join('\n'));
    htmlParts.push(
      `<pre style="background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;overflow-x:auto;margin:16px 0;font-size:0.875em;line-height:1.6;"><code class="language-${codeBlockLang}">${code}</code></pre>`
    );
  }

  return htmlParts.join('\n');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const WriterApp: React.FC = () => {
  // Content state
  const [content, setContent] = useState<string>('# Welcome to Aether Writer\n\nStart writing your markdown here. Use the toolbar above or keyboard shortcuts to format text.\n\n## Features\n\n- **Bold**, *italic*, and ~~strikethrough~~ text\n- Code blocks with syntax highlighting\n- Task lists, tables, and blockquotes\n- AI-powered writing assistance\n\n> The best way to predict the future is to create it.\n\nHappy writing!\n');
  const [savedContent, setSavedContent] = useState<string>('');
  const [isDirty, setIsDirty] = useState(false);

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [splitPosition, setSplitPosition] = useState(50); // percentage
  const [isDraggingSplitter, setIsDraggingSplitter] = useState(false);

  // File state
  const [files, setFiles] = useState<WriterFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [fileName, setFileName] = useState('Untitled.md');
  const [showSidebar, setShowSidebar] = useState(true);
  const [useKernel, setUseKernel] = useState(false);

  // AI state
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAction, setAiAction] = useState<string>('');

  // Save status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');

  // Cursor / stats
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);

  // Refs
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const splitterContainerRef = useRef<HTMLDivElement>(null);
  const aiMenuRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const wordCount = content.trim() === '' ? 0 : content.trim().split(/\s+/).length;
  const charCount = content.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / WORDS_PER_MINUTE));
  const lineCount = content.split('\n').length;

  // ---------------------------------------------------------------------------
  // Kernel / localStorage initialization
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadFileList();
    } else {
      // Load from localStorage
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.content) {
            setContent(parsed.content);
            setSavedContent(parsed.content);
          }
          if (parsed.files) setFiles(parsed.files);
          if (parsed.activeFile) setActiveFile(parsed.activeFile);
          if (parsed.fileName) setFileName(parsed.fileName);
        } catch {
          // Ignore parse errors
        }
      }
    }
  }, []);

  // Close AI menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (aiMenuRef.current && !aiMenuRef.current.contains(e.target as Node)) {
        setShowAiMenu(false);
      }
    };
    if (showAiMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showAiMenu]);

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  const loadFileList = async () => {
    const client = getKernelClient();
    try {
      await client.mkdir(WRITING_DIR).catch(() => {});
      const entries = await client.listDir(WRITING_DIR);
      const mdFiles = entries
        .filter((e: any) => e.type === 'file' && (e.name.endsWith('.md') || e.name.endsWith('.txt')))
        .map((e: any) => ({ name: e.name, path: e.path || `${WRITING_DIR}/${e.name}` }));
      setFiles(mdFiles);
      if (mdFiles.length > 0 && !activeFile) {
        await loadFile(mdFiles[0].path, mdFiles[0].name);
      }
    } catch (err) {
      console.error('[WriterApp] Failed to load files:', err);
    }
  };

  const loadFile = async (path: string, name: string) => {
    if (useKernel) {
      const client = getKernelClient();
      try {
        const { content: fileContent } = await client.readFile(path);
        setContent(fileContent);
        setSavedContent(fileContent);
        setIsDirty(false);
        setActiveFile(path);
        setFileName(name);
      } catch {
        setContent('');
        setSavedContent('');
        setActiveFile(path);
        setFileName(name);
      }
    } else {
      // In localStorage mode, each file content is stored separately
      const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY}_file_${path}`);
      setContent(stored || '');
      setSavedContent(stored || '');
      setIsDirty(false);
      setActiveFile(path);
      setFileName(name);
    }
  };

  const createNewFile = async () => {
    const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    const name = `Draft ${timestamp}.md`;
    const path = `${WRITING_DIR}/${name}`;
    const defaultContent = `# ${name.replace('.md', '')}\n\n`;

    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.mkdir(WRITING_DIR).catch(() => {});
        await client.writeFile(path, defaultContent);
        setFiles(prev => [...prev, { name, path }]);
        setContent(defaultContent);
        setSavedContent(defaultContent);
        setIsDirty(false);
        setActiveFile(path);
        setFileName(name);
      } catch (err) {
        console.error('[WriterApp] Failed to create file:', err);
      }
    } else {
      setFiles(prev => [...prev, { name, path }]);
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_file_${path}`, defaultContent);
      setContent(defaultContent);
      setSavedContent(defaultContent);
      setIsDirty(false);
      setActiveFile(path);
      setFileName(name);
      saveLocalState([...files, { name, path }], path, name);
    }
  };

  const deleteFile = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.rm(path);
      } catch {
        // Ignore deletion errors
      }
    } else {
      localStorage.removeItem(`${LOCAL_STORAGE_KEY}_file_${path}`);
    }
    const updatedFiles = files.filter(f => f.path !== path);
    setFiles(updatedFiles);
    if (activeFile === path) {
      if (updatedFiles.length > 0) {
        await loadFile(updatedFiles[0].path, updatedFiles[0].name);
      } else {
        setContent('');
        setSavedContent('');
        setActiveFile(null);
        setFileName('Untitled.md');
      }
    }
    if (!useKernel) {
      saveLocalState(updatedFiles, activeFile === path ? null : activeFile, activeFile === path ? 'Untitled.md' : fileName);
    }
  };

  const saveLocalState = (fileList: WriterFile[], active: string | null, name: string) => {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      files: fileList,
      activeFile: active,
      fileName: name,
      content: content,
    }));
  };

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');

    if (useKernel && activeFile) {
      const client = getKernelClient();
      try {
        await client.writeFile(activeFile, content);
        setSavedContent(content);
        setIsDirty(false);
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      } catch (err) {
        console.error('[WriterApp] Failed to save to kernel:', err);
      }
    }

    // localStorage fallback
    if (activeFile) {
      localStorage.setItem(`${LOCAL_STORAGE_KEY}_file_${activeFile}`, content);
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
      files,
      activeFile,
      fileName,
      content,
    }));
    setSavedContent(content);
    setIsDirty(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [content, activeFile, useKernel, files, fileName]);

  // ---------------------------------------------------------------------------
  // Editor operations - toolbar formatting
  // ---------------------------------------------------------------------------

  const wrapSelection = (before: string, after: string) => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = content.substring(start, end);
    const replacement = before + (selected || 'text') + after;
    const newContent = content.substring(0, start) + replacement + content.substring(end);
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
    // Position cursor after the replacement
    requestAnimationFrame(() => {
      textarea.focus();
      if (selected) {
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + selected.length;
      } else {
        textarea.selectionStart = start + before.length;
        textarea.selectionEnd = start + before.length + 4; // select "text"
      }
    });
  };

  const insertAtCursor = (text: string) => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const newContent = content.substring(0, start) + text + content.substring(start);
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.selectionStart = start + text.length;
      textarea.selectionEnd = start + text.length;
    });
  };

  const prependLine = (prefix: string) => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    // Find the start of the current line
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualEnd = lineEnd === -1 ? content.length : lineEnd;
    const selectedLines = content.substring(lineStart, actualEnd);
    const newLines = selectedLines.split('\n').map(line => prefix + line).join('\n');
    const newContent = content.substring(0, lineStart) + newLines + content.substring(actualEnd);
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
    requestAnimationFrame(() => {
      textarea.focus();
    });
  };

  const [headingLevel, setHeadingLevel] = useState(1);

  const insertHeading = () => {
    const level = headingLevel;
    const prefix = '#'.repeat(level) + ' ';
    const textarea = editorRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', start);
    const actualEnd = lineEnd === -1 ? content.length : lineEnd;
    const currentLine = content.substring(lineStart, actualEnd);
    // Remove existing heading prefix if any
    const stripped = currentLine.replace(/^#{1,4}\s*/, '');
    const newLine = prefix + stripped;
    const newContent = content.substring(0, lineStart) + newLine + content.substring(actualEnd);
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
    setHeadingLevel(level >= 3 ? 1 : level + 1);
    requestAnimationFrame(() => {
      textarea.focus();
    });
  };

  const insertTable = () => {
    const template = '\n| Header 1 | Header 2 | Header 3 |\n| -------- | -------- | -------- |\n| Cell 1   | Cell 2   | Cell 3   |\n| Cell 4   | Cell 5   | Cell 6   |\n';
    insertAtCursor(template);
  };

  const insertLink = () => {
    wrapSelection('[', '](https://url)');
  };

  const insertImage = () => {
    insertAtCursor('![alt text](https://image-url)');
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === 's') {
      e.preventDefault();
      handleSave();
      return;
    }

    if (mod && e.key === 'b') {
      e.preventDefault();
      wrapSelection('**', '**');
      return;
    }

    if (mod && e.key === 'i' && !e.shiftKey) {
      e.preventDefault();
      // If Shift is not held, do italic. If AI menu shortcut is separate.
      wrapSelection('*', '*');
      return;
    }

    // AI menu: Cmd+Shift+I
    if (mod && e.key === 'I' && e.shiftKey) {
      e.preventDefault();
      setShowAiMenu(prev => !prev);
      return;
    }

    // Tab key - insert spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + '  ' + content.substring(end);
      setContent(newContent);
      setIsDirty(newContent !== savedContent);
      requestAnimationFrame(() => {
        textarea.selectionStart = start + 2;
        textarea.selectionEnd = start + 2;
      });
      return;
    }
  }, [content, savedContent, handleSave]);

  // Global keyboard shortcut for Cmd+S (when not focused on textarea)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      // Cmd+Shift+I for AI menu
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'I') {
        e.preventDefault();
        setShowAiMenu(prev => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  // ---------------------------------------------------------------------------
  // Content change handler
  // ---------------------------------------------------------------------------

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setContent(newContent);
    setIsDirty(newContent !== savedContent);
  };

  // ---------------------------------------------------------------------------
  // Cursor tracking
  // ---------------------------------------------------------------------------

  const updateCursorPosition = () => {
    const textarea = editorRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart;
    const textBefore = content.substring(0, pos);
    const line = textBefore.split('\n').length;
    const col = pos - textBefore.lastIndexOf('\n');
    setCursorLine(line);
    setCursorCol(col);
  };

  // ---------------------------------------------------------------------------
  // Split divider dragging
  // ---------------------------------------------------------------------------

  const handleSplitterMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplitter(true);
  };

  useEffect(() => {
    if (!isDraggingSplitter) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = splitterContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(80, Math.max(20, (x / rect.width) * 100));
      setSplitPosition(pct);
    };

    const handleMouseUp = () => {
      setIsDraggingSplitter(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplitter]);

  // ---------------------------------------------------------------------------
  // AI Writing Assist
  // ---------------------------------------------------------------------------

  const handleAiAction = async (action: AiAction) => {
    setShowAiMenu(false);
    setAiLoading(true);

    const actionLabels: Record<AiAction, string> = {
      continue: 'Continuing writing',
      summarize: 'Summarizing',
      rewrite: 'Rewriting',
      grammar: 'Fixing grammar',
    };
    setAiAction(actionLabels[action]);

    let prompt = '';
    const model = GeminiModel.FLASH;

    switch (action) {
      case 'continue':
        prompt = `You are a creative writing assistant. Continue writing the following markdown document naturally. Only output the continuation text (no need to repeat the existing content). Write 2-3 paragraphs:\n\n${content}`;
        break;
      case 'summarize':
        prompt = `Summarize the following markdown text into a concise summary. Return the result in markdown format:\n\n${content}`;
        break;
      case 'rewrite':
        prompt = `Rewrite the following markdown text to be clearer, more professional, and better structured. Keep the markdown formatting. Return only the rewritten text:\n\n${content}`;
        break;
      case 'grammar':
        prompt = `Fix all grammar, spelling, and punctuation errors in the following markdown text. Keep the markdown formatting intact. Return only the corrected text:\n\n${content}`;
        break;
    }

    try {
      const result = await generateText(prompt, model);
      if (action === 'continue') {
        // Append AI result
        const newContent = content + '\n\n' + result;
        setContent(newContent);
        setIsDirty(newContent !== savedContent);
      } else {
        // Replace content
        setContent(result);
        setIsDirty(result !== savedContent);
      }
    } catch (err) {
      console.error('[WriterApp] AI action failed:', err);
    } finally {
      setAiLoading(false);
      setAiAction('');
    }
  };

  // ---------------------------------------------------------------------------
  // Scroll sync between editor and preview
  // ---------------------------------------------------------------------------

  const handleEditorScroll = () => {
    if (viewMode !== 'split') return;
    const editor = editorRef.current;
    const preview = previewRef.current;
    if (!editor || !preview) return;
    const scrollRatio = editor.scrollTop / (editor.scrollHeight - editor.clientHeight || 1);
    preview.scrollTop = scrollRatio * (preview.scrollHeight - preview.clientHeight || 1);
  };

  // ---------------------------------------------------------------------------
  // Line number gutter
  // ---------------------------------------------------------------------------

  const renderLineNumbers = () => {
    const totalLines = Math.max(lineCount, 20);
    const lineNumbers: React.ReactNode[] = [];
    for (let i = 1; i <= totalLines; i++) {
      lineNumbers.push(
        <div
          key={i}
          className={`text-right pr-3 leading-6 text-xs select-none ${
            i === cursorLine ? 'text-[#c0caf5]' : 'text-[#3b3f51]'
          }`}
        >
          {i}
        </div>
      );
    }
    return lineNumbers;
  };

  // ---------------------------------------------------------------------------
  // Rendered preview HTML
  // ---------------------------------------------------------------------------

  const previewHtml = parseMarkdownToHtml(content);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-full bg-[#1a1b26] text-[#a9b1d6] overflow-hidden select-none">
      {/* ================================================================== */}
      {/* Sidebar - File Browser */}
      {/* ================================================================== */}
      {showSidebar && (
        <div className="w-56 bg-[#16161e] border-r border-[#222436] flex flex-col shrink-0">
          {/* Sidebar header */}
          <div className="h-10 flex items-center justify-between px-3 border-b border-[#222436]">
            <span className="text-xs font-bold uppercase tracking-wider text-[#565a6e]">Documents</span>
            <div className="flex items-center gap-1">
              <button
                onClick={createNewFile}
                className="p-1 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
                title="New document"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setShowSidebar(false)}
                className="p-1 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
                title="Close sidebar"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto p-2">
            {files.length === 0 && (
              <div className="text-xs text-[#3b3f51] p-3 text-center">
                No documents yet. Click + to create one.
              </div>
            )}
            {files.map(file => (
              <button
                key={file.path}
                onClick={() => loadFile(file.path, file.name)}
                className={`w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 group transition-colors mb-0.5 ${
                  activeFile === file.path
                    ? 'bg-[#292e42] text-[#c0caf5]'
                    : 'text-[#565a6e] hover:bg-[#1f2233] hover:text-[#a9b1d6]'
                }`}
              >
                <FileText size={14} className="shrink-0" />
                <span className="truncate flex-1 text-xs">{file.name}</span>
                <button
                  onClick={(e) => deleteFile(file.path, e)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-all shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </button>
            ))}
          </div>

          {/* Sidebar footer */}
          <div className="px-3 py-2 border-t border-[#222436] text-[10px] text-[#3b3f51]">
            {useKernel ? 'Kernel FS' : 'localStorage'}
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Main area */}
      {/* ================================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ============================================================== */}
        {/* Toolbar */}
        {/* ============================================================== */}
        <div className="h-11 bg-[#1a1d26] border-b border-[#222436] flex items-center px-3 gap-1 shrink-0">
          {/* Open sidebar button (visible when sidebar is hidden) */}
          {!showSidebar && (
            <button
              onClick={() => setShowSidebar(true)}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5] mr-2"
              title="Open file browser"
            >
              <FolderOpen size={16} />
            </button>
          )}

          {/* Formatting buttons */}
          <div className="flex items-center gap-0.5 bg-[#16161e] rounded-lg p-0.5">
            <button
              onClick={() => wrapSelection('**', '**')}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Bold (Cmd+B)"
            >
              <Bold size={15} />
            </button>
            <button
              onClick={() => wrapSelection('*', '*')}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Italic (Cmd+I)"
            >
              <Italic size={15} />
            </button>
            <button
              onClick={insertHeading}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title={`Heading H${headingLevel} (cycles H1-H3)`}
            >
              <Heading size={15} />
            </button>
            <button
              onClick={() => wrapSelection('`', '`')}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Inline code"
            >
              <Code size={15} />
            </button>
            <button
              onClick={insertLink}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Insert link"
            >
              <Link size={15} />
            </button>
            <button
              onClick={insertImage}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Insert image"
            >
              <Image size={15} />
            </button>
            <button
              onClick={() => prependLine('- ')}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Unordered list"
            >
              <List size={15} />
            </button>
            <button
              onClick={() => prependLine('> ')}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Blockquote"
            >
              <Quote size={15} />
            </button>
            <button
              onClick={insertTable}
              className="p-1.5 hover:bg-[#292e42] rounded transition-colors text-[#565a6e] hover:text-[#c0caf5]"
              title="Insert table"
            >
              <Table size={15} />
            </button>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-[#222436] mx-2" />

          {/* View mode toggle */}
          <div className="flex items-center gap-0.5 bg-[#16161e] rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('editor')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'editor' ? 'bg-[#292e42] text-[#c0caf5]' : 'text-[#565a6e] hover:text-[#c0caf5] hover:bg-[#292e42]'
              }`}
              title="Editor only"
            >
              <PenLine size={15} />
            </button>
            <button
              onClick={() => setViewMode('split')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'split' ? 'bg-[#292e42] text-[#c0caf5]' : 'text-[#565a6e] hover:text-[#c0caf5] hover:bg-[#292e42]'
              }`}
              title="Split view"
            >
              <SplitSquareHorizontal size={15} />
            </button>
            <button
              onClick={() => setViewMode('preview')}
              className={`p-1.5 rounded transition-colors ${
                viewMode === 'preview' ? 'bg-[#292e42] text-[#c0caf5]' : 'text-[#565a6e] hover:text-[#c0caf5] hover:bg-[#292e42]'
              }`}
              title="Preview only"
            >
              <Eye size={15} />
            </button>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* AI assist button */}
          <div className="relative" ref={aiMenuRef}>
            <button
              onClick={() => setShowAiMenu(prev => !prev)}
              disabled={aiLoading}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                aiLoading
                  ? 'bg-[#292e42] text-[#7aa2f7] animate-pulse'
                  : 'bg-[#292e42] text-[#7aa2f7] hover:bg-[#343b58]'
              }`}
              title="AI Writing Assist (Cmd+Shift+I)"
            >
              {aiLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )}
              {aiLoading ? aiAction : 'AI Assist'}
              {!aiLoading && <ChevronDown size={12} />}
            </button>

            {/* AI dropdown menu */}
            {showAiMenu && !aiLoading && (
              <div className="absolute right-0 top-full mt-1 w-52 bg-[#1f2335] border border-[#292e42] rounded-lg shadow-xl z-50 overflow-hidden">
                <button
                  onClick={() => handleAiAction('continue')}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#a9b1d6] hover:bg-[#292e42] transition-colors flex items-center gap-2"
                >
                  <PenLine size={14} className="text-[#9ece6a]" />
                  Continue writing
                </button>
                <button
                  onClick={() => handleAiAction('summarize')}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#a9b1d6] hover:bg-[#292e42] transition-colors flex items-center gap-2"
                >
                  <FileText size={14} className="text-[#7aa2f7]" />
                  Summarize
                </button>
                <button
                  onClick={() => handleAiAction('rewrite')}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#a9b1d6] hover:bg-[#292e42] transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={14} className="text-[#bb9af7]" />
                  Rewrite
                </button>
                <button
                  onClick={() => handleAiAction('grammar')}
                  className="w-full text-left px-3 py-2.5 text-sm text-[#a9b1d6] hover:bg-[#292e42] transition-colors flex items-center gap-2"
                >
                  <Wand2 size={14} className="text-[#e0af68]" />
                  Fix grammar
                </button>
              </div>
            )}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ml-2 ${
              saveStatus === 'saved'
                ? 'bg-[#9ece6a]/20 text-[#9ece6a]'
                : isDirty
                  ? 'bg-[#e0af68]/20 text-[#e0af68] hover:bg-[#e0af68]/30'
                  : 'bg-[#292e42] text-[#565a6e] hover:text-[#c0caf5] hover:bg-[#343b58]'
            }`}
            title="Save (Cmd+S)"
          >
            <Save size={14} />
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'}
          </button>
        </div>

        {/* ============================================================== */}
        {/* Editor + Preview content area */}
        {/* ============================================================== */}
        <div
          ref={splitterContainerRef}
          className="flex-1 flex overflow-hidden relative"
          style={{ cursor: isDraggingSplitter ? 'col-resize' : undefined }}
        >
          {/* Editor pane */}
          {(viewMode === 'editor' || viewMode === 'split') && (
            <div
              className="flex h-full overflow-hidden"
              style={{
                width: viewMode === 'split' ? `${splitPosition}%` : '100%',
                minWidth: viewMode === 'split' ? '200px' : undefined,
              }}
            >
              {/* Line number gutter */}
              <div
                className="w-12 bg-[#16161e] overflow-hidden shrink-0 pt-4 select-none"
                style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace" }}
              >
                {renderLineNumbers()}
              </div>

              {/* Textarea editor */}
              <textarea
                ref={editorRef}
                value={content}
                onChange={handleContentChange}
                onKeyDown={handleKeyDown}
                onClick={updateCursorPosition}
                onKeyUp={updateCursorPosition}
                onScroll={handleEditorScroll}
                className="flex-1 bg-[#1a1b26] text-[#c0caf5] p-4 pl-2 outline-none resize-none leading-6 text-sm"
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                  tabSize: 2,
                  caretColor: '#7aa2f7',
                }}
                spellCheck={false}
                placeholder="Start writing your markdown here..."
              />
            </div>
          )}

          {/* Resizable splitter handle */}
          {viewMode === 'split' && (
            <div
              onMouseDown={handleSplitterMouseDown}
              className={`w-1.5 cursor-col-resize flex items-center justify-center shrink-0 transition-colors ${
                isDraggingSplitter ? 'bg-[#7aa2f7]' : 'bg-[#222436] hover:bg-[#3b3f51]'
              }`}
            >
              <div className="w-0.5 h-8 bg-[#3b3f51] rounded-full" />
            </div>
          )}

          {/* Preview pane */}
          {(viewMode === 'preview' || viewMode === 'split') && (
            <div
              ref={previewRef}
              className="h-full overflow-y-auto bg-[#fafbfc]"
              style={{
                width: viewMode === 'split' ? `${100 - splitPosition}%` : '100%',
                minWidth: viewMode === 'split' ? '200px' : undefined,
              }}
            >
              <div
                className="max-w-3xl mx-auto p-8"
                style={{
                  fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
                  color: '#1e293b',
                  fontSize: '16px',
                  lineHeight: '1.8',
                }}
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}

          {/* Drag overlay to prevent iframe/selection issues while dragging */}
          {isDraggingSplitter && (
            <div className="absolute inset-0 z-50" style={{ cursor: 'col-resize' }} />
          )}
        </div>

        {/* ============================================================== */}
        {/* Status bar */}
        {/* ============================================================== */}
        <div className="h-7 bg-[#16161e] border-t border-[#222436] flex items-center px-3 justify-between text-[11px] text-[#3b3f51] shrink-0 select-none">
          <div className="flex items-center gap-4">
            <span className="text-[#565a6e]">{fileName}</span>
            {isDirty && (
              <span className="text-[#e0af68]">Modified</span>
            )}
            {saveStatus === 'saving' && (
              <span className="text-[#7aa2f7]">Saving...</span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-[#9ece6a]">Saved</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <span>Ln {cursorLine}, Col {cursorCol}</span>
            <span>{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
            <span>{charCount} {charCount === 1 ? 'char' : 'chars'}</span>
            <span>{readingTime} min read</span>
            <span className="text-[#565a6e]">Markdown</span>
          </div>
        </div>
      </div>
    </div>
  );
};
