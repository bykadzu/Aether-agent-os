/**
 * Aether Embed - API Client
 *
 * Minimal self-contained API client for the embed widget.
 * Communicates with the Aether OS REST API v1.
 */

export class EmbedApi {
  private server: string;
  private token?: string;

  constructor(server: string, token?: string) {
    this.server = server.replace(/\/$/, '');
    this.token = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) h['Authorization'] = `Bearer ${this.token}`;
    return h;
  }

  async spawnAgent(config: {
    role?: string;
    goal: string;
    template?: string;
  }): Promise<{ uid: string; pid: number }> {
    const res = await fetch(`${this.server}/api/v1/agents`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        role: config.role || 'assistant',
        goal: config.goal,
      }),
    });
    const json = await res.json();
    return json.data || json;
  }

  async sendMessage(uid: string, content: string): Promise<void> {
    await fetch(`${this.server}/api/v1/agents/${uid}/message`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content }),
    });
  }

  async getTimeline(uid: string, since?: number): Promise<any[]> {
    const params = new URLSearchParams();
    if (since) params.set('offset', String(since));
    const res = await fetch(`${this.server}/api/v1/agents/${uid}/timeline?${params}`, {
      headers: this.headers(),
    });
    const json = await res.json();
    return json.data || json || [];
  }

  subscribeEvents(uid: string, onEvent: (e: any) => void): () => void {
    const url = `${this.server}/api/v1/events?filter=agent.*`;
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();

    fetch(url, { headers, signal: controller.signal })
      .then(async (res) => {
        if (!res.body) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            let currentData = '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                currentData += line.slice(6);
              } else if (line === '' && currentData) {
                try {
                  onEvent(JSON.parse(currentData));
                } catch {
                  /* skip */
                }
                currentData = '';
              }
            }
          }
        } catch {
          /* aborted or closed */
        }
      })
      .catch(() => {
        /* aborted */
      });

    return () => controller.abort();
  }
}
