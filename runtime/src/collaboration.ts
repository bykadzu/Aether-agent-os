/**
 * Aether Runtime - Agent Collaboration Protocols (v0.3 Wave 4, Feature #13)
 *
 * Structured protocols for agent-to-agent coordination:
 * - review_request / review_response: Code or work review
 * - task_delegate / task_accepted / task_completed: Task delegation
 * - status_update: Broadcast status to collaborators
 * - knowledge_share: Share a memory or finding with another agent
 *
 * These protocols run on top of the existing IPC system (kernel.processes).
 */

import * as crypto from 'node:crypto';
import type { Kernel } from '@aether/kernel';
import type { PID } from '@aether/shared';

// ---------------------------------------------------------------------------
// Protocol Types
// ---------------------------------------------------------------------------

export type CollaborationProtocol =
  | 'review_request'
  | 'review_response'
  | 'task_delegate'
  | 'task_accepted'
  | 'task_rejected'
  | 'task_completed'
  | 'status_update'
  | 'knowledge_share';

export interface CollaborationMessage {
  protocol: CollaborationProtocol;
  from_uid: string;
  from_pid: number;
  to_uid?: string; // Target agent UID (optional for broadcasts)
  to_pid?: number; // Target PID
  payload: any;
  correlation_id?: string; // Links request/response pairs
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Payload Types
// ---------------------------------------------------------------------------

export interface ReviewRequest {
  subject: string; // What to review
  content: string; // The content to review
  context?: string; // Additional context
  urgency: 'low' | 'medium' | 'high';
}

export interface ReviewResponse {
  approved: boolean;
  feedback: string;
  suggestions?: string[];
}

export interface TaskDelegation {
  goal: string;
  context: string;
  deadline?: number; // Optional deadline timestamp
  priority: 'low' | 'medium' | 'high';
}

export interface TaskAccepted {
  estimated_steps?: number;
  message?: string;
}

export interface TaskRejected {
  reason: string;
}

export interface TaskCompleted {
  result: string;
  success: boolean;
  artifacts?: string[];
}

export interface StatusUpdate {
  status: string;
  progress?: number; // 0-100
  details?: string;
}

export interface KnowledgeShare {
  topic: string;
  content: string;
  layer: 'episodic' | 'semantic' | 'procedural' | 'social';
  tags: string[];
}

// ---------------------------------------------------------------------------
// Core Messaging
// ---------------------------------------------------------------------------

/**
 * Send a collaboration message to a specific agent by PID.
 *
 * Wraps the kernel IPC `sendMessage` with collaboration protocol metadata.
 * The message is placed on the `collab:<protocol>` channel so it can be
 * distinguished from raw IPC messages when draining.
 */
export function sendCollaborationMessage(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  message: Omit<CollaborationMessage, 'timestamp'>,
): boolean {
  const fullMessage: CollaborationMessage = {
    ...message,
    timestamp: Date.now(),
  };

  const ipcMsg = kernel.processes.sendMessage(
    fromPid,
    toPid,
    `collab:${message.protocol}`,
    fullMessage,
  );

  if (ipcMsg) {
    kernel.bus.emit('collaboration.message', {
      protocol: message.protocol,
      fromPid,
      toPid,
    });
    return true;
  }
  return false;
}

/**
 * Drain collaboration messages for a given PID.
 *
 * Filters IPC messages to only return collab protocol messages (those on
 * channels starting with `collab:`).  Non-collab messages are left in the
 * queue untouched because the underlying `drainMessages` already removes
 * them --- so callers that care about both raw IPC *and* collab messages
 * should use the standard `check_messages` tool instead.
 */
export function drainCollaborationMessages(kernel: Kernel, pid: PID): CollaborationMessage[] {
  const allMessages = kernel.processes.drainMessages(pid);
  return allMessages
    .filter((m) => m.channel.startsWith('collab:'))
    .map((m) => m.payload as CollaborationMessage);
}

// ---------------------------------------------------------------------------
// Review Workflow
// ---------------------------------------------------------------------------

/**
 * Send a review request to another agent.
 *
 * Returns a `correlation_id` that the reviewer should include in their
 * response so the requester can match request/response pairs.
 */
export function requestReview(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  request: ReviewRequest,
): string {
  const correlationId = crypto.randomUUID();
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'review_request',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: request,
    correlation_id: correlationId,
  });

  return correlationId;
}

