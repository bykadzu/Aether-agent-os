/**
 * Integration tests for Kernel-level browser command handling.
 *
 * Verifies that kernel.handleCommand() correctly routes every browser command
 * to BrowserManager and returns the expected KernelEvent array.
 *
 * Strategy: instantiate a real Kernel (without boot()) and mock only the
 * BrowserManager methods so we can assert routing, argument forwarding,
 * and event shape without requiring Playwright.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock native modules that Kernel transitively imports but are not installed
// in the test environment.
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 9999,
  })),
}));

vi.mock('better-sqlite3', () => {
  function MockDatabase() {
    return {
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => []),
      })),
      close: vi.fn(),
    };
  }
  return { default: MockDatabase };
});

import { Kernel } from '../Kernel.js';
import type { KernelCommand, KernelEvent } from '@aether/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convenience: find the first event of a given type. */
function findEvent<T extends KernelEvent>(events: KernelEvent[], type: string): T | undefined {
  return events.find((e) => e.type === type) as T | undefined;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Kernel browser command routing (integration)', () => {
  let kernel: Kernel;

  beforeEach(() => {
    kernel = new Kernel({ fsRoot: '/tmp/aether-test-browser-integration' });

    // Mock every BrowserManager method that handleCommand may call.
    // We do NOT call kernel.boot() so no real subsystems are initialised.
    (kernel.browser as any).createSession = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).destroySession = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).navigateTo = vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example Domain',
      isLoading: false,
    });
    (kernel.browser as any).goBack = vi.fn().mockResolvedValue({
      url: 'https://example.com/prev',
      title: 'Previous Page',
      isLoading: false,
    });
    (kernel.browser as any).goForward = vi.fn().mockResolvedValue({
      url: 'https://example.com/next',
      title: 'Next Page',
      isLoading: false,
    });
    (kernel.browser as any).reload = vi.fn().mockResolvedValue({
      url: 'https://example.com/reloaded',
      title: 'Reloaded',
      isLoading: false,
    });
    (kernel.browser as any).getScreenshot = vi.fn().mockResolvedValue('base64screenshotdata');
    (kernel.browser as any).getDOMSnapshot = vi.fn().mockResolvedValue({
      url: 'https://example.com',
      title: 'Example',
      elements: [{ tag: 'a', text: 'Link', href: 'https://example.com' }],
    });
    (kernel.browser as any).click = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).type = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).keyPress = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).scroll = vi.fn().mockResolvedValue(undefined);
    (kernel.browser as any).startScreencast = vi.fn();
    (kernel.browser as any).stopScreencast = vi.fn();
  });

  // -----------------------------------------------------------------------
  // browser:create
  // -----------------------------------------------------------------------

  describe('browser:create', () => {
    it('routes to BrowserManager.createSession and returns response.ok + browser:created', async () => {
      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-1',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.createSession).toHaveBeenCalledWith('sess-1', undefined);
      expect(events).toHaveLength(2);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).id).toBe('cmd-1');
      expect((ok as any).data).toEqual({ sessionId: 'sess-1' });

      const created = findEvent(events, 'browser:created');
      expect(created).toBeDefined();
      expect((created as any).sessionId).toBe('sess-1');
    });

    it('forwards BrowserSessionOptions to createSession', async () => {
      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-opts',
        sessionId: 'sess-opts',
        options: { width: 800, height: 600 },
      };

      await kernel.handleCommand(cmd);

      expect(kernel.browser.createSession).toHaveBeenCalledWith('sess-opts', {
        width: 800,
        height: 600,
      });
    });

    it('returns response.error when createSession throws (duplicate session)', async () => {
      (kernel.browser as any).createSession = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'dup' already exists"));

      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-dup',
        sessionId: 'dup',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).id).toBe('cmd-dup');
      expect((err as any).error).toContain('already exists');
    });

    it('returns response.error when Playwright is unavailable', async () => {
      (kernel.browser as any).createSession = vi
        .fn()
        .mockRejectedValue(
          new Error('Playwright is not available. Install with: npx playwright install chromium'),
        );

      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-nopw',
        sessionId: 'sess-nopw',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toContain('Playwright is not available');
    });
  });

  // -----------------------------------------------------------------------
  // browser:destroy
  // -----------------------------------------------------------------------

  describe('browser:destroy', () => {
    it('routes to BrowserManager.destroySession and returns response.ok + browser:destroyed', async () => {
      const cmd: KernelCommand = {
        type: 'browser:destroy',
        id: 'cmd-d1',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.destroySession).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(2);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).id).toBe('cmd-d1');

      const destroyed = findEvent(events, 'browser:destroyed');
      expect(destroyed).toBeDefined();
      expect((destroyed as any).sessionId).toBe('sess-1');
    });

    it('returns response.error when destroying a non-existent session', async () => {
      (kernel.browser as any).destroySession = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'ghost' not found"));

      const cmd: KernelCommand = {
        type: 'browser:destroy',
        id: 'cmd-d-ghost',
        sessionId: 'ghost',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // browser:navigate
  // -----------------------------------------------------------------------

  describe('browser:navigate', () => {
    it('routes to BrowserManager.navigateTo and returns page info + browser:navigated', async () => {
      const cmd: KernelCommand = {
        type: 'browser:navigate',
        id: 'cmd-nav',
        sessionId: 'sess-1',
        url: 'https://example.com',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.navigateTo).toHaveBeenCalledWith('sess-1', 'https://example.com');
      expect(events).toHaveLength(2);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).id).toBe('cmd-nav');
      expect((ok as any).data).toEqual({
        url: 'https://example.com',
        title: 'Example Domain',
        isLoading: false,
      });

      const navigated = findEvent(events, 'browser:navigated');
      expect(navigated).toBeDefined();
      expect((navigated as any).sessionId).toBe('sess-1');
      expect((navigated as any).url).toBe('https://example.com');
      expect((navigated as any).title).toBe('Example Domain');
    });

    it('returns response.error when navigating on a non-existent session', async () => {
      (kernel.browser as any).navigateTo = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'missing' not found"));

      const cmd: KernelCommand = {
        type: 'browser:navigate',
        id: 'cmd-nav-bad',
        sessionId: 'missing',
        url: 'https://example.com',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toContain('not found');
    });

    it('returns response.error when page navigation itself fails', async () => {
      (kernel.browser as any).navigateTo = vi
        .fn()
        .mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));

      const cmd: KernelCommand = {
        type: 'browser:navigate',
        id: 'cmd-nav-fail',
        sessionId: 'sess-1',
        url: 'https://nonexistent.invalid',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toContain('ERR_NAME_NOT_RESOLVED');
    });
  });

  // -----------------------------------------------------------------------
  // browser:screenshot
  // -----------------------------------------------------------------------

  describe('browser:screenshot', () => {
    it('routes to BrowserManager.getScreenshot and returns base64 data', async () => {
      const cmd: KernelCommand = {
        type: 'browser:screenshot',
        id: 'cmd-ss',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.getScreenshot).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).id).toBe('cmd-ss');
      expect((ok as any).data).toEqual({ screenshot: 'base64screenshotdata' });
    });

    it('returns response.error when screenshot fails on closed page', async () => {
      (kernel.browser as any).getScreenshot = vi
        .fn()
        .mockRejectedValue(new Error('Target page, context or browser has been closed'));

      const cmd: KernelCommand = {
        type: 'browser:screenshot',
        id: 'cmd-ss-closed',
        sessionId: 'sess-closed',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toContain('closed');
    });
  });

  // -----------------------------------------------------------------------
  // browser:click
  // -----------------------------------------------------------------------

  describe('browser:click', () => {
    it('routes to BrowserManager.click with coordinates and default button', async () => {
      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-click',
        sessionId: 'sess-1',
        x: 100,
        y: 200,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.click).toHaveBeenCalledWith('sess-1', 100, 200, undefined);
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).id).toBe('cmd-click');
    });

    it('forwards explicit right-button click', async () => {
      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-rclick',
        sessionId: 'sess-1',
        x: 50,
        y: 75,
        button: 'right',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.click).toHaveBeenCalledWith('sess-1', 50, 75, 'right');
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('returns response.error when click fails on non-existent session', async () => {
      (kernel.browser as any).click = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'none' not found"));

      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-click-bad',
        sessionId: 'none',
        x: 0,
        y: 0,
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect((findEvent(events, 'response.error') as any).error).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // browser:type
  // -----------------------------------------------------------------------

  describe('browser:type', () => {
    it('routes to BrowserManager.type with the provided text', async () => {
      const cmd: KernelCommand = {
        type: 'browser:type',
        id: 'cmd-type',
        sessionId: 'sess-1',
        text: 'hello world',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.type).toHaveBeenCalledWith('sess-1', 'hello world');
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('handles empty string text input', async () => {
      const cmd: KernelCommand = {
        type: 'browser:type',
        id: 'cmd-type-empty',
        sessionId: 'sess-1',
        text: '',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.type).toHaveBeenCalledWith('sess-1', '');
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('handles special characters and unicode text', async () => {
      const specialText = '<script>alert("xss")</script> \u00e9\u00e8\u00ea \u{1F600}';
      const cmd: KernelCommand = {
        type: 'browser:type',
        id: 'cmd-type-special',
        sessionId: 'sess-1',
        text: specialText,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.type).toHaveBeenCalledWith('sess-1', specialText);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('returns response.error when typing on a non-existent session', async () => {
      (kernel.browser as any).type = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'bad' not found"));

      const cmd: KernelCommand = {
        type: 'browser:type',
        id: 'cmd-type-bad',
        sessionId: 'bad',
        text: 'whatever',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect((findEvent(events, 'response.error') as any).error).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // browser:keypress
  // -----------------------------------------------------------------------

  describe('browser:keypress', () => {
    it('routes to BrowserManager.keyPress with the key name', async () => {
      const cmd: KernelCommand = {
        type: 'browser:keypress',
        id: 'cmd-kp',
        sessionId: 'sess-1',
        key: 'Enter',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.keyPress).toHaveBeenCalledWith('sess-1', 'Enter');
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('returns response.error when keypress fails', async () => {
      (kernel.browser as any).keyPress = vi
        .fn()
        .mockRejectedValue(new Error("Browser session 'x' not found"));

      const cmd: KernelCommand = {
        type: 'browser:keypress',
        id: 'cmd-kp-bad',
        sessionId: 'x',
        key: 'Escape',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect((findEvent(events, 'response.error') as any).error).toContain('not found');
    });
  });

  // -----------------------------------------------------------------------
  // browser:scroll
  // -----------------------------------------------------------------------

  describe('browser:scroll', () => {
    it('routes to BrowserManager.scroll with delta values', async () => {
      const cmd: KernelCommand = {
        type: 'browser:scroll',
        id: 'cmd-scroll',
        sessionId: 'sess-1',
        deltaX: 0,
        deltaY: 500,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.scroll).toHaveBeenCalledWith('sess-1', 0, 500);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('supports negative scroll (scroll up)', async () => {
      const cmd: KernelCommand = {
        type: 'browser:scroll',
        id: 'cmd-scroll-up',
        sessionId: 'sess-1',
        deltaX: 0,
        deltaY: -300,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.scroll).toHaveBeenCalledWith('sess-1', 0, -300);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('supports horizontal scroll', async () => {
      const cmd: KernelCommand = {
        type: 'browser:scroll',
        id: 'cmd-scroll-h',
        sessionId: 'sess-1',
        deltaX: 200,
        deltaY: 0,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.scroll).toHaveBeenCalledWith('sess-1', 200, 0);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // browser:back
  // -----------------------------------------------------------------------

  describe('browser:back', () => {
    it('routes to BrowserManager.goBack and returns page info', async () => {
      const cmd: KernelCommand = {
        type: 'browser:back',
        id: 'cmd-back',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.goBack).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).data).toEqual({
        url: 'https://example.com/prev',
        title: 'Previous Page',
        isLoading: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // browser:forward
  // -----------------------------------------------------------------------

  describe('browser:forward', () => {
    it('routes to BrowserManager.goForward and returns page info', async () => {
      const cmd: KernelCommand = {
        type: 'browser:forward',
        id: 'cmd-fwd',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.goForward).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).data).toEqual({
        url: 'https://example.com/next',
        title: 'Next Page',
        isLoading: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // browser:reload
  // -----------------------------------------------------------------------

  describe('browser:reload', () => {
    it('routes to BrowserManager.reload and returns page info', async () => {
      const cmd: KernelCommand = {
        type: 'browser:reload',
        id: 'cmd-reload',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.reload).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).data).toEqual({
        url: 'https://example.com/reloaded',
        title: 'Reloaded',
        isLoading: false,
      });
    });
  });

  // -----------------------------------------------------------------------
  // browser:dom_snapshot
  // -----------------------------------------------------------------------

  describe('browser:dom_snapshot', () => {
    it('routes to BrowserManager.getDOMSnapshot and returns elements', async () => {
      const cmd: KernelCommand = {
        type: 'browser:dom_snapshot',
        id: 'cmd-dom',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.getDOMSnapshot).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);

      const ok = findEvent(events, 'response.ok');
      expect(ok).toBeDefined();
      expect((ok as any).data).toEqual({
        url: 'https://example.com',
        title: 'Example',
        elements: [{ tag: 'a', text: 'Link', href: 'https://example.com' }],
      });
    });

    it('returns response.error when DOM snapshot fails', async () => {
      (kernel.browser as any).getDOMSnapshot = vi
        .fn()
        .mockRejectedValue(new Error('Execution context was destroyed'));

      const cmd: KernelCommand = {
        type: 'browser:dom_snapshot',
        id: 'cmd-dom-err',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect((findEvent(events, 'response.error') as any).error).toContain(
        'Execution context was destroyed',
      );
    });
  });

  // -----------------------------------------------------------------------
  // browser:screencast_start / browser:screencast_stop
  // -----------------------------------------------------------------------

  describe('browser:screencast_start', () => {
    it('routes to BrowserManager.startScreencast and returns response.ok', async () => {
      const cmd: KernelCommand = {
        type: 'browser:screencast_start',
        id: 'cmd-sc-start',
        sessionId: 'sess-1',
        fps: 15,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.startScreencast).toHaveBeenCalledWith('sess-1', 15);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('passes undefined fps when not specified', async () => {
      const cmd: KernelCommand = {
        type: 'browser:screencast_start',
        id: 'cmd-sc-start-nofps',
        sessionId: 'sess-1',
      };

      await kernel.handleCommand(cmd);

      expect(kernel.browser.startScreencast).toHaveBeenCalledWith('sess-1', undefined);
    });
  });

  describe('browser:screencast_stop', () => {
    it('routes to BrowserManager.stopScreencast and returns response.ok', async () => {
      const cmd: KernelCommand = {
        type: 'browser:screencast_stop',
        id: 'cmd-sc-stop',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.stopScreencast).toHaveBeenCalledWith('sess-1');
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('each response event carries the original command id', async () => {
      const commandTypes: KernelCommand[] = [
        { type: 'browser:create', id: 'id-create', sessionId: 's' },
        { type: 'browser:destroy', id: 'id-destroy', sessionId: 's' },
        { type: 'browser:navigate', id: 'id-nav', sessionId: 's', url: 'https://x.com' },
        { type: 'browser:screenshot', id: 'id-ss', sessionId: 's' },
        { type: 'browser:click', id: 'id-click', sessionId: 's', x: 0, y: 0 },
        { type: 'browser:type', id: 'id-type', sessionId: 's', text: 'a' },
        { type: 'browser:keypress', id: 'id-kp', sessionId: 's', key: 'Tab' },
        { type: 'browser:scroll', id: 'id-scroll', sessionId: 's', deltaX: 0, deltaY: 0 },
        { type: 'browser:back', id: 'id-back', sessionId: 's' },
        { type: 'browser:forward', id: 'id-fwd', sessionId: 's' },
        { type: 'browser:reload', id: 'id-reload', sessionId: 's' },
        { type: 'browser:dom_snapshot', id: 'id-dom', sessionId: 's' },
        { type: 'browser:screencast_start', id: 'id-sc-on', sessionId: 's' },
        { type: 'browser:screencast_stop', id: 'id-sc-off', sessionId: 's' },
      ];

      for (const cmd of commandTypes) {
        const events = await kernel.handleCommand(cmd);
        const ok = findEvent(events, 'response.ok');
        expect(ok).toBeDefined();
        expect((ok as any).id).toBe(cmd.id);
      }
    });

    it('non-string error from BrowserManager is stringified', async () => {
      // Simulate a non-Error throw (e.g. a string or number)
      (kernel.browser as any).createSession = vi.fn().mockRejectedValue('raw string error');

      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-raw-err',
        sessionId: 'sess-raw',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toBe('raw string error');
    });

    it('numeric throw from BrowserManager is stringified', async () => {
      (kernel.browser as any).click = vi.fn().mockRejectedValue(42);

      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-num-err',
        sessionId: 'sess-num',
        x: 0,
        y: 0,
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      const err = findEvent(events, 'response.error');
      expect(err).toBeDefined();
      expect((err as any).error).toBe('42');
    });

    it('multiple sequential commands each get independent event arrays', async () => {
      const cmd1: KernelCommand = {
        type: 'browser:create',
        id: 'seq-1',
        sessionId: 'a',
      };
      const cmd2: KernelCommand = {
        type: 'browser:create',
        id: 'seq-2',
        sessionId: 'b',
      };

      const events1 = await kernel.handleCommand(cmd1);
      const events2 = await kernel.handleCommand(cmd2);

      // The two arrays must be distinct objects
      expect(events1).not.toBe(events2);

      // Each should reference its own command id
      expect((findEvent(events1, 'response.ok') as any).id).toBe('seq-1');
      expect((findEvent(events2, 'response.ok') as any).id).toBe('seq-2');
    });

    it('browser:create with empty sessionId still routes through', async () => {
      const cmd: KernelCommand = {
        type: 'browser:create',
        id: 'cmd-empty-sid',
        sessionId: '',
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.createSession).toHaveBeenCalledWith('', undefined);
      expect(events).toHaveLength(2);
      expect((findEvent(events, 'browser:created') as any).sessionId).toBe('');
    });

    it('browser:click at boundary coordinates (0,0) works', async () => {
      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-zero',
        sessionId: 'sess-1',
        x: 0,
        y: 0,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.click).toHaveBeenCalledWith('sess-1', 0, 0, undefined);
      expect(events).toHaveLength(1);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('browser:click at large coordinates routes correctly', async () => {
      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-large',
        sessionId: 'sess-1',
        x: 99999,
        y: 99999,
      };

      const events = await kernel.handleCommand(cmd);

      expect(kernel.browser.click).toHaveBeenCalledWith('sess-1', 99999, 99999, undefined);
      expect(findEvent(events, 'response.ok')).toBeDefined();
    });

    it('browser:navigate produces exactly two events (response.ok and browser:navigated)', async () => {
      const cmd: KernelCommand = {
        type: 'browser:navigate',
        id: 'cmd-nav-count',
        sessionId: 'sess-1',
        url: 'https://example.com',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(2);
      const types = events.map((e) => e.type);
      expect(types).toContain('response.ok');
      expect(types).toContain('browser:navigated');
    });

    it('browser:screenshot produces exactly one event (response.ok only, no broadcast event)', async () => {
      const cmd: KernelCommand = {
        type: 'browser:screenshot',
        id: 'cmd-ss-count',
        sessionId: 'sess-1',
      };

      const events = await kernel.handleCommand(cmd);

      // The kernel only pushes response.ok for screenshot; the BrowserManager itself
      // emits the bus event separately (not returned in handleCommand events array).
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('response.ok');
    });

    it('browser:click produces exactly one event (response.ok only)', async () => {
      const cmd: KernelCommand = {
        type: 'browser:click',
        id: 'cmd-click-count',
        sessionId: 'sess-1',
        x: 10,
        y: 20,
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('response.ok');
    });

    it('browser:type produces exactly one event (response.ok only)', async () => {
      const cmd: KernelCommand = {
        type: 'browser:type',
        id: 'cmd-type-count',
        sessionId: 'sess-1',
        text: 'test',
      };

      const events = await kernel.handleCommand(cmd);

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('response.ok');
    });

    it('concurrent command handling does not interfere', async () => {
      const cmds: KernelCommand[] = [
        { type: 'browser:navigate', id: 'conc-1', sessionId: 's1', url: 'https://a.com' },
        { type: 'browser:screenshot', id: 'conc-2', sessionId: 's2' },
        { type: 'browser:click', id: 'conc-3', sessionId: 's3', x: 10, y: 20 },
      ];

      const results = await Promise.all(cmds.map((c) => kernel.handleCommand(c)));

      // Each result should have the correct id
      expect((findEvent(results[0], 'response.ok') as any).id).toBe('conc-1');
      expect((findEvent(results[1], 'response.ok') as any).id).toBe('conc-2');
      expect((findEvent(results[2], 'response.ok') as any).id).toBe('conc-3');
    });
  });
});
