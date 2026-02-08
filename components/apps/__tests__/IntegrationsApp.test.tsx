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
    Plug: createIcon('plug'),
    GitBranch: createIcon('git-branch'),
    Check: createIcon('check'),
    X: createIcon('x'),
    RefreshCw: createIcon('refresh'),
    Settings: createIcon('settings'),
    Activity: createIcon('activity'),
    ExternalLink: createIcon('external-link'),
    Shield: createIcon('shield'),
    ChevronRight: createIcon('chevron-right'),
    Search: createIcon('search'),
    ToggleLeft: createIcon('toggle-left'),
    ToggleRight: createIcon('toggle-right'),
    AlertCircle: createIcon('alert-circle'),
  };
});

import { IntegrationsApp } from '../IntegrationsApp';

describe('IntegrationsApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<IntegrationsApp />);
    expect(container).toBeTruthy();
  });

  it('shows the Integrations header', () => {
    render(<IntegrationsApp />);
    expect(screen.getByText('Integrations')).toBeTruthy();
  });

  it('shows GitHub as an available integration type', () => {
    render(<IntegrationsApp />);
    expect(screen.getAllByText('GitHub').length).toBeGreaterThan(0);
  });

  it('shows other integration types as coming soon', () => {
    render(<IntegrationsApp />);
    // Check for "Coming Soon" labels on non-GitHub integrations
    const comingSoonElements = screen.getAllByText('Coming Soon');
    expect(comingSoonElements.length).toBeGreaterThan(0);
  });

  it('renders integration type sidebar', () => {
    const { container } = render(<IntegrationsApp />);
    // The sidebar should have multiple integration type entries
    expect(container.textContent).toContain('GitHub');
  });

  it('has substantial content', () => {
    const { container } = render(<IntegrationsApp />);
    // Should have meaningful content
    expect(container.textContent!.length).toBeGreaterThan(100);
  });
});
