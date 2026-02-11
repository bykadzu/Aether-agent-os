import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { ResourceGovernor } from '../ResourceGovernor.js';

// Minimal mock for ProcessManager — only need signal()
function createMockProcessManager() {
  return {
    signal: vi.fn().mockReturnValue(true),
  } as any;
}

describe('ResourceGovernor', () => {
  let bus: EventBus;
  let pm: ReturnType<typeof createMockProcessManager>;
  let gov: ResourceGovernor;

  beforeEach(() => {
    bus = new EventBus();
    pm = createMockProcessManager();
    gov = new ResourceGovernor(bus, pm);
  });

  // ---------------------------------------------------------------------------
  // Token recording and accumulation
  // ---------------------------------------------------------------------------

  describe('recordTokenUsage', () => {
    it('records and accumulates token usage for a process', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      gov.recordTokenUsage(1, 2000, 1000, 'gemini');

      const usage = gov.getUsage(1);
      expect(usage).not.toBeNull();
      expect(usage!.totalInputTokens).toBe(3000);
      expect(usage!.totalOutputTokens).toBe(1500);
      expect(usage!.totalSteps).toBe(2);
      expect(usage!.provider).toBe('gemini');
    });

    it('tracks separate usage per process', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      gov.recordTokenUsage(2, 3000, 1500, 'claude');

      const usage1 = gov.getUsage(1);
      const usage2 = gov.getUsage(2);
      expect(usage1!.totalInputTokens).toBe(1000);
      expect(usage2!.totalInputTokens).toBe(3000);
      expect(usage2!.provider).toBe('claude');
    });

    it('emits resource.usage event on each recording', () => {
      const events: any[] = [];
      bus.on('resource.usage', (data: any) => events.push(data));

      gov.recordTokenUsage(1, 1000, 500, 'gemini');

      expect(events).toHaveLength(1);
      expect(events[0].pid).toBe(1);
      expect(events[0].usage.totalInputTokens).toBe(1000);
    });

    it('initializes startedAt timestamp on first recording', () => {
      const before = Date.now();
      gov.recordTokenUsage(1, 100, 50, 'gemini');
      const after = Date.now();

      const usage = gov.getUsage(1);
      expect(usage!.startedAt).toBeGreaterThanOrEqual(before);
      expect(usage!.startedAt).toBeLessThanOrEqual(after);
    });
  });

  // ---------------------------------------------------------------------------
  // Quota checking (allowed vs exceeded)
  // ---------------------------------------------------------------------------

  describe('checkQuota', () => {
    it('returns allowed for process with no usage', () => {
      const result = gov.checkQuota(99);
      expect(result.allowed).toBe(true);
    });

    it('returns allowed for process within quota', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      const result = gov.checkQuota(1);
      expect(result.allowed).toBe(true);
    });

    it('returns not allowed when session token limit exceeded', () => {
      // Set a small quota
      gov.setQuota(1, { maxTokensPerSession: 5000 });

      // Record usage that exceeds the limit
      gov.recordTokenUsage(1, 3000, 3000, 'gemini'); // 6000 total > 5000

      // After auto-check in recordTokenUsage, the process should be killed
      expect(pm.signal).toHaveBeenCalledWith(1, 'SIGTERM');

      // Manual check should also reflect exceeded
      const result = gov.checkQuota(1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Session token limit exceeded');
    });

    it('returns not allowed when step limit exceeded', () => {
      gov.setQuota(1, { maxSteps: 3 });

      // Record 4 steps (each recordTokenUsage call = 1 step)
      gov.recordTokenUsage(1, 100, 50, 'gemini');
      gov.recordTokenUsage(1, 100, 50, 'gemini');
      gov.recordTokenUsage(1, 100, 50, 'gemini');
      gov.recordTokenUsage(1, 100, 50, 'gemini');

      const result = gov.checkQuota(1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Step limit exceeded');
    });

    it('returns not allowed when wall clock limit exceeded', () => {
      gov.setQuota(1, { maxWallClockMs: 100 });

      // Record initial usage
      gov.recordTokenUsage(1, 100, 50, 'gemini');

      // Manually set startedAt to the past to simulate elapsed time
      const usage = gov.getUsage(1)!;
      // Access internal map to set startedAt
      (gov as any).usageMap.get(1).startedAt = Date.now() - 200;

      const result = gov.checkQuota(1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Wall clock limit exceeded');
    });

    it('returns usage in the result', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      const result = gov.checkQuota(1);
      expect(result.usage.totalInputTokens).toBe(1000);
      expect(result.usage.totalOutputTokens).toBe(500);
    });
  });

  // ---------------------------------------------------------------------------
  // Runaway detection
  // ---------------------------------------------------------------------------

  describe('isRunaway', () => {
    it('returns false for process with no usage', () => {
      expect(gov.isRunaway(99)).toBe(false);
    });

    it('returns false for process within quota', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      expect(gov.isRunaway(1)).toBe(false);
    });

    it('returns true when token usage exceeds quota by >20%', () => {
      gov.setQuota(1, { maxTokensPerSession: 1000 });

      // 1300 tokens > 1000 * 1.2 = 1200, so runaway
      // Need to bypass auto-kill for this test
      (gov as any).usageMap.set(1, {
        pid: 1,
        totalInputTokens: 800,
        totalOutputTokens: 500,
        totalSteps: 1,
        startedAt: Date.now(),
        estimatedCostUSD: 0,
        provider: 'gemini',
      });

      expect(gov.isRunaway(1)).toBe(true);
    });

    it('returns false when usage exceeds quota by <20%', () => {
      gov.setQuota(1, { maxTokensPerSession: 1000 });

      // 1100 tokens > 1000 but < 1200, so not runaway
      (gov as any).usageMap.set(1, {
        pid: 1,
        totalInputTokens: 600,
        totalOutputTokens: 500,
        totalSteps: 1,
        startedAt: Date.now(),
        estimatedCostUSD: 0,
        provider: 'gemini',
      });

      expect(gov.isRunaway(1)).toBe(false);
    });

    it('returns true when steps exceed quota by >20%', () => {
      gov.setQuota(1, { maxSteps: 10 });

      (gov as any).usageMap.set(1, {
        pid: 1,
        totalInputTokens: 100,
        totalOutputTokens: 50,
        totalSteps: 13, // 13 > 10 * 1.2 = 12
        startedAt: Date.now(),
        estimatedCostUSD: 0,
        provider: 'gemini',
      });

      expect(gov.isRunaway(1)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Cost estimation accuracy
  // ---------------------------------------------------------------------------

  describe('estimateCost', () => {
    it('estimates cost for Gemini Flash correctly', () => {
      const cost = gov.estimateCost(1_000_000, 1_000_000, 'gemini-flash');
      // $0.075/M input + $0.3/M output = $0.375
      expect(cost).toBeCloseTo(0.375, 2);
    });

    it('estimates cost for Claude Opus correctly', () => {
      const cost = gov.estimateCost(1_000_000, 1_000_000, 'claude-opus');
      // $15/M input + $75/M output = $90
      expect(cost).toBeCloseTo(90, 0);
    });

    it('estimates cost for GPT-5 correctly', () => {
      const cost = gov.estimateCost(1_000_000, 1_000_000, 'gpt-5');
      // $5/M input + $15/M output = $20
      expect(cost).toBeCloseTo(20, 0);
    });

    it('uses default rate for unknown provider', () => {
      const cost = gov.estimateCost(1_000_000, 1_000_000, 'unknown-provider');
      // Default: $1/M input + $3/M output = $4
      expect(cost).toBeCloseTo(4, 0);
    });

    it('updates estimated cost in usage record', () => {
      gov.recordTokenUsage(1, 1_000_000, 0, 'gemini-flash');
      const usage = gov.getUsage(1);
      // $0.075 for 1M input tokens
      expect(usage!.estimatedCostUSD).toBeCloseTo(0.075, 3);
    });
  });

  // ---------------------------------------------------------------------------
  // Event emission on quota exceeded
  // ---------------------------------------------------------------------------

  describe('quota exceeded events', () => {
    it('emits resource.exceeded event when quota is exceeded', () => {
      const events: any[] = [];
      bus.on('resource.exceeded', (data: any) => events.push(data));

      gov.setQuota(1, { maxTokensPerSession: 1000 });
      gov.recordTokenUsage(1, 800, 400, 'gemini'); // 1200 > 1000

      expect(events).toHaveLength(1);
      expect(events[0].pid).toBe(1);
      expect(events[0].reason).toContain('Session token limit exceeded');
      expect(events[0].usage.totalInputTokens).toBe(800);
    });

    it('calls ProcessManager.signal(SIGTERM) on exceeded quota', () => {
      gov.setQuota(1, { maxTokensPerSession: 1000 });
      gov.recordTokenUsage(1, 800, 400, 'gemini');

      expect(pm.signal).toHaveBeenCalledWith(1, 'SIGTERM');
    });

    it('does not emit exceeded event when within quota', () => {
      const events: any[] = [];
      bus.on('resource.exceeded', (data: any) => events.push(data));

      gov.recordTokenUsage(1, 100, 50, 'gemini');

      expect(events).toHaveLength(0);
      expect(pm.signal).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Quota management
  // ---------------------------------------------------------------------------

  describe('quota management', () => {
    it('returns default quota for unknown process', () => {
      const quota = gov.getQuota(99);
      expect(quota.maxTokensPerSession).toBe(500_000);
      expect(quota.maxTokensPerDay).toBe(2_000_000);
      expect(quota.maxSteps).toBe(200);
      expect(quota.maxWallClockMs).toBe(3_600_000);
    });

    it('allows setting partial quota overrides', () => {
      gov.setQuota(1, { maxSteps: 50 });
      const quota = gov.getQuota(1);
      expect(quota.maxSteps).toBe(50);
      // Other fields remain defaults
      expect(quota.maxTokensPerSession).toBe(500_000);
    });

    it('allows overriding all quota fields', () => {
      gov.setQuota(1, {
        maxTokensPerSession: 100,
        maxTokensPerDay: 200,
        maxSteps: 5,
        maxWallClockMs: 10000,
      });
      const quota = gov.getQuota(1);
      expect(quota.maxTokensPerSession).toBe(100);
      expect(quota.maxTokensPerDay).toBe(200);
      expect(quota.maxSteps).toBe(5);
      expect(quota.maxWallClockMs).toBe(10000);
    });
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  describe('getSummary', () => {
    it('returns empty array when no usage tracked', () => {
      expect(gov.getSummary()).toEqual([]);
    });

    it('returns all tracked agent usage', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      gov.recordTokenUsage(2, 2000, 1000, 'claude');

      const summary = gov.getSummary();
      expect(summary).toHaveLength(2);
      expect(summary.find((u) => u.pid === 1)!.totalInputTokens).toBe(1000);
      expect(summary.find((u) => u.pid === 2)!.totalInputTokens).toBe(2000);
    });
  });

  // ---------------------------------------------------------------------------
  // Cleanup and shutdown
  // ---------------------------------------------------------------------------

  describe('cleanup', () => {
    it('removes all data for a process', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      gov.setQuota(1, { maxSteps: 50 });

      gov.cleanup(1);

      expect(gov.getUsage(1)).toBeNull();
      // Quota should revert to default
      const quota = gov.getQuota(1);
      expect(quota.maxSteps).toBe(200);
    });
  });

  describe('shutdown', () => {
    it('clears all tracking state', () => {
      gov.recordTokenUsage(1, 1000, 500, 'gemini');
      gov.recordTokenUsage(2, 2000, 1000, 'claude');

      gov.shutdown();

      expect(gov.getSummary()).toEqual([]);
      expect(gov.getUsage(1)).toBeNull();
      expect(gov.getUsage(2)).toBeNull();
    });
  });
});
