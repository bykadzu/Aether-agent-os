import { Agent } from '../types';

/**
 * Format a timestamp as a human-readable date-time string.
 */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

/**
 * Format a timestamp as a short time string (HH:MM:SS).
 */
function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Build the JSON export payload for an agent's logs.
 */
function buildJsonPayload(agent: Agent) {
  return {
    agent: {
      id: agent.id,
      pid: agent.pid ?? null,
      name: agent.name,
      role: agent.role,
      goal: agent.goal,
      status: agent.status,
      phase: agent.phase ?? null,
      progress: agent.progress,
      githubSync: agent.githubSync ?? false,
    },
    exportedAt: new Date().toISOString(),
    logCount: agent.logs.length,
    logs: agent.logs.map((log) => ({
      timestamp: log.timestamp,
      timestampFormatted: formatTimestamp(log.timestamp),
      type: log.type,
      message: log.message,
    })),
  };
}

/**
 * Build a plain-text export of an agent's logs.
 */
function buildTextPayload(agent: Agent): string {
  const divider = '='.repeat(60);
  const lines: string[] = [];

  lines.push('Agent Log Export');
  lines.push(divider);
  lines.push(`Agent:    ${agent.name}`);
  lines.push(`Role:     ${agent.role}`);
  lines.push(`Goal:     ${agent.goal}`);
  lines.push(`Status:   ${agent.status}`);
  if (agent.phase) lines.push(`Phase:    ${agent.phase}`);
  if (agent.pid != null) lines.push(`PID:      ${agent.pid}`);
  lines.push(`Progress: ${agent.progress}`);
  lines.push(`Exported: ${formatTimestamp(Date.now())}`);
  lines.push(`Entries:  ${agent.logs.length}`);
  lines.push(divider);
  lines.push('');

  for (const log of agent.logs) {
    const time = formatTime(log.timestamp);
    const typeLabel = log.type.toUpperCase().padEnd(11);
    lines.push(`[${time}] ${typeLabel} ${log.message}`);
  }

  lines.push('');
  lines.push(divider);
  lines.push('End of log export');

  return lines.join('\n');
}

/**
 * Generate a sanitized filename for the export.
 */
function buildFilename(agent: Agent, format: 'json' | 'text'): string {
  const safePid = agent.pid ?? 'nopid';
  const safeRole = agent.role.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const ext = format === 'json' ? 'json' : 'txt';
  return `agent-${safePid}-${safeRole}-logs.${ext}`;
}

/**
 * Trigger a file download in the browser via Blob + object URL.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  // Clean up
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Export agent logs as a JSON file download.
 */
export function exportLogsAsJson(agent: Agent): void {
  const payload = buildJsonPayload(agent);
  const content = JSON.stringify(payload, null, 2);
  const filename = buildFilename(agent, 'json');
  triggerDownload(content, filename, 'application/json');
}

/**
 * Export agent logs as a plain-text file download.
 */
export function exportLogsAsText(agent: Agent): void {
  const content = buildTextPayload(agent);
  const filename = buildFilename(agent, 'text');
  triggerDownload(content, filename, 'text/plain');
}
