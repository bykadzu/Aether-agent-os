/**
 * Aether Kernel - Metrics Exporter
 *
 * Collects and exports kernel metrics in Prometheus text exposition format.
 * Subscribes to EventBus events to automatically track counters and gauges.
 * No external dependencies — Prometheus format is hand-rolled.
 *
 * Metrics exported:
 * - aether_agents_active (gauge)
 * - aether_agents_total (counter)
 * - aether_agent_completions_total (counter, labels: outcome)
 * - aether_agent_duration_seconds (histogram, labels: outcome)
 * - aether_agent_steps_total (counter, labels: pid, role)
 * - aether_llm_requests_total (counter, labels: provider, model)
 * - aether_llm_tokens_total (counter, labels: provider, direction)
 * - aether_llm_latency_seconds (histogram, labels: provider)
 * - aether_tool_executions_total (counter, labels: tool_name)
 * - aether_tool_latency_seconds (histogram, labels: tool_name)
 * - aether_websocket_connections (gauge)
 * - aether_events_emitted_total (counter, labels: event_type)
 * - aether_cost_usd_total (counter, labels: provider)
 */

import { EventBus } from './EventBus.js';
import { ProcessManager } from './ProcessManager.js';
import { ResourceGovernor } from './ResourceGovernor.js';

