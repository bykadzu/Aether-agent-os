/**
 * Aether Kernel - Discord Integration (v0.4 Wave 4)
 *
 * Implements the IIntegration interface for Discord REST API v10.
 * Uses native fetch() — no external dependencies.
 *
 * Provides bot-based communication:
 * - Send messages, list guilds/channels, read messages, add reactions, get members
 */

import type { IIntegration, IntegrationActionDef } from './IIntegration.js';

const DISCORD_API = 'https://discord.com/api/v10';

const ACTIONS: IntegrationActionDef[] = [
  {
    name: 'discord.send_message',
    description: 'Send a message to a Discord channel',
    parameters: {
      channel_id: { type: 'string', description: 'Channel ID', required: true },
      content: { type: 'string', description: 'Message text', required: true },
      embeds: { type: 'string', description: 'JSON array of embed objects' },
    },
  },
  {
    name: 'discord.list_guilds',
    description: 'List guilds (servers) the bot is a member of',
  },
  {
    name: 'discord.list_channels',
    description: 'List channels in a guild',
    parameters: {
      guild_id: { type: 'string', description: 'Guild ID', required: true },
    },
  },
  {
    name: 'discord.read_messages',
    description: 'Read recent messages from a channel',
    parameters: {
      channel_id: { type: 'string', description: 'Channel ID', required: true },
      limit: { type: 'number', description: 'Number of messages to fetch (default 50)' },
    },
  },
  {
    name: 'discord.add_reaction',
    description: 'Add an emoji reaction to a message',
    parameters: {
      channel_id: { type: 'string', description: 'Channel ID', required: true },
      message_id: { type: 'string', description: 'Message ID', required: true },
      emoji: {
        type: 'string',
        description: 'URL-encoded emoji (e.g. %F0%9F%91%8D or custom name:id)',
        required: true,
      },
    },
  },
  {
    name: 'discord.get_guild_members',
    description: 'Get members of a guild',
    parameters: {
      guild_id: { type: 'string', description: 'Guild ID', required: true },
      limit: { type: 'number', description: 'Max members to return (default 100)' },
    },
  },
];

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Aether-OS/0.4',
  };
}

export class DiscordIntegration implements IIntegration {
  readonly type = 'discord';

  getAvailableActions(): IntegrationActionDef[] {
    return ACTIONS;
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
        headers: headers(credentials.bot_token),
      });
      if (res.ok) {
        const data = (await res.json()) as any[];
        return {
          success: true,
          message: `Connected — bot is in ${data.length} guild(s)`,
        };
      }
      return { success: false, message: `Discord API returned ${res.status}` };
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
      case 'discord.send_message': {
        const body: Record<string, any> = { content: params.content };
        if (params.embeds) {
          body.embeds =
            typeof params.embeds === 'string' ? JSON.parse(params.embeds) : params.embeds;
        }
        const res = await fetch(`${DISCORD_API}/channels/${params.channel_id}/messages`, {
          method: 'POST',
          headers: h,
          body: JSON.stringify(body),
        });
        return res.json();
      }

      case 'discord.list_guilds': {
        const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
          headers: h,
        });
        return res.json();
      }

      case 'discord.list_channels': {
        const res = await fetch(`${DISCORD_API}/guilds/${params.guild_id}/channels`, {
          headers: h,
        });
        return res.json();
      }

      case 'discord.read_messages': {
        const limit = params.limit || 50;
        const res = await fetch(
          `${DISCORD_API}/channels/${params.channel_id}/messages?limit=${limit}`,
          { headers: h },
        );
        return res.json();
      }

      case 'discord.add_reaction': {
        const res = await fetch(
          `${DISCORD_API}/channels/${params.channel_id}/messages/${params.message_id}/reactions/${params.emoji}/@me`,
          {
            method: 'PUT',
            headers: h,
            body: '',
          },
        );
        // Discord returns 204 No Content on success
        if (res.status === 204) {
          return { success: true };
        }
        return res.json();
      }

      case 'discord.get_guild_members': {
        const limit = params.limit || 100;
        const res = await fetch(`${DISCORD_API}/guilds/${params.guild_id}/members?limit=${limit}`, {
          headers: h,
        });
        return res.json();
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}
