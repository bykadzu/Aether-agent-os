/**
 * Aether Kernel - Browser Manager
 *
 * Manages headless Chromium browser instances via Playwright. Each browser
 * session is an isolated page that can be navigated, screenshotted, and
 * interacted with programmatically. Designed for AI agents that need real
 * web browsing capabilities.
 *
 * Data flow: Agent command → BrowserManager → Playwright Page → Screenshot/DOM → EventBus
 */

import { EventBus } from './EventBus.js';
import type {
  BrowserPageInfo,
  BrowserSessionOptions,
  DOMElement,
  DOMSnapshot,
} from '@aether/shared';

// Playwright types - dynamically imported to allow graceful fallback
type PlaywrightBrowser = {
  close(): Promise<void>;
  newPage(): Promise<PlaywrightPage>;
};

type PlaywrightPage = {
  goto(url: string, options?: { waitUntil?: string }): Promise<any>;
  goBack(): Promise<any>;
  goForward(): Promise<any>;
  reload(): Promise<any>;
  screenshot(options?: {
    type?: string;
    encoding?: string;
    fullPage?: boolean;
  }): Promise<Buffer | string>;
  url(): string;
  title(): Promise<string>;
  mouse: {
    click(x: number, y: number, options?: { button?: string }): Promise<void>;
    wheel(deltaX: number, deltaY: number): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    press(key: string): Promise<void>;
  };
  evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T>;
  close(): Promise<void>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  isClosed(): boolean;
};

interface BrowserSession {
  sessionId: string;
  page: PlaywrightPage;
  width: number;
  height: number;
  screencastInterval?: ReturnType<typeof setInterval>;
}

export class BrowserManager {
  private sessions = new Map<string, BrowserSession>();
  private bus: EventBus;
  private browser: PlaywrightBrowser | null = null;
  private playwrightAvailable = false;
  private chromiumModule: any = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  /**
   * Initialize the browser manager. Checks if Playwright + Chromium is available.
   * Gracefully falls back if not installed.
   */
  async init(): Promise<void> {
    try {
      const pw = await import('playwright');
      this.chromiumModule = pw.chromium;
      this.playwrightAvailable = true;
      console.log('[BrowserManager] Playwright available');
    } catch {
      this.playwrightAvailable = false;
      console.log('[BrowserManager] Playwright not available — browser features disabled');
    }
  }

  /**
   * Whether Playwright/Chromium is available for use.
   */
  isAvailable(): boolean {
    return this.playwrightAvailable;
  }

  /**
   * Launch the shared Chromium browser instance (lazy, on first session).
   */
  private async ensureBrowser(): Promise<PlaywrightBrowser> {
    if (!this.playwrightAvailable) {
      throw new Error('Playwright is not available. Install with: npx playwright install chromium');
    }
    if (!this.browser) {
      this.browser = await this.chromiumModule.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
    }
    return this.browser;
  }

