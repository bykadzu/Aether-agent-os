import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThemeMode = 'dark' | 'light' | 'system';

export interface Theme {
  '--bg-primary': string;
  '--bg-secondary': string;
  '--bg-tertiary': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--border-color': string;
  '--border-subtle': string;
  '--accent-color': string;
  '--accent-hover': string;
  '--glass-bg': string;
  '--glass-border': string;
  '--surface-color': string;
  '--surface-hover': string;
  '--danger': string;
  '--warning': string;
  '--success': string;
  '--info': string;
  '--shadow-color': string;
}

// ─── Theme Definitions ───────────────────────────────────────────────────────

export const darkTheme: Theme = {
  '--bg-primary': '#0a0b0f',
  '--bg-secondary': '#1a1d26',
  '--bg-tertiary': '#16161e',
  '--text-primary': '#ffffff',
  '--text-secondary': '#a9b1d6',
  '--text-muted': '#565a6e',
  '--border-color': 'rgba(255, 255, 255, 0.1)',
  '--border-subtle': 'rgba(255, 255, 255, 0.05)',
  '--accent-color': '#6366f1',
  '--accent-hover': '#818cf8',
  '--glass-bg': 'rgba(255, 255, 255, 0.08)',
  '--glass-border': 'rgba(255, 255, 255, 0.12)',
  '--surface-color': '#1a1d26',
  '--surface-hover': '#222436',
  '--danger': '#ef4444',
  '--warning': '#f59e0b',
  '--success': '#22c55e',
  '--info': '#3b82f6',
  '--shadow-color': 'rgba(0, 0, 0, 0.5)',
};

export const lightTheme: Theme = {
  '--bg-primary': '#f5f5f7',
  '--bg-secondary': '#ffffff',
  '--bg-tertiary': '#e8e8ed',
  '--text-primary': '#1d1d1f',
  '--text-secondary': '#6e6e73',
  '--text-muted': '#aeaeb2',
  '--border-color': 'rgba(0, 0, 0, 0.12)',
  '--border-subtle': 'rgba(0, 0, 0, 0.06)',
  '--accent-color': '#5856d6',
  '--accent-hover': '#4744c9',
  '--glass-bg': 'rgba(255, 255, 255, 0.72)',
  '--glass-border': 'rgba(0, 0, 0, 0.08)',
  '--surface-color': '#ffffff',
  '--surface-hover': '#f0f0f5',
  '--danger': '#ff3b30',
  '--warning': '#ff9500',
  '--success': '#34c759',
  '--info': '#007aff',
  '--shadow-color': 'rgba(0, 0, 0, 0.1)',
};

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'aether_theme_mode';
const THEME_CHANGE_EVENT = 'themeChange';

// ─── ThemeManager Singleton ──────────────────────────────────────────────────

class ThemeManager {
  private mode: ThemeMode;
  private resolvedDark: boolean;
  private mediaQuery: MediaQueryList | null = null;
  private listeners: Array<(mode: ThemeMode, isDark: boolean) => void> = [];

  constructor() {
    // Load persisted preference or default to 'dark'
    const stored =
      typeof localStorage !== 'undefined'
        ? (localStorage.getItem(STORAGE_KEY) as ThemeMode | null)
        : null;
    this.mode = stored && ['dark', 'light', 'system'].includes(stored) ? stored : 'dark';

    // Resolve effective theme
    this.resolvedDark = this.resolveIsDark();

    // Listen to system preference changes
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaQuery.addEventListener('change', this.handleSystemChange);
    }

    // Apply immediately
    this.applyTheme();
  }

  /** Returns the resolved Theme object (dark or light). */
  getTheme(): Theme {
    return this.resolvedDark ? darkTheme : lightTheme;
  }

  /** Returns the current user-chosen mode. */
  getMode(): ThemeMode {
    return this.mode;
  }

  /** Returns true if the effective theme is dark. */
  getIsDark(): boolean {
    return this.resolvedDark;
  }

  /** Switch to a new mode and apply. */
  setTheme(mode: ThemeMode): void {
    this.mode = mode;
    this.resolvedDark = this.resolveIsDark();

    // Persist
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // localStorage may be unavailable
    }

    this.applyTheme();
    this.emit();
  }

  /** Apply CSS custom properties and data-theme attribute to document root. */
  applyTheme(): void {
    if (typeof document === 'undefined') return;

    const root = document.documentElement;
    const effectiveTheme = this.resolvedDark ? 'dark' : 'light';

    // Set data-theme attribute (drives CSS custom properties from index.css)
    root.setAttribute('data-theme', effectiveTheme);

    // Also set properties programmatically for any JS consumers
    const theme = this.getTheme();
    const keys = Object.keys(theme) as Array<keyof Theme>;
    for (const key of keys) {
      root.style.setProperty(key, theme[key]);
    }
  }

  /** Subscribe to theme changes. Returns an unsubscribe function. */
  onChange(listener: (mode: ThemeMode, isDark: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Clean up event listeners. */
  destroy(): void {
    if (this.mediaQuery) {
      this.mediaQuery.removeEventListener('change', this.handleSystemChange);
    }
    this.listeners = [];
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private resolveIsDark(): boolean {
    if (this.mode === 'dark') return true;
    if (this.mode === 'light') return false;
    // 'system' — check media query
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return true; // Default to dark if we can't detect
  }

  private handleSystemChange = (): void => {
    if (this.mode !== 'system') return;
    this.resolvedDark = this.resolveIsDark();
    this.applyTheme();
    this.emit();
  };

  private emit(): void {
    // Dispatch a DOM event for non-React consumers
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(THEME_CHANGE_EVENT, {
          detail: { mode: this.mode, isDark: this.resolvedDark },
        }),
      );
    }
    // Notify registered listeners
    for (const listener of this.listeners) {
      listener(this.mode, this.resolvedDark);
    }
  }
}

// ─── Singleton Accessor ──────────────────────────────────────────────────────

let instance: ThemeManager | null = null;

export function getThemeManager(): ThemeManager {
  if (!instance) {
    instance = new ThemeManager();
  }
  return instance;
}

// ─── React Integration ───────────────────────────────────────────────────────

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  theme: Theme;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  setMode: () => {},
  theme: darkTheme,
  isDark: true,
});

/**
 * ThemeProvider - wraps the app and applies the theme on mount.
 * Place this near the root of your component tree.
 */
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const manager = getThemeManager();

  const [state, setState] = useState<{ mode: ThemeMode; isDark: boolean }>({
    mode: manager.getMode(),
    isDark: manager.getIsDark(),
  });

  useEffect(() => {
    // Apply theme on mount
    manager.applyTheme();

    // Subscribe to changes
    const unsub = manager.onChange((mode, isDark) => {
      setState({ mode, isDark });
    });

    return unsub;
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    manager.setTheme(mode);
  }, []);

  const contextValue: ThemeContextValue = {
    mode: state.mode,
    setMode,
    theme: state.isDark ? darkTheme : lightTheme,
    isDark: state.isDark,
  };

  return React.createElement(ThemeContext.Provider, { value: contextValue }, children);
};

/**
 * useTheme - React hook that returns the current theme state and setter.
 */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
