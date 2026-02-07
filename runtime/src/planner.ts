/**
 * Aether Runtime - Goal Decomposition & Planning (v0.3 Wave 2, Feature #6)
 *
 * Agents can create hierarchical plans to break down complex goals.
 * Plans are JSON trees stored in a single plan_tree TEXT column.
 *
 * Key design decisions:
 * - Plans are created explicitly via `create_plan` tool (not automatic)
 * - Plan nodes have estimated steps (agent guesses) and actual steps (tracked)
 * - Plan state is injected into system prompt as markdown checklist
 * - Re-planning: agent can call `create_plan` again to replace current plan
 *
 * Plan node statuses: pending | active | completed | failed | skipped
 */

import * as crypto from 'node:crypto';
import type { Kernel } from '@aether/kernel';
import type { PID, PlanRecord, PlanNode, PlanNodeStatus } from '@aether/shared';

/**
 * Create a new plan for an agent process.
 * If an active plan already exists for this PID, it will be marked as abandoned.
 */
export function createPlan(
  kernel: Kernel,
  pid: PID,
  agentUid: string,
  goal: string,
  rootNodes: PlanNode[],
): PlanRecord {
  const now = Date.now();

  // Mark any existing active plan for this PID as abandoned
  const existing = kernel.state.getActivePlanByPid(pid);
  if (existing) {
    kernel.state.updatePlan(existing.id, existing.plan_tree, 'abandoned');
  }

  // Ensure all nodes have IDs
  const processedNodes = rootNodes.map((node) => ensureNodeIds(node));

  const id = crypto.randomUUID();
  const record: PlanRecord = {
    id,
    agent_uid: agentUid,
    pid,
    goal,
    root_nodes: processedNodes,
    status: 'active',
    created_at: now,
    updated_at: now,
  };

  kernel.state.insertPlan({
    id: record.id,
    agent_uid: record.agent_uid,
    pid: record.pid,
    goal: record.goal,
    plan_tree: JSON.stringify(record.root_nodes),
    status: record.status,
    created_at: record.created_at,
    updated_at: record.updated_at,
  });

  kernel.bus.emit('plan.created', { plan: record });

  return record;
}

/**
 * Get the active plan for a process.
 */
export function getActivePlan(kernel: Kernel, pid: PID): PlanRecord | null {
  const raw = kernel.state.getActivePlanByPid(pid);
  if (!raw) return null;
  return hydratePlanRecord(raw);
}

/**
 * Update a plan's nodes and/or status.
 */
export function updatePlan(
  kernel: Kernel,
  planId: string,
  updates: { root_nodes?: PlanNode[]; status?: PlanRecord['status'] },
): PlanRecord | null {
  const raw = kernel.state.getPlan(planId);
  if (!raw) return null;

  const current = hydratePlanRecord(raw);
  const newNodes = updates.root_nodes || current.root_nodes;
  const newStatus = updates.status || current.status;

  kernel.state.updatePlan(planId, JSON.stringify(newNodes), newStatus);

  const updated: PlanRecord = {
    ...current,
    root_nodes: newNodes,
    status: newStatus,
    updated_at: Date.now(),
  };

  kernel.bus.emit('plan.updated', { plan: updated });

  return updated;
}

/**
 * Update the status of a specific node within a plan.
 * Finds the node by ID and updates its status.
 */
export function updateNodeStatus(
  kernel: Kernel,
  planId: string,
  nodeId: string,
  status: PlanNodeStatus,
  actualSteps?: number,
): PlanRecord | null {
  const raw = kernel.state.getPlan(planId);
  if (!raw) return null;

  const plan = hydratePlanRecord(raw);
  const updated = updateNodeInTree(plan.root_nodes, nodeId, status, actualSteps);
  if (!updated) return null;

  // Auto-complete plan if all root nodes are completed, failed, or skipped
  let planStatus = plan.status;
  if (areAllNodesTerminal(plan.root_nodes)) {
    planStatus = 'completed';
  }

  kernel.state.updatePlan(planId, JSON.stringify(plan.root_nodes), planStatus);

  const result: PlanRecord = {
    ...plan,
    status: planStatus,
    updated_at: Date.now(),
  };

  kernel.bus.emit('plan.updated', { plan: result });

  return result;
}

