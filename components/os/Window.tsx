import React, { useState, useEffect, useRef } from 'react';
import { X, Minus, Square, Maximize2 } from 'lucide-react';
import { WindowState } from '../../types';

interface WindowProps {
  windowState: WindowState;
  onClose: (id: string) => void;
  onMinimize: (id: string) => void;
  onMaximize: (id: string) => void;
  onFocus: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number, x?: number, y?: number) => void;
  children: React.ReactNode;
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// Exporting reusable styles for VirtualDesktop
export const WindowChromeStyle = {
  vmBg: 'bg-[#0f111a]/95',
  glassBg: 'bg-glass-700',
  vmBorder: 'border-indigo-500/30',
  glassBorder: 'border-white/20',
  vmText: 'text-indigo-100',
  glassText: 'text-gray-800/80'
};

export const Window: React.FC<WindowProps> = ({
  windowState,
  onClose,
  onMinimize,
  onMaximize,
  onFocus,
  onMove,
  onResize,
  children
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  
  const [isResizing, setIsResizing] = useState(false);
  const [resizeDir, setResizeDir] = useState<ResizeDirection | null>(null);
  const [resizeStart, setResizeStart] = useState({ 
    mouseX: 0, 
    mouseY: 0, 
    winX: 0, 
    winY: 0, 
    winW: 0, 
    winH: 0 
  });

  const windowRef = useRef<HTMLDivElement>(null);
  const MIN_WIDTH = 300;
  const MIN_HEIGHT = 200;

  // Handle Mouse Down for Dragging
  const handleDragStart = (e: React.MouseEvent) => {
    if (windowState.isMaximized) return;
    e.stopPropagation();
    onFocus(windowState.id);
    
    // Only allow drag from title bar, not buttons
    const target = e.target as HTMLElement;
    if (target.closest('.window-controls')) return;

    setIsDragging(true);
    setDragOffset({
      x: e.clientX - windowState.position.x,
      y: e.clientY - windowState.position.y
    });
  };

  // Handle Mouse Down for Resizing
  const handleResizeStart = (e: React.MouseEvent, dir: ResizeDirection) => {
    if (windowState.isMaximized) return;
    e.stopPropagation();
    e.preventDefault();
    onFocus(windowState.id);
    
    setIsResizing(true);
    setResizeDir(dir);
    setResizeStart({
      mouseX: e.clientX,
      mouseY: e.clientY,
      winX: windowState.position.x,
      winY: windowState.position.y,
      winW: windowState.size.width,
      winH: windowState.size.height
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        onMove(windowState.id, e.clientX - dragOffset.x, e.clientY - dragOffset.y);
      } else if (isResizing && resizeDir) {
        const deltaX = e.clientX - resizeStart.mouseX;
        const deltaY = e.clientY - resizeStart.mouseY;
        
        let newWidth = resizeStart.winW;
        let newHeight = resizeStart.winH;
        let newX = resizeStart.winX;
        let newY = resizeStart.winY;

        // Vertical Resize
        if (resizeDir.includes('n')) {
          const potentialHeight = resizeStart.winH - deltaY;
          if (potentialHeight > MIN_HEIGHT) {
            newHeight = potentialHeight;
            newY = resizeStart.winY + deltaY;
          }
        } else if (resizeDir.includes('s')) {
          newHeight = Math.max(MIN_HEIGHT, resizeStart.winH + deltaY);
        }

        // Horizontal Resize
        if (resizeDir.includes('w')) {
          const potentialWidth = resizeStart.winW - deltaX;
          if (potentialWidth > MIN_WIDTH) {
            newWidth = potentialWidth;
            newX = resizeStart.winX + deltaX;
          }
        } else if (resizeDir.includes('e')) {
          newWidth = Math.max(MIN_WIDTH, resizeStart.winW + deltaX);
        }

        onResize(windowState.id, newWidth, newHeight, newX, newY);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      setResizeDir(null);
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, isResizing, dragOffset, resizeDir, resizeStart, onMove, onResize, windowState.id]);

  if (!windowState.isOpen || windowState.isMinimized) return null;

  const style: React.CSSProperties = {
    zIndex: windowState.zIndex,
    transform: windowState.isMaximized 
      ? 'translate(0, 0)' 
      : `translate(${windowState.position.x}px, ${windowState.position.y}px)`,
    width: windowState.isMaximized ? '100%' : `${windowState.size.width}px`,
    height: windowState.isMaximized ? 'calc(100% - 40px)' : `${windowState.size.height}px`,
    top: windowState.isMaximized ? '0' : 'unset',
    left: windowState.isMaximized ? '0' : 'unset',
  };

  // Special styling for VM windows (Darker, more tech-focused)
  const isVM = windowState.appId === 'vm' || windowState.appId === 'agents';
  const bgColor = isVM ? WindowChromeStyle.vmBg : WindowChromeStyle.glassBg;
  const borderColor = isVM ? WindowChromeStyle.vmBorder : WindowChromeStyle.glassBorder;
  const titleColor = isVM ? WindowChromeStyle.vmText : WindowChromeStyle.glassText;

  return (
    <div
      ref={windowRef}
      style={style}
      className={`absolute flex flex-col ${bgColor} backdrop-blur-2xl border ${borderColor} shadow-2xl rounded-xl overflow-visible transition-shadow duration-300 ${isDragging ? 'cursor-grabbing' : ''}`}
      onMouseDown={() => onFocus(windowState.id)}
    >
      {/* Resize Handles - Only show if not maximized */}
      {!windowState.isMaximized && (
        <>
          <div className="absolute -top-1 inset-x-2 h-2 cursor-ns-resize z-10" onMouseDown={(e) => handleResizeStart(e, 'n')} />
          <div className="absolute -bottom-1 inset-x-2 h-2 cursor-ns-resize z-10" onMouseDown={(e) => handleResizeStart(e, 's')} />
          <div className="absolute -left-1 inset-y-2 w-2 cursor-ew-resize z-10" onMouseDown={(e) => handleResizeStart(e, 'w')} />
          <div className="absolute -right-1 inset-y-2 w-2 cursor-ew-resize z-10" onMouseDown={(e) => handleResizeStart(e, 'e')} />
          
          <div className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'nw')} />
          <div className="absolute -top-1 -right-1 w-4 h-4 cursor-nesw-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'ne')} />
          <div className="absolute -bottom-1 -left-1 w-4 h-4 cursor-nesw-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'sw')} />
          <div className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'se')} />
        </>
      )}

      {/* Title Bar */}
      <div 
        className="h-10 bg-white/5 border-b border-white/5 flex items-center justify-between px-4 cursor-grab select-none shrink-0 rounded-t-xl"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2 window-controls">
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(windowState.id); }}
            className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center group"
          >
            <X size={8} className="text-red-900 opacity-0 group-hover:opacity-100" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onMinimize(windowState.id); }}
            className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors flex items-center justify-center group"
          >
             <Minus size={8} className="text-yellow-900 opacity-0 group-hover:opacity-100" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onMaximize(windowState.id); }}
            className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 transition-colors flex items-center justify-center group"
          >
             {windowState.isMaximized ? 
               <Square size={6} className="text-green-900 opacity-0 group-hover:opacity-100" /> : 
               <Maximize2 size={6} className="text-green-900 opacity-0 group-hover:opacity-100" />
             }
          </button>
        </div>
        <div className={`text-sm font-medium ${titleColor} pointer-events-none tracking-wide`}>{windowState.title}</div>
        <div className="w-14"></div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-auto relative rounded-b-xl ${isVM ? 'bg-black/20' : 'bg-white/40'}`}>
        {children}
      </div>
    </div>
  );
};