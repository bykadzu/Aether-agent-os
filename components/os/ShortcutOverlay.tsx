import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Search, Keyboard } from 'lucide-react';
import {
  getShortcutManager,
  formatCombo,
  type ShortcutEntry,
} from '../../services/shortcutManager';

interface ShortcutOverlayProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Kbd tag ──────────────────────────────────────────────────────────────────

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md bg-white/10 border border-white/20 text-[11px] font-mono font-medium text-white/90 shadow-sm">
    {children}
  </kbd>
);

const ComboDisplay: React.FC<{ combo: string }> = ({ combo }) => {
  const parts = formatCombo(combo);
  return (
    <span className="inline-flex items-center gap-0.5">
      {parts.map((p, i) => (
        <Kbd key={i}>{p}</Kbd>
      ))}
    </span>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function groupShortcuts(
  entries: ShortcutEntry[],
): Record<string, ShortcutEntry[]> {
  const groups: Record<string, ShortcutEntry[]> = {};

  for (const entry of entries) {
    let groupName = entry.group || 'Other';
    // App-scoped shortcuts without an explicit group get a per-app group
    if (!entry.group && entry.scope.startsWith('app:')) {
      const appName = entry.scope.replace('app:', '');
      groupName = appName.charAt(0).toUpperCase() + appName.slice(1);
    }
    if (!groups[groupName]) groups[groupName] = [];
    groups[groupName].push(entry);
  }

  // Sort: System first, then Window Management, Navigation, then alphabetical
  const priority = ['System', 'Window Management', 'Navigation'];
  const sortedKeys = Object.keys(groups).sort((a, b) => {
    const ai = priority.indexOf(a);
    const bi = priority.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });

  const sorted: Record<string, ShortcutEntry[]> = {};
  for (const key of sortedKeys) {
    sorted[key] = groups[key];
  }
  return sorted;
}

// ── Component ────────────────────────────────────────────────────────────────

export const ShortcutOverlay: React.FC<ShortcutOverlayProps> = ({
  isOpen,
  onClose,
}) => {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Focus search input when overlay opens
  useEffect(() => {
    if (isOpen) {
      setSearch('');
      // Small delay so the DOM is painted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Close on click outside the panel
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  const allShortcuts = useMemo(() => {
    if (!isOpen) return [];
    return getShortcutManager().getAll();
  }, [isOpen]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allShortcuts;
    const q = search.toLowerCase();
    return allShortcuts.filter(
      (s) =>
        s.description.toLowerCase().includes(q) ||
        s.combo.toLowerCase().includes(q) ||
        (s.group && s.group.toLowerCase().includes(q)),
    );
  }, [allShortcuts, search]);

  const grouped = useMemo(() => groupShortcuts(filtered), [filtered]);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10001] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg max-h-[70vh] bg-[#1a1d26]/90 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl flex flex-col animate-scale-in overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <div className="flex items-center gap-2 text-white/90">
            <Keyboard size={18} />
            <h2 className="text-base font-semibold">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-3">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30"
            />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search shortcuts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
          </div>
        </div>

        {/* Shortcut list */}
        <div className="flex-1 overflow-y-auto px-5 pb-4 scrollbar-thin">
          {Object.keys(grouped).length === 0 && (
            <p className="text-center text-white/30 text-sm py-8">
              No shortcuts match your search.
            </p>
          )}

          {Object.entries(grouped).map(([group, entries]: [string, ShortcutEntry[]]) => (
            <div key={group} className="mb-4 last:mb-0">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-2">
                {group}
              </h3>
              <div className="space-y-1">
                {entries.map((entry: ShortcutEntry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/5 transition-colors"
                  >
                    <span className="text-sm text-white/80">
                      {entry.description}
                    </span>
                    <ComboDisplay combo={entry.combo} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
