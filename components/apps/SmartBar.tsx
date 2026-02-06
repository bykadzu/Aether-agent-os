import React, { useState, useEffect, useRef } from 'react';
import { Search, Sparkles, Command, ArrowRight } from 'lucide-react';
import { generateText, GeminiModel } from '../../services/geminiService';

interface SmartBarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SmartBar: React.FC<SmartBarProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    } else {
      setQuery('');
      setResult(null);
    }
  }, [isOpen]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResult(null);

    // Using Flash for quick system-level queries
    const response = await generateText(
      query, 
      GeminiModel.FLASH, 
      "You are Aether, an intelligent AI OS assistant. Keep answers concise, helpful, and friendly. Do not use markdown syntax excessively."
    );
    
    setResult(response);
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[20vh] bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="w-[600px] bg-glass-800 backdrop-blur-2xl rounded-2xl border border-white/20 shadow-2xl overflow-hidden animate-scale-in"
        onClick={e => e.stopPropagation()}
      >
        <form onSubmit={handleSearch} className="flex items-center p-4 gap-3 border-b border-white/10">
          <Sparkles className={`w-6 h-6 ${loading ? 'text-blue-500 animate-pulse' : 'text-gray-500'}`} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask Gemini anything..."
            className="flex-1 bg-transparent text-xl text-gray-800 placeholder-gray-500 focus:outline-none font-medium"
          />
          <div className="flex items-center gap-1 text-xs text-gray-500 bg-white/20 px-2 py-1 rounded">
            <span className="font-mono">RET</span>
            <ArrowRight size={10} />
          </div>
        </form>

        {loading && (
          <div className="p-8 text-center text-gray-500">
             <div className="inline-block w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2"></div>
             <p className="text-sm">Gemini is thinking...</p>
          </div>
        )}

        {result && (
          <div className="p-6 bg-white/40 max-h-[400px] overflow-y-auto">
            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{result}</p>
            <div className="mt-4 pt-4 border-t border-gray-200/50 flex justify-between items-center">
                <span className="text-xs text-gray-500 font-medium bg-blue-100/50 px-2 py-1 rounded text-blue-700">Gemini 2.5 Flash</span>
                <button 
                    onClick={() => navigator.clipboard.writeText(result)}
                    className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
                >
                    Copy to clipboard
                </button>
            </div>
          </div>
        )}
        
        {!result && !loading && (
            <div className="bg-gray-50/50 p-2 px-4 text-xs text-gray-400 flex justify-between">
                <span>Pro tip: Ask for calculations, definitions, or quick drafts.</span>
                <span>ESC to close</span>
            </div>
        )}
      </div>
    </div>
  );
};