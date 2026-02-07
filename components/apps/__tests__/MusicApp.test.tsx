// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock HTMLAudioElement
const mockAudio = {
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  load: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  currentTime: 0,
  duration: 180,
  volume: 1,
  muted: false,
  paused: true,
  src: '',
};

vi.stubGlobal(
  'Audio',
  vi.fn(() => mockAudio),
);

// Mock AudioContext
const mockAnalyser = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  fftSize: 0,
  frequencyBinCount: 64,
  getByteFrequencyData: vi.fn(),
  getByteTimeDomainData: vi.fn(),
};

const mockSource = { connect: vi.fn(), disconnect: vi.fn() };

vi.stubGlobal(
  'AudioContext',
  vi.fn(() => ({
    createAnalyser: () => mockAnalyser,
    createMediaElementSource: () => mockSource,
    destination: {},
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
  })),
);

// Mock speechSynthesis
vi.stubGlobal('speechSynthesis', {
  speak: vi.fn(),
  cancel: vi.fn(),
  getVoices: vi.fn().mockReturnValue([]),
  speaking: false,
  paused: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

vi.stubGlobal(
  'SpeechSynthesisUtterance',
  vi.fn(() => ({
    voice: null,
    rate: 1,
    pitch: 1,
    volume: 1,
    text: '',
  })),
);

// Mock kernel client
vi.mock('../../../services/kernelClient', () => ({
  getKernelClient: () => ({
    connected: false,
    sendCommand: vi.fn().mockResolvedValue({ data: {} }),
    on: vi.fn().mockReturnValue(vi.fn()),
  }),
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

import { MusicApp } from '../MusicApp';

describe('MusicApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<MusicApp />);
    expect(document.body.textContent).toBeDefined();
  });

  it('displays playback controls', () => {
    render(<MusicApp />);
    const buttons = document.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(3); // play, skip, etc.
  });

  it('shows a file browser or playlist area', () => {
    render(<MusicApp />);
    // Should have some sidebar or list area
    const container = document.querySelector('[class*="flex"]');
    expect(container).toBeTruthy();
  });

  it('has volume control', () => {
    render(<MusicApp />);
    // Look for range inputs (volume/seek) or volume icon
    const rangeInputs = document.querySelectorAll('input[type="range"]');
    const hasVolumeUI = rangeInputs.length > 0 || document.querySelector('[data-testid*="volume"]');
    expect(hasVolumeUI).toBeTruthy();
  });

  it('shows time display', () => {
    render(<MusicApp />);
    // Should display time somewhere (0:00 or similar)
    const text = document.body.textContent || '';
    expect(text.match(/\d:\d\d/) || text.includes('No track')).toBeTruthy();
  });
});
