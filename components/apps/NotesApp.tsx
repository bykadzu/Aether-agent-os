import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PenTool, Wand2, Check, RefreshCw, AlignLeft, Save, Plus, FileText, Trash2 } from 'lucide-react';
import { generateText, GeminiModel } from '../../services/geminiService';
import { getKernelClient } from '../../services/kernelClient';

interface NotesAppProps {
    initialContent?: string;
    onSave?: (content: string) => void;
}

interface NoteFile {
  name: string;
  path: string;
}

const NOTES_DIR = '/home/root/Documents/notes';

export const NotesApp: React.FC<NotesAppProps> = ({ initialContent, onSave }) => {
  const [content, setContent] = useState("Welcome to Aether Notes.\n\nStart typing here, then use the AI tools above to enhance your writing.");
  const [isProcessing, setIsProcessing] = useState(false);
  const [toolMessage, setToolMessage] = useState('');
  const [showSaved, setShowSaved] = useState(false);
  const [useKernel, setUseKernel] = useState(false);
  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [noteTitle, setNoteTitle] = useState('Untitled');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check kernel connection and load notes
  useEffect(() => {
    const client = getKernelClient();
    if (client.connected) {
      setUseKernel(true);
      loadNotes();
    } else {
      // Load from localStorage
      const savedNotes = localStorage.getItem('aether_notes');
      if (savedNotes) {
        try {
          const parsed = JSON.parse(savedNotes);
          if (parsed.content) setContent(parsed.content);
          if (parsed.noteList) setNotes(parsed.noteList);
        } catch {}
      }
    }
  }, []);

  useEffect(() => {
    if (initialContent) {
      setContent(initialContent);
    }
  }, [initialContent]);

  // Auto-save with debounce (2s of inactivity)
  const debounceSave = useCallback((newContent: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (useKernel && activeNote) {
        const client = getKernelClient();
        client.writeFile(activeNote, newContent).catch(() => {});
      } else {
        // Save to localStorage
        localStorage.setItem('aether_notes', JSON.stringify({
          content: newContent,
          noteList: notes,
        }));
      }
    }, 2000);
  }, [useKernel, activeNote, notes]);

  const loadNotes = async () => {
    const client = getKernelClient();
    try {
      // Ensure notes directory exists
      await client.mkdir(NOTES_DIR).catch(() => {});
      const entries = await client.listDir(NOTES_DIR);
      const mdFiles = entries
        .filter((e: any) => e.type === 'file' && e.name.endsWith('.md'))
        .map((e: any) => ({ name: e.name.replace('.md', ''), path: e.path }));
      setNotes(mdFiles);

      // Load the first note if it exists
      if (mdFiles.length > 0) {
        await loadNote(mdFiles[0].path, mdFiles[0].name);
      }
    } catch (err) {
      console.error('[NotesApp] Failed to load notes:', err);
    }
  };

  const loadNote = async (path: string, name: string) => {
    const client = getKernelClient();
    try {
      const { content: fileContent } = await client.readFile(path);
      setContent(fileContent);
      setActiveNote(path);
      setNoteTitle(name);
    } catch {
      setContent('');
      setActiveNote(path);
      setNoteTitle(name);
    }
  };

  const createNewNote = async () => {
    const name = `Note ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const path = `${NOTES_DIR}/${name}.md`;

    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.mkdir(NOTES_DIR).catch(() => {});
        await client.writeFile(path, `# ${name}\n\n`);
        setNotes(prev => [...prev, { name, path }]);
        setContent(`# ${name}\n\n`);
        setActiveNote(path);
        setNoteTitle(name);
      } catch (err) {
        console.error('[NotesApp] Failed to create note:', err);
      }
    } else {
      setNotes(prev => [...prev, { name, path }]);
      setContent(`# ${name}\n\n`);
      setActiveNote(path);
      setNoteTitle(name);
    }
  };

  const deleteNote = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (useKernel) {
      const client = getKernelClient();
      try {
        await client.rm(path);
      } catch {}
    }
    setNotes(prev => prev.filter(n => n.path !== path));
    if (activeNote === path) {
      setContent('');
      setActiveNote(null);
      setNoteTitle('Untitled');
    }
  };

  const handleContentChange = (newContent: string) => {
    setContent(newContent);
    debounceSave(newContent);
  };

  const handleSave = async () => {
    if (useKernel && activeNote) {
      const client = getKernelClient();
      try {
        await client.writeFile(activeNote, content);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
        return;
      } catch {}
    }

    if (onSave) {
      onSave(content);
    }

    // Save to localStorage fallback
    localStorage.setItem('aether_notes', JSON.stringify({
      content,
      noteList: notes,
    }));

    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleAiAction = async (action: 'summarize' | 'polish' | 'expand') => {
    if (!content.trim()) return;
    setIsProcessing(true);
    setToolMessage(`Gemini is ${action === 'polish' ? 'polishing' : action + 'ing'}...`);

    let prompt = "";
    let model = GeminiModel.FLASH;

    switch (action) {
      case 'summarize':
        prompt = `Summarize the following text efficiently:\n\n${content}`;
        break;
      case 'polish':
        prompt = `Rewrite the following text to be more professional, fixing grammar and improving flow:\n\n${content}`;
        break;
      case 'expand':
        model = GeminiModel.PRO;
        prompt = `Expand upon the following text, adding relevant details and context while maintaining the tone:\n\n${content}`;
        break;
    }

    const result = await generateText(prompt, model);
    setContent(result);
    debounceSave(result);
    setIsProcessing(false);
    setToolMessage('');
  };

  return (
    <div className="flex h-full bg-white/60">
      {/* Notes Sidebar */}
      <div className="w-48 bg-gray-50/80 border-r border-gray-200/50 flex flex-col">
        <div className="p-2 border-b border-gray-200/50 flex items-center justify-between">
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Notes</span>
          <button onClick={createNewNote} className="p-1 hover:bg-gray-200/50 rounded transition-colors text-gray-500 hover:text-gray-700" title="New Note">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1">
          {notes.length === 0 && (
            <div className="text-xs text-gray-400 p-3 text-center">
              No notes yet. Click + to create one.
            </div>
          )}
          {notes.map(note => (
            <button
              key={note.path}
              onClick={() => useKernel ? loadNote(note.path, note.name) : (() => { setActiveNote(note.path); setNoteTitle(note.name); })()}
              className={`w-full text-left p-2 rounded-lg text-sm flex items-center gap-2 group transition-colors ${
                activeNote === note.path ? 'bg-blue-100/50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-100/50'
              }`}
            >
              <FileText size={14} className="shrink-0" />
              <span className="truncate flex-1">{note.name}</span>
              <button
                onClick={(e) => deleteNote(note.path, e)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-500 transition-all"
              >
                <Trash2 size={12} />
              </button>
            </button>
          ))}
        </div>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center justify-between p-2 border-b border-gray-200/50 bg-white/40">
          <div className="flex bg-gray-200/50 rounded-lg p-1">
            <button
              disabled={isProcessing}
              onClick={() => handleAiAction('polish')}
              className="p-2 hover:bg-white rounded-md transition-all text-gray-700 disabled:opacity-50"
              title="Polish Grammar & Style"
            >
              <Wand2 size={16} />
            </button>
            <button
              disabled={isProcessing}
              onClick={() => handleAiAction('summarize')}
              className="p-2 hover:bg-white rounded-md transition-all text-gray-700 disabled:opacity-50"
              title="Summarize"
            >
              <AlignLeft size={16} />
            </button>
            <button
              disabled={isProcessing}
              onClick={() => handleAiAction('expand')}
              className="p-2 hover:bg-white rounded-md transition-all text-gray-700 disabled:opacity-50"
              title="Expand (Gemini Pro)"
            >
              <PenTool size={16} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isProcessing && (
              <div className="flex items-center gap-2 text-xs font-medium text-blue-600 animate-pulse">
                <RefreshCw size={12} className="animate-spin" />
                {toolMessage}
              </div>
            )}
            <button
              onClick={handleSave}
              className="flex items-center gap-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
            >
              {showSaved ? <Check size={14} /> : <Save size={14} />}
              {showSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* Editor */}
        <textarea
          value={content}
          onChange={(e) => handleContentChange(e.target.value)}
          onBlur={handleSave}
          className="flex-1 w-full p-6 bg-transparent resize-none focus:outline-none font-sans text-gray-800 leading-7 text-lg placeholder-gray-400"
          placeholder="Start typing..."
        />

        <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-200/50 flex justify-between">
          <span>{content.length} characters · {noteTitle}</span>
          <span>{useKernel ? 'Kernel FS' : 'localStorage'}</span>
        </div>
      </div>
    </div>
  );
};
