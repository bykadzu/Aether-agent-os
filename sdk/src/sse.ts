/**
 * Aether SDK - Server-Sent Events Client
 *
 * Uses native fetch with ReadableStream to parse SSE.
 * No EventSource dependency required.
 */

export interface AetherEvent {
  type: string;
  [key: string]: any;
}

export async function* subscribeEvents(
  baseUrl: string,
  token: string | null,
  filter?: string[],
): AsyncGenerator<AetherEvent, void, unknown> {
  const url = new URL('/api/v1/events', baseUrl);
  if (filter?.length) url.searchParams.set('filter', filter.join(','));

  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) throw new Error(`SSE connection failed: ${res.status}`);
  if (!res.body) throw new Error('No response body for SSE');

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
            yield JSON.parse(currentData);
          } catch {
            /* skip malformed */
          }
          currentData = '';
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
