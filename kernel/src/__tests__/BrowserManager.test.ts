import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { BrowserManager } from '../BrowserManager.js';

// ---------------------------------------------------------------------------
// Playwright Mock Setup
// ---------------------------------------------------------------------------

function createMockPage(overrides: Record<string, any> = {}) {
  const page: any = {
    goto: vi.fn().mockResolvedValue(null),
    goBack: vi.fn().mockResolvedValue(null),
    goForward: vi.fn().mockResolvedValue(null),
    reload: vi.fn().mockResolvedValue(null),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-png-data')),
    url: vi.fn().mockReturnValue('about:blank'),
    title: vi.fn().mockResolvedValue(''),
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
    setViewportSize: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
    mouse: {
      click: vi.fn().mockResolvedValue(undefined),
      wheel: vi.fn().mockResolvedValue(undefined),
    },
    keyboard: {
      type: vi.fn().mockResolvedValue(undefined),
      press: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
  return page;
}

function createMockBrowser(page: any) {
  return {
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Inject a mock Playwright module into the BrowserManager by calling init()
 * with a mocked dynamic import.
 */
async function initWithMockPlaywright(manager: BrowserManager, mockBrowser: any) {
  // We patch the manager's internals after init detects playwright as unavailable
  // by directly setting the private fields
  const m = manager as any;
  m.playwrightAvailable = true;
  m.chromiumModule = {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BrowserManager', () => {
  let bus: EventBus;
  let manager: BrowserManager;
  let mockPage: any;
  let mockBrowser: any;

  beforeEach(async () => {
    bus = new EventBus();
    manager = new BrowserManager(bus);
    mockPage = createMockPage();
    mockBrowser = createMockBrowser(mockPage);
    await initWithMockPlaywright(manager, mockBrowser);
  });

  afterEach(async () => {
    await manager.shutdown();
  });

  // --- Initialization / Fallback ---

  describe('init()', () => {
    it('gracefully handles missing Playwright', () => {
      const freshManager = new BrowserManager(bus);
      // Before init(), manager should report unavailable
      expect(freshManager.isAvailable()).toBe(false);
    });

    it('reports available when Playwright module is present', () => {
      expect(manager.isAvailable()).toBe(true);
    });
  });

  // --- Session Management ---

  describe('createSession()', () => {
    it('creates a browser session with default viewport', async () => {
      const handler = vi.fn();
      bus.on('browser:created', handler);

      await manager.createSession('test-session');

      expect(mockBrowser.newPage).toHaveBeenCalledOnce();
      expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 1280, height: 720 });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'test-session' }));
    });

    it('creates a session with custom viewport', async () => {
      await manager.createSession('custom-vp', { width: 800, height: 600 });

      expect(mockPage.setViewportSize).toHaveBeenCalledWith({ width: 800, height: 600 });
    });

    it('throws when creating duplicate session', async () => {
      await manager.createSession('dup');
      await expect(manager.createSession('dup')).rejects.toThrow('already exists');
    });

    it('throws when Playwright is not available', async () => {
      const noPlaywright = new BrowserManager(bus);
      // Explicitly mark as unavailable (simulates missing playwright package)
      (noPlaywright as any).playwrightAvailable = false;
      await expect(noPlaywright.createSession('s1')).rejects.toThrow('Playwright is not available');
    });
  });

  describe('destroySession()', () => {
    it('destroys a session and emits event', async () => {
      const handler = vi.fn();
      bus.on('browser:destroyed', handler);

      await manager.createSession('s1');
      await manager.destroySession('s1');

      expect(mockPage.close).toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1' }));
    });

    it('throws when session does not exist', async () => {
      await expect(manager.destroySession('nonexistent')).rejects.toThrow('not found');
    });
  });

  // --- Navigation ---

  describe('navigateTo()', () => {
    it('navigates to a URL and returns page info', async () => {
      const navHandler = vi.fn();
      bus.on('browser:navigated', navHandler);

      mockPage.url.mockReturnValue('https://example.com');
      mockPage.title.mockResolvedValue('Example Domain');

      await manager.createSession('nav');
      const info = await manager.navigateTo('nav', 'https://example.com');

      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
      });
      expect(info.url).toBe('https://example.com');
      expect(info.title).toBe('Example Domain');
      expect(navHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'nav',
          url: 'https://example.com',
          title: 'Example Domain',
        }),
      );
    });
  });

  describe('goBack() / goForward()', () => {
    it('calls page.goBack and returns page info', async () => {
      await manager.createSession('hist');
      await manager.goBack('hist');
      expect(mockPage.goBack).toHaveBeenCalledOnce();
    });

    it('calls page.goForward and returns page info', async () => {
      await manager.createSession('hist2');
      await manager.goForward('hist2');
      expect(mockPage.goForward).toHaveBeenCalledOnce();
    });
  });

  describe('reload()', () => {
    it('reloads the page', async () => {
      await manager.createSession('rl');
      await manager.reload('rl');
      expect(mockPage.reload).toHaveBeenCalledOnce();
    });
  });

  // --- Screenshots ---

  describe('getScreenshot()', () => {
    it('returns a base64 screenshot and emits event', async () => {
      const handler = vi.fn();
      bus.on('browser:screenshot', handler);

      await manager.createSession('ss');
      const data = await manager.getScreenshot('ss');

      expect(mockPage.screenshot).toHaveBeenCalledWith({ type: 'png' });
      expect(typeof data).toBe('string');
      expect(data.length).toBeGreaterThan(0);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'ss', data }));
    });
  });

  // --- Page Info ---

  describe('getPageInfo()', () => {
    it('returns current page URL and title', async () => {
      mockPage.url.mockReturnValue('https://test.com/page');
      mockPage.title.mockResolvedValue('Test Page');

      const infoHandler = vi.fn();
      bus.on('browser:page_info', infoHandler);

      await manager.createSession('pi');
      const info = await manager.getPageInfo('pi');

      expect(info.url).toBe('https://test.com/page');
      expect(info.title).toBe('Test Page');
      expect(info.isLoading).toBe(false);
      expect(infoHandler).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'pi', info }));
    });
  });

  // --- DOM Snapshot ---

  describe('getDOMSnapshot()', () => {
    it('returns a DOM snapshot from page.evaluate', async () => {
      const mockElements = [
        { tag: 'a', text: 'Click me', href: 'https://example.com' },
        { tag: 'button', text: 'Submit' },
      ];
      mockPage.evaluate.mockResolvedValue(mockElements);
      mockPage.url.mockReturnValue('https://dom.test');
      mockPage.title.mockResolvedValue('DOM Test');

      await manager.createSession('dom');
      const snapshot = await manager.getDOMSnapshot('dom');

      expect(snapshot.url).toBe('https://dom.test');
      expect(snapshot.title).toBe('DOM Test');
      expect(snapshot.elements).toEqual(mockElements);
    });
  });

  // --- Input Methods ---

  describe('click()', () => {
    it('clicks at the given position with default left button', async () => {
      await manager.createSession('clk');
      await manager.click('clk', 100, 200);
      expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200, { button: 'left' });
    });

    it('clicks with right button when specified', async () => {
      await manager.createSession('rclk');
      await manager.click('rclk', 50, 75, 'right');
      expect(mockPage.mouse.click).toHaveBeenCalledWith(50, 75, { button: 'right' });
    });
  });

  describe('type()', () => {
    it('types text via keyboard', async () => {
      await manager.createSession('typ');
      await manager.type('typ', 'hello world');
      expect(mockPage.keyboard.type).toHaveBeenCalledWith('hello world');
    });
  });

  describe('keyPress()', () => {
    it('presses a key', async () => {
      await manager.createSession('kp');
      await manager.keyPress('kp', 'Enter');
      expect(mockPage.keyboard.press).toHaveBeenCalledWith('Enter');
    });
  });

  describe('scroll()', () => {
    it('scrolls the page', async () => {
      await manager.createSession('scr');
      await manager.scroll('scr', 0, 500);
      expect(mockPage.mouse.wheel).toHaveBeenCalledWith(0, 500);
    });
  });

  // --- Screencast ---

  describe('startScreencast() / stopScreencast()', () => {
    it('starts and stops screencast without errors', async () => {
      await manager.createSession('sc');

      // Start at low FPS so interval is long
      manager.startScreencast('sc', 1);

      // Stop immediately
      manager.stopScreencast('sc');

      // No error should have occurred
    });

    it('emits screenshots during screencast', async () => {
      vi.useFakeTimers();

      const handler = vi.fn();
      bus.on('browser:screenshot', handler);

      await manager.createSession('sc2');
      manager.startScreencast('sc2', 10); // 100ms interval

      // Advance time to trigger interval
      await vi.advanceTimersByTimeAsync(150);

      expect(handler).toHaveBeenCalled();

      manager.stopScreencast('sc2');
      vi.useRealTimers();
    });
  });

  // --- Shutdown ---

  describe('shutdown()', () => {
    it('closes all sessions and the browser', async () => {
      await manager.createSession('s1');
      await manager.createSession('s2');

      await manager.shutdown();

      // Pages should be closed
      expect(mockPage.close).toHaveBeenCalled();
      // Browser should be closed
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it('handles shutdown when no sessions exist', async () => {
      // Should not throw
      await manager.shutdown();
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('throws on operations with invalid session ID', async () => {
      await expect(manager.navigateTo('bad', 'https://x.com')).rejects.toThrow('not found');
      await expect(manager.getScreenshot('bad')).rejects.toThrow('not found');
      await expect(manager.click('bad', 0, 0)).rejects.toThrow('not found');
      await expect(manager.type('bad', 'x')).rejects.toThrow('not found');
      await expect(manager.keyPress('bad', 'Enter')).rejects.toThrow('not found');
      await expect(manager.scroll('bad', 0, 0)).rejects.toThrow('not found');
    });
  });
});
