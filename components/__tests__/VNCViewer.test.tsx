// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React, { createRef } from 'react';

// Mock lucide-react icons
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

// Control whether noVNC mock returns a valid RFB class or null
let mockNoVNCAvailable = true;
const mockRFBInstance: Record<string, any> = {
  addEventListener: vi.fn(),
  disconnect: vi.fn(),
  sendCtrlAltDel: vi.fn(),
  clipboardPasteFrom: vi.fn(),
  scaleViewport: true,
  qualityLevel: 5,
  compressionLevel: 5,
};

// Mock the dynamic import at the module level
vi.mock('@novnc/novnc/lib/rfb.js', () => {
  return {
    get default() {
      if (!mockNoVNCAvailable) return undefined;
      return function MockRFB() {
        return { ...mockRFBInstance };
      };
    },
  };
});

import { VNCViewer, VNCViewerHandle } from '../os/VNCViewer';

describe('VNCViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNoVNCAvailable = true;
  });

  it('renders connecting state initially', () => {
    const { container } = render(<VNCViewer wsUrl="ws://localhost:6080" />);
    // The connecting overlay should be visible
    expect(container.textContent).toContain('Connecting to desktop...');
    expect(container.textContent).toContain('ws://localhost:6080');
  });

  it('shows error state when noVNC is not available', async () => {
    mockNoVNCAvailable = false;
    const { container } = render(<VNCViewer wsUrl="ws://localhost:6080" />);

    // Wait for async init to settle
    await waitFor(
      () => {
        expect(container.textContent).toContain('noVNC library not loaded');
      },
      { timeout: 5000 },
    );
  });

  it('renders retry button in error state and reconnect triggers re-init', async () => {
    mockNoVNCAvailable = false;
    const { container } = render(<VNCViewer wsUrl="ws://localhost:6080" />);

    // Wait for error state
    await waitFor(
      () => {
        expect(container.textContent).toContain('Retry');
      },
      { timeout: 5000 },
    );

    // Click retry — should go back to connecting state
    const retryButton = container.querySelector('button');
    expect(retryButton).toBeTruthy();
    fireEvent.click(retryButton!);

    // After clicking retry, status resets to connecting
    expect(container.textContent).toContain('Connecting to desktop...');
  });

  it('exposes sendCtrlAltDel via ref', () => {
    const ref = createRef<VNCViewerHandle>();
    render(<VNCViewer ref={ref} wsUrl="ws://localhost:6080" />);

    // ref.current is set synchronously by forwardRef/useImperativeHandle
    expect(ref.current).toBeTruthy();
    expect(typeof ref.current!.sendCtrlAltDel).toBe('function');
  });

  it('renders without crashing when wsUrl is empty', () => {
    const { container } = render(<VNCViewer wsUrl="" />);
    // Should render the outer container without errors
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('does not show quality selector when not connected', () => {
    const { container } = render(<VNCViewer wsUrl="ws://localhost:6080" />);
    // Quality menu should not appear in connecting state
    expect(container.textContent).not.toContain('Medium');
  });
});
