/**
 * Aether OS — /api/v1/events SSE route handler
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type V1RouterDeps, type V1Handler, type UserInfo, setVersionHeader } from './helpers.js';

export function createEventsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel } = deps;

  async function handleEvents(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (pathname !== '/api/v1/events' || method !== 'GET') return false;

    const filterParam = url.searchParams.get('filter');
    const filters = filterParam ? filterParam.split(',').map((f) => f.trim()) : [];

    setVersionHeader(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial heartbeat
    res.write('data: {"type":"connected"}\n\n');

    const unsubscribers: (() => void)[] = [];

    // Subscribe to kernel events
    const EVENT_TYPES = [
      'process.spawned',
      'process.stateChange',
      'process.exit',
      'agent.thought',
      'agent.action',
      'agent.observation',
      'agent.phaseChange',
      'agent.progress',
      'fs.changed',
      'agent.sharedFileWritten',
      'agent.userMessage',
      'cron.fired',
      'trigger.fired',
      'kernel.metrics',
    ];

    for (const eventType of EVENT_TYPES) {
      // Check filter
      if (filters.length > 0) {
        const matches = filters.some((f) => {
          if (f.endsWith('.*')) {
            return eventType.startsWith(f.slice(0, -1));
          }
          return eventType === f;
        });
        if (!matches) continue;
      }

      const unsub = kernel.bus.on(eventType, (data: any) => {
        try {
          res.write(`data: ${JSON.stringify({ type: eventType, ...data })}\n\n`);
        } catch {
          // Connection closed
        }
      });
      unsubscribers.push(unsub);
    }

    // Clean up on close
    req.on('close', () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
    });

    return true;
  }

  return handleEvents;
}
