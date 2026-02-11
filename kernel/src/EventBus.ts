/**
 * Aether Kernel - Event Bus
 *
 * Central nervous system of the kernel. All subsystems communicate through
 * typed events on this bus. Inspired by the Linux kernel's netlink and
 * kobject uevent systems.
 *
 * This is intentionally simple - a typed EventEmitter pattern. No external
 * dependencies. The kernel should be self-contained.
 */

import { createEventId } from '@aether/shared';

type Listener<T = any> = (data: T) => void;

const DEDUP_MAX_PER_TYPE = 500;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private onceListeners = new Map<string, Set<Listener>>();
  private seenEventIds = new Map<string, Set<string>>();

  /**
   * Subscribe to an event type.
   * Returns an unsubscribe function.
   */
  on<T = any>(event: string, listener: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);

    return () => {
      this.listeners.get(event)?.delete(listener);
    };
  }

  /**
   * Subscribe to an event type, but only fire once.
   */
  once<T = any>(event: string, listener: Listener<T>): () => void {
    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, new Set());
    }
    this.onceListeners.get(event)!.add(listener);

    return () => {
      this.onceListeners.get(event)?.delete(listener);
    };
  }

  /**
   * Check if an event ID has already been seen (for external dedup use).
   */
  isDuplicate(eventType: string, eventId: string): boolean {
    const seen = this.seenEventIds.get(eventType);
    return seen ? seen.has(eventId) : false;
  }

  /**
   * Emit an event to all subscribers.
   */
  emit<T = any>(event: string, data: T): void {
    // Stamp event ID for dedup if data is an object
    if (data && typeof data === 'object' && event !== '*') {
      const d = data as any;
      if (!d.__eventId) {
        d.__eventId = createEventId();
      }
      // Per-event-type dedup: skip if we've already processed this event ID for this type
      if (!this.seenEventIds.has(event)) {
        this.seenEventIds.set(event, new Set());
      }
      const seen = this.seenEventIds.get(event)!;
      if (seen.has(d.__eventId)) {
        return;
      }
      seen.add(d.__eventId);
      // Cap the dedup set size per event type
      if (seen.size > DEDUP_MAX_PER_TYPE) {
        const first = seen.values().next().value;
        if (first !== undefined) seen.delete(first);
      }
    }

    // Regular listeners
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[EventBus] Error in listener for '${event}':`, err);
        }
      }
    }

    // Once listeners
    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      for (const listener of onceListeners) {
        try {
          listener(data);
        } catch (err) {
          console.error(`[EventBus] Error in once-listener for '${event}':`, err);
        }
      }
      this.onceListeners.delete(event);
    }

    // Also emit on wildcard channel (direct dispatch, not recursive)
    if (event !== '*') {
      const wildcardData = { event, data };
      const wildcardListeners = this.listeners.get('*');
      if (wildcardListeners) {
        for (const listener of wildcardListeners) {
          try {
            listener(wildcardData);
          } catch (err) {
            console.error(`[EventBus] Error in wildcard listener for '${event}':`, err);
          }
        }
      }
      const wildcardOnce = this.onceListeners.get('*');
      if (wildcardOnce) {
        for (const listener of wildcardOnce) {
          try {
            listener(wildcardData);
          } catch (err) {
            console.error(`[EventBus] Error in wildcard once-listener for '${event}':`, err);
          }
        }
        this.onceListeners.delete('*');
      }
    }
  }

  /**
   * Remove all listeners for an event, or all listeners entirely.
   */
  off(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    } else {
      this.listeners.clear();
      this.onceListeners.clear();
    }
  }

  /**
   * Wait for an event to fire, returning the data as a Promise.
   */
  wait<T = any>(event: string, timeout?: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const unsub = this.once<T>(event, (data) => {
        if (timer) clearTimeout(timer);
        resolve(data);
      });

      let timer: ReturnType<typeof setTimeout> | undefined;
      if (timeout) {
        timer = setTimeout(() => {
          unsub();
          reject(new Error(`EventBus: timeout waiting for '${event}'`));
        }, timeout);
      }
    });
  }
}
