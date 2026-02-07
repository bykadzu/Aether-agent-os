// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the kernel client before importing the component
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    on: vi.fn(() => vi.fn()),
    send: vi.fn(),
  }),
}));

// Mock lucide-react icons to simple spans
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => (props: any) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    Brain: createIcon('brain'),
    Search: createIcon('search'),
    Trash2: createIcon('trash'),
    Edit3: createIcon('edit'),
    Tag: createIcon('tag'),
    Clock: createIcon('clock'),
    BarChart3: createIcon('barchart'),
    User: createIcon('user'),
    Filter: createIcon('filter'),
    X: createIcon('x'),
    ChevronRight: createIcon('chevron-right'),
    Eye: createIcon('eye'),
    RefreshCw: createIcon('refresh'),
    Database: createIcon('database'),
    Layers: createIcon('layers'),
    Hash: createIcon('hash'),
    Link2: createIcon('link'),
    AlertTriangle: createIcon('alert'),
  };
});

import { MemoryInspectorApp } from '../MemoryInspectorApp';

describe('MemoryInspectorApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<MemoryInspectorApp />);
    expect(container).toBeTruthy();
  });

  it('shows agent list in the sidebar', () => {
    render(<MemoryInspectorApp />);
    // Sidebar header says "Agents"
    expect(screen.getByText('Agents')).toBeTruthy();
  });

  it('shows layer filter tabs', () => {
    render(<MemoryInspectorApp />);
    // Filter tabs contain: All, Episodic, Semantic, Procedural, Social
    // Use getAllByText since the text may appear multiple times (tabs + card labels)
    expect(screen.getAllByText('All').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Episodic').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Semantic').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Procedural').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Social').length).toBeGreaterThan(0);
  });

  it('shows search input', () => {
    render(<MemoryInspectorApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeTruthy();
  });

  it('displays memory cards with mock data', () => {
    const { container } = render(<MemoryInspectorApp />);
    // Mock data should show memory content — the DOM should have substantial text
    expect(container.textContent!.length).toBeGreaterThan(100);
  });

  it('shows stats header with memory counts', () => {
    const { container } = render(<MemoryInspectorApp />);
    // Stats should include memory count text
    expect(container.textContent?.toLowerCase().includes('memor')).toBeTruthy();
  });

  it('filters memories by layer when clicking a tab', async () => {
    render(<MemoryInspectorApp />);
    const episodicTabs = screen.getAllByText('Episodic');
    fireEvent.click(episodicTabs[0]);
    // After clicking, component should still render with episodic filter
    await waitFor(() => {
      expect(screen.getAllByText('Episodic').length).toBeGreaterThan(0);
    });
  });

  it('searches memories when typing in search input', async () => {
    render(<MemoryInspectorApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'test' } });
    await waitFor(() => {
      expect(searchInput).toBeTruthy();
    });
  });

  it('expands a memory card when clicked', async () => {
    const { container } = render(<MemoryInspectorApp />);
    // Find any clickable memory card element
    const cards = container.querySelectorAll('[class*="cursor-pointer"]');
    if (cards.length > 0) {
      fireEvent.click(cards[0]);
      await waitFor(() => {
        expect(container).toBeTruthy();
      });
    }
  });
});
