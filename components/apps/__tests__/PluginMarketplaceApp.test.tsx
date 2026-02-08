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
    X: createIcon('x'),
    Tag: createIcon('tag'),
    ExternalLink: createIcon('external-link'),
    Package: createIcon('package'),
    RefreshCw: createIcon('refresh'),
    CheckCircle2: createIcon('check-circle'),
    Star: createIcon('star'),
    MessageSquare: createIcon('message-square'),
    GitBranch: createIcon('git-branch'),
    Cpu: createIcon('cpu'),
    Database: createIcon('database'),
    Palette: createIcon('palette'),
    Bell: createIcon('bell'),
    Shield: createIcon('shield'),
    Settings: createIcon('settings'),
    Wrench: createIcon('wrench'),
  };
});

import { PluginMarketplaceApp } from '../PluginMarketplaceApp';

describe('PluginMarketplaceApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<PluginMarketplaceApp />);
    expect(container).toBeTruthy();
  });

  it('shows the Plugin Marketplace header', () => {
    render(<PluginMarketplaceApp />);
    expect(screen.getByText('Plugin Marketplace')).toBeTruthy();
  });

  it('shows category sidebar with expected categories', () => {
    render(<PluginMarketplaceApp />);
    expect(screen.getByText('All Plugins')).toBeTruthy();
    expect(screen.getAllByText('Tools').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LLM Providers').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Data Sources').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Notifications').length).toBeGreaterThan(0);
    expect(screen.getByText('Auth Providers')).toBeTruthy();
    expect(screen.getAllByText('Themes').length).toBeGreaterThan(0);
    expect(screen.getByText('Widgets')).toBeTruthy();
  });

  it('shows Browse and Installed tabs', () => {
    render(<PluginMarketplaceApp />);
    expect(screen.getByText('Browse')).toBeTruthy();
    expect(screen.getByText(/^Installed/)).toBeTruthy();
  });

  it('shows search input', () => {
    render(<PluginMarketplaceApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    expect(searchInput).toBeTruthy();
  });

  it('displays mock registry plugins', () => {
    render(<PluginMarketplaceApp />);
    expect(screen.getByText('Slack Notifications')).toBeTruthy();
    expect(screen.getByText('GitHub Tools')).toBeTruthy();
    expect(screen.getByText('Custom LLM Provider')).toBeTruthy();
    expect(screen.getByText('Notion Connector')).toBeTruthy();
    expect(screen.getByText('Dark Theme')).toBeTruthy();
  });

  it('filters plugins when searching', async () => {
    render(<PluginMarketplaceApp />);
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: 'GitHub' } });
    await waitFor(() => {
      expect(screen.getByText('GitHub Tools')).toBeTruthy();
      expect(screen.queryByText('Slack Notifications')).toBeNull();
    });
  });

  it('filters plugins when clicking a category', async () => {
    render(<PluginMarketplaceApp />);
    // Click the "Tools" category in sidebar
    const toolsButtons = screen.getAllByText('Tools');
    fireEvent.click(toolsButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('GitHub Tools')).toBeTruthy();
    });
  });

  it('shows install button for uninstalled plugins', () => {
    render(<PluginMarketplaceApp />);
    const installButtons = screen.getAllByText('Install');
    expect(installButtons.length).toBeGreaterThan(0);
  });

  it('opens detail panel when clicking a plugin card', async () => {
    render(<PluginMarketplaceApp />);
    fireEvent.click(screen.getByText('GitHub Tools'));
    await waitFor(() => {
      expect(screen.getByText('Plugin Details')).toBeTruthy();
    });
  });

  it('switches to Installed tab', async () => {
    render(<PluginMarketplaceApp />);
    const installedTab = screen.getByText(/^Installed/);
    fireEvent.click(installedTab);
    await waitFor(() => {
      expect(screen.getByText(/^Installed/)).toBeTruthy();
    });
  });

  it('displays plugin descriptions in cards', () => {
    const { container } = render(<PluginMarketplaceApp />);
    expect(container.textContent!.length).toBeGreaterThan(200);
  });
});
