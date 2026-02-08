/**
 * Aether Embed - Web Component
 *
 * Custom element <aether-agent> that provides an embeddable
 * chat interface for Aether OS agents.
 *
 * Usage:
 *   <aether-agent server="https://aether.example.com" theme="dark" position="bottom-right" />
 */

import { EmbedApi } from './api.js';
import { getStyles } from './styles.js';

interface ChatMessage {
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
}

export class AetherAgentElement extends HTMLElement {
  private shadow: ShadowRoot;
  private api: EmbedApi | null = null;
  private agentUid: string | null = null;
  private expanded = false;
  private messages: ChatMessage[] = [];
  private unsubscribe: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastTimelineLength = 0;

  // DOM references
  private root!: HTMLDivElement;
  private fab!: HTMLButtonElement;
  private panel!: HTMLDivElement;
  private messagesContainer!: HTMLDivElement;
  private input!: HTMLInputElement;

  static get observedAttributes(): string[] {
    return ['server', 'token', 'template', 'goal', 'theme', 'position', 'expanded'];
  }

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
    this.attachEvents();

    const server = this.getAttribute('server');
    if (server) {
      this.api = new EmbedApi(server, this.getAttribute('token') || undefined);
    }

    if (this.getAttribute('expanded') === 'true') {
      this.togglePanel(true);
    }
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
    if (name === 'theme' || name === 'position') {
      this.updateStyles();
    }
    if (name === 'server' && newVal) {
      this.api = new EmbedApi(newVal, this.getAttribute('token') || undefined);
    }
  }

  private render(): void {
    const theme = (this.getAttribute('theme') as 'dark' | 'light') || 'dark';
    const position = this.getAttribute('position') || 'bottom-right';

    this.shadow.innerHTML = `
      <style>${getStyles(theme)}</style>
      <div id="aether-widget-root" class="${position}">
        <button class="aether-fab" aria-label="Open Aether Agent">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </button>
        <div class="aether-panel" style="display:none;">
          <div class="aether-header">
            <span>Aether Agent</span>
            <button class="minimize" aria-label="Minimize">&times;</button>
          </div>
          <div class="aether-messages"></div>
          <div class="aether-input-bar">
            <input type="text" placeholder="Type a message..." />
            <button class="send" aria-label="Send">&rarr;</button>
          </div>
        </div>
      </div>
    `;

    this.root = this.shadow.querySelector('#aether-widget-root')!;
    this.fab = this.shadow.querySelector('.aether-fab')!;
    this.panel = this.shadow.querySelector('.aether-panel')!;
    this.messagesContainer = this.shadow.querySelector('.aether-messages')!;
    this.input = this.shadow.querySelector('.aether-input-bar input')!;
  }

  private attachEvents(): void {
    this.fab.addEventListener('click', () => this.togglePanel(true));
    this.shadow
      .querySelector('.minimize')!
      .addEventListener('click', () => this.togglePanel(false));
    this.shadow.querySelector('.send')!.addEventListener('click', () => this.handleSend());
    this.input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  private togglePanel(show: boolean): void {
    this.expanded = show;
    this.fab.style.display = show ? 'none' : 'flex';
    this.panel.style.display = show ? 'flex' : 'none';

    if (show) {
      this.input.focus();
      this.maybeAutoSpawn();
    }
  }

  private async maybeAutoSpawn(): Promise<void> {
    if (this.agentUid || !this.api) return;

    const template = this.getAttribute('template');
    const goal = this.getAttribute('goal');

    if (goal) {
      this.addMessage('system', 'Connecting to Aether OS...');
      try {
        const result = await this.api.spawnAgent({
          role: template || 'assistant',
          goal,
          template: template || undefined,
        });
        this.agentUid = result.uid;
        this.addMessage('system', 'Agent connected. You can start chatting.');
        this.startPolling();
      } catch (err: any) {
        this.addMessage('system', `Failed to connect: ${err.message}`);
      }
    }
  }

  private async handleSend(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || !this.api) return;

    this.input.value = '';
    this.addMessage('user', text);

    if (!this.agentUid) {
      // Auto-spawn on first message
      try {
        this.addMessage('system', 'Starting agent...');
        const result = await this.api.spawnAgent({
          role: this.getAttribute('template') || 'assistant',
          goal: text,
        });
        this.agentUid = result.uid;
        this.startPolling();
      } catch (err: any) {
        this.addMessage('system', `Error: ${err.message}`);
        return;
      }
    }

    try {
      await this.api.sendMessage(this.agentUid, text);
    } catch (err: any) {
      this.addMessage('system', `Send failed: ${err.message}`);
    }
  }

  private addMessage(role: ChatMessage['role'], content: string): void {
    this.messages.push({ role, content, timestamp: Date.now() });
    this.renderMessages();
  }

  private renderMessages(): void {
    this.messagesContainer.innerHTML = this.messages
      .map((m) => `<div class="aether-message ${m.role}">${this.escapeHtml(m.content)}</div>`)
      .join('');
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.pollTimeline(), 2000);
  }

  private async pollTimeline(): Promise<void> {
    if (!this.agentUid || !this.api) return;
    try {
      const entries = await this.api.getTimeline(this.agentUid);
      if (entries.length > this.lastTimelineLength) {
        const newEntries = entries.slice(this.lastTimelineLength);
        for (const entry of newEntries) {
          if (entry.type === 'thought' || entry.type === 'agent.thought') {
            this.addMessage('agent', entry.content || entry.thought || JSON.stringify(entry));
          } else if (entry.type === 'observation' || entry.type === 'agent.observation') {
            this.addMessage('agent', entry.content || entry.observation || JSON.stringify(entry));
          } else if (entry.type === 'action' || entry.type === 'agent.action') {
            this.addMessage(
              'agent',
              `[Action] ${entry.tool || entry.action || ''}: ${entry.content || ''}`,
            );
          }
        }
        this.lastTimelineLength = entries.length;
      }
    } catch {
      /* poll error - ignore */
    }
  }

  private updateStyles(): void {
    const theme = (this.getAttribute('theme') as 'dark' | 'light') || 'dark';
    const position = this.getAttribute('position') || 'bottom-right';
    const styleEl = this.shadow.querySelector('style');
    if (styleEl) styleEl.textContent = getStyles(theme);
    if (this.root) {
      this.root.className = position;
    }
  }

  private cleanup(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
