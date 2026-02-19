/**
 * Aether OS — WebSocket event buffer with backpressure
 *
 * Extracted from index.ts for testability. Provides per-client event
 * batching with backpressure awareness: when a client's TCP send buffer
 * is congested (high bufferedAmount), non-critical events are dropped
 * to keep the connection responsive for important messages.
 */

import { WebSocket } from 'ws';
import { WS_MAX_BUFFER_BYTES, WS_MAX_QUEUED_EVENTS } from '@aether/shared';

// Re-export constants for test convenience
export { WS_MAX_BUFFER_BYTES, WS_MAX_QUEUED_EVENTS };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KernelEvent {
  type: string;
  [key: string]: unknown;
}

export interface EventBuffer {
  events: KernelEvent[];
  flushTimer: ReturnType<typeof setInterval>;
}

// ---------------------------------------------------------------------------
// Critical events — never dropped under backpressure
// ---------------------------------------------------------------------------

export const CRITICAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'response.ok',
  'response.error',
  'kernel.ready',
  'process.list',
]);

function isCritical(event: KernelEvent): boolean {
  return CRITICAL_EVENT_TYPES.has(event.type);
}

// ---------------------------------------------------------------------------
// Backpressure-aware send
// ---------------------------------------------------------------------------

/** Send a single event immediately, respecting backpressure. */
export function sendEventImmediate(ws: WebSocket, event: KernelEvent): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  // Under backpressure — drop non-critical events
  if (ws.bufferedAmount > WS_MAX_BUFFER_BYTES && !isCritical(event)) {
    return;
  }

  ws.send(JSON.stringify(event), { compress: false });
}

// ---------------------------------------------------------------------------
// Batched buffer
// ---------------------------------------------------------------------------

export const BATCH_FLUSH_INTERVAL_MS = 50;
export const BATCH_MAX_SIZE = 20;

const eventBuffers = new Map<WebSocket, EventBuffer>();

/** Get the buffer map (exposed for testing). */
export function getBufferMap(): Map<WebSocket, EventBuffer> {
  return eventBuffers;
}

/** Add an event to a connection's buffer, flushing if full. */
export function bufferEvent(ws: WebSocket, event: KernelEvent): void {
  const buf = eventBuffers.get(ws);
  if (!buf) {
    sendEventImmediate(ws, event);
    return;
  }

  // Enforce queue cap — drop oldest non-critical when full
  if (buf.events.length >= WS_MAX_QUEUED_EVENTS) {
    const dropIdx = buf.events.findIndex((e) => !isCritical(e));
    if (dropIdx !== -1) {
      buf.events.splice(dropIdx, 1);
    } else {
      // All critical (unlikely) — drop oldest anyway to prevent unbounded growth
      buf.events.shift();
    }
  }

  buf.events.push(event);
  if (buf.events.length >= BATCH_MAX_SIZE) {
    flushBuffer(ws, buf);
  }
}

/** Flush all buffered events, respecting backpressure. */
export function flushBuffer(ws: WebSocket, buf: EventBuffer): void {
  if (buf.events.length === 0) return;
  if (ws.readyState !== WebSocket.OPEN) {
    buf.events = [];
    return;
  }

  // Under backpressure — keep only critical events from the batch
  if (ws.bufferedAmount > WS_MAX_BUFFER_BYTES) {
    const critical = buf.events.filter(isCritical);
    buf.events = [];
    if (critical.length > 0) {
      ws.send(JSON.stringify(critical), { compress: false });
    }
    return;
  }

  ws.send(JSON.stringify(buf.events), { compress: false });
  buf.events = [];
}

/** Initialize the event buffer for a new connection. */
export function initBuffer(ws: WebSocket): void {
  const buf: EventBuffer = {
    events: [],
    flushTimer: setInterval(() => {
      const b = eventBuffers.get(ws);
      if (b) flushBuffer(ws, b);
    }, BATCH_FLUSH_INTERVAL_MS),
  };
  eventBuffers.set(ws, buf);
}

/** Clean up the event buffer when a connection closes. */
export function destroyBuffer(ws: WebSocket): void {
  const buf = eventBuffers.get(ws);
  if (buf) {
    clearInterval(buf.flushTimer);
    eventBuffers.delete(ws);
  }
}
