import React, { useState, useCallback } from 'react';

interface WorkspaceSwitcherProps {
  currentWorkspace: number;
  totalWorkspaces: number;
  windowCounts: number[]; // number of windows in each workspace
  onSwitch: (workspaceIndex: number) => void;
  onShowOverview: () => void;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  currentWorkspace,
  totalWorkspaces,
  windowCounts,
  onSwitch,
  onShowOverview,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="flex items-center gap-1 px-2 py-0.5 rounded-md hover:bg-white/10 transition-colors cursor-pointer select-none"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onShowOverview}
      title="Click for overview (Ctrl+Up)"
    >
      {Array.from({ length: totalWorkspaces }, (_, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            onSwitch(i);
          }}
          className={`transition-all duration-200 rounded-sm ${
            i === currentWorkspace
              ? 'bg-white/80 w-2.5 h-2.5'
              : windowCounts[i] > 0
              ? 'bg-white/40 w-2 h-2 hover:bg-white/60'
              : 'bg-white/20 w-2 h-2 hover:bg-white/40'
          }`}
          title={`Workspace ${i + 1}${windowCounts[i] > 0 ? ` (${windowCounts[i]} windows)` : ''}`}
        />
      ))}
      {isHovered && (
        <span className="text-[10px] text-white/50 ml-1">{currentWorkspace + 1}/{totalWorkspaces}</span>
      )}
    </div>
  );
};

// Workspace overview modal - shows all workspaces in a grid with miniature previews
interface WorkspaceOverviewProps {
  currentWorkspace: number;
  totalWorkspaces: number;
  workspaceWindows: { workspace: number; windows: { id: string; title: string; appId: string; position: { x: number; y: number }; size: { width: number; height: number } }[] }[];
  onSwitch: (workspaceIndex: number) => void;
  onClose: () => void;
}

export const WorkspaceOverview: React.FC<WorkspaceOverviewProps> = ({
  currentWorkspace,
  totalWorkspaces,
  workspaceWindows,
  onSwitch,
  onClose,
}) => {
  const handleSelect = useCallback((idx: number) => {
    onSwitch(idx);
    onClose();
  }, [onSwitch, onClose]);

  // Calculate grid layout: up to 3 columns
  const cols = Math.min(totalWorkspaces, 3);

  return (
    <div
      className="absolute inset-0 z-[9500] bg-black/70 backdrop-blur-xl flex items-center justify-center"
      onClick={onClose}
    >
      <div className="text-center" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-white/80 text-lg font-light mb-6 tracking-wide">Workspaces</h2>
        <div
          className="grid gap-6"
          style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
        >
          {Array.from({ length: totalWorkspaces }, (_, i) => {
            const wsData = workspaceWindows.find(w => w.workspace === i);
            const wins = wsData?.windows || [];
            const isCurrent = i === currentWorkspace;

            return (
              <button
                key={i}
                onClick={() => handleSelect(i)}
                className={`group relative w-64 h-40 rounded-xl border-2 transition-all duration-200 overflow-hidden ${
                  isCurrent
                    ? 'border-indigo-500 bg-indigo-500/10 shadow-lg shadow-indigo-500/20'
                    : 'border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10'
                }`}
              >
                {/* Miniature window previews */}
                <div className="absolute inset-2 overflow-hidden">
                  {wins.map((win) => {
                    // Scale positions to fit in the preview (assume 1920x1080 desktop)
                    const scaleX = 240 / 1920;
                    const scaleY = 136 / 1080;
                    const x = win.position.x * scaleX;
                    const y = win.position.y * scaleY;
                    const w = Math.max(win.size.width * scaleX, 20);
                    const h = Math.max(win.size.height * scaleY, 12);

                    return (
                      <div
                        key={win.id}
                        className="absolute rounded-sm bg-white/20 border border-white/10"
                        style={{
                          left: `${x}px`,
                          top: `${y}px`,
                          width: `${w}px`,
                          height: `${h}px`,
                        }}
                      >
                        <div className="h-1.5 bg-white/10 rounded-t-sm" />
                      </div>
                    );
                  })}
                  {wins.length === 0 && (
                    <div className="flex items-center justify-center h-full text-white/20 text-xs">
                      Empty
                    </div>
                  )}
                </div>

                {/* Label */}
                <div className="absolute bottom-0 inset-x-0 bg-black/30 px-2 py-1 flex items-center justify-between">
                  <span className={`text-xs font-medium ${isCurrent ? 'text-indigo-300' : 'text-white/60'}`}>
                    Desktop {i + 1}
                  </span>
                  <span className="text-[10px] text-white/40">
                    {wins.length} {wins.length === 1 ? 'window' : 'windows'}
                  </span>
                </div>

                {isCurrent && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-400" />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-white/30 text-xs mt-4">
          Ctrl+Left/Right to switch &middot; Ctrl+1-9 to jump &middot; Esc to close
        </p>
      </div>
    </div>
  );
};
