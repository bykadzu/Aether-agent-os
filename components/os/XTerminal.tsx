import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';
import { getKernelClient } from '../../services/kernelClient';

interface XTerminalProps {
  ttyId?: string;
  onData?: (data: string) => void;
  className?: string;
}

const THEME = {
  background: '#0a0b12',
  foreground: '#a9b1d6',
  cursor: '#c0caf5',
  cursorAccent: '#0a0b12',
  selectionBackground: '#33467c',
  selectionForeground: '#c0caf5',
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
};

export const XTerminal: React.FC<XTerminalProps> = ({ ttyId, onData, className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      scrollback: 1000,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowTransparency: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);

    // Initial fit
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Handle user input
    const inputDisposable = term.onData((data) => {
      if (ttyId) {
        const client = getKernelClient();
        client.sendTerminalInput(ttyId, data);
      } else if (onData) {
        onData(data);
      }
    });

    // Subscribe to kernel tty output
    let unsubTty: (() => void) | undefined;
    if (ttyId) {
      const client = getKernelClient();
      unsubTty = client.on('tty.output', (event: any) => {
        if (event.ttyId === ttyId) {
          term.write(event.data);
        }
      });

      // Send initial resize
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          client.resizeTerminal(ttyId, term.cols, term.rows);
        } catch {}
      });
    }

    // ResizeObserver for auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
          if (ttyId) {
            const client = getKernelClient();
            client.resizeTerminal(ttyId, term.cols, term.rows);
          }
        } catch {}
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      inputDisposable.dispose();
      unsubTty?.();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [ttyId]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className || ''}`}
      style={{ backgroundColor: THEME.background }}
    />
  );
};
