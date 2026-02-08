/**
 * @vitest-environment jsdom
 */

/**
 * Aether Embed - Web Component Tests
 *
 * Tests for the <aether-agent> custom element.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We need to register the custom element before tests
import { AetherAgentElement } from '../src/AetherAgentElement.js';

if (!customElements.get('aether-agent')) {
  customElements.define('aether-agent', AetherAgentElement);
}

describe('AetherAgentElement', () => {
  let el: AetherAgentElement;

  beforeEach(() => {
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  it('registers the custom element', () => {
    expect(customElements.get('aether-agent')).toBe(AetherAgentElement);
  });

  it('is an instance of HTMLElement', () => {
    expect(el).toBeInstanceOf(HTMLElement);
  });

  // -----------------------------------------------------------------------
  // Shadow DOM Structure
  // -----------------------------------------------------------------------

  it('creates a shadow root', () => {
    expect(el.shadowRoot).toBeTruthy();
  });

  it('has a FAB button', () => {
    const fab = el.shadowRoot!.querySelector('.aether-fab');
    expect(fab).toBeTruthy();
    expect(fab!.tagName).toBe('BUTTON');
  });

  it('has a panel with header, messages, and input bar', () => {
    const panel = el.shadowRoot!.querySelector('.aether-panel');
    expect(panel).toBeTruthy();

    const header = el.shadowRoot!.querySelector('.aether-header');
    expect(header).toBeTruthy();

    const messages = el.shadowRoot!.querySelector('.aether-messages');
    expect(messages).toBeTruthy();

    const inputBar = el.shadowRoot!.querySelector('.aether-input-bar');
    expect(inputBar).toBeTruthy();

    const input = el.shadowRoot!.querySelector('.aether-input-bar input');
    expect(input).toBeTruthy();

    const sendBtn = el.shadowRoot!.querySelector('.aether-input-bar .send');
    expect(sendBtn).toBeTruthy();
  });

  it('has a minimize button in the header', () => {
    const minimize = el.shadowRoot!.querySelector('.aether-header .minimize');
    expect(minimize).toBeTruthy();
  });

  it('panel is hidden by default', () => {
    const panel = el.shadowRoot!.querySelector('.aether-panel') as HTMLDivElement;
    expect(panel.style.display).toBe('none');
  });

  // -----------------------------------------------------------------------
  // FAB / Panel Toggle
  // -----------------------------------------------------------------------

  it('clicking FAB shows the panel and hides the FAB', () => {
    const fab = el.shadowRoot!.querySelector('.aether-fab') as HTMLButtonElement;
    const panel = el.shadowRoot!.querySelector('.aether-panel') as HTMLDivElement;

    fab.click();

    expect(fab.style.display).toBe('none');
    expect(panel.style.display).toBe('flex');
  });

  it('clicking minimize hides the panel and shows the FAB', () => {
    const fab = el.shadowRoot!.querySelector('.aether-fab') as HTMLButtonElement;
    const panel = el.shadowRoot!.querySelector('.aether-panel') as HTMLDivElement;
    const minimize = el.shadowRoot!.querySelector('.minimize') as HTMLButtonElement;

    // First open the panel
    fab.click();
    expect(panel.style.display).toBe('flex');

    // Then minimize
    minimize.click();
    expect(panel.style.display).toBe('none');
    expect(fab.style.display).toBe('flex');
  });

  // -----------------------------------------------------------------------
  // Theme attribute
  // -----------------------------------------------------------------------

  it('defaults to dark theme', () => {
    const style = el.shadowRoot!.querySelector('style');
    expect(style).toBeTruthy();
    // Dark theme uses #1a1a2e as background
    expect(style!.textContent).toContain('#1a1a2e');
  });

  it('supports light theme', () => {
    el.remove();
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    el.setAttribute('theme', 'light');
    document.body.appendChild(el);

    const style = el.shadowRoot!.querySelector('style');
    expect(style).toBeTruthy();
    // Light theme uses #ffffff as background
    expect(style!.textContent).toContain('#ffffff');
    // Light theme should use #f5f5f7 for panel backgrounds (not dark #16213e)
    expect(style!.textContent).toContain('#f5f5f7');
    expect(style!.textContent).not.toContain('#16213e');
  });

  // -----------------------------------------------------------------------
  // Position attribute
  // -----------------------------------------------------------------------

  it('defaults to bottom-right position', () => {
    const root = el.shadowRoot!.querySelector('#aether-widget-root');
    expect(root!.className).toBe('bottom-right');
  });

  it('supports bottom-left position', () => {
    el.remove();
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    el.setAttribute('position', 'bottom-left');
    document.body.appendChild(el);

    const root = el.shadowRoot!.querySelector('#aether-widget-root');
    expect(root!.className).toBe('bottom-left');
  });

  it('supports top-right position', () => {
    el.remove();
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    el.setAttribute('position', 'top-right');
    document.body.appendChild(el);

    const root = el.shadowRoot!.querySelector('#aether-widget-root');
    expect(root!.className).toBe('top-right');
  });

  it('supports top-left position', () => {
    el.remove();
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    el.setAttribute('position', 'top-left');
    document.body.appendChild(el);

    const root = el.shadowRoot!.querySelector('#aether-widget-root');
    expect(root!.className).toBe('top-left');
  });

  // -----------------------------------------------------------------------
  // Message rendering
  // -----------------------------------------------------------------------

  it('renders messages via internal addMessage', () => {
    // Access the private method via casting
    const instance = el as any;
    instance.addMessage('user', 'Hello world');

    const msgs = el.shadowRoot!.querySelectorAll('.aether-message');
    expect(msgs.length).toBe(1);
    expect(msgs[0].classList.contains('user')).toBe(true);
    expect(msgs[0].textContent).toBe('Hello world');
  });

  it('renders multiple messages in order', () => {
    const instance = el as any;
    instance.addMessage('user', 'First');
    instance.addMessage('agent', 'Second');
    instance.addMessage('system', 'Third');

    const msgs = el.shadowRoot!.querySelectorAll('.aether-message');
    expect(msgs.length).toBe(3);
    expect(msgs[0].textContent).toBe('First');
    expect(msgs[1].textContent).toBe('Second');
    expect(msgs[2].textContent).toBe('Third');
    expect(msgs[0].classList.contains('user')).toBe(true);
    expect(msgs[1].classList.contains('agent')).toBe(true);
    expect(msgs[2].classList.contains('system')).toBe(true);
  });

  it('escapes HTML in messages', () => {
    const instance = el as any;
    instance.addMessage('user', '<script>alert("xss")</script>');

    const msgs = el.shadowRoot!.querySelectorAll('.aether-message');
    expect(msgs[0].textContent).toBe('<script>alert("xss")</script>');
    expect(msgs[0].innerHTML).not.toContain('<script>');
  });

  // -----------------------------------------------------------------------
  // Input submission
  // -----------------------------------------------------------------------

  it('enter key triggers send (input is cleared)', () => {
    const input = el.shadowRoot!.querySelector('.aether-input-bar input') as HTMLInputElement;
    input.value = 'Test message';

    // Mock fetch to prevent actual network calls
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: { uid: 'test-uid', pid: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    // Input should be cleared after send
    expect(input.value).toBe('');

    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // API mock: spawnAgent and sendMessage
  // -----------------------------------------------------------------------

  it('spawns agent on first message when no agentUid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ data: { uid: 'agent-123', pid: 42 } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = el as any;
    instance.input.value = 'Hello agent';
    await instance.handleSend();

    // Should have called fetch to spawn agent
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4600/api/v1/agents',
      expect.objectContaining({ method: 'POST' }),
    );

    expect(instance.agentUid).toBe('agent-123');

    vi.unstubAllGlobals();
  });

  it('sends message to existing agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const instance = el as any;
    instance.agentUid = 'existing-agent';
    instance.input.value = 'Follow up message';
    await instance.handleSend();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4600/api/v1/agents/existing-agent/message',
      expect.objectContaining({ method: 'POST' }),
    );

    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Expanded attribute
  // -----------------------------------------------------------------------

  it('auto-expands when expanded="true"', () => {
    el.remove();
    el = document.createElement('aether-agent') as AetherAgentElement;
    el.setAttribute('server', 'http://localhost:4600');
    el.setAttribute('expanded', 'true');
    document.body.appendChild(el);

    const fab = el.shadowRoot!.querySelector('.aether-fab') as HTMLButtonElement;
    const panel = el.shadowRoot!.querySelector('.aether-panel') as HTMLDivElement;

    expect(fab.style.display).toBe('none');
    expect(panel.style.display).toBe('flex');
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  it('cleans up on disconnect', () => {
    const instance = el as any;
    const mockUnsubscribe = vi.fn();
    instance.unsubscribe = mockUnsubscribe;
    instance.pollTimer = setInterval(() => {}, 10000);

    el.remove();

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(instance.pollTimer).toBeNull();
  });
});
