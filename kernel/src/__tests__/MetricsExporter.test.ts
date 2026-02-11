import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { MetricsExporter } from '../MetricsExporter.js';

// Minimal mock for ProcessManager
function createMockProcessManager() {
  return {
    getCounts: vi.fn().mockReturnValue({
      created: 0,
      running: 2,
      sleeping: 1,
      stopped: 0,
      zombie: 0,
      dead: 3,
    }),
    get: vi.fn().mockReturnValue({
      info: {
        pid: 1,
        env: { AETHER_ROLE: 'Coder' },
      },
    }),
  } as any;
}

// Minimal mock for ResourceGovernor
function createMockResourceGovernor() {
  return {
    getSummary: vi.fn().mockReturnValue([]),
  } as any;
}

describe('MetricsExporter', () => {
  let bus: EventBus;
  let pm: ReturnType<typeof createMockProcessManager>;
  let rg: ReturnType<typeof createMockResourceGovernor>;
  let metrics: MetricsExporter;

  beforeEach(() => {
    bus = new EventBus();
    pm = createMockProcessManager();
    rg = createMockResourceGovernor();
    metrics = new MetricsExporter(bus, pm, rg);
    metrics.init();
  });

  // ---------------------------------------------------------------------------
  // Counter increment on events
  // ---------------------------------------------------------------------------

  describe('counter increments from events', () => {
    it('increments agents_total on process.spawned', () => {
      bus.emit('process.spawned', { pid: 1, info: {} });
      bus.emit('process.spawned', { pid: 2, info: {} });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_agents_total 2');
    });

    it('increments agent_steps_total on agent.progress', () => {
      bus.emit('agent.progress', { pid: 1, step: 1, maxSteps: 10, summary: 'test' });
      bus.emit('agent.progress', { pid: 1, step: 2, maxSteps: 10, summary: 'test' });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_agent_steps_total{pid="1",role="Coder"} 2');
    });

    it('increments tool_executions_total on agent.action', () => {
      bus.emit('agent.action', { pid: 1, tool: 'write_file', args: {} });
      bus.emit('agent.action', { pid: 1, tool: 'write_file', args: {} });
      bus.emit('agent.action', { pid: 1, tool: 'run_command', args: {} });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_tool_executions_total{tool_name="write_file"} 2');
      expect(text).toContain('aether_tool_executions_total{tool_name="run_command"} 1');
    });

    it('updates token counts and cost from resource.usage', () => {
      bus.emit('resource.usage', {
        pid: 1,
        usage: {
          totalInputTokens: 5000,
          totalOutputTokens: 2000,
          estimatedCostUSD: 0.015,
          provider: 'gemini',
        },
      });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_llm_tokens_total{provider="gemini",direction="input"} 5000');
      expect(text).toContain('aether_llm_tokens_total{provider="gemini",direction="output"} 2000');
      expect(text).toContain('aether_cost_usd_total{provider="gemini"} 0.015000');
    });

    it('counts events via wildcard listener', () => {
      bus.emit('process.spawned', { pid: 1, info: {} });
      bus.emit('agent.thought', { pid: 1, thought: 'hello' });
      bus.emit('agent.thought', { pid: 1, thought: 'world' });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_events_emitted_total{event_type="process.spawned"} 1');
      expect(text).toContain('aether_events_emitted_total{event_type="agent.thought"} 2');
    });
  });

  // ---------------------------------------------------------------------------
  // Gauge updates for active agents
  // ---------------------------------------------------------------------------

  describe('gauge updates', () => {
    it('reports active agent count from ProcessManager.getCounts', () => {
      // Mock returns running=2, sleeping=1, created=0 => active=3
      const text = metrics.getMetricsText();
      expect(text).toContain('aether_agents_active 3');
    });

    it('reports WebSocket connections gauge', () => {
      metrics.setWsConnections(5);
      const text = metrics.getMetricsText();
      expect(text).toContain('aether_websocket_connections 5');
    });

    it('updates WebSocket gauge on change', () => {
      metrics.setWsConnections(3);
      let text = metrics.getMetricsText();
      expect(text).toContain('aether_websocket_connections 3');

      metrics.setWsConnections(1);
      text = metrics.getMetricsText();
      expect(text).toContain('aether_websocket_connections 1');
    });
  });

  // ---------------------------------------------------------------------------
  // Prometheus text format output is valid
  // ---------------------------------------------------------------------------

  describe('Prometheus text format', () => {
    it('includes HELP and TYPE comments for each metric', () => {
      const text = metrics.getMetricsText();

      expect(text).toContain('# HELP aether_agents_active');
      expect(text).toContain('# TYPE aether_agents_active gauge');
      expect(text).toContain('# HELP aether_agents_total');
      expect(text).toContain('# TYPE aether_agents_total counter');
      expect(text).toContain('# HELP aether_websocket_connections');
      expect(text).toContain('# TYPE aether_websocket_connections gauge');
      expect(text).toContain('# HELP aether_llm_latency_seconds');
      expect(text).toContain('# TYPE aether_llm_latency_seconds histogram');
      expect(text).toContain('# HELP aether_tool_latency_seconds');
      expect(text).toContain('# TYPE aether_tool_latency_seconds histogram');
      expect(text).toContain('# HELP aether_cost_usd_total');
      expect(text).toContain('# TYPE aether_cost_usd_total counter');
    });

    it('produces valid metric lines (name{labels} value format)', () => {
      bus.emit('process.spawned', { pid: 1, info: {} });
      metrics.setWsConnections(2);

      const text = metrics.getMetricsText();
      const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));

      for (const line of lines) {
        // Each metric line should match: metric_name{labels} value  OR  metric_name value
        expect(line).toMatch(/^[a-z_]+(\{[^}]*\})?\s+[\d.+-]+$/);
      }
    });

    it('escapes special characters in label values', () => {
      // Emit an event with a tool name containing a double quote
      bus.emit('agent.action', { pid: 1, tool: 'tool"with"quotes', args: {} });

      const text = metrics.getMetricsText();
      expect(text).toContain('tool\\"with\\"quotes');
      expect(text).not.toContain('tool"with"quotes"');
    });
  });

  // ---------------------------------------------------------------------------
  // Histogram buckets for latency
  // ---------------------------------------------------------------------------

  describe('histogram recording', () => {
    it('records LLM latency histogram buckets', () => {
      metrics.recordLLMRequest('gemini', 'gemini-2.5-flash', 0.15);
      metrics.recordLLMRequest('gemini', 'gemini-2.5-flash', 0.35);
      metrics.recordLLMRequest('gemini', 'gemini-2.5-flash', 1.5);

      const text = metrics.getMetricsText();

      // Check histogram output includes bucket lines
      expect(text).toContain('aether_llm_latency_seconds_bucket{provider="gemini",le="0.1"} 0');
      expect(text).toContain('aether_llm_latency_seconds_bucket{provider="gemini",le="0.25"} 1');
      expect(text).toContain('aether_llm_latency_seconds_bucket{provider="gemini",le="0.5"} 2');
      expect(text).toContain('aether_llm_latency_seconds_bucket{provider="gemini",le="2.5"} 3');
      expect(text).toContain('aether_llm_latency_seconds_bucket{provider="gemini",le="+Inf"} 3');
      expect(text).toContain('aether_llm_latency_seconds_count{provider="gemini"} 3');
      expect(text).toMatch(/aether_llm_latency_seconds_sum\{provider="gemini"\} 2\.0/);
    });

    it('records tool latency histogram', () => {
      metrics.recordToolLatency('write_file', 0.05);
      metrics.recordToolLatency('write_file', 0.12);

      const text = metrics.getMetricsText();
      expect(text).toContain(
        'aether_tool_latency_seconds_bucket{tool_name="write_file",le="0.05"} 1',
      );
      expect(text).toContain(
        'aether_tool_latency_seconds_bucket{tool_name="write_file",le="0.25"} 2',
      );
      expect(text).toContain('aether_tool_latency_seconds_count{tool_name="write_file"} 2');
    });

    it('also increments llm_requests_total on recordLLMRequest', () => {
      metrics.recordLLMRequest('claude', 'claude-sonnet', 0.5);
      metrics.recordLLMRequest('claude', 'claude-sonnet', 0.3);

      const text = metrics.getMetricsText();
      expect(text).toContain(
        'aether_llm_requests_total{provider="claude",model="claude-sonnet"} 2',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Shutdown cleans up listeners
  // ---------------------------------------------------------------------------

  describe('shutdown', () => {
    it('removes EventBus listeners on shutdown', () => {
      metrics.shutdown();

      // Emit events after shutdown — counters should NOT increase
      bus.emit('process.spawned', { pid: 99, info: {} });
      bus.emit('agent.action', { pid: 99, tool: 'test_tool', args: {} });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_agents_total 0');
      expect(text).not.toContain('test_tool');
    });

    it('can be called multiple times safely', () => {
      metrics.shutdown();
      metrics.shutdown();
      // No error thrown
    });
  });

  // ---------------------------------------------------------------------------
  // Cost tracking from resource usage events
  // ---------------------------------------------------------------------------

  describe('cost tracking', () => {
    it('tracks cost per provider from resource.usage events', () => {
      bus.emit('resource.usage', {
        pid: 1,
        usage: {
          totalInputTokens: 10000,
          totalOutputTokens: 5000,
          estimatedCostUSD: 0.123456,
          provider: 'claude',
        },
      });

      bus.emit('resource.usage', {
        pid: 2,
        usage: {
          totalInputTokens: 20000,
          totalOutputTokens: 10000,
          estimatedCostUSD: 0.05,
          provider: 'gemini',
        },
      });

      const text = metrics.getMetricsText();
      expect(text).toContain('aether_cost_usd_total{provider="claude"} 0.123456');
      expect(text).toContain('aether_cost_usd_total{provider="gemini"} 0.050000');
    });

    it('updates cost when same provider reports new usage', () => {
      bus.emit('resource.usage', {
        pid: 1,
        usage: {
          totalInputTokens: 1000,
          totalOutputTokens: 500,
          estimatedCostUSD: 0.01,
          provider: 'gemini',
        },
      });

      bus.emit('resource.usage', {
        pid: 1,
        usage: {
          totalInputTokens: 5000,
          totalOutputTokens: 2500,
          estimatedCostUSD: 0.05,
          provider: 'gemini',
        },
      });

      const text = metrics.getMetricsText();
      // Should show latest value (0.05), not cumulative
      expect(text).toContain('aether_cost_usd_total{provider="gemini"} 0.050000');
    });
  });
});
