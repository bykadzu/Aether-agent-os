import React, { useState, useEffect } from 'react';
import { PenTool, Wand2, Check, RefreshCw, AlignLeft, Save } from 'lucide-react';
import { generateText, GeminiModel } from '../../services/geminiService';

interface NotesAppProps {
    initialContent?: string;
    onSave?: (content: string) => void;
}

export const NotesApp: React.FC<NotesAppProps> = ({ initialContent, onSave }) => {
  const [content, setContent] = useState("Welcome to Aether Notes.\n\nStart typing here, then use the AI tools above to enhance your writing.");
  const [isProcessing, setIsProcessing] = useState(false);
  const [toolMessage, setToolMessage] = useState('');
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    if (initialContent) {
        setContent(initialContent);
    }
  }, [initialContent]);

  const handleSave = () => {
    if (onSave) {
        onSave(content);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
    }
  };

  const handleAiAction = async (action: 'summarize' | 'polish' | 'expand') => {
    if (!content.trim()) return;
    setIsProcessing(true);
    setToolMessage(`Gemini is ${action === 'polish' ? 'polishing' : action + 'ing'}...`);

    let prompt = "";
    let model = GeminiModel.FLASH; // Default fast model

    switch (action) {
      case 'summarize':
        prompt = `Summarize the following text efficiently:\n\n${content}`;
        break;
      case 'polish':
        prompt = `Rewrite the following text to be more professional, fixing grammar and improving flow:\n\n${content}`;
        break;
      case 'expand':
        model = GeminiModel.PRO; // Use Pro for creative expansion
        prompt = `Expand upon the following text, adding relevant details and context while maintaining the tone:\n\n${content}`;
        break;
    }

    const result = await generateText(prompt, model);
    setContent(result);
    setIsProcessing(false);
    setToolMessage('');
  };

  return (
    <div className="flex flex-col h-full bg-white/60">
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
                <RefreshCw size={12} className="animate-spin"/>
                {toolMessage}
            </div>
            )}
            {onSave && (
                <button 
                    onClick={handleSave}
                    className="flex items-center gap-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                >
                    {showSaved ? <Check size={14} /> : <Save size={14} />}
                    {showSaved ? 'Saved' : 'Save'}
                </button>
            )}
        </div>
      </div>

      {/* Editor */}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 w-full p-6 bg-transparent resize-none focus:outline-none font-sans text-gray-800 leading-7 text-lg placeholder-gray-400"
        placeholder="Start typing..."
      />
      
      <div className="px-4 py-2 text-xs text-gray-400 border-t border-gray-200/50 flex justify-between">
         <span>{content.length} characters</span>
         <span>Powered by Gemini</span>
      </div>
    </div>
  );
};