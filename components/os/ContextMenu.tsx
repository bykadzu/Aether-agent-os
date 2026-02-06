import React, { useEffect, useRef } from 'react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  actions: { label: string; action: () => void; icon?: React.ReactNode; separator?: boolean }[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, actions }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use a small timeout to prevent the initial right-click from closing the menu immediately
    const timeout = setTimeout(() => {
        document.addEventListener('click', handleClick);
    }, 10);
    
    return () => {
        clearTimeout(timeout);
        document.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{ top: y, left: x }}
      className="fixed z-[9999] min-w-[180px] bg-glass-800 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl py-1.5 text-sm text-gray-100 animate-scale-in origin-top-left overflow-hidden"
    >
      {actions.map((item, index) => (
        <React.Fragment key={index}>
            {item.separator ? (
                 <div className="h-[1px] bg-white/10 my-1 mx-2" />
            ) : (
                <button
                onClick={(e) => { e.stopPropagation(); item.action(); onClose(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-blue-500 hover:text-white transition-colors flex items-center gap-2 group"
                >
                {item.icon && <span className="text-gray-400 group-hover:text-white">{item.icon}</span>}
                {item.label}
                </button>
            )}
        </React.Fragment>
      ))}
    </div>
  );
};