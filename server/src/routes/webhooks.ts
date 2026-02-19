/**
 * Aether OS -- Webhook DLQ route handler
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  matchRoute,
} from './helpers.js';

export function createWebhooksHandler(deps: V1RouterDeps): V1Handler {
  const { kernel } = deps;

  async function handleWebhookDlq(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/webhooks/dlq — List DLQ entries
    if (pathname === '/api/v1/webhooks/dlq' && method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50', 10);
      const offset = parseInt(url.searchParams.get('offset') || '0', 10);
      const entries = kernel.webhooks.getDlqEntries(limit, offset);
      jsonOk(res, entries);
      return true;
    }

    // POST /api/v1/webhooks/dlq/:id/retry — Retry a DLQ entry
    let params = matchRoute(pathname, method, 'POST', '/api/v1/webhooks/dlq/:id/retry');
    if (params) {
      const success = await kernel.webhooks.retryDlqEntry(params.id);
      jsonOk(res, { success });
      return true;
    }

    // DELETE /api/v1/webhooks/dlq/:id — Purge a single DLQ entry
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/webhooks/dlq/:id');
    if (params) {
      const purged = kernel.webhooks.purgeDlqEntry(params.id);
      if (purged) {
        jsonOk(res, { deleted: true });
      } else {
        jsonError(res, 404, 'NOT_FOUND', `DLQ entry ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  return handleWebhookDlq;
}
