/**
 * Aether Kernel - Slack Integration (v0.4 Wave 3)
 *
 * Implements the IIntegration interface for Slack Web API.
 * Uses native fetch() — no external dependencies.
 *
 * Provides bidirectional communication:
 * - Outbound: send messages, manage channels, users, reactions
 * - Inbound: verify Slack request signatures, parse slash commands
 */

import * as crypto from 'node:crypto';
import type { IIntegration, IntegrationActionDef } from './IIntegration.js';

const SLACK_API = 'https://slack.com/api';

const ACTIONS: IntegrationActionDef[] = [
  {
    name: 'slack.send_message',
    description: 'Send a message to a Slack channel',
    parameters: {
      channel: { type: 'string', description: 'Channel ID or name', required: true },
      text: { type: 'string', description: 'Message text', required: true },
      thread_ts: { type: 'string', description: 'Thread timestamp for replies' },
    },
  },
  {
    name: 'slack.list_channels',
    description: 'List public channels in the workspace',
    parameters: {
      limit: { type: 'number', description: 'Max channels to return (default 100)' },
      cursor: { type: 'string', description: 'Pagination cursor' },
    },
  },
  {
    name: 'slack.read_channel',
    description: 'Read recent messages from a channel',
    parameters: {
      channel: { type: 'string', description: 'Channel ID', required: true },
      limit: { type: 'number', description: 'Number of messages (default 10)' },
      oldest: { type: 'string', description: 'Only messages after this timestamp' },
    },
  },
  {
    name: 'slack.add_reaction',
    description: 'Add an emoji reaction to a message',
    parameters: {
      channel: { type: 'string', description: 'Channel ID', required: true },
      timestamp: { type: 'string', description: 'Message timestamp', required: true },
      name: { type: 'string', description: 'Emoji name (without colons)', required: true },
    },
  },
  {
    name: 'slack.set_topic',
    description: 'Set the topic of a channel',
    parameters: {
      channel: { type: 'string', description: 'Channel ID', required: true },
      topic: { type: 'string', description: 'New channel topic', required: true },
    },
  },
  {
    name: 'slack.upload_file',
    description: 'Upload a file to a channel',
    parameters: {
      channels: { type: 'string', description: 'Comma-separated channel IDs', required: true },
      content: { type: 'string', description: 'File content', required: true },
      filename: { type: 'string', description: 'Filename', required: true },
      title: { type: 'string', description: 'File title' },
    },
  },
  {
    name: 'slack.list_users',
    description: 'List users in the workspace',
    parameters: {
      limit: { type: 'number', description: 'Max users to return (default 100)' },
      cursor: { type: 'string', description: 'Pagination cursor' },
    },
  },
  {
    name: 'slack.send_dm',
    description: 'Send a direct message to a user',
    parameters: {
      user: { type: 'string', description: 'User ID', required: true },
      text: { type: 'string', description: 'Message text', required: true },
    },
  },
];

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

/**
 * Verify an incoming Slack request signature using HMAC-SHA256.
 * See: https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string,
): boolean {
  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expected = `v0=${hmac}`;
  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Simple Mustache-style template renderer.
 * Replaces {{field.path}} placeholders with values from data.
 */
export function renderTemplate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const keys = path.trim().split('.');
    let value: any = data;
    for (const key of keys) {
      if (value == null) return '';
      value = value[key];
    }
    return value != null ? String(value) : '';
  });
}

/**
 * Parse a slash command text like:
 *   "/aether spawn coder \"Fix the login bug\""
 *   "/aether status"
 *   "/aether kill 42"
 *   "/aether ask coder \"What is the status?\""
 *
 * Returns { command, args } where args is context-dependent.
 */
export function parseSlashCommand(text: string): { command: string; args: string[] } {
  const trimmed = text.trim();
  if (!trimmed) return { command: '', args: [] };

  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ' ' && !inQuotes) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  const [command = '', ...args] = tokens;
  return { command, args };
}

export class SlackIntegration implements IIntegration {
  readonly type = 'slack';

  getAvailableActions(): IntegrationActionDef[] {
    return ACTIONS;
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${SLACK_API}/auth.test`, {
        method: 'POST',
        headers: headers(credentials.bot_token),
      });
      const data = (await res.json()) as any;
      if (data.ok) {
        return { success: true, message: `Connected as ${data.user} in ${data.team}` };
      }
      return { success: false, message: data.error || 'auth.test failed' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Connection failed' };
    }
  }

  async executeAction(
    action: string,
    params: Record<string, any>,
    credentials: Record<string, string>,
  ): Promise<any> {
    const h = headers(credentials.bot_token);

    switch (action) {
      case 'slack.send_message': {
        const body: Record<string, any> = {
          channel: params.channel,
          text: params.text,
        };
        if (params.thread_ts) body.thread_ts = params.thread_ts;
        const res = await fetch(`${SLACK_API}/chat.postMessage`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body),
        });
        return res.json();
      }

      case 'slack.list_channels': {
        const query = new URLSearchParams();
        query.set('limit', String(params.limit || 100));
        if (params.cursor) query.set('cursor', params.cursor);
        const res = await fetch(`${SLACK_API}/conversations.list?${query}`, {
          headers: h,
        });
        return res.json();
      }

      case 'slack.read_channel': {
        const query = new URLSearchParams();
        query.set('channel', params.channel);
        query.set('limit', String(params.limit || 10));
        if (params.oldest) query.set('oldest', params.oldest);
        const res = await fetch(`${SLACK_API}/conversations.history?${query}`, {
          headers: h,
        });
        return res.json();
      }

      case 'slack.add_reaction': {
        const res = await fetch(`${SLACK_API}/reactions.add`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            channel: params.channel,
            timestamp: params.timestamp,
            name: params.name,
          }),
        });
        return res.json();
      }

      case 'slack.set_topic': {
        const res = await fetch(`${SLACK_API}/conversations.setTopic`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            channel: params.channel,
            topic: params.topic,
          }),
        });
        return res.json();
      }

      case 'slack.upload_file': {
        const res = await fetch(`${SLACK_API}/files.upload`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            channels: params.channels,
            content: params.content,
            filename: params.filename,
            title: params.title || params.filename,
          }),
        });
        return res.json();
      }

      case 'slack.list_users': {
        const query = new URLSearchParams();
        query.set('limit', String(params.limit || 100));
        if (params.cursor) query.set('cursor', params.cursor);
        const res = await fetch(`${SLACK_API}/users.list?${query}`, {
          headers: h,
        });
        return res.json();
      }

      case 'slack.send_dm': {
        // First open a DM channel with the user
        const openRes = await fetch(`${SLACK_API}/conversations.open`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({ users: params.user }),
        });
        const openData = (await openRes.json()) as any;
        if (!openData.ok) {
          return openData;
        }
        // Then send the message
        const res = await fetch(`${SLACK_API}/chat.postMessage`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify({
            channel: openData.channel.id,
            text: params.text,
          }),
        });
        return res.json();
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
