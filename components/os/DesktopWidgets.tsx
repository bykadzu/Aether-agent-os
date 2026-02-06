import React from 'react';
import { CloudSun, Calendar, Play, SkipForward, SkipBack, Music } from 'lucide-react';

export const DesktopWidgets: React.FC = () => {
  return (
    <div className="absolute top-12 right-6 flex flex-col gap-4 z-0 pointer-events-none select-none">
      {/* Weather Widget */}
      <div className="w-40 h-40 bg-glass-300 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg p-4 flex flex-col justify-between text-white animate-fade-in hover:bg-glass-400 transition-colors pointer-events-auto cursor-default">
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
             <span className="text-sm font-medium opacity-80">Cupertino</span>
             <span className="text-4xl font-light">72°</span>
          </div>
          <CloudSun size={24} className="text-yellow-300" />
        </div>
        <div className="text-xs font-medium space-y-1 opacity-90">
           <div className="flex justify-between">
             <span>H:76°</span>
             <span>L:62°</span>
           </div>
           <p>Mostly Sunny</p>
        </div>
      </div>

      {/* Calendar Widget */}
       <div className="w-40 h-40 bg-white/80 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg p-4 flex flex-col items-center justify-center text-gray-800 animate-fade-in pointer-events-auto cursor-default hover:bg-white/90 transition-colors" style={{ animationDelay: '0.1s' }}>
         <span className="text-red-500 font-bold uppercase text-xs tracking-wider">Tuesday</span>
         <span className="text-5xl font-light">24</span>
         <div className="mt-2 flex gap-1 justify-center">
             <div className="w-1.5 h-1.5 rounded-full bg-gray-400"></div>
             <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
         </div>
      </div>

      {/* Music Widget */}
      <div className="w-40 h-40 bg-gradient-to-br from-pink-500 to-rose-600 backdrop-blur-md rounded-3xl border border-white/20 shadow-lg p-4 flex flex-col justify-between text-white animate-fade-in pointer-events-auto cursor-default" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-center gap-2 opacity-80">
              <Music size={16} />
              <span className="text-xs font-medium uppercase tracking-wider">Music</span>
          </div>
          <div>
              <div className="font-semibold text-sm truncate">Midnight City</div>
              <div className="text-xs opacity-70 truncate">M83</div>
          </div>
          <div className="flex items-center justify-between mt-2">
              <button className="hover:text-white/70 transition-colors"><SkipBack size={16} fill="currentColor" /></button>
              <button className="hover:scale-110 transition-transform"><Play size={24} fill="currentColor" /></button>
              <button className="hover:text-white/70 transition-colors"><SkipForward size={16} fill="currentColor" /></button>
          </div>
      </div>
    </div>
  );
};