  /**
   * Get a session by ID, throwing if not found.
   */
  private getSession(sessionId: string): BrowserSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Browser session '${sessionId}' not found`);
    }
    return session;
  }

  /**
   * Create a new browser session with its own page.
   */
  async createSession(sessionId: string, options?: BrowserSessionOptions): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Browser session '${sessionId}' already exists`);
    }

    const browser = await this.ensureBrowser();
    const page = await browser.newPage();

    const width = options?.width ?? 1280;
    const height = options?.height ?? 720;
    await page.setViewportSize({ width, height });

    const session: BrowserSession = {
      sessionId,
      page,
      width,
      height,
    };

    this.sessions.set(sessionId, session);

    // Handle file downloads — route into agent filesystem
    page.on('download', async (download: any) => {
      try {
        const filename = download.suggestedFilename();
        const tmpPath = await download.path();
        if (tmpPath && filename) {
          this.bus.emit('browser:download', {
            sessionId,
            filename,
            tempPath: tmpPath,
          });
          console.log(`[BrowserManager] Download captured: ${filename}`);
        }
      } catch (err: any) {
        console.warn(`[BrowserManager] Download handling failed: ${err.message}`);
      }
    });

    this.bus.emit('browser:created', { sessionId });
    console.log(`[BrowserManager] Session created: ${sessionId} (${width}x${height})`);
  }

  /**
   * Destroy a browser session and close its page.
   */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId);

    // Stop screencast if running
    if (session.screencastInterval) {
      clearInterval(session.screencastInterval);
    }

    if (!session.page.isClosed()) {
      await session.page.close();
    }

    this.sessions.delete(sessionId);

    this.bus.emit('browser:destroyed', { sessionId });
    console.log(`[BrowserManager] Session destroyed: ${sessionId}`);
  }

  /**
   * Navigate to a URL.
   */
  async navigateTo(sessionId: string, url: string): Promise<BrowserPageInfo> {
    const session = this.getSession(sessionId);

    await session.page.goto(url, { waitUntil: 'domcontentloaded' });

    const info = await this.getPageInfo(sessionId);

    this.bus.emit('browser:navigated', {
      sessionId,
      url: info.url,
      title: info.title,
    });

    return info;
  }

  /**
   * Navigate back in history.
   */
  async goBack(sessionId: string): Promise<BrowserPageInfo> {
    const session = this.getSession(sessionId);
    await session.page.goBack();
    const info = await this.getPageInfo(sessionId);
    this.bus.emit('browser:navigated', { sessionId, url: info.url, title: info.title });
    return info;
  }

  /**
   * Navigate forward in history.
   */
  async goForward(sessionId: string): Promise<BrowserPageInfo> {
    const session = this.getSession(sessionId);
    await session.page.goForward();
    const info = await this.getPageInfo(sessionId);
    this.bus.emit('browser:navigated', { sessionId, url: info.url, title: info.title });
    return info;
  }

  /**
   * Reload the current page.
   */
  async reload(sessionId: string): Promise<BrowserPageInfo> {
    const session = this.getSession(sessionId);
    await session.page.reload();
    const info = await this.getPageInfo(sessionId);
    this.bus.emit('browser:navigated', { sessionId, url: info.url, title: info.title });
    return info;
  }

  /**
   * Capture a PNG screenshot of the current page, returned as base64.
   */
  async getScreenshot(sessionId: string): Promise<string> {
    const session = this.getSession(sessionId);
    const buffer = await session.page.screenshot({ type: 'png' });
    const base64 = typeof buffer === 'string' ? buffer : Buffer.from(buffer).toString('base64');

    this.bus.emit('browser:screenshot', { sessionId, data: base64 });

    return base64;
  }

  /**
   * Get current page info (URL, title, loading state).
   */
  async getPageInfo(sessionId: string): Promise<BrowserPageInfo> {
    const session = this.getSession(sessionId);
    const url = session.page.url();
    const title = await session.page.title();

    const info: BrowserPageInfo = {
      url,
      title,
      isLoading: false,
    };

    this.bus.emit('browser:page_info', { sessionId, info });

    return info;
  }

  /**
   * Get a simplified DOM snapshot for agent consumption.
   * Extracts text, links, forms, and interactive elements.
   */
  async getDOMSnapshot(sessionId: string): Promise<DOMSnapshot> {
    const session = this.getSession(sessionId);

    const elements = await session.page.evaluate(() => {
      const INTERACTIVE_TAGS = new Set([
        'A',
        'BUTTON',
        'INPUT',
        'SELECT',
        'TEXTAREA',
        'LABEL',
        'H1',
        'H2',
        'H3',
        'H4',
        'H5',
        'H6',
        'P',
        'LI',
        'IMG',
      ]);

      function extractElements(root: Element): any[] {
        const result: any[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
          acceptNode(node: Node) {
            const el = node as Element;
            if (INTERACTIVE_TAGS.has(el.tagName)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            if (
              el.getAttribute('role') ||
              el.getAttribute('aria-label') ||
              el.getAttribute('onclick')
            ) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_SKIP;
          },
        });

        let node = walker.nextNode();
        while (node) {
          const el = node as Element;
          const item: any = { tag: el.tagName.toLowerCase() };

          const text = el.textContent?.trim().substring(0, 200);
          if (text) item.text = text;

          if (el.tagName === 'A') item.href = (el as HTMLAnchorElement).href;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
            item.type = (el as HTMLInputElement).type;
            item.name = (el as HTMLInputElement).name;
            item.value = (el as HTMLInputElement).value;
          }

          const role = el.getAttribute('role');
          if (role) item.role = role;

          const ariaLabel = el.getAttribute('aria-label');
          if (ariaLabel) item.ariaLabel = ariaLabel;

          result.push(item);
          node = walker.nextNode();
        }

        return result;
      }

      return extractElements(document.body);
    });

    const url = session.page.url();
    const title = await session.page.title();

    return { url, title, elements: elements as DOMElement[] };
  }

  // ----- Input Methods -----

  /**
   * Click at a position on the page.
   */
  async click(
    sessionId: string,
    x: number,
    y: number,
    button: 'left' | 'right' = 'left',
  ): Promise<void> {
    const session = this.getSession(sessionId);
    await session.page.mouse.click(x, y, { button });
  }

  /**
   * Type text at the current focus.
   */
  async type(sessionId: string, text: string): Promise<void> {
    const session = this.getSession(sessionId);
    await session.page.keyboard.type(text);
  }

  /**
   * Press a single key (e.g. 'Enter', 'Tab', 'Escape').
   */
  async keyPress(sessionId: string, key: string): Promise<void> {
    const session = this.getSession(sessionId);
    await session.page.keyboard.press(key);
  }

  /**
   * Scroll the page.
   */
  async scroll(sessionId: string, deltaX: number, deltaY: number): Promise<void> {
    const session = this.getSession(sessionId);
    await session.page.mouse.wheel(deltaX, deltaY);
  }

  // ----- Streaming -----

  /**
   * Start emitting screenshots at a given FPS via EventBus.
   */
  startScreencast(sessionId: string, fps: number = 10): void {
    const session = this.getSession(sessionId);

    // Stop existing screencast if any
    if (session.screencastInterval) {
      clearInterval(session.screencastInterval);
    }

    const intervalMs = Math.max(Math.floor(1000 / fps), 50); // min 50ms
    session.screencastInterval = setInterval(async () => {
      try {
        if (session.page.isClosed()) {
          this.stopScreencast(sessionId);
          return;
        }
        const buffer = await session.page.screenshot({ type: 'png' });
        const base64 = typeof buffer === 'string' ? buffer : Buffer.from(buffer).toString('base64');
        this.bus.emit('browser:screenshot', { sessionId, data: base64 });
      } catch {
        // Page may have been closed; stop the screencast
        this.stopScreencast(sessionId);
      }
    }, intervalMs);
  }

  /**
   * Stop the screencast for a session.
   */
  stopScreencast(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.screencastInterval) {
      clearInterval(session.screencastInterval);
      session.screencastInterval = undefined;
    }
  }

  /**
   * Shutdown all browser sessions and close the browser instance.
   */
  async shutdown(): Promise<void> {
    // Stop all screencasts and close pages
    for (const [_sessionId, session] of this.sessions) {
      if (session.screencastInterval) {
        clearInterval(session.screencastInterval);
      }
      try {
        if (!session.page.isClosed()) {
          await session.page.close();
        }
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.sessions.clear();

    // Close the browser
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore errors during cleanup
      }
      this.browser = null;
    }

    console.log('[BrowserManager] Shutdown complete');
  }
}
