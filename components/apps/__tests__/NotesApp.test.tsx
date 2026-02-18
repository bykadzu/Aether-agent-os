// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock the kernel client before importing the component
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    on: vi.fn(() => vi.fn()),
    send: vi.fn(),
  }),
}));

// Mock gemini service
vi.mock('../../../services/geminiService', () => ({
  generateText: vi.fn(),
  GeminiModel: { FLASH: 'flash', PRO: 'pro' },
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => (props: any) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    PenTool: createIcon('pen-tool'),
    Wand2: createIcon('wand2'),
    Check: createIcon('check'),
    RefreshCw: createIcon('refresh-cw'),
    AlignLeft: createIcon('align-left'),
    Save: createIcon('save'),
    Plus: createIcon('plus'),
    FileText: createIcon('file-text'),
    Trash2: createIcon('trash2'),
  };
});

import { NotesApp } from '../NotesApp';

describe('NotesApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders without crashing', () => {
    const { container } = render(<NotesApp />);
    expect(container).toBeTruthy();
  });

  it('shows "Notes" in sidebar', () => {
    render(<NotesApp />);
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('shows Save button', () => {
    render(<NotesApp />);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('shows editor textarea', () => {
    render(<NotesApp />);
    const textarea = screen.getByPlaceholderText('Start typing...');
    expect(textarea).toBeTruthy();
  });

  it('can type content', () => {
    render(<NotesApp />);
    const textarea = screen.getByPlaceholderText('Start typing...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Hello World' } });
    expect(textarea.value).toBe('Hello World');
  });
});
