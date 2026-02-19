import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  sendEventImmediate,
  bufferEvent,
  flushBuffer,
  initBuffer,
  destroyBuffer,
  getBufferMap,
  CRITICAL_EVENT_TYPES,
  WS_MAX_BUFFER_BYTES,
  WS_MAX_QUEUED_EVENTS,
  type KernelEvent,
  type EventBuffer,
} from '../ws-buffer.js';

/** Create a mock WebSocket with controllable bufferedAmount. */
function createMockWs(opts: { bufferedAmount?: number; readyState?: number } = {}): WebSocket {
  const ws = {
    readyState: opts.readyState ?? WebSocket.OPEN,
    bufferedAmount: opts.bufferedAmount ?? 0,
    send: vi.fn(),
  } as unknown as WebSocket;
  return ws;
}

describe('ws-buffer', () => {
  afterEach(() => {
    // Clean up any leftover buffers
    const map = getBufferMap();
    for (const [ws] of map) {
      destroyBuffer(ws);
    }
  });

  describe('sendEventImmediate', () => {
    it('sends event when connection is open and not congested', () => {
      const ws = createMockWs();
      const event: KernelEvent = { type: 'agent.thought', data: 'hello' };
      sendEventImmediate(ws, event);
      expect(ws.send).toHaveBeenCalledOnce();
      expect(JSON.parse((ws.send as any).mock.calls[0][0])).toEqual(event);
    });

    it('drops non-critical events under backpressure', () => {
      const ws = createMockWs({ bufferedAmount: WS_MAX_BUFFER_BYTES + 1 });
      sendEventImmediate(ws, { type: 'agent.thought' });
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('sends critical events even under backpressure', () => {
      const ws = createMockWs({ bufferedAmount: WS_MAX_BUFFER_BYTES + 1 });
      for (const type of CRITICAL_EVENT_TYPES) {
        sendEventImmediate(ws, { type });
      }
      expect(ws.send).toHaveBeenCalledTimes(CRITICAL_EVENT_TYPES.size);
    });

    it('does nothing when connection is not open', () => {
      const ws = createMockWs({ readyState: WebSocket.CLOSED });
      sendEventImmediate(ws, { type: 'response.ok' });
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('bufferEvent', () => {
    it('buffers events until flush', () => {
      const ws = createMockWs();
      // Use fake timers to prevent the flush interval from firing
      vi.useFakeTimers();
      initBuffer(ws);

      bufferEvent(ws, { type: 'agent.thought' });
      bufferEvent(ws, { type: 'agent.action' });
      expect(ws.send).not.toHaveBeenCalled();

      const buf = getBufferMap().get(ws)!;
      expect(buf.events).toHaveLength(2);

      vi.useRealTimers();
      destroyBuffer(ws);
    });

    it('drops oldest non-critical when buffer is full', () => {
      const ws = createMockWs();
      vi.useFakeTimers();
      initBuffer(ws);

      const buf = getBufferMap().get(ws)!;

      // Fill buffer to capacity with non-critical events
      for (let i = 0; i < WS_MAX_QUEUED_EVENTS; i++) {
        buf.events.push({ type: 'agent.thought', idx: i });
      }

      expect(buf.events).toHaveLength(WS_MAX_QUEUED_EVENTS);

      // bufferEvent will: 1) drop oldest non-critical (idx=0), 2) push new event,
      // 3) since length >= BATCH_MAX_SIZE, flush (send) the buffer.
      bufferEvent(ws, { type: 'agent.action', idx: 'new' });

      // The buffer was flushed, so check what was sent to ws.send
      expect(ws.send).toHaveBeenCalled();
      const lastCall = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1];
      const sentEvents = JSON.parse(lastCall[0]);

      // The oldest non-critical (idx=0) should have been dropped before flush
      expect(sentEvents.some((e: any) => e.idx === 0)).toBe(false);
      // The new event should be included
      expect(sentEvents.some((e: any) => e.idx === 'new')).toBe(true);

      vi.useRealTimers();
      destroyBuffer(ws);
    });
  });

  describe('flushBuffer', () => {
    it('sends all events as a JSON array', () => {
      const ws = createMockWs();
      const events: KernelEvent[] = [{ type: 'a' }, { type: 'b' }];
      const buf: EventBuffer = { events: [...events], flushTimer: 0 as any };

      flushBuffer(ws, buf);

      expect(ws.send).toHaveBeenCalledOnce();
      expect(JSON.parse((ws.send as any).mock.calls[0][0])).toEqual(events);
      expect(buf.events).toHaveLength(0);
    });

    it('under backpressure, sends only critical events', () => {
      const ws = createMockWs({ bufferedAmount: WS_MAX_BUFFER_BYTES + 1 });
      const buf: EventBuffer = {
        events: [
          { type: 'agent.thought' },
          { type: 'response.ok' },
          { type: 'agent.action' },
          { type: 'response.error' },
        ],
        flushTimer: 0 as any,
      };

      flushBuffer(ws, buf);

      expect(ws.send).toHaveBeenCalledOnce();
      const sent = JSON.parse((ws.send as any).mock.calls[0][0]);
      expect(sent).toHaveLength(2);
      expect(sent.map((e: any) => e.type)).toEqual(['response.ok', 'response.error']);
      expect(buf.events).toHaveLength(0);
    });

    it('under backpressure with no critical events, sends nothing', () => {
      const ws = createMockWs({ bufferedAmount: WS_MAX_BUFFER_BYTES + 1 });
      const buf: EventBuffer = {
        events: [{ type: 'agent.thought' }, { type: 'agent.action' }],
        flushTimer: 0 as any,
      };

      flushBuffer(ws, buf);

      expect(ws.send).not.toHaveBeenCalled();
      expect(buf.events).toHaveLength(0);
    });

    it('does nothing with empty buffer', () => {
      const ws = createMockWs();
      const buf: EventBuffer = { events: [], flushTimer: 0 as any };
      flushBuffer(ws, buf);
      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('CRITICAL_EVENT_TYPES', () => {
    it('includes the expected types', () => {
      expect(CRITICAL_EVENT_TYPES.has('response.ok')).toBe(true);
      expect(CRITICAL_EVENT_TYPES.has('response.error')).toBe(true);
      expect(CRITICAL_EVENT_TYPES.has('kernel.ready')).toBe(true);
      expect(CRITICAL_EVENT_TYPES.has('process.list')).toBe(true);
    });

    it('does not include non-critical types', () => {
      expect(CRITICAL_EVENT_TYPES.has('agent.thought')).toBe(false);
      expect(CRITICAL_EVENT_TYPES.has('agent.action')).toBe(false);
    });
  });

  describe('initBuffer / destroyBuffer', () => {
    it('initializes and cleans up buffer for a connection', () => {
      vi.useFakeTimers();
      const ws = createMockWs();

      initBuffer(ws);
      expect(getBufferMap().has(ws)).toBe(true);

      destroyBuffer(ws);
      expect(getBufferMap().has(ws)).toBe(false);

      vi.useRealTimers();
    });
  });
});
