/**
 * Aether OS — /api/v1/system and /api/v1/templates route handlers
 */

import { type IncomingMessage, type ServerResponse } from 'node:http';
import * as os from 'node:os';
import {
  type V1RouterDeps,
  type V1Handler,
  type UserInfo,
  API_VERSION,
  jsonOk,
  jsonError,
  matchRoute,
} from './helpers.js';

export function createSystemHandler(deps: V1RouterDeps): V1Handler {
  const { kernel, agentTemplates } = deps;
  const templates = agentTemplates || [];

  async function handleTemplates(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method !== 'GET') return false;

    // GET /api/v1/templates
    if (pathname === '/api/v1/templates') {
      jsonOk(res, templates);
      return true;
    }

    // GET /api/v1/templates/:id
    const params = matchRoute(pathname, method, 'GET', '/api/v1/templates/:id');
    if (params) {
      const template = templates.find((t: any) => t.id === params.id);
      if (template) {
        jsonOk(res, template);
      } else {
        jsonError(res, 404, 'NOT_FOUND', `Template ${params.id} not found`);
      }
      return true;
    }

    return false;
  }

  async function handleSystem(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    _user: UserInfo,
  ): Promise<boolean> {
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method !== 'GET') return false;

    // GET /api/v1/system/status
    if (pathname === '/api/v1/system/status') {
      const counts = kernel.processes.getCounts();
      jsonOk(res, {
        version: API_VERSION,
        uptime: kernel.getUptime(),
        processes: counts,
        docker: kernel.containers.isDockerAvailable(),
        containers: kernel.containers.getAll().length,
        gpu: kernel.containers.isGPUAvailable(),
        gpuCount: kernel.containers.getGPUs().length,
      });
      return true;
    }

    // GET /api/v1/system/metrics
    if (pathname === '/api/v1/system/metrics') {
      const cpus = os.cpus();
      const coreCount = cpus.length || 1;
      const loadAvg1 = os.loadavg()[0];
      const cpuPercent = Math.min(100, (loadAvg1 / coreCount) * 100);

      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      const counts = kernel.processes.getCounts();
      const agentCount = counts.running + counts.sleeping + counts.created;

      jsonOk(res, {
        cpu: { percent: parseFloat(cpuPercent.toFixed(1)), cores: coreCount },
        memory: {
          usedMB: Math.round(usedMem / (1024 * 1024)),
          totalMB: Math.round(totalMem / (1024 * 1024)),
          percent: parseFloat(((usedMem / totalMem) * 100).toFixed(1)),
        },
        agents: agentCount,
        containers: kernel.containers.getAll().length,
        timestamp: Date.now(),
      });
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
    if (await handleTemplates(req, res, url, user)) return true;
    if (await handleSystem(req, res, url, user)) return true;
    return false;
  };
}
