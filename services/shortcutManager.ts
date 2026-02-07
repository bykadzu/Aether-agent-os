import { useEffect, useRef, type DependencyList } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type ShortcutScope = 'global' | `app:${string}`;

export interface ShortcutEntry {
  id: string;
  combo: string;           // e.g. 'Cmd+K', 'Cmd+Shift+N', 'Alt+1'
  handler: (e: KeyboardEvent) => void;
  description: string;
  scope: ShortcutScope;
  group?: string;          // For overlay grouping: 'System', 'Window Management', etc.
}

interface ParsedCombo {
  mod: boolean;   // Cmd (Mac) or Ctrl (Win/Linux)
  shift: boolean;
  alt: boolean;
  key: string;    // Lowercase key
}

// ── Platform detection ───────────────────────────────────────────────────────

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export function getModLabel(): string {
  return isMac ? '⌘' : 'Ctrl';
}

// ── Combo parsing ────────────────────────────────────────────────────────────

function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .split('+')
    .map((p) => p.trim().toLowerCase());

  return {
    mod: parts.includes('cmd') || parts.includes('ctrl'),
    shift: parts.includes('shift'),
    alt: parts.includes('alt'),
    key: parts.filter((p) => !['cmd', 'ctrl', 'shift', 'alt'].includes(p))[0] || '',
  };
}

function matchesEvent(parsed: ParsedCombo, e: KeyboardEvent): boolean {
  const modPressed = isMac ? e.metaKey : e.ctrlKey;
  if (parsed.mod !== modPressed) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;

  // Normalise the event key for comparison
  const eventKey = e.key.toLowerCase();

  // Special‐case: '?' is shift+/ on most layouts — allow matching both forms
  if (parsed.key === '?' && eventKey === '/') return true;
  if (parsed.key === '/' && eventKey === '?') return true;

  // Number keys: e.key is the digit itself when no modifier produces a symbol
  if (parsed.key === eventKey) return true;

  // Tab, Escape, etc.
  if (parsed.key === 'tab' && eventKey === 'tab') return true;
  if (parsed.key === 'escape' && eventKey === 'escape') return true;

  return false;
}

// ── Singleton manager ────────────────────────────────────────────────────────

class ShortcutManager {
  private shortcuts = new Map<string, ShortcutEntry>();
  private listener: ((e: KeyboardEvent) => void) | null = null;
  private focusedAppId: string | null = null;

  constructor() {
    this.attach();
  }

  // -- Public API ----------------------------------------------------------

  registerShortcut(
    id: string,
    combo: string,
    handler: (e: KeyboardEvent) => void,
    description: string,
    scope: ShortcutScope = 'global',
    group?: string,
  ): void {
    // Conflict detection
    const existing = this.findByComboAndScope(combo, scope);
    if (existing && existing.id !== id) {
      console.warn(
        `[ShortcutManager] Combo "${combo}" (scope: ${scope}) conflicts with existing shortcut "${existing.id}". Overwriting.`,
      );
    }

    this.shortcuts.set(id, { id, combo, handler, description, scope, group });
  }

  unregisterShortcut(id: string): void {
    this.shortcuts.delete(id);
  }

  setFocusedApp(appId: string | null): void {
    this.focusedAppId = appId;
  }

  getAll(): ShortcutEntry[] {
    return Array.from(this.shortcuts.values());
  }

  /** Return shortcuts that would be active right now (global + focused app). */
  getActive(): ShortcutEntry[] {
    return this.getAll().filter(
      (s) =>
        s.scope === 'global' ||
        (this.focusedAppId && s.scope === `app:${this.focusedAppId}`),
    );
  }

  destroy(): void {
    if (this.listener) {
      window.removeEventListener('keydown', this.listener);
      this.listener = null;
    }
  }

  // -- Internal ------------------------------------------------------------

  private attach(): void {
    this.listener = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs/textareas/contenteditable
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      // Iterate from most recently registered to first (last wins)
      const entries = Array.from(this.shortcuts.values()).reverse();

      for (const entry of entries) {
        const parsed = parseCombo(entry.combo);

        if (!matchesEvent(parsed, e)) continue;

        // For input fields, only allow shortcuts with a modifier key (Cmd/Ctrl)
        // Escape is always allowed
        if (isInput && !parsed.mod && parsed.key !== 'escape') continue;

        // Scope check
        if (entry.scope !== 'global') {
          const scopeApp = entry.scope.replace('app:', '');
          if (this.focusedAppId !== scopeApp) continue;
        }

        e.preventDefault();
        entry.handler(e);
        return; // First match wins
      }
    };

    window.addEventListener('keydown', this.listener);
  }

  private findByComboAndScope(
    combo: string,
    scope: ShortcutScope,
  ): ShortcutEntry | undefined {
    const parsed = parseCombo(combo);
    for (const entry of this.shortcuts.values()) {
      if (entry.scope !== scope) continue;
      const entryParsed = parseCombo(entry.combo);
      if (
        entryParsed.mod === parsed.mod &&
        entryParsed.shift === parsed.shift &&
        entryParsed.alt === parsed.alt &&
        entryParsed.key === parsed.key
      ) {
        return entry;
      }
    }
    return undefined;
  }
}

// ── Singleton export ─────────────────────────────────────────────────────────

let instance: ShortcutManager | null = null;

export function getShortcutManager(): ShortcutManager {
  if (!instance) {
    instance = new ShortcutManager();
  }
  return instance;
}

// ── React hook ───────────────────────────────────────────────────────────────

/**
 * Register a keyboard shortcut that auto-cleans up on unmount.
 *
 * @param combo    Key combination string, e.g. 'Cmd+S'
 * @param handler  Callback when the shortcut fires
 * @param deps     React dependency array for the handler
 * @param options  Optional description, scope, and group
 */
export function useShortcut(
  combo: string,
  handler: (e: KeyboardEvent) => void,
  deps: DependencyList = [],
  options: {
    id?: string;
    description?: string;
    scope?: ShortcutScope;
    group?: string;
  } = {},
): void {
  const idRef = useRef(
    options.id || `hook-${combo}-${Math.random().toString(36).slice(2, 8)}`,
  );

  useEffect(() => {
    const id = idRef.current;
    const mgr = getShortcutManager();
    mgr.registerShortcut(
      id,
      combo,
      handler,
      options.description || combo,
      options.scope || 'global',
      options.group,
    );
    return () => {
      mgr.unregisterShortcut(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── Helpers for pretty-printing combos ───────────────────────────────────────

/**
 * Turn 'Cmd+Shift+M' into display-friendly parts: ['⌘', 'Shift', 'M']
 */
export function formatCombo(combo: string): string[] {
  return combo.split('+').map((part) => {
    const p = part.trim();
    const lower = p.toLowerCase();
    if (lower === 'cmd' || lower === 'ctrl') return isMac ? '⌘' : 'Ctrl';
    if (lower === 'shift') return isMac ? '⇧' : 'Shift';
    if (lower === 'alt') return isMac ? '⌥' : 'Alt';
    if (lower === 'tab') return '⇥';
    if (lower === 'escape') return 'Esc';
    if (lower === ',') return ',';
    if (lower === '/') return '/';
    if (lower === '?') return '?';
    return p.toUpperCase();
  });
}
