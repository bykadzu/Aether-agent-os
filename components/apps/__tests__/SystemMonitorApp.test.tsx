// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

// Mock the kernel client before importing the component
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    on: vi.fn(() => vi.fn()),
  }),
}));

// Mock lucide-react icons to simple spans
vi.mock('lucide-react', () => ({
  Cpu: (props: any) => <span data-testid="icon-cpu" {...props} />,
  HardDrive: (props: any) => <span data-testid="icon-harddrive" {...props} />,
  Wifi: (props: any) => <span data-testid="icon-wifi" {...props} />,
  Activity: (props: any) => <span data-testid="icon-activity" {...props} />,
  RefreshCw: (props: any) => <span data-testid="icon-refresh" {...props} />,
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

import { SystemMonitorApp } from '../SystemMonitorApp';

describe('SystemMonitorApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Default: fetch fails, so component falls back to mock data
    mockFetch.mockRejectedValue(new Error('Network error'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders without crashing', () => {
    const { container } = render(<SystemMonitorApp />);
    expect(container).toBeTruthy();
  });

  it('shows the header with System Monitor title', () => {
    render(<SystemMonitorApp />);
    expect(screen.getByText('System Monitor')).toBeTruthy();
  });

  it('shows chart panels for all four metrics', async () => {
    render(<SystemMonitorApp />);

    // Wait for the initial fetch cycle (mock data will be used)
    await waitFor(() => {
      expect(screen.getByText('CPU Usage')).toBeTruthy();
    });

    expect(screen.getByText('Memory Usage')).toBeTruthy();
    expect(screen.getByText('Disk Usage')).toBeTruthy();
    expect(screen.getByText('Network I/O')).toBeTruthy();
  });

  it('shows Demo Mode indicator when server is unavailable', async () => {
    render(<SystemMonitorApp />);

    await waitFor(() => {
      expect(screen.getByText('Demo Mode')).toBeTruthy();
    });
  });

  it('shows Kernel Offline when not connected', () => {
    render(<SystemMonitorApp />);
    expect(screen.getByText('Kernel Offline')).toBeTruthy();
  });

  it('shows agent table when process data is available', async () => {
    const mockStats = {
      cpu: { percent: 45.2, cores: 8 },
      memory: { usedMB: 8192, totalMB: 16384, percent: 50 },
      disk: { usedGB: 120, totalGB: 512, percent: 23.4 },
      network: { bytesIn: 50000, bytesOut: 25000 },
      processes: [
        { pid: 1, name: 'Coder Agent', cpuPercent: 25.3, memoryMB: 128.5, state: 'running' },
        { pid: 2, name: 'Researcher', cpuPercent: 10.1, memoryMB: 64.2, state: 'sleeping' },
      ],
      timestamp: Date.now(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStats),
    });

    render(<SystemMonitorApp />);

    await waitFor(() => {
      expect(screen.getByText('Per-Agent Resource Breakdown')).toBeTruthy();
    });

    expect(screen.getByText('Coder Agent')).toBeTruthy();
    expect(screen.getByText('Researcher')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
    expect(screen.getByText('sleeping')).toBeTruthy();
  });

  it('handles fetch errors gracefully and falls back to mock data', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const { container } = render(<SystemMonitorApp />);

    // Component should still render without throwing
    expect(container).toBeTruthy();

    // Should display chart panels with mock data
    await waitFor(() => {
      expect(screen.getByText('CPU Usage')).toBeTruthy();
    });

    // Demo Mode should be visible
    expect(screen.getByText('Demo Mode')).toBeTruthy();
  });

  it('handles non-ok HTTP responses gracefully', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Internal Server Error' }),
    });

    render(<SystemMonitorApp />);

    // Should fall back to mock data and still render
    await waitFor(() => {
      expect(screen.getByText('CPU Usage')).toBeTruthy();
    });

    expect(screen.getByText('Demo Mode')).toBeTruthy();
  });

  it('renders SVG elements for charts', async () => {
    render(<SystemMonitorApp />);

    await waitFor(() => {
      expect(screen.getByText('CPU Usage')).toBeTruthy();
    });

    // Check that SVG elements exist in the DOM
    const { container } = render(<SystemMonitorApp />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs.length).toBeGreaterThan(0);
  });

  it('displays current values in chart headers', async () => {
    const mockStats = {
      cpu: { percent: 42.5, cores: 4 },
      memory: { usedMB: 6000, totalMB: 16384, percent: 36.6 },
      disk: { usedGB: 200.5, totalGB: 512, percent: 39.2 },
      network: { bytesIn: 100000, bytesOut: 50000 },
      processes: [],
      timestamp: Date.now(),
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStats),
    });

    render(<SystemMonitorApp />);

    await waitFor(() => {
      expect(screen.getByText('42.5%')).toBeTruthy();
    });

    // Memory value shows in chart header
    expect(screen.getByText('6000.0 MB')).toBeTruthy();

    // Disk value
    expect(screen.getByText('200.5 GB')).toBeTruthy();
  });
});
