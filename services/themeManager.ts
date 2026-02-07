// ── Theme Manager ─────────────────────────────────────────────────────────────
// Singleton service for managing dark / light / system theme across Aether OS.
// Persists choice to localStorage, applies `data-theme` attribute and Tailwind
// `dark` class on <html>, and exposes a lightweight pub/sub for reactive UIs.

// ── Types ────────────────────────────────────────────────────────────────────

export type ThemeType = 'dark' | 'light' | 'system';

type ThemeChangeCallback = (theme: ThemeType, effective: 'dark' | 'light') => void;

// ── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'aether_theme';
const DEFAULT_THEME: ThemeType = 'dark';

// ── Helpers ──────────────────────────────────────────────────────────────────

function prefersDark(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveEffective(theme: ThemeType): 'dark' | 'light' {
  if (theme === 'system') {
    return prefersDark() ? 'dark' : 'light';
  }
  return theme;
}

// ── Subscribers ──────────────────────────────────────────────────────────────

let subscribers: ThemeChangeCallback[] = [];

function notifySubscribers(theme: ThemeType, effective: 'dark' | 'light'): void {
  for (const cb of subscribers) {
    try {
      cb(theme, effective);
    } catch (err) {
      console.error('[ThemeManager] subscriber error:', err);
    }
  }
}

// ── DOM manipulation ─────────────────────────────────────────────────────────

function applyToDOM(effective: 'dark' | 'light'): void {
  const root = document.documentElement;

  // Set data-theme attribute (drives CSS custom properties)
  root.setAttribute('data-theme', effective);

  // Toggle Tailwind dark class
  if (effective === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
}

// ── Public API (singleton object) ────────────────────────────────────────────

function getTheme(): ThemeType {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored;
  }
  return DEFAULT_THEME;
}

function setTheme(theme: ThemeType): void {
  localStorage.setItem(STORAGE_KEY, theme);
  const effective = resolveEffective(theme);
  applyToDOM(effective);
  notifySubscribers(theme, effective);
}

function getEffectiveTheme(): 'dark' | 'light' {
  return resolveEffective(getTheme());
}

function applyTheme(): void {
  const theme = getTheme();
  const effective = resolveEffective(theme);
  applyToDOM(effective);
}

function onThemeChange(callback: ThemeChangeCallback): () => void {
  subscribers.push(callback);
  return () => {
    subscribers = subscribers.filter((cb) => cb !== callback);
  };
}

// ── Initialise on import ─────────────────────────────────────────────────────
// Apply the persisted (or default) theme immediately so the page renders with
// the correct colours before any React component mounts.

applyTheme();

// Listen for OS-level colour-scheme changes so 'system' stays in sync.
if (typeof window !== 'undefined') {
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handleSystemChange = () => {
    const current = getTheme();
    if (current === 'system') {
      const effective = resolveEffective('system');
      applyToDOM(effective);
      notifySubscribers(current, effective);
    }
  };
  // Modern browsers
  if (mql.addEventListener) {
    mql.addEventListener('change', handleSystemChange);
  } else if (mql.addListener) {
    // Safari < 14
    mql.addListener(handleSystemChange);
  }
}

// ── Export singleton ─────────────────────────────────────────────────────────

export const themeManager = {
  getTheme,
  setTheme,
  getEffectiveTheme,
  applyTheme,
  onThemeChange,
};