// Default histogram bucket boundaries for latency (seconds)
const DEFAULT_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramData {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

export class MetricsExporter {
  // --- Counters ---
  private agentsTotal = 0;
  private agentCompletions = new Map<string, number>(); // outcome -> count ("success", "timeout", "failure")
  private agentSteps = new Map<string, number>(); // "pid:role" -> count
  private llmRequests = new Map<string, number>(); // "provider:model" -> count
  private llmTokens = new Map<string, number>(); // "provider:direction" -> count
  private toolExecutions = new Map<string, number>(); // tool_name -> count
  private eventsEmitted = new Map<string, number>(); // event_type -> count
  private costByProvider = new Map<string, number>(); // provider -> USD

  // --- Gauges ---
  private wsConnections = 0;

  // --- Histograms ---
  private agentDuration = new Map<string, HistogramData>(); // outcome -> histogram (seconds)

  // --- Histograms ---
  private llmLatency = new Map<string, HistogramData>(); // provider -> histogram
  private toolLatency = new Map<string, HistogramData>(); // tool_name -> histogram

  // --- Subscriptions ---
  private unsubscribers: Array<() => void> = [];

  constructor(
    private bus: EventBus,
    private processes: ProcessManager,
    private resources: ResourceGovernor,
  ) {}

  /**
   * Subscribe to EventBus events to auto-increment metrics.
   */
  init(): void {
    // process.spawned → increment agents_total
    this.unsubscribers.push(
      this.bus.on('process.spawned', () => {
        this.agentsTotal++;
      }),
    );

    // agent.completed → track completions, failures, and duration
    this.unsubscribers.push(
      this.bus.on(
        'agent.completed',
        (data: { pid: number; outcome: string; steps: number; durationMs: number }) => {
          const outcome = data.outcome || 'unknown';
          this.agentCompletions.set(outcome, (this.agentCompletions.get(outcome) || 0) + 1);
          this.observeHistogram(this.agentDuration, outcome, data.durationMs / 1000);
        },
      ),
    );

    // agent.progress → increment agent_steps_total
    this.unsubscribers.push(
      this.bus.on('agent.progress', (data: { pid: number; step: number }) => {
        const proc = this.processes.get(data.pid);
        const role = proc?.info.env.AETHER_ROLE || 'unknown';
        const key = `${data.pid}:${role}`;
        this.agentSteps.set(key, (this.agentSteps.get(key) || 0) + 1);
      }),
    );

    // agent.action → increment tool_executions_total
    this.unsubscribers.push(
      this.bus.on('agent.action', (data: { pid: number; tool: string }) => {
        this.toolExecutions.set(data.tool, (this.toolExecutions.get(data.tool) || 0) + 1);
      }),
    );

    // resource.usage → update token counts and cost
    this.unsubscribers.push(
      this.bus.on(
        'resource.usage',
        (data: {
          pid: number;
          usage: {
            totalInputTokens: number;
            totalOutputTokens: number;
            estimatedCostUSD: number;
            provider: string;
          };
        }) => {
          const provider = data.usage.provider || 'unknown';
          // Overwrite with latest totals from ResourceGovernor (it accumulates)
          this.llmTokens.set(`${provider}:input`, data.usage.totalInputTokens);
          this.llmTokens.set(`${provider}:output`, data.usage.totalOutputTokens);
          this.costByProvider.set(provider, data.usage.estimatedCostUSD);
        },
      ),
    );

    // Wildcard listener for events_emitted_total
    this.unsubscribers.push(
      this.bus.on('*', (data: { event: string }) => {
        if (data.event) {
          this.eventsEmitted.set(data.event, (this.eventsEmitted.get(data.event) || 0) + 1);
        }
      }),
    );
  }

  /**
   * Clean up all event listeners.
   */
  shutdown(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  /**
   * Set the current WebSocket connection gauge.
   */
  setWsConnections(count: number): void {
    this.wsConnections = count;
  }

  /**
   * Record an LLM request with latency.
   */
  recordLLMRequest(provider: string, model: string, latencySeconds: number): void {
    const reqKey = `${provider}:${model}`;
    this.llmRequests.set(reqKey, (this.llmRequests.get(reqKey) || 0) + 1);
    this.observeHistogram(this.llmLatency, provider, latencySeconds);
  }

  /**
   * Record a tool execution with latency.
   */
  recordToolLatency(toolName: string, latencySeconds: number): void {
    this.observeHistogram(this.toolLatency, toolName, latencySeconds);
  }

  /**
   * Generate the full Prometheus text exposition output.
   */
  getMetricsText(): string {
    const lines: string[] = [];

    // --- aether_agents_active (gauge) ---
    const counts = this.processes.getCounts();
    const activeAgents = counts.running + counts.sleeping + counts.created;
    lines.push('# HELP aether_agents_active Current number of active agent processes');
    lines.push('# TYPE aether_agents_active gauge');
    lines.push(`aether_agents_active ${activeAgents}`);

    // --- aether_agents_total (counter) ---
    lines.push('# HELP aether_agents_total Total number of agents spawned');
    lines.push('# TYPE aether_agents_total counter');
    lines.push(`aether_agents_total ${this.agentsTotal}`);

    // --- aether_agent_completions_total (counter, labels: outcome) ---
    lines.push('# HELP aether_agent_completions_total Agent task completions by outcome');
    lines.push('# TYPE aether_agent_completions_total counter');
    for (const [outcome, count] of this.agentCompletions) {
      lines.push(`aether_agent_completions_total{outcome="${escapeLabel(outcome)}"} ${count}`);
    }

    // --- aether_agent_duration_seconds (histogram, labels: outcome) ---
    lines.push('# HELP aether_agent_duration_seconds Agent task duration in seconds');
    lines.push('# TYPE aether_agent_duration_seconds histogram');
    for (const [outcome, hist] of this.agentDuration) {
      this.renderHistogram(lines, 'aether_agent_duration_seconds', { outcome }, hist);
    }

    // --- aether_agent_steps_total (counter, labels: pid, role) ---
    lines.push('# HELP aether_agent_steps_total Total agent steps executed');
    lines.push('# TYPE aether_agent_steps_total counter');
    for (const [key, count] of this.agentSteps) {
      const [pid, role] = key.split(':');
      lines.push(`aether_agent_steps_total{pid="${pid}",role="${escapeLabel(role)}"} ${count}`);
    }

    // --- aether_llm_requests_total (counter, labels: provider, model) ---
    lines.push('# HELP aether_llm_requests_total Total LLM API calls');
    lines.push('# TYPE aether_llm_requests_total counter');
    for (const [key, count] of this.llmRequests) {
      const [provider, model] = key.split(':');
      lines.push(
        `aether_llm_requests_total{provider="${escapeLabel(provider)}",model="${escapeLabel(model)}"} ${count}`,
      );
    }

    // --- aether_llm_tokens_total (counter, labels: provider, direction) ---
    lines.push('# HELP aether_llm_tokens_total Total LLM tokens consumed');
    lines.push('# TYPE aether_llm_tokens_total counter');
    for (const [key, count] of this.llmTokens) {
      const [provider, direction] = key.split(':');
      lines.push(
        `aether_llm_tokens_total{provider="${escapeLabel(provider)}",direction="${direction}"} ${count}`,
      );
    }

    // --- aether_llm_latency_seconds (histogram, labels: provider) ---
    lines.push('# HELP aether_llm_latency_seconds LLM response time in seconds');
    lines.push('# TYPE aether_llm_latency_seconds histogram');
    for (const [provider, hist] of this.llmLatency) {
      this.renderHistogram(lines, 'aether_llm_latency_seconds', { provider }, hist);
    }

    // --- aether_tool_executions_total (counter, labels: tool_name) ---
    lines.push('# HELP aether_tool_executions_total Total tool invocations');
    lines.push('# TYPE aether_tool_executions_total counter');
    for (const [tool, count] of this.toolExecutions) {
      lines.push(`aether_tool_executions_total{tool_name="${escapeLabel(tool)}"} ${count}`);
    }

    // --- aether_tool_latency_seconds (histogram, labels: tool_name) ---
    lines.push('# HELP aether_tool_latency_seconds Tool execution time in seconds');
    lines.push('# TYPE aether_tool_latency_seconds histogram');
    for (const [tool, hist] of this.toolLatency) {
      this.renderHistogram(lines, 'aether_tool_latency_seconds', { tool_name: tool }, hist);
    }

    // --- aether_websocket_connections (gauge) ---
    lines.push('# HELP aether_websocket_connections Active WebSocket connections');
    lines.push('# TYPE aether_websocket_connections gauge');
    lines.push(`aether_websocket_connections ${this.wsConnections}`);

    // --- aether_events_emitted_total (counter, labels: event_type) ---
    lines.push('# HELP aether_events_emitted_total Total events emitted through EventBus');
    lines.push('# TYPE aether_events_emitted_total counter');
    for (const [eventType, count] of this.eventsEmitted) {
      lines.push(`aether_events_emitted_total{event_type="${escapeLabel(eventType)}"} ${count}`);
    }

    // --- aether_cost_usd_total (counter, labels: provider) ---
    lines.push('# HELP aether_cost_usd_total Estimated LLM cost in USD');
    lines.push('# TYPE aether_cost_usd_total counter');
    for (const [provider, cost] of this.costByProvider) {
      lines.push(`aether_cost_usd_total{provider="${escapeLabel(provider)}"} ${cost.toFixed(6)}`);
    }

    lines.push('');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------
  // Histogram helpers
  // ---------------------------------------------------------------------------

  private observeHistogram(store: Map<string, HistogramData>, key: string, value: number): void {
    let hist = store.get(key);
    if (!hist) {
      hist = {
        buckets: [...DEFAULT_BUCKETS],
        counts: new Array(DEFAULT_BUCKETS.length).fill(0),
        sum: 0,
        count: 0,
      };
      store.set(key, hist);
    }

    hist.sum += value;
    hist.count++;
    // Increment only the first bucket where value fits (renderHistogram does cumulative)
    for (let i = 0; i < hist.buckets.length; i++) {
      if (value <= hist.buckets[i]) {
        hist.counts[i]++;
        break;
      }
    }
    // If value exceeds all buckets, it is only counted in +Inf (tracked by hist.count)
  }

  private renderHistogram(
    lines: string[],
    metricName: string,
    labels: Record<string, string>,
    hist: HistogramData,
  ): void {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
      .join(',');

    let cumulative = 0;
    for (let i = 0; i < hist.buckets.length; i++) {
      cumulative += hist.counts[i];
      const le = hist.buckets[i];
      lines.push(`${metricName}_bucket{${labelStr},le="${le}"} ${cumulative}`);
    }
    lines.push(`${metricName}_bucket{${labelStr},le="+Inf"} ${hist.count}`);
    lines.push(`${metricName}_sum{${labelStr}} ${hist.sum.toFixed(6)}`);
    lines.push(`${metricName}_count{${labelStr}} ${hist.count}`);
  }
}

/**
 * Escape special characters in Prometheus label values.
 */
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
