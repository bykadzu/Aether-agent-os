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
      expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('receives multiple emitted events', () => {
      const handler = vi.fn();
      bus.on('test.event', handler);
      bus.emit('test.event', 'first');
      bus.emit('test.event', 'second');

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenNthCalledWith(1, 'first');
      expect(handler).toHaveBeenNthCalledWith(2, 'second');
    });

    it('does not receive events from other channels', () => {
      const handler = vi.fn();
      bus.on('channel.a', handler);
      bus.emit('channel.b', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on same event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test.event', handler1);
      bus.on('test.event', handler2);
      bus.emit('test.event', 'data');

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });
  });

  describe('once()', () => {
    it('fires only once', () => {
      const handler = vi.fn();
      bus.once('test.once', handler);
      bus.emit('test.once', 'first');
      bus.emit('test.once', 'second');

      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith('first');
    });
  });

  describe('off()', () => {
    it('unsubscribes via returned function', () => {
      const handler = vi.fn();
      const unsub = bus.on('test.event', handler);
      unsub();
      bus.emit('test.event', 'data');

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes all listeners for a specific event', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('test.event', handler1);
      bus.on('test.event', handler2);
      bus.off('test.event');
      bus.emit('test.event', 'data');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });

    it('removes all listeners when called without args', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      bus.on('event.a', handler1);
      bus.on('event.b', handler2);
      bus.off();
      bus.emit('event.a', 'data');
      bus.emit('event.b', 'data');

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('wildcard (*)', () => {
    it('receives all events', () => {
      const handler = vi.fn();
      bus.on('*', handler);
      bus.emit('event.a', 'data-a');
      bus.emit('event.b', 'data-b');

      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith({ event: 'event.a', data: 'data-a' });
      expect(handler).toHaveBeenCalledWith({ event: 'event.b', data: 'data-b' });
    });
  });

  describe('wait()', () => {
    it('resolves when event is emitted', async () => {
      const promise = bus.wait('test.resolve');
      setTimeout(() => bus.emit('test.resolve', { value: 'resolved' }), 10);
      const result = await promise;
      expect(result).toEqual({ value: 'resolved' });
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

      expect(() => bus.emit('test.event', 'data')).not.toThrow();
      expect(goodHandler).toHaveBeenCalled();
    });
  });
});
