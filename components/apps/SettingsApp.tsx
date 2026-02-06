import React, { useState } from 'react';
import { 
  Wifi, Bluetooth, User, Globe, Moon, 
  Battery, Lock, Monitor, Bell, Search, Info
} from 'lucide-react';

export const SettingsApp: React.FC = () => {
  const [activeTab, setActiveTab] = useState('General');

  const categories = [
    { name: 'Network', icon: Wifi, color: 'bg-blue-500' },
    { name: 'Bluetooth', icon: Bluetooth, color: 'bg-blue-600' },
    { name: 'General', icon: Info, color: 'bg-gray-500' },
    { name: 'Appearance', icon: Moon, color: 'bg-indigo-500' },
    { name: 'Display', icon: Monitor, color: 'bg-blue-400' },
    { name: 'Notifications', icon: Bell, color: 'bg-red-500' },
    { name: 'Battery', icon: Battery, color: 'bg-green-500' },
    { name: 'Privacy', icon: Lock, color: 'bg-sky-500' },
  ];

  const renderContent = () => {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4 mb-8">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
                A
            </div>
            <div>
                <h2 className="text-xl font-bold text-gray-800">Aether User</h2>
                <p className="text-sm text-gray-500">Apple ID, iCloud, Media & Purchases</p>
            </div>
        </div>

        {activeTab === 'General' && (
           <>
             <div className="bg-white/50 rounded-xl border border-white/40 overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
                    <span className="text-sm font-medium text-gray-700">Software Update</span>
                    <span className="text-xs text-gray-400 flex items-center gap-1">iOS 18.0 <span className="w-2 h-2 rounded-full bg-red-500"></span></span>
                </div>
                <div className="p-4 flex items-center justify-between border-b border-gray-100 hover:bg-white/60 transition-colors">
                    <span className="text-sm font-medium text-gray-700">Storage</span>
                    <span className="text-xs text-gray-400">24GB / 128GB</span>
                </div>
                 <div className="p-4 flex items-center justify-between hover:bg-white/60 transition-colors">
                    <span className="text-sm font-medium text-gray-700">About</span>
                    <span className="text-xs text-gray-400">Aether OS 1.0</span>
                </div>
             </div>
           </>
        )}

        {activeTab === 'Appearance' && (
            <div className="bg-white/50 rounded-xl border border-white/40 p-4">
                <h3 className="text-sm font-medium text-gray-700 mb-4">Theme</h3>
                <div className="flex gap-4">
                    <div className="flex-1 aspect-video bg-gray-100 rounded-lg border-2 border-blue-500 relative cursor-pointer shadow-sm">
                        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-600">Light</div>
                        <div className="absolute bottom-2 right-2 w-4 h-4 rounded-full bg-blue-500 text-white flex items-center justify-center text-[10px]">✓</div>
                    </div>
                    <div className="flex-1 aspect-video bg-gray-800 rounded-lg border-2 border-transparent hover:border-gray-300 cursor-pointer shadow-sm">
                        <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-gray-300">Dark</div>
                    </div>
                </div>
            </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full bg-gray-50/80 backdrop-blur-xl">
      {/* Sidebar */}
      <div className="w-60 bg-white/30 border-r border-gray-200/50 flex flex-col">
         <div className="p-4 pb-2">
            <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Search" className="w-full bg-black/5 pl-8 pr-3 py-1.5 rounded-lg text-sm focus:outline-none focus:bg-black/10 transition-colors" />
            </div>
         </div>
         <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {categories.map(cat => (
                <button 
                    key={cat.name}
                    onClick={() => setActiveTab(cat.name)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${activeTab === cat.name ? 'bg-blue-500 text-white shadow-sm' : 'hover:bg-black/5 text-gray-700'}`}
                >
                    <div className={`w-6 h-6 rounded-md ${cat.color} flex items-center justify-center text-white shrink-0 shadow-sm`}>
                        <cat.icon size={14} />
                    </div>
                    <span className="font-medium">{cat.name}</span>
                </button>
            ))}
         </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-8 bg-gray-50/50">
         {renderContent()}
      </div>
    </div>
  );
};