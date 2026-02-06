import React, { useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Lock, Star } from 'lucide-react';

export const BrowserApp: React.FC = () => {
  const [url, setUrl] = useState('https://www.wikipedia.org');
  const [inputUrl, setInputUrl] = useState('https://www.wikipedia.org');
  const [isLoading, setIsLoading] = useState(false);

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault();
    let target = inputUrl;
    if (!target.startsWith('http')) {
        target = `https://${target}`;
    }
    setUrl(target);
    setIsLoading(true);
  };

  const onLoad = () => {
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-100">
      {/* Chrome */}
      <div className="h-10 bg-white border-b border-gray-200 flex items-center px-2 gap-2 shadow-sm z-10">
        <div className="flex gap-1 text-gray-500">
             <button className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><ArrowLeft size={16}/></button>
             <button className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"><ArrowRight size={16}/></button>
             <button 
                className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                onClick={() => { setIsLoading(true); const u = url; setUrl(''); setTimeout(() => setUrl(u), 10); }}
             >
                <RotateCw size={14} className={isLoading ? "animate-spin" : ""} />
             </button>
        </div>
        
        <form onSubmit={handleNavigate} className="flex-1 relative group">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock size={12} />
            </div>
            <input 
                type="text" 
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
                className="w-full bg-gray-100 group-hover:bg-gray-200/70 focus:bg-white border-transparent focus:border-blue-500/50 rounded-full pl-8 pr-8 py-1.5 text-sm outline-none transition-all text-gray-700 text-center focus:text-left focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                <Star size={12} />
            </div>
        </form>
      </div>

      {/* Content */}
      <div className="flex-1 relative bg-white">
        {/* Note: In a real production app, iframes have X-Frame-Options restrictions. 
            For this demo, we assume the user understands some sites won't load. 
            Wikipedia usually allows embedding. */}
        <iframe 
            src={url} 
            className="w-full h-full border-none"
            title="Browser"
            onLoad={onLoad}
            sandbox="allow-same-origin allow-scripts allow-forms"
        />
        {isLoading && (
            <div className="absolute inset-0 bg-white flex flex-col items-center justify-center">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <span className="text-gray-400 text-sm">Loading...</span>
            </div>
        )}
      </div>
    </div>
  );
};