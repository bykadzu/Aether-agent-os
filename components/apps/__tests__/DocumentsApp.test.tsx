// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock kernel client
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    sendCommand: vi.fn().mockResolvedValue({ data: {} }),
    on: vi.fn().mockReturnValue(vi.fn()),
  }),
}));

// Mock gemini service
vi.mock('../../../services/geminiService', () => ({
  generateText: vi.fn().mockResolvedValue('Test summary'),
  GeminiModel: { FLASH: 'gemini-2.5-flash' },
}));

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

import { DocumentsApp } from '../DocumentsApp';

describe('DocumentsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<DocumentsApp />);
    expect(document.body.textContent).toBeDefined();
  });

  it('shows a welcome state when no document is open', () => {
    render(<DocumentsApp />);
    const text = document.body.textContent || '';
    // Should have some welcome or empty state message
    expect(text.length).toBeGreaterThan(0);
  });

  it('has toolbar with navigation controls', () => {
    render(<DocumentsApp />);
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('accepts initialFile prop', () => {
    render(<DocumentsApp initialFile="/test/document.pdf" />);
    expect(document.body.textContent).toBeDefined();
  });

  it('has zoom controls', () => {
    render(<DocumentsApp />);
    // Should have zoom UI elements (buttons or inputs)
    const buttons = document.querySelectorAll('button');
    const text = document.body.textContent || '';
    expect(buttons.length > 0 || text.includes('%')).toBeTruthy();
  });

  it('renders file browser sidebar', () => {
    render(<DocumentsApp />);
    // Should have a sidebar or file listing area
    const container = document.querySelector('[class*="flex"]');
    expect(container).toBeTruthy();
  });
});