/**
 * Render a plan as a markdown checklist for injection into system prompt.
 */
export function renderPlanAsMarkdown(plan: PlanRecord): string {
  const lines: string[] = [];
  lines.push(`## Current Plan: ${plan.goal}`);
  lines.push(`Status: ${plan.status}`);
  lines.push('');

  for (const node of plan.root_nodes) {
    renderNodeAsMarkdown(node, lines, 0);
  }

  return lines.join('\n');
}

/**
 * Calculate plan progress statistics.
 */
export function getPlanProgress(plan: PlanRecord): {
  total: number;
  completed: number;
  active: number;
  failed: number;
  pending: number;
  skipped: number;
} {
  const stats = { total: 0, completed: 0, active: 0, failed: 0, pending: 0, skipped: 0 };
  for (const node of plan.root_nodes) {
    countNodes(node, stats);
  }
  return stats;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Ensure every node in the tree has a unique ID.
 */
function ensureNodeIds(node: PlanNode): PlanNode {
  return {
    ...node,
    id: node.id || crypto.randomUUID(),
    status: node.status || 'pending',
    estimated_steps: node.estimated_steps || 1,
    actual_steps: node.actual_steps || 0,
    children: (node.children || []).map((child) => ensureNodeIds(child)),
  };
}

/**
 * Recursively find and update a node's status in the tree.
 */
function updateNodeInTree(
  nodes: PlanNode[],
  nodeId: string,
  status: PlanNodeStatus,
  actualSteps?: number,
): boolean {
  for (const node of nodes) {
    if (node.id === nodeId) {
      node.status = status;
      if (actualSteps !== undefined) {
        node.actual_steps = actualSteps;
      }
      return true;
    }
    if (node.children && node.children.length > 0) {
      if (updateNodeInTree(node.children, nodeId, status, actualSteps)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if all nodes (including children) are in terminal states.
 */
function areAllNodesTerminal(nodes: PlanNode[]): boolean {
  for (const node of nodes) {
    if (node.status !== 'completed' && node.status !== 'failed' && node.status !== 'skipped') {
      return false;
    }
    if (node.children && node.children.length > 0) {
      if (!areAllNodesTerminal(node.children)) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Render a single node as a markdown checklist item.
 */
function renderNodeAsMarkdown(node: PlanNode, lines: string[], depth: number): void {
  const indent = '  '.repeat(depth);
  const statusIcon = getStatusIcon(node.status);
  const stepsInfo =
    node.actual_steps > 0
      ? ` (${node.actual_steps}/${node.estimated_steps} steps)`
      : ` (~${node.estimated_steps} steps)`;

  lines.push(`${indent}${statusIcon} ${node.title}${stepsInfo}`);

  if (node.children) {
    for (const child of node.children) {
      renderNodeAsMarkdown(child, lines, depth + 1);
    }
  }
}

function getStatusIcon(status: PlanNodeStatus): string {
  switch (status) {
    case 'pending':
      return '- [ ]';
    case 'active':
      return '- [~]';
    case 'completed':
      return '- [x]';
    case 'failed':
      return '- [!]';
    case 'skipped':
      return '- [-]';
    default:
      return '- [ ]';
  }
}

/**
 * Count nodes by status recursively.
 */
function countNodes(
  node: PlanNode,
  stats: {
    total: number;
    completed: number;
    active: number;
    failed: number;
    pending: number;
    skipped: number;
  },
): void {
  stats.total++;
  switch (node.status) {
    case 'completed':
      stats.completed++;
      break;
    case 'active':
      stats.active++;
      break;
    case 'failed':
      stats.failed++;
      break;
    case 'skipped':
      stats.skipped++;
      break;
    default:
      stats.pending++;
      break;
  }
  if (node.children) {
    for (const child of node.children) {
      countNodes(child, stats);
    }
  }
}

/**
 * Hydrate a raw database row into a PlanRecord.
 */
function hydratePlanRecord(raw: any): PlanRecord {
  return {
    id: raw.id,
    agent_uid: raw.agent_uid,
    pid: raw.pid,
    goal: raw.goal,
    root_nodes: typeof raw.plan_tree === 'string' ? JSON.parse(raw.plan_tree) : raw.plan_tree,
    status: raw.status,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  };
}
