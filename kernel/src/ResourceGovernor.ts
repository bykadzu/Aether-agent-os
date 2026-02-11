/**
 * Aether Kernel - Resource Governor
 *
 * Per-agent resource quota enforcement and runaway detection.
 * Tracks token usage, step counts, and wall-clock time per agent process.
 * When quotas are exceeded, emits events and kills the offending process.
 *
 * Cost estimation uses rough per-provider rates (USD per million tokens).
 */

import { EventBus } from './EventBus.js';
import { ProcessManager } from './ProcessManager.js';
import {
  AgentUsage,
  ResourceQuota,
  QuotaCheckResult,
  DEFAULT_MAX_TOKENS_PER_SESSION,
  DEFAULT_MAX_TOKENS_PER_DAY,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_WALL_CLOCK_MS,
} from '@aether/shared';

// Rough cost per million input tokens by provider family
const COST_PER_MILLION_INPUT: Record<string, number> = {
  gemini: 0.075,
  'gemini-flash': 0.075,
  'gemini-pro': 1.25,
  gpt: 5,
  'gpt-4': 5,
  'gpt-5': 5,
  claude: 15,
  'claude-opus': 15,
  'claude-sonnet': 3,
  'claude-haiku': 0.25,
};

// Rough cost per million output tokens (typically 3-5x input)
const COST_PER_MILLION_OUTPUT: Record<string, number> = {
  gemini: 0.3,
  'gemini-flash': 0.3,
  'gemini-pro': 5,
  gpt: 15,
  'gpt-4': 15,
  'gpt-5': 15,
  claude: 75,
  'claude-opus': 75,
  'claude-sonnet': 15,
  'claude-haiku': 1.25,
};

const RUNAWAY_THRESHOLD = 1.2; // 20% over quota = runaway

export class ResourceGovernor {
  private usageMap = new Map<number, AgentUsage>();
  private quotaMap = new Map<number, ResourceQuota>();
  private dailyTokens = new Map<number, number>(); // pid -> total tokens today

  private defaultQuota: ResourceQuota;

  constructor(
    private bus: EventBus,
    private processes: ProcessManager,
  ) {
    this.defaultQuota = {
      maxTokensPerSession:
        parseInt(process.env.AETHER_MAX_TOKENS_PER_SESSION || '', 10) ||
        DEFAULT_MAX_TOKENS_PER_SESSION,
      maxTokensPerDay:
        parseInt(process.env.AETHER_MAX_TOKENS_PER_DAY || '', 10) || DEFAULT_MAX_TOKENS_PER_DAY,
      maxSteps: parseInt(process.env.AETHER_MAX_STEPS || '', 10) || DEFAULT_MAX_STEPS,
      maxWallClockMs:
        parseInt(process.env.AETHER_MAX_WALL_CLOCK_MS || '', 10) || DEFAULT_MAX_WALL_CLOCK_MS,
    };
  }

  /**
   * Record token usage from an LLM provider response.
   */
  recordTokenUsage(pid: number, inputTokens: number, outputTokens: number, provider: string): void {
    let usage = this.usageMap.get(pid);
    if (!usage) {
      usage = {
        pid,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalSteps: 0,
        startedAt: Date.now(),
        estimatedCostUSD: 0,
        provider,
      };
      this.usageMap.set(pid, usage);
    }

    usage.totalInputTokens += inputTokens;
    usage.totalOutputTokens += outputTokens;
    usage.totalSteps += 1;
    usage.provider = provider;
    usage.estimatedCostUSD = this.estimateCost(
      usage.totalInputTokens,
      usage.totalOutputTokens,
      provider,
    );

    // Track daily totals
    const dailyTotal = (this.dailyTokens.get(pid) || 0) + inputTokens + outputTokens;
    this.dailyTokens.set(pid, dailyTotal);

    this.bus.emit('resource.usage', { pid, usage: { ...usage } });

    // Auto-check quota after recording
    const check = this.checkQuota(pid);
    if (!check.allowed) {
      this.bus.emit('resource.exceeded', {
        pid,
        reason: check.reason!,
        usage: { ...usage },
      });
      // Auto-kill: send SIGTERM to the offending process
      this.processes.signal(pid, 'SIGTERM');
    }
  }

