/**
 * Aether OS — /api/v1/integrations and Slack webhook route handlers
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import { verifySlackSignature, parseSlashCommand } from '@aether/kernel';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  jsonOk,
  jsonError,
  matchRoute,
  getErrorMessage,
  setVersionHeader,
} from './helpers.js';

export function createIntegrationsHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, readBody } = deps;

  async function handleIntegrations(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // GET /api/v1/integrations — List integrations
    if (pathname === '/api/v1/integrations' && method === 'GET') {
      const list = kernel.integrations.list();
      jsonOk(res, list);
      return true;
    }

    // POST /api/v1/integrations — Register integration
    if (pathname === '/api/v1/integrations' && method === 'POST') {
      try {
        const body = await readBody(req);
        const config = JSON.parse(body);
        if (!config.type || !config.name) {
          jsonError(res, 400, 'INVALID_INPUT', 'type and name are required');
          return true;
        }
        const info = kernel.integrations.register(config, user.id);
        jsonOk(res, info, 201);
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    // GET /api/v1/integrations/:id
    let params = matchRoute(pathname, method, 'GET', '/api/v1/integrations/:id');
    if (params) {
      const info = kernel.integrations.get(params.id);
      if (info) {
        jsonOk(res, info);
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Integration ${params.id} not found`);
      }
      return true;
    }

    // DELETE /api/v1/integrations/:id
    params = matchRoute(pathname, method, 'DELETE', '/api/v1/integrations/:id');
    if (params) {
      kernel.integrations.unregister(params.id);
      jsonOk(res, { deleted: true });
      return true;
    }

    // POST /api/v1/integrations/:id/test
    params = matchRoute(pathname, method, 'POST', '/api/v1/integrations/:id/test');
    if (params) {
      const result = await kernel.integrations.test(params.id);
      jsonOk(res, result);
      return true;
    }

    // POST /api/v1/integrations/:id/execute
    params = matchRoute(pathname, method, 'POST', '/api/v1/integrations/:id/execute');
    if (params) {
      try {
        const body = await readBody(req);
        const { action, params: actionParams } = JSON.parse(body);
        if (!action) {
          jsonError(res, 400, 'INVALID_INPUT', 'action is required');
          return true;
        }
        const result = await kernel.integrations.execute(params!.id, action, actionParams);
        jsonOk(res, result);
      } catch (err: unknown) {
        jsonError(res, 400, 'EXECUTION_ERROR', getErrorMessage(err));
      }
      return true;
    }

    // PATCH /api/v1/integrations/:id — Enable/disable
    params = matchRoute(pathname, method, 'PATCH', '/api/v1/integrations/:id');
    if (params) {
      try {
        const body = await readBody(req);
        const { enabled } = JSON.parse(body);
        if (typeof enabled !== 'boolean') {
          jsonError(res, 400, 'INVALID_INPUT', 'enabled (boolean) is required');
          return true;
        }
        if (enabled) {
          kernel.integrations.enable(params.id);
        } else {
          kernel.integrations.disable(params.id);
        }
        jsonOk(res, { id: params.id, enabled });
      } catch (err: unknown) {
        jsonError(res, 400, 'INVALID_INPUT', getErrorMessage(err));
      }
      return true;
    }

    return false;
  }

  async function handleSlackWebhooks(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    // POST /api/v1/integrations/slack/commands — Slash command receiver
    if (pathname === '/api/v1/integrations/slack/commands' && method === 'POST') {
      const body = await readBody(req);

      // Find a registered Slack integration to get signing_secret
      const allIntegrations = kernel.integrations.list();
      const slackIntegration = allIntegrations.find((i: any) => i.type === 'slack' && i.enabled);
      if (!slackIntegration) {
        jsonError(res, 404, 'NOT_FOUND', 'No active Slack integration found');
        return true;
      }

      // Get credentials from the integration row
      const row = kernel.state.getIntegration(slackIntegration.id);
      const credentials = row?.credentials ? JSON.parse(row.credentials) : {};

      // Verify Slack signature
      const timestamp = (req.headers['x-slack-request-timestamp'] as string) || '';
      const signature = (req.headers['x-slack-signature'] as string) || '';
      if (
        !credentials.signing_secret ||
        !verifySlackSignature(credentials.signing_secret, timestamp, body, signature)
      ) {
        jsonError(res, 401, 'INVALID_SIGNATURE', 'Slack signature verification failed');
        return true;
      }

      // Parse URL-encoded slash command payload
      const params = new URLSearchParams(body);
      const commandText = params.get('text') || '';
      const userId = params.get('user_id') || '';
      const userName = params.get('user_name') || '';
      const channelId = params.get('channel_id') || '';
      const responseUrl = params.get('response_url') || '';

      const parsed = parseSlashCommand(commandText);

      // Emit event on the kernel bus for other subsystems to react
      kernel.bus.emit('slack.command', {
        integrationId: slackIntegration.id,
        command: parsed.command,
        args: parsed.args,
        user_id: userId,
        user_name: userName,
        channel_id: channelId,
        response_url: responseUrl,
        raw_text: commandText,
      });

      // Return immediate acknowledgement to Slack
      jsonOk(res, {
        response_type: 'ephemeral',
        text: `Processing command: ${parsed.command} ${parsed.args.join(' ')}`,
      });
      return true;
    }

    // POST /api/v1/integrations/slack/events — Events API receiver
    if (pathname === '/api/v1/integrations/slack/events' && method === 'POST') {
      const body = await readBody(req);

      let payload: any;
      try {
        payload = JSON.parse(body);
      } catch {
        jsonError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
        return true;
      }

      // Handle Slack URL verification challenge
      if (payload.type === 'url_verification') {
        setVersionHeader(res);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ challenge: payload.challenge }));
        return true;
      }

      // Find a registered Slack integration
      const allIntegrations = kernel.integrations.list();
      const slackIntegration = allIntegrations.find((i: any) => i.type === 'slack' && i.enabled);
      if (!slackIntegration) {
        jsonError(res, 404, 'NOT_FOUND', 'No active Slack integration found');
        return true;
      }

      // Get credentials
      const row = kernel.state.getIntegration(slackIntegration.id);
      const credentials = row?.credentials ? JSON.parse(row.credentials) : {};

      // Verify Slack signature
      const timestamp = (req.headers['x-slack-request-timestamp'] as string) || '';
      const signature = (req.headers['x-slack-signature'] as string) || '';
      if (
        !credentials.signing_secret ||
        !verifySlackSignature(credentials.signing_secret, timestamp, body, signature)
      ) {
        jsonError(res, 401, 'INVALID_SIGNATURE', 'Slack signature verification failed');
        return true;
      }

      // Emit event on kernel bus
      if (payload.event) {
        kernel.bus.emit('slack.event', {
          integrationId: slackIntegration.id,
          event_type: payload.event.type,
          event: payload.event,
          team_id: payload.team_id,
        });
      }

      // Acknowledge receipt to Slack (must respond within 3s)
      jsonOk(res, { ok: true });
      return true;
    }

    return false;
  }

  return async function combinedHandler(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    user: UserInfo,
  ): Promise<boolean> {
    if (await handleIntegrations(req, res, url, user)) return true;
    if (await handleSlackWebhooks(req, res, url, user)) return true;
    return false;
  };
}
