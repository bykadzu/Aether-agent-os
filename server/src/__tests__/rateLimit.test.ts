import { describe, it, expect, beforeEach, vi } from 'vitest';

// We need to test checkRateLimit which is exported from the server index.
// Since the server index has side effects (boots kernel, starts server),
// we extract the rate limit logic for testing by re-implementing the
// same algorithm here, or we can test via integration. Let's test the
// algorithm directly by importing from a focused test.

// Re-implement the sliding window algorithm for isolated unit testing
// (mirrors the implementation in server/src/index.ts)

interface RateLimitEntry {
  timestamps: number[];
}

function createRateLimiter() {
  const store = new Map<string, RateLimitEntry>();

  function checkRateLimit(
    key: string,
    maxRequests: number,
  ): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const windowMs = 60_000;
    const cutoff = now - windowMs;

    let entry = store.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      store.set(key, entry);
    }

    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

    if (entry.timestamps.length >= maxRequests) {
      const oldestInWindow = entry.timestamps[0];
      const retryAfterMs = oldestInWindow + windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(1000, retryAfterMs) };
    }

    entry.timestamps.push(now);
    return { allowed: true };
  }

  function cleanup() {
    const cutoff = Date.now() - 60_000;
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) {
        store.delete(key);
      }
    }
  }

  return { checkRateLimit, cleanup, store };
}

describe('Rate Limiting - Sliding Window', () => {
  let limiter: ReturnType<typeof createRateLimiter>;

  beforeEach(() => {
    limiter = createRateLimiter();
    vi.useFakeTimers();
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 5; i++) {
      const result = limiter.checkRateLimit('user:alice', 10);
      expect(result.allowed).toBe(true);
    }
  });

  it('blocks requests at the limit', () => {
    const limit = 3;
    for (let i = 0; i < limit; i++) {
      const result = limiter.checkRateLimit('user:bob', limit);
      expect(result.allowed).toBe(true);
    }

    const blocked = limiter.checkRateLimit('user:bob', limit);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('allows requests again after the window expires', () => {
    const limit = 2;
    // Fill up the limit
    limiter.checkRateLimit('user:carol', limit);
    limiter.checkRateLimit('user:carol', limit);

    // Should be blocked
    expect(limiter.checkRateLimit('user:carol', limit).allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    expect(limiter.checkRateLimit('user:carol', limit).allowed).toBe(true);
  });

  it('isolates different keys', () => {
    const limit = 1;
    limiter.checkRateLimit('user:dave', limit);
    expect(limiter.checkRateLimit('user:dave', limit).allowed).toBe(false);

    // Different key should still be allowed
    expect(limiter.checkRateLimit('user:eve', limit).allowed).toBe(true);
  });

  it('returns retryAfterMs >= 1000', () => {
    const limit = 1;
    limiter.checkRateLimit('user:frank', limit);
    const result = limiter.checkRateLimit('user:frank', limit);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1000);
  });

  it('sliding window allows staggered requests', () => {
    const limit = 3;

    // Send 2 requests at t=0
    limiter.checkRateLimit('user:grace', limit);
    limiter.checkRateLimit('user:grace', limit);

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);

    // Send 1 more (should be allowed - total 3 in window)
    expect(limiter.checkRateLimit('user:grace', limit).allowed).toBe(true);

    // 4th should be blocked
    expect(limiter.checkRateLimit('user:grace', limit).allowed).toBe(false);

    // Advance 31 more seconds (first 2 requests now outside 60s window)
    vi.advanceTimersByTime(31_000);

    // Should be allowed again (only 1 request in last 60s window)
    expect(limiter.checkRateLimit('user:grace', limit).allowed).toBe(true);
  });

  it('cleanup removes stale entries', () => {
    limiter.checkRateLimit('user:stale', 10);
    expect(limiter.store.size).toBe(1);

    vi.advanceTimersByTime(61_000);
    limiter.cleanup();

    expect(limiter.store.size).toBe(0);
  });

  it('handles high-throughput without issues', () => {
    const limit = 120;
    let allowed = 0;
    let blocked = 0;

    for (let i = 0; i < 200; i++) {
      const result = limiter.checkRateLimit('user:heavy', limit);
      if (result.allowed) allowed++;
      else blocked++;
    }

    expect(allowed).toBe(120);
    expect(blocked).toBe(80);
  });
});
