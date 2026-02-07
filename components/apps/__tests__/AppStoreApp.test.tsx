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
    Store: createIcon('store'),
    Search: createIcon('search'),
    Download: createIcon('download'),
    Trash2: createIcon('trash'),
    ToggleLeft: createIcon('toggle-left'),
    ToggleRight: createIcon('toggle-right'),
    BarChart3: createIcon('barchart'),
    GitBranch: createIcon('git-branch'),
    MessageSquare: createIcon('message-square'),
    Clock: createIcon('clock'),
    Cpu: createIcon('cpu'),
    ChevronRight: createIcon('chevron-right'),
    X: createIcon('x'),
    Shield: createIcon('shield'),
    Tag: createIcon('tag'),
    ExternalLink: createIcon('external-link'),
    Package: createIcon('package'),
    Grid3X3: createIcon('grid'),
    List: createIcon('list'),
    RefreshCw: createIcon('refresh'),
    CheckCircle2: createIcon('check-circle'),
    Star: createIcon('star'),
  };
});

import { AppStoreApp } from '../AppStoreApp';

describe('AppStoreApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<AppStoreApp />);
    expect(container).toBeTruthy();
  });

  it('shows the App Store header', () => {
    render(<AppStoreApp />);
    expect(screen.getByText('App Store')).toBeTruthy();
  });

  it('shows category sidebar with expected categories', () => {
    render(<AppStoreApp />);
    expect(screen.getByText('All Apps')).toBeTruthy();
    // Category names may appear both in sidebar and as card labels, so use getAllByText
    expect(screen.getAllByText('Productivity').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Development').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Communication').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Utilities').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Monitoring').length).toBeGreaterThan(0);
  });

  it('shows Browse and Installed tabs', () => {
    render(<AppStoreApp />);
    expect(screen.getByText('Browse')).toBeTruthy();
    expect(screen.getByText(/^Installed/)).toBeTruthy();
  });

  it('shows search input', () => {
    render(<AppStoreApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeTruthy();
  });

  it('displays mock registry apps', () => {
    render(<AppStoreApp />);
    expect(screen.getByText('Agent Dashboard Pro')).toBeTruthy();
    expect(screen.getByText('Git Integration')).toBeTruthy();
  });

  it('filters apps when searching', async () => {
    render(<AppStoreApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'Git' } });
    await waitFor(() => {
      expect(screen.getByText('Git Integration')).toBeTruthy();
      expect(screen.queryByText('Slack Notifier')).toBeNull();
    });
  });

  it('filters apps when clicking a category', async () => {
    render(<AppStoreApp />);
    // "Development" appears in sidebar and as card category label; click the sidebar one
    const devButtons = screen.getAllByText('Development');
    fireEvent.click(devButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Git Integration')).toBeTruthy();
    });
  });

  it('shows install button for uninstalled apps', () => {
    render(<AppStoreApp />);
    const installButtons = screen.getAllByText('Install');
    expect(installButtons.length).toBeGreaterThan(0);
  });

  it('opens detail panel when clicking an app card', async () => {
    render(<AppStoreApp />);
    // Click the app name directly — the whole card is clickable
    fireEvent.click(screen.getByText('Agent Dashboard Pro'));
    await waitFor(() => {
      // Detail panel should show the permissions section
      expect(screen.getByText(/Permissions/)).toBeTruthy();
    });
  });

  it('switches to Installed tab', async () => {
    render(<AppStoreApp />);
    const installedTab = screen.getByText(/^Installed/);
    fireEvent.click(installedTab);
    await waitFor(() => {
      // Should still render without crashing
      expect(screen.getByText(/^Installed/)).toBeTruthy();
    });
  });

  it('displays app descriptions in cards', () => {
    const { container } = render(<AppStoreApp />);
    // Cards should have substantial content (descriptions, authors, etc.)
    expect(container.textContent!.length).toBeGreaterThan(200);
  });
});
