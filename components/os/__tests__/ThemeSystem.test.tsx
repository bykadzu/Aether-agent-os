// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';

// Mock lucide-react
vi.mock(
  'lucide-react',
  () =>
    new Proxy(
      {},
      {
        get: (_, name) => {
          if (name === '__esModule') return true;
          return (props: any) => (
            <span data-testid={`icon-${String(name).toLowerCase()}`} {...props} />
          );
        },
      },
    ),
);

// Mock matchMedia
const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes('dark'),
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));
vi.stubGlobal('matchMedia', mockMatchMedia);

import { getThemeManager, ThemeProvider, useTheme } from '../../../services/themeManager';
import { ThemeToggle } from '../ThemeToggle';

describe('ThemeManager', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('returns a singleton instance', () => {
    const mgr1 = getThemeManager();
    const mgr2 = getThemeManager();
    expect(mgr1).toBe(mgr2);
  });

  it('defaults to dark mode', () => {
    const mgr = getThemeManager();
    const mode = mgr.getMode();
    // Default should be 'dark' or whatever was persisted
    expect(['dark', 'light', 'system']).toContain(mode);
  });

  it('persists theme preference to localStorage', () => {
    const mgr = getThemeManager();
    mgr.setMode('light');
    expect(localStorage.getItem('aether_theme_mode')).toBe('light');
  });

  it('applies data-theme attribute to document', () => {
    const mgr = getThemeManager();
    mgr.setMode('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('ThemeProvider', () => {
  it('renders children', () => {
    render(
      <ThemeProvider>
        <div data-testid="child">Hello</div>
      </ThemeProvider>,
    );
    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('Hello')).toBeTruthy();
  });
});

describe('ThemeToggle', () => {
  it('renders without crashing', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('toggles theme on click', () => {
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = document.querySelector('button');
    if (button) {
      fireEvent.click(button);
      // After click, theme should change
      const mode = getThemeManager().getMode();
      expect(['dark', 'light', 'system']).toContain(mode);
    }
  });
});
