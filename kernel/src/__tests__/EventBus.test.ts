import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../EventBus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on() / emit()', () => {
    it('receives emitted events', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', { value: 42 });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ value: 42 }));
    });

    it('receives multiple distinct emitted events', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', { v: 'first' });
      bus.emit('test.event', { v: 'second' });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('does not receive events from other channels', () => {
      const handler = vi.fn();
      bus.on('channel.a', handler);
      bus.emit('channel.b', { data: true });

      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test.event', handler1);
      bus.on('test.event', handler2);
      bus.emit('test.event', { data: true });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe('once()', () => {
    it('fires only once', () => {
      const handler = vi.fn();
      bus.once('test.once', handler);
      bus.emit('test.once', { v: 'first' });
      bus.emit('test.once', { v: 'second' });

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ v: 'first' }));
    });
  });

  describe('off()', () => {
    it('unsubscribes via returned function', () => {
      const handler = vi.fn();
      const unsub = bus.on('test.event', handler);
      unsub();
      bus.emit('test.event', { data: true });

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes all listeners for a specific event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test.event', handler1);
      bus.on('test.event', handler2);
      bus.off('test.event');
      bus.emit('test.event', { data: true });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('removes all listeners when called without args', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('event.a', handler1);
      bus.on('event.b', handler2);
      bus.off();
      bus.emit('event.a', { data: true });
      bus.emit('event.b', { data: true });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('wildcard (*)', () => {
    it('receives all events', () => {
      const handler = vi.fn();
      bus.on('*', handler);
      bus.emit('event.a', { d: 'a' });
      bus.emit('event.b', { d: 'b' });

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'event.a' }));
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ event: 'event.b' }));
    });

    it('does not cause duplicate delivery via recursive emit', () => {
      const handler = vi.fn();
      const wildcardHandler = vi.fn();
      bus.on('test.event', handler);
      bus.on('*', wildcardHandler);
      bus.emit('test.event', { value: 1 });

      // Regular listener fires once
      expect(handler).toHaveBeenCalledOnce();
      // Wildcard listener fires once (no recursive re-emit)
      expect(wildcardHandler).toHaveBeenCalledOnce();
    });
  });

  describe('wait()', () => {
    it('resolves when event is emitted', async () => {
      const promise = bus.wait('test.resolve');
      setTimeout(() => bus.emit('test.resolve', { value: 'resolved' }), 10);
      const result = await promise;
      expect(result).toEqual(expect.objectContaining({ value: 'resolved' }));
    });

    it('rejects on timeout', async () => {
      await expect(bus.wait('test.timeout', 50)).rejects.toThrow(
        "EventBus: timeout waiting for 'test.timeout'",
      );
    });
  });

  describe('error handling', () => {
    it('does not propagate errors from listeners', () => {
      const errorHandler = () => {
        throw new Error('listener error');
      };
      const goodHandler = vi.fn();
      bus.on('test.event', errorHandler);
      bus.on('test.event', goodHandler);

      expect(() => bus.emit('test.event', { data: true })).not.toThrow();
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('event ID generation', () => {
    it('stamps __eventId on emitted object data', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', { value: 1 });

      const data = handler.mock.calls[0][0];
      expect(data.__eventId).toBeDefined();
      expect(typeof data.__eventId).toBe('string');
    });

    it('generates timestamp-prefixed UUIDs', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', { value: 1 });

      const eventId = handler.mock.calls[0][0].__eventId;
      // Format: <timestamp>-<uuid>
      const parts = eventId.split('-');
      // Timestamp is the first part, followed by 5 UUID segments
      expect(parts.length).toBe(6); // timestamp + 5 UUID parts
      expect(Number(parts[0])).toBeGreaterThan(0);
    });

    it('preserves pre-existing __eventId', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', { value: 1, __eventId: 'custom-id-123' });

      expect(handler.mock.calls[0][0].__eventId).toBe('custom-id-123');
    });
  });

  describe('duplicate suppression', () => {
    it('suppresses duplicate events with the same __eventId', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      const data = { value: 1, __eventId: 'dup-test-001' };

      bus.emit('test.event', data);
      bus.emit('test.event', data);
      bus.emit('test.event', data);

      expect(handler).toHaveBeenCalledOnce();
    });

    it('allows same __eventId on different event types', () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      bus.on('event.a', handlerA);
      bus.on('event.b', handlerB);

      bus.emit('event.a', { value: 1, __eventId: 'shared-id-001' });
      bus.emit('event.b', { value: 2, __eventId: 'shared-id-001' });

      expect(handlerA).toHaveBeenCalledOnce();
      expect(handlerB).toHaveBeenCalledOnce();
    });

    it('prunes oldest entries when per-type limit is exceeded', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);

      // Emit 501 unique events (limit is 500 per type)
      for (let i = 0; i < 501; i++) {
        bus.emit('test.event', { i, __eventId: `evt-${i}` });
      }
      expect(handler).toHaveBeenCalledTimes(501);

      // The first event ID should have been pruned, so re-emitting it should work
      handler.mockClear();
      bus.emit('test.event', { i: 0, __eventId: 'evt-0' });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('isDuplicate()', () => {
    it('returns false for unseen event IDs', () => {
      expect(bus.isDuplicate('test.event', 'unseen-id')).toBe(false);
    });

    it('returns true for previously emitted event IDs', () => {
      bus.emit('test.event', { value: 1, __eventId: 'seen-id' });
      expect(bus.isDuplicate('test.event', 'seen-id')).toBe(true);
    });

    it('is scoped per event type', () => {
      bus.emit('event.a', { value: 1, __eventId: 'scoped-id' });
      expect(bus.isDuplicate('event.a', 'scoped-id')).toBe(true);
      expect(bus.isDuplicate('event.b', 'scoped-id')).toBe(false);
    });
  });
});
