import React, { useState, useRef, useEffect } from 'react';
import { LogOut, Settings, Users, ChevronDown } from 'lucide-react';

interface UserInfo {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

interface UserMenuProps {
  user: UserInfo;
  onLogout: () => void;
  onOpenSettings?: () => void;
  onOpenUserManagement?: () => void;
}

export const UserMenu: React.FC<UserMenuProps> = ({ user, onLogout, onOpenSettings, onOpenUserManagement }) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get initials for avatar
  const initials = user.displayName
    .split(' ')
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase() || user.username.substring(0, 2).toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      {/* Trigger */}
      <button
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        className="flex items-center gap-1.5 hover:bg-white/10 px-1.5 py-0.5 rounded transition-colors"
      >
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-[8px] font-bold">
          {initials}
        </div>
        <span className="text-[11px] text-white/80 hidden sm:inline">{user.displayName}</span>
        <ChevronDown size={10} className={`text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-56 bg-[#1a1b26]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-[9999] animate-fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* User Info Header */}
          <div className="px-4 py-3 border-b border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="text-sm text-white font-medium truncate">{user.displayName}</div>
                <div className="text-[10px] text-white/40 truncate">@{user.username}</div>
              </div>
            </div>
            {user.role === 'admin' && (
              <div className="mt-2">
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/20">
                  Admin
                </span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="py-1">
            {onOpenSettings && (
              <button
                onClick={() => { setIsOpen(false); onOpenSettings(); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Settings size={14} />
                Settings
              </button>
            )}

            {user.role === 'admin' && onOpenUserManagement && (
              <button
                onClick={() => { setIsOpen(false); onOpenUserManagement(); }}
                className="w-full flex items-center gap-3 px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Users size={14} />
                User Management
              </button>
            )}

            <div className="my-1 border-t border-white/5" />

            <button
              onClick={() => { setIsOpen(false); onLogout(); }}
              className="w-full flex items-center gap-3 px-4 py-2 text-xs text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <LogOut size={14} />
              Log Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