/**
 * Send a review response back to the requesting agent.
 *
 * The `correlationId` should match the one returned by `requestReview` so
 * the original requester can correlate the feedback.
 */
export function respondToReview(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  correlationId: string,
  response: ReviewResponse,
): void {
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'review_response',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: response,
    correlation_id: correlationId,
  });
}

// ---------------------------------------------------------------------------
// Task Delegation Workflow
// ---------------------------------------------------------------------------

/**
 * Delegate a task to another agent.
 *
 * Returns a `correlation_id` for tracking acceptance and completion.
 */
export function delegateTask(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  delegation: TaskDelegation,
): string {
  const correlationId = crypto.randomUUID();
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'task_delegate',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: delegation,
    correlation_id: correlationId,
  });

  return correlationId;
}

/**
 * Accept a delegated task.
 */
export function acceptTask(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  correlationId: string,
  acceptance: TaskAccepted,
): void {
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'task_accepted',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: acceptance,
    correlation_id: correlationId,
  });
}

/**
 * Reject a delegated task with a reason.
 */
export function rejectTask(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  correlationId: string,
  rejection: TaskRejected,
): void {
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'task_rejected',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: rejection,
    correlation_id: correlationId,
  });
}

/**
 * Report completion of a delegated task.
 */
export function completeTask(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  correlationId: string,
  completion: TaskCompleted,
): void {
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'task_completed',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: completion,
    correlation_id: correlationId,
  });
}

// ---------------------------------------------------------------------------
// Status Updates
// ---------------------------------------------------------------------------

/**
 * Broadcast a status update to all running agents.
 *
 * Iterates over every running agent (except the sender) and delivers a
 * `status_update` collaboration message.
 */
export function broadcastStatus(kernel: Kernel, fromPid: PID, update: StatusUpdate): void {
  const fromProc = kernel.processes.get(fromPid);
  const agents = kernel.processes.listRunningAgents();

  for (const agent of agents) {
    if (agent.pid !== fromPid) {
      sendCollaborationMessage(kernel, fromPid, agent.pid, {
        protocol: 'status_update',
        from_uid: fromProc?.info.uid || 'unknown',
        from_pid: fromPid,
        to_pid: agent.pid,
        payload: update,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Knowledge Sharing
// ---------------------------------------------------------------------------

/**
 * Share knowledge (a memory) with another agent.
 *
 * In addition to delivering the collaboration message, this also stores a
 * social-layer memory for the sending agent so there is a persistent record
 * of the knowledge exchange.
 */
export function shareKnowledge(
  kernel: Kernel,
  fromPid: PID,
  toPid: PID,
  knowledge: KnowledgeShare,
): void {
  const fromProc = kernel.processes.get(fromPid);

  sendCollaborationMessage(kernel, fromPid, toPid, {
    protocol: 'knowledge_share',
    from_uid: fromProc?.info.uid || 'unknown',
    from_pid: fromPid,
    to_pid: toPid,
    payload: knowledge,
  });

  // Also store as social memory for the sending agent
  if (kernel.memory) {
    const toProc = kernel.processes.get(toPid);
    try {
      kernel.memory.store({
        agent_uid: fromProc?.info.uid || 'unknown',
        layer: 'social',
        content: `Shared knowledge with ${toProc?.info.uid || `PID ${toPid}`}: ${knowledge.topic} - ${knowledge.content.substring(0, 200)}`,
        tags: ['knowledge-share', ...knowledge.tags],
        importance: 0.6,
        source_pid: fromPid,
      });
    } catch (err) {
      console.warn(`[Collaboration] Failed to store knowledge-share memory:`, err);
    }
  }
}
