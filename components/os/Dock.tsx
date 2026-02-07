import React from 'react';
import { AppID } from '../../types';
import {
  StickyNote,
  FolderOpen,
  Settings as SettingsIcon,
  Terminal,
  Globe,
  Code,
  Bot,
  Table2,
  Palette,
  FileEdit,
  Activity,
  Music,
  FileText,
} from 'lucide-react';

interface DockProps {
  onAppClick: (id: AppID) => void;
  openApps: string[]; // Changed to string[] to match window IDs
}

export const Dock: React.FC<DockProps> = ({ onAppClick, openApps }) => {
  const apps = [
    { id: AppID.AGENTS, icon: Bot, label: 'Agent Center', color: 'bg-indigo-500 text-white' },
    { id: AppID.FILES, icon: FolderOpen, label: 'Finder', color: 'bg-blue-100 text-blue-600' },
    { id: AppID.BROWSER, icon: Globe, label: 'Safari', color: 'bg-blue-50 text-blue-500' },
    { id: AppID.TERMINAL, icon: Terminal, label: 'Terminal', color: 'bg-gray-800 text-white' },
    { id: AppID.CODE, icon: Code, label: 'Code', color: 'bg-indigo-100 text-indigo-600' },
    { id: AppID.NOTES, icon: StickyNote, label: 'Notes', color: 'bg-yellow-100 text-yellow-600' },
    { id: AppID.SHEETS, icon: Table2, label: 'Sheets', color: 'bg-green-100 text-green-600' },
    { id: AppID.CANVAS, icon: Palette, label: 'Canvas', color: 'bg-purple-100 text-purple-600' },
    { id: AppID.WRITER, icon: FileEdit, label: 'Writer', color: 'bg-orange-100 text-orange-600' },
    { id: AppID.MUSIC, icon: Music, label: 'Music', color: 'bg-pink-100 text-pink-600' },
    { id: AppID.DOCUMENTS, icon: FileText, label: 'Documents', color: 'bg-sky-100 text-sky-600' },
    {
      id: AppID.SYSTEM_MONITOR,
      icon: Activity,
      label: 'System Monitor',
      color: 'bg-red-100 text-red-600',
    },
  ];

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000]">
      <div className="bg-glass-300 backdrop-blur-xl border border-white/20 px-4 py-3 rounded-3xl shadow-2xl flex items-end gap-4 transition-all hover:scale-105 duration-300">
        {apps.map((app) => (
          <button
            key={app.id}
            onClick={() => onAppClick(app.id)}
            className="group relative flex flex-col items-center gap-1 transition-all hover:-translate-y-2 duration-300"
          >
            <div
              className={`w-12 h-12 rounded-2xl ${app.color} shadow-lg flex items-center justify-center border border-white/30 transition-transform active:scale-95`}
            >
              <app.icon size={24} />
            </div>
            {openApps.some((id) => id.startsWith(app.id)) && (
              <div className="w-1 h-1 bg-black/40 rounded-full absolute -bottom-2"></div>
            )}
            <span className="absolute -top-10 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              {app.label}
            </span>
          </button>
        ))}

        <div className="w-[1px] h-10 bg-white/20 mx-1"></div>

        <button
          onClick={() => onAppClick(AppID.SETTINGS)}
          className="group relative flex flex-col items-center gap-1 transition-all hover:-translate-y-2 duration-300"
        >
          <div className="w-12 h-12 rounded-2xl bg-gray-200 text-gray-600 shadow-lg flex items-center justify-center border border-white/30 transition-transform active:scale-95">
            <SettingsIcon size={24} />
          </div>
          {openApps.some((id) => id.startsWith(AppID.SETTINGS)) && (
            <div className="w-1 h-1 bg-black/40 rounded-full absolute -bottom-2"></div>
          )}
          <span className="absolute -top-10 bg-black/70 backdrop-blur-sm text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
            Settings
          </span>
        </button>
      </div>
    </div>
  );
};
