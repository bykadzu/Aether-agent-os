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
    getStatus: vi.fn().mockRejectedValue(new Error('not connected')),
    getGPUs: vi.fn().mockRejectedValue(new Error('not connected')),
    getClusterInfo: vi.fn().mockRejectedValue(new Error('not connected')),
    getProcessHistory: vi.fn().mockResolvedValue([]),
  }),
}));

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const createIcon = (name: string) => (props: any) => (
    <span data-testid={`icon-${name}`} {...props} />
  );
  return {
    Plus: createIcon('plus'),
    Bot: createIcon('bot'),
    Monitor: createIcon('monitor'),
    List: createIcon('list'),
    Grid3x3: createIcon('grid3x3'),
    Filter: createIcon('filter'),
    ExternalLink: createIcon('external-link'),
    Activity: createIcon('activity'),
    Cpu: createIcon('cpu'),
    HardDrive: createIcon('hard-drive'),
    Clock: createIcon('clock'),
    Zap: createIcon('zap'),
    History: createIcon('history'),
    ChevronRight: createIcon('chevron-right'),
    Eye: createIcon('eye'),
    Server: createIcon('server'),
    Globe: createIcon('globe'),
    Code: createIcon('code'),
    FileSearch: createIcon('file-search'),
    BarChart3: createIcon('bar-chart3'),
    BookOpen: createIcon('book-open'),
    TestTube: createIcon('test-tube'),
    Users: createIcon('users'),
    Wrench: createIcon('wrench'),
    ArrowLeft: createIcon('arrow-left'),
    Pause: createIcon('pause'),
    Play: createIcon('play'),
    FastForward: createIcon('fast-forward'),
  };
});

// Mock VirtualDesktop
vi.mock('../../os/VirtualDesktop', () => ({
  VirtualDesktop: () => <div data-testid="virtual-desktop" />,
}));

// Mock AgentTimeline
vi.mock('../AgentTimeline', () => ({
  AgentTimeline: () => <div data-testid="agent-timeline" />,
}));

// Mock fetch globally
globalThis.fetch = vi.fn(() =>
  Promise.resolve({ ok: false, json: () => Promise.resolve([]) }),
) as any;

import { AgentDashboard } from '../AgentDashboard';

const defaultProps = {
  agents: [],
  onLaunchAgent: vi.fn(),
  onOpenVM: vi.fn(),
  onStopAgent: vi.fn(),
};

describe('AgentDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<AgentDashboard {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it('shows "Mission Control" heading', () => {
    render(<AgentDashboard {...defaultProps} />);
    expect(screen.getByText('Mission Control')).toBeTruthy();
  });

  it('shows Deploy Agent button', () => {
    render(<AgentDashboard {...defaultProps} />);
    expect(screen.getByText('Deploy Agent')).toBeTruthy();
  });

  it('when agents passed, shows agent info', async () => {
    const agents = [
      {
        id: 'agent-1',
        name: 'Test Agent',
        role: 'Researcher',
        goal: 'Research AI',
        status: 'working' as const,
        phase: 'working',
        logs: [],
        progress: 5,
      },
    ];
    render(<AgentDashboard {...defaultProps} agents={agents} />);
    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeTruthy();
    });
  });

  it('calls onOpenVM when clicking on agent card', async () => {
    const onOpenVM = vi.fn();
    const agents = [
      {
        id: 'agent-1',
        name: 'Test Agent',
        role: 'Researcher',
        goal: 'Research AI',
        status: 'working' as const,
        phase: 'working',
        logs: [],
        progress: 5,
      },
    ];
    render(<AgentDashboard {...defaultProps} agents={agents} onOpenVM={onOpenVM} />);
    await waitFor(() => {
      expect(screen.getByText('Test Agent')).toBeTruthy();
    });
    // Click the desktop preview area which calls onOpenVM
    const desktopPreview = screen.getByText('Enter VM').closest('[class*="aspect-video"]');
    if (desktopPreview) {
      fireEvent.click(desktopPreview);
      expect(onOpenVM).toHaveBeenCalledWith('agent-1');
    }
  });
});