  /**
   * Check whether a process is within its resource quota.
   */
  checkQuota(pid: number): QuotaCheckResult {
    const usage = this.usageMap.get(pid);
    if (!usage) {
      return {
        allowed: true,
        usage: {
          pid,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalSteps: 0,
          startedAt: Date.now(),
          estimatedCostUSD: 0,
          provider: 'unknown',
        },
      };
    }

    const quota = this.getQuota(pid);
    const sessionTokens = usage.totalInputTokens + usage.totalOutputTokens;
    const dailyTotal = this.dailyTokens.get(pid) || sessionTokens;
    const wallClockMs = Date.now() - usage.startedAt;

    if (sessionTokens > quota.maxTokensPerSession) {
      return {
        allowed: false,
        reason: `Session token limit exceeded: ${sessionTokens} > ${quota.maxTokensPerSession}`,
        usage: { ...usage },
      };
    }

    if (dailyTotal > quota.maxTokensPerDay) {
      return {
        allowed: false,
        reason: `Daily token limit exceeded: ${dailyTotal} > ${quota.maxTokensPerDay}`,
        usage: { ...usage },
      };
    }

    if (usage.totalSteps > quota.maxSteps) {
      return {
        allowed: false,
        reason: `Step limit exceeded: ${usage.totalSteps} > ${quota.maxSteps}`,
        usage: { ...usage },
      };
    }

    if (wallClockMs > quota.maxWallClockMs) {
      return {
        allowed: false,
        reason: `Wall clock limit exceeded: ${wallClockMs}ms > ${quota.maxWallClockMs}ms`,
        usage: { ...usage },
      };
    }

    return { allowed: true, usage: { ...usage } };
  }

  /**
   * Check if a process is runaway (any quota exceeded by >20%).
   */
  isRunaway(pid: number): boolean {
    const usage = this.usageMap.get(pid);
    if (!usage) return false;

    const quota = this.getQuota(pid);
    const sessionTokens = usage.totalInputTokens + usage.totalOutputTokens;
    const dailyTotal = this.dailyTokens.get(pid) || sessionTokens;
    const wallClockMs = Date.now() - usage.startedAt;

    if (sessionTokens > quota.maxTokensPerSession * RUNAWAY_THRESHOLD) return true;
    if (dailyTotal > quota.maxTokensPerDay * RUNAWAY_THRESHOLD) return true;
    if (usage.totalSteps > quota.maxSteps * RUNAWAY_THRESHOLD) return true;
    if (wallClockMs > quota.maxWallClockMs * RUNAWAY_THRESHOLD) return true;

    return false;
  }

  /**
   * Get the quota for a specific process (custom or default).
   */
  getQuota(pid: number): ResourceQuota {
    return this.quotaMap.get(pid) || { ...this.defaultQuota };
  }

  /**
   * Set a custom quota for a specific process.
   */
  setQuota(pid: number, quota: Partial<ResourceQuota>): ResourceQuota {
    const current = this.getQuota(pid);
    const merged = { ...current, ...quota };
    this.quotaMap.set(pid, merged);
    return merged;
  }

  /**
   * Get usage for a specific process.
   */
  getUsage(pid: number): AgentUsage | null {
    const usage = this.usageMap.get(pid);
    return usage ? { ...usage } : null;
  }

  /**
   * Get a summary of all tracked agent resource usage.
   */
  getSummary(): AgentUsage[] {
    return Array.from(this.usageMap.values()).map((u) => ({ ...u }));
  }

  /**
   * Estimate cost in USD for given token counts and provider.
   */
  estimateCost(inputTokens: number, outputTokens: number, provider: string): number {
    const key = provider.toLowerCase();
    // Find the best matching key
    let inputRate = 1.0; // default fallback: $1/M
    let outputRate = 3.0;
    for (const [k, rate] of Object.entries(COST_PER_MILLION_INPUT)) {
      if (key.includes(k)) {
        inputRate = rate;
        outputRate = COST_PER_MILLION_OUTPUT[k] || rate * 3;
        break;
      }
    }

    return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
  }

  /**
   * Clean up usage data for a terminated process.
   */
  cleanup(pid: number): void {
    this.usageMap.delete(pid);
    this.quotaMap.delete(pid);
    this.dailyTokens.delete(pid);
  }

  /**
   * Shutdown — clean up all state.
   */
  shutdown(): void {
    this.usageMap.clear();
    this.quotaMap.clear();
    this.dailyTokens.clear();
  }
}
