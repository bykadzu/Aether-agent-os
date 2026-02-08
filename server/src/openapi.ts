/**
 * Aether OS - OpenAPI 3.0.0 Specification
 *
 * Auto-generated spec covering all REST API v1 endpoints.
 * Served at GET /api/v1/openapi.json.
 */

function getSchemas(): Record<string, object> {
  return {
    Agent: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Unique agent identifier' },
        role: { type: 'string', description: 'Agent role description' },
        goal: { type: 'string', description: 'Agent goal' },
        model: { type: 'string', description: 'LLM model identifier' },
        status: {
          type: 'string',
          enum: ['created', 'running', 'sleeping', 'stopped', 'zombie', 'dead'],
          description: 'Agent lifecycle state',
        },
        pid: { type: 'integer', description: 'Process identifier' },
        ttyId: { type: 'string', description: 'Terminal identifier' },
        created_at: { type: 'integer', description: 'Unix timestamp of creation' },
      },
    },
    AgentSpawnRequest: {
      type: 'object',
      required: ['role', 'goal'],
      properties: {
        role: { type: 'string', description: 'Agent role description' },
        goal: { type: 'string', description: 'Agent goal' },
        model: { type: 'string', description: 'LLM model identifier' },
        tools: { type: 'array', items: { type: 'string' }, description: 'List of tool names' },
        maxSteps: { type: 'integer', description: 'Maximum agent loop steps' },
      },
    },
    Template: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Template identifier' },
        name: { type: 'string', description: 'Display name' },
        description: { type: 'string', description: 'Template description' },
        category: { type: 'string', enum: ['development', 'research', 'data', 'creative', 'ops'] },
        config: { type: 'object', description: 'Agent configuration' },
        suggestedGoals: { type: 'array', items: { type: 'string' } },
        author: { type: 'string', description: 'Template author' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    },
    Organization: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Organization identifier' },
        name: { type: 'string', description: 'Organization slug name' },
        displayName: { type: 'string', description: 'Display name' },
        settings: { type: 'object', description: 'Organization settings' },
        created_at: { type: 'integer', description: 'Unix timestamp of creation' },
      },
    },
    OrgMember: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'User identifier' },
        role: {
          type: 'string',
          enum: ['owner', 'admin', 'member', 'viewer'],
          description: 'Member role',
        },
        joinedAt: { type: 'integer', description: 'Unix timestamp of join' },
      },
    },
    Team: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Team identifier' },
        name: { type: 'string', description: 'Team name' },
        description: { type: 'string', description: 'Team description' },
        org_id: { type: 'string', description: 'Parent organization identifier' },
      },
    },
    Integration: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Integration identifier' },
        type: { type: 'string', description: 'Integration type (e.g. slack, github)' },
        name: { type: 'string', description: 'Display name' },
        enabled: { type: 'boolean', description: 'Whether the integration is active' },
        status: { type: 'string', description: 'Connection status' },
        available_actions: { type: 'array', items: { type: 'string' } },
        last_error: { type: 'string', nullable: true, description: 'Last error message' },
        created_at: { type: 'integer', description: 'Unix timestamp of creation' },
      },
    },
    IntegrationRegisterRequest: {
      type: 'object',
      required: ['type', 'name'],
      properties: {
        type: { type: 'string', description: 'Integration type' },
        name: { type: 'string', description: 'Display name' },
        credentials: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Credential key-value pairs',
        },
      },
    },
    CronJob: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Cron job identifier' },
        name: { type: 'string', description: 'Job name' },
        cron_expression: { type: 'string', description: 'Cron expression (e.g. "0 * * * *")' },
        enabled: { type: 'boolean', description: 'Whether the job is active' },
        last_run: { type: 'integer', nullable: true, description: 'Unix timestamp of last run' },
        fire_count: { type: 'integer', description: 'Total number of fires' },
      },
    },
    CronJobCreateRequest: {
      type: 'object',
      required: ['name', 'cron_expression', 'agent_config'],
      properties: {
        name: { type: 'string', description: 'Job name' },
        cron_expression: { type: 'string', description: 'Cron expression' },
        agent_config: { type: 'object', description: 'Agent configuration to spawn on fire' },
      },
    },
    Trigger: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Trigger identifier' },
        name: { type: 'string', description: 'Trigger name' },
        event_type: { type: 'string', description: 'Event type to listen for' },
        enabled: { type: 'boolean', description: 'Whether the trigger is active' },
        fire_count: { type: 'integer', description: 'Total number of fires' },
      },
    },
    TriggerCreateRequest: {
      type: 'object',
      required: ['name', 'event_type', 'agent_config'],
      properties: {
        name: { type: 'string', description: 'Trigger name' },
        event_type: { type: 'string', description: 'Event type to listen for' },
        agent_config: { type: 'object', description: 'Agent configuration to spawn on fire' },
      },
    },
    Plugin: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Plugin identifier' },
        manifest: { type: 'object', description: 'Plugin manifest' },
        installed_at: { type: 'integer', description: 'Unix timestamp of installation' },
        enabled: { type: 'boolean', description: 'Whether the plugin is enabled' },
        download_count: { type: 'integer', description: 'Number of downloads' },
        rating_avg: { type: 'number', description: 'Average rating' },
      },
    },
    TemplateMarketplaceEntry: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Template identifier' },
        name: { type: 'string', description: 'Display name' },
        description: { type: 'string', description: 'Template description' },
        icon: { type: 'string', description: 'Icon emoji or identifier' },
        category: { type: 'string', enum: ['development', 'research', 'data', 'creative', 'ops'] },
        config: { type: 'object', description: 'Agent configuration' },
        suggestedGoals: { type: 'array', items: { type: 'string' } },
        author: { type: 'string', description: 'Template author' },
        tags: { type: 'array', items: { type: 'string' } },
        download_count: { type: 'integer', description: 'Number of downloads' },
        rating_avg: { type: 'number', description: 'Average rating' },
      },
    },
    Error: {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Machine-readable error code' },
            message: { type: 'string', description: 'Human-readable error message' },
          },
        },
      },
    },
    SuccessResponse: {
      type: 'object',
      properties: {
        data: { description: 'Response payload' },
      },
    },
    ListResponse: {
      type: 'object',
      properties: {
        data: { type: 'array', items: {}, description: 'Array of items' },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'integer', description: 'Total number of items' },
            limit: { type: 'integer', description: 'Page size' },
            offset: { type: 'integer', description: 'Page offset' },
          },
        },
      },
    },
  };
}

function ref(name: string): object {
  return { $ref: `#/components/schemas/${name}` };
}

function errorResponses(codes: number[]): Record<string, object> {
  const map: Record<string, object> = {};
  const descriptions: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
  };
  for (const code of codes) {
    map[String(code)] = {
      description: descriptions[code] || 'Error',
      content: { 'application/json': { schema: ref('Error') } },
    };
  }
  return map;
}

function jsonContent(schema: object): object {
  return { 'application/json': { schema } };
}

function successResponse(description: string, schema?: object): object {
  if (schema) {
    return {
      description,
      content: jsonContent({
        type: 'object',
        properties: { data: schema },
      }),
    };
  }
  return {
    description,
    content: jsonContent(ref('SuccessResponse')),
  };
}

function listResponse(description: string, itemSchema: object): object {
  return {
    description,
    content: jsonContent({
      type: 'object',
      properties: {
        data: { type: 'array', items: itemSchema },
        meta: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            limit: { type: 'integer' },
            offset: { type: 'integer' },
          },
        },
      },
    }),
  };
}

function pathParam(name: string, description: string): object {
  return { name, in: 'path', required: true, schema: { type: 'string' }, description };
}

function queryParam(name: string, description: string, type = 'string', required = false): object {
  return { name, in: 'query', required, schema: { type }, description };
}

function getPaths(): Record<string, object> {
  return {
    // -----------------------------------------------------------------------
    // OpenAPI
    // -----------------------------------------------------------------------
    '/openapi.json': {
      get: {
        summary: 'Get OpenAPI specification',
        operationId: 'getOpenApiSpec',
        tags: ['System'],
        security: [],
        responses: {
          '200': { description: 'OpenAPI 3.0.0 spec', content: jsonContent({ type: 'object' }) },
        },
      },
    },

    // -----------------------------------------------------------------------
    // Agents
    // -----------------------------------------------------------------------
    '/agents': {
      post: {
        summary: 'Spawn a new agent',
        operationId: 'spawnAgent',
        tags: ['Agents'],
        requestBody: {
          required: true,
          content: jsonContent(ref('AgentSpawnRequest')),
        },
        responses: {
          '201': successResponse('Agent spawned', ref('Agent')),
          ...errorResponses([400, 401]),
        },
      },
      get: {
        summary: 'List agents',
        operationId: 'listAgents',
        tags: ['Agents'],
        parameters: [
          queryParam('status', 'Filter by status'),
          queryParam('limit', 'Page size', 'integer'),
          queryParam('offset', 'Page offset', 'integer'),
        ],
        responses: {
          '200': listResponse('Agent list', ref('Agent')),
          ...errorResponses([401]),
        },
      },
    },
    '/agents/{uid}': {
      get: {
        summary: 'Get agent details',
        operationId: 'getAgent',
        tags: ['Agents'],
        parameters: [pathParam('uid', 'Agent unique identifier')],
        responses: {
          '200': successResponse('Agent details', ref('Agent')),
          ...errorResponses([401, 404]),
        },
      },
      delete: {
        summary: 'Kill an agent',
        operationId: 'killAgent',
        tags: ['Agents'],
        parameters: [pathParam('uid', 'Agent unique identifier')],
        responses: {
          '200': successResponse('Agent killed'),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/agents/{uid}/message': {
      post: {
        summary: 'Send a message to an agent',
        operationId: 'sendAgentMessage',
        tags: ['Agents'],
        parameters: [pathParam('uid', 'Agent unique identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['content'],
            properties: { content: { type: 'string', description: 'Message content' } },
          }),
        },
        responses: {
          '200': successResponse('Message delivered'),
          ...errorResponses([400, 401, 404]),
        },
      },
    },
    '/agents/{uid}/timeline': {
      get: {
        summary: 'Get agent action timeline',
        operationId: 'getAgentTimeline',
        tags: ['Agents'],
        parameters: [
          pathParam('uid', 'Agent unique identifier'),
          queryParam('limit', 'Page size', 'integer'),
          queryParam('offset', 'Page offset', 'integer'),
        ],
        responses: {
          '200': listResponse('Timeline entries', { type: 'object' }),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/agents/{uid}/memory': {
      get: {
        summary: 'Search agent memories',
        operationId: 'searchAgentMemory',
        tags: ['Agents'],
        parameters: [
          pathParam('uid', 'Agent unique identifier'),
          queryParam('q', 'Search query'),
          queryParam('layer', 'Memory layer filter'),
          queryParam('limit', 'Maximum results', 'integer'),
        ],
        responses: {
          '200': successResponse('Memory results', { type: 'array', items: { type: 'object' } }),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/agents/{uid}/plan': {
      get: {
        summary: 'Get agent current plan',
        operationId: 'getAgentPlan',
        tags: ['Agents'],
        parameters: [pathParam('uid', 'Agent unique identifier')],
        responses: {
          '200': successResponse('Current plan', { type: 'object', nullable: true }),
          ...errorResponses([401]),
        },
      },
    },
    '/agents/{uid}/profile': {
      get: {
        summary: 'Get agent profile',
        operationId: 'getAgentProfile',
        tags: ['Agents'],
        parameters: [pathParam('uid', 'Agent unique identifier')],
        responses: {
          '200': successResponse('Agent profile', { type: 'object' }),
          ...errorResponses([401]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Filesystem
    // -----------------------------------------------------------------------
    '/fs/{path}': {
      get: {
        summary: 'Read file or list directory',
        operationId: 'readFile',
        tags: ['Filesystem'],
        parameters: [pathParam('path', 'Virtual filesystem path')],
        responses: {
          '200': successResponse('File content or directory listing'),
          ...errorResponses([401, 404]),
        },
      },
      put: {
        summary: 'Write file',
        operationId: 'writeFile',
        tags: ['Filesystem'],
        parameters: [pathParam('path', 'Virtual filesystem path')],
        requestBody: {
          required: true,
          content: { 'application/octet-stream': { schema: { type: 'string' } } },
        },
        responses: {
          '200': successResponse('File written'),
          ...errorResponses([401, 500]),
        },
      },
      delete: {
        summary: 'Delete file or directory',
        operationId: 'deleteFile',
        tags: ['Filesystem'],
        parameters: [pathParam('path', 'Virtual filesystem path')],
        responses: {
          '200': successResponse('File deleted'),
          ...errorResponses([401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Templates
    // -----------------------------------------------------------------------
    '/templates': {
      get: {
        summary: 'List agent templates',
        operationId: 'listTemplates',
        tags: ['Templates'],
        responses: {
          '200': successResponse('Template list', { type: 'array', items: ref('Template') }),
          ...errorResponses([401]),
        },
      },
    },
    '/templates/{id}': {
      get: {
        summary: 'Get template by ID',
        operationId: 'getTemplate',
        tags: ['Templates'],
        parameters: [pathParam('id', 'Template identifier')],
        responses: {
          '200': successResponse('Template details', ref('Template')),
          ...errorResponses([401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // System
    // -----------------------------------------------------------------------
    '/system/status': {
      get: {
        summary: 'Get system status',
        operationId: 'getSystemStatus',
        tags: ['System'],
        responses: {
          '200': successResponse('System status', {
            type: 'object',
            properties: {
              version: { type: 'string' },
              uptime: { type: 'integer' },
              processes: { type: 'object' },
              docker: { type: 'boolean' },
              containers: { type: 'integer' },
              gpu: { type: 'boolean' },
              gpuCount: { type: 'integer' },
            },
          }),
          ...errorResponses([401]),
        },
      },
    },
    '/system/metrics': {
      get: {
        summary: 'Get system metrics',
        operationId: 'getSystemMetrics',
        tags: ['System'],
        responses: {
          '200': successResponse('System metrics', {
            type: 'object',
            properties: {
              cpu: { type: 'object' },
              memory: { type: 'object' },
              agents: { type: 'integer' },
              containers: { type: 'integer' },
              timestamp: { type: 'integer' },
            },
          }),
          ...errorResponses([401]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Events (SSE)
    // -----------------------------------------------------------------------
    '/events': {
      get: {
        summary: 'Subscribe to server-sent events',
        operationId: 'subscribeEvents',
        tags: ['Events'],
        parameters: [
          queryParam('filter', 'Comma-separated event type filters (e.g. "agent.*,process.*")'),
        ],
        responses: {
          '200': {
            description: 'SSE event stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
          ...errorResponses([401]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Cron
    // -----------------------------------------------------------------------
    '/cron': {
      get: {
        summary: 'List cron jobs',
        operationId: 'listCronJobs',
        tags: ['Cron'],
        responses: {
          '200': successResponse('Cron job list', { type: 'array', items: ref('CronJob') }),
          ...errorResponses([401]),
        },
      },
      post: {
        summary: 'Create a cron job',
        operationId: 'createCronJob',
        tags: ['Cron'],
        requestBody: {
          required: true,
          content: jsonContent(ref('CronJobCreateRequest')),
        },
        responses: {
          '201': successResponse('Cron job created', ref('CronJob')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/cron/{id}': {
      delete: {
        summary: 'Delete a cron job',
        operationId: 'deleteCronJob',
        tags: ['Cron'],
        parameters: [pathParam('id', 'Cron job identifier')],
        responses: {
          '200': successResponse('Cron job deleted'),
          ...errorResponses([401, 404]),
        },
      },
      patch: {
        summary: 'Enable or disable a cron job',
        operationId: 'updateCronJob',
        tags: ['Cron'],
        parameters: [pathParam('id', 'Cron job identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
          }),
        },
        responses: {
          '200': successResponse('Cron job updated'),
          ...errorResponses([400, 401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Triggers
    // -----------------------------------------------------------------------
    '/triggers': {
      get: {
        summary: 'List event triggers',
        operationId: 'listTriggers',
        tags: ['Triggers'],
        responses: {
          '200': successResponse('Trigger list', { type: 'array', items: ref('Trigger') }),
          ...errorResponses([401]),
        },
      },
      post: {
        summary: 'Create an event trigger',
        operationId: 'createTrigger',
        tags: ['Triggers'],
        requestBody: {
          required: true,
          content: jsonContent(ref('TriggerCreateRequest')),
        },
        responses: {
          '201': successResponse('Trigger created', ref('Trigger')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/triggers/{id}': {
      delete: {
        summary: 'Delete an event trigger',
        operationId: 'deleteTrigger',
        tags: ['Triggers'],
        parameters: [pathParam('id', 'Trigger identifier')],
        responses: {
          '200': successResponse('Trigger deleted'),
          ...errorResponses([401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Integrations
    // -----------------------------------------------------------------------
    '/integrations': {
      get: {
        summary: 'List integrations',
        operationId: 'listIntegrations',
        tags: ['Integrations'],
        responses: {
          '200': successResponse('Integration list', { type: 'array', items: ref('Integration') }),
          ...errorResponses([401]),
        },
      },
      post: {
        summary: 'Register an integration',
        operationId: 'registerIntegration',
        tags: ['Integrations'],
        requestBody: {
          required: true,
          content: jsonContent(ref('IntegrationRegisterRequest')),
        },
        responses: {
          '201': successResponse('Integration registered', ref('Integration')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/integrations/{id}': {
      get: {
        summary: 'Get integration details',
        operationId: 'getIntegration',
        tags: ['Integrations'],
        parameters: [pathParam('id', 'Integration identifier')],
        responses: {
          '200': successResponse('Integration details', ref('Integration')),
          ...errorResponses([401, 404]),
        },
      },
      delete: {
        summary: 'Unregister an integration',
        operationId: 'unregisterIntegration',
        tags: ['Integrations'],
        parameters: [pathParam('id', 'Integration identifier')],
        responses: {
          '200': successResponse('Integration unregistered'),
          ...errorResponses([401, 404]),
        },
      },
      patch: {
        summary: 'Enable or disable an integration',
        operationId: 'updateIntegration',
        tags: ['Integrations'],
        parameters: [pathParam('id', 'Integration identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
          }),
        },
        responses: {
          '200': successResponse('Integration updated'),
          ...errorResponses([400, 401, 404]),
        },
      },
    },
    '/integrations/{id}/test': {
      post: {
        summary: 'Test integration connection',
        operationId: 'testIntegration',
        tags: ['Integrations'],
        parameters: [pathParam('id', 'Integration identifier')],
        responses: {
          '200': successResponse('Test result', { type: 'object' }),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/integrations/{id}/execute': {
      post: {
        summary: 'Execute an integration action',
        operationId: 'executeIntegrationAction',
        tags: ['Integrations'],
        parameters: [pathParam('id', 'Integration identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', description: 'Action to execute' },
              params: { type: 'object', description: 'Action parameters' },
            },
          }),
        },
        responses: {
          '200': successResponse('Execution result'),
          ...errorResponses([400, 401, 404]),
        },
      },
    },
    '/integrations/slack/commands': {
      post: {
        summary: 'Receive Slack slash commands',
        operationId: 'handleSlackCommand',
        tags: ['Slack'],
        security: [],
        requestBody: {
          required: true,
          content: { 'application/x-www-form-urlencoded': { schema: { type: 'string' } } },
        },
        responses: {
          '200': successResponse('Command acknowledged'),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/integrations/slack/events': {
      post: {
        summary: 'Receive Slack events',
        operationId: 'handleSlackEvent',
        tags: ['Slack'],
        security: [],
        requestBody: {
          required: true,
          content: jsonContent({ type: 'object' }),
        },
        responses: {
          '200': successResponse('Event acknowledged'),
          ...errorResponses([400, 401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Marketplace
    // -----------------------------------------------------------------------
    '/marketplace/plugins': {
      get: {
        summary: 'List installed plugins',
        operationId: 'listPlugins',
        tags: ['Marketplace'],
        parameters: [queryParam('category', 'Filter by category'), queryParam('q', 'Search query')],
        responses: {
          '200': successResponse('Plugin list', { type: 'array', items: ref('Plugin') }),
          ...errorResponses([401]),
        },
      },
      post: {
        summary: 'Install a plugin',
        operationId: 'installPlugin',
        tags: ['Marketplace'],
        requestBody: {
          required: true,
          content: jsonContent({ type: 'object', description: 'Plugin manifest' }),
        },
        responses: {
          '201': successResponse('Plugin installed', ref('Plugin')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/marketplace/plugins/{id}': {
      delete: {
        summary: 'Uninstall a plugin',
        operationId: 'uninstallPlugin',
        tags: ['Marketplace'],
        parameters: [pathParam('id', 'Plugin identifier')],
        responses: {
          '200': successResponse('Plugin uninstalled'),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/marketplace/templates': {
      get: {
        summary: 'List marketplace templates',
        operationId: 'listMarketplaceTemplates',
        tags: ['Marketplace'],
        parameters: [queryParam('category', 'Filter by category')],
        responses: {
          '200': successResponse('Marketplace template list', {
            type: 'array',
            items: ref('TemplateMarketplaceEntry'),
          }),
          ...errorResponses([401]),
        },
      },
      post: {
        summary: 'Publish a template to the marketplace',
        operationId: 'publishTemplate',
        tags: ['Marketplace'],
        requestBody: {
          required: true,
          content: jsonContent(ref('TemplateMarketplaceEntry')),
        },
        responses: {
          '201': successResponse('Template published', ref('TemplateMarketplaceEntry')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/marketplace/templates/{id}': {
      delete: {
        summary: 'Unpublish a template from the marketplace',
        operationId: 'unpublishTemplate',
        tags: ['Marketplace'],
        parameters: [pathParam('id', 'Template identifier')],
        responses: {
          '200': successResponse('Template unpublished'),
          ...errorResponses([401, 404]),
        },
      },
    },

    // -----------------------------------------------------------------------
    // Organizations
    // -----------------------------------------------------------------------
    '/orgs': {
      post: {
        summary: 'Create an organization',
        operationId: 'createOrg',
        tags: ['Organizations'],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Organization slug name' },
              displayName: { type: 'string', description: 'Display name' },
            },
          }),
        },
        responses: {
          '201': successResponse('Organization created', ref('Organization')),
          ...errorResponses([400, 401]),
        },
      },
      get: {
        summary: 'List organizations',
        operationId: 'listOrgs',
        tags: ['Organizations'],
        responses: {
          '200': successResponse('Organization list', {
            type: 'array',
            items: ref('Organization'),
          }),
          ...errorResponses([401]),
        },
      },
    },
    '/orgs/{orgId}': {
      get: {
        summary: 'Get organization details',
        operationId: 'getOrg',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        responses: {
          '200': successResponse('Organization details', ref('Organization')),
          ...errorResponses([401, 404]),
        },
      },
      delete: {
        summary: 'Delete an organization',
        operationId: 'deleteOrg',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        responses: {
          '200': successResponse('Organization deleted'),
          ...errorResponses([401, 403]),
        },
      },
      patch: {
        summary: 'Update organization settings',
        operationId: 'updateOrg',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            properties: {
              displayName: { type: 'string' },
              settings: { type: 'object' },
            },
          }),
        },
        responses: {
          '200': successResponse('Organization updated', ref('Organization')),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/orgs/{orgId}/members': {
      get: {
        summary: 'List organization members',
        operationId: 'listOrgMembers',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        responses: {
          '200': successResponse('Member list', { type: 'array', items: ref('OrgMember') }),
          ...errorResponses([401, 404]),
        },
      },
      post: {
        summary: 'Invite a member to the organization',
        operationId: 'inviteOrgMember',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['userId', 'role'],
            properties: {
              userId: { type: 'string', description: 'User identifier to invite' },
              role: { type: 'string', description: 'Member role' },
            },
          }),
        },
        responses: {
          '201': successResponse('Member invited'),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/orgs/{orgId}/members/{userId}': {
      delete: {
        summary: 'Remove a member from the organization',
        operationId: 'removeOrgMember',
        tags: ['Organizations'],
        parameters: [
          pathParam('orgId', 'Organization identifier'),
          pathParam('userId', 'User identifier'),
        ],
        responses: {
          '200': successResponse('Member removed'),
          ...errorResponses([401, 403]),
        },
      },
      patch: {
        summary: 'Update member role',
        operationId: 'updateOrgMemberRole',
        tags: ['Organizations'],
        parameters: [
          pathParam('orgId', 'Organization identifier'),
          pathParam('userId', 'User identifier'),
        ],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['role'],
            properties: {
              role: { type: 'string', description: 'New role' },
            },
          }),
        },
        responses: {
          '200': successResponse('Role updated'),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/orgs/{orgId}/teams': {
      post: {
        summary: 'Create a team',
        operationId: 'createTeam',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', description: 'Team name' },
              description: { type: 'string', description: 'Team description' },
            },
          }),
        },
        responses: {
          '201': successResponse('Team created', ref('Team')),
          ...errorResponses([400, 401]),
        },
      },
      get: {
        summary: 'List teams in organization',
        operationId: 'listTeams',
        tags: ['Organizations'],
        parameters: [pathParam('orgId', 'Organization identifier')],
        responses: {
          '200': successResponse('Team list', { type: 'array', items: ref('Team') }),
          ...errorResponses([401, 404]),
        },
      },
    },
    '/orgs/{orgId}/teams/{teamId}': {
      delete: {
        summary: 'Delete a team',
        operationId: 'deleteTeam',
        tags: ['Organizations'],
        parameters: [
          pathParam('orgId', 'Organization identifier'),
          pathParam('teamId', 'Team identifier'),
        ],
        responses: {
          '200': successResponse('Team deleted'),
          ...errorResponses([401, 403]),
        },
      },
    },
    '/orgs/{orgId}/teams/{teamId}/members': {
      post: {
        summary: 'Add a member to a team',
        operationId: 'addTeamMember',
        tags: ['Organizations'],
        parameters: [
          pathParam('orgId', 'Organization identifier'),
          pathParam('teamId', 'Team identifier'),
        ],
        requestBody: {
          required: true,
          content: jsonContent({
            type: 'object',
            required: ['userId'],
            properties: {
              userId: { type: 'string', description: 'User identifier' },
              role: { type: 'string', description: 'Team role' },
            },
          }),
        },
        responses: {
          '201': successResponse('Member added to team'),
          ...errorResponses([400, 401]),
        },
      },
    },
    '/orgs/{orgId}/teams/{teamId}/members/{userId}': {
      delete: {
        summary: 'Remove a member from a team',
        operationId: 'removeTeamMember',
        tags: ['Organizations'],
        parameters: [
          pathParam('orgId', 'Organization identifier'),
          pathParam('teamId', 'Team identifier'),
          pathParam('userId', 'User identifier'),
        ],
        responses: {
          '200': successResponse('Member removed from team'),
          ...errorResponses([401, 403]),
        },
      },
    },
  };
}

export function generateOpenApiSpec(): object {
  return {
    openapi: '3.0.0',
    info: {
      title: 'Aether OS API',
      version: '1.0.0',
      description: 'REST API for Aether OS — AI-native operating system',
      contact: { name: 'Aether OS Team' },
      license: { name: 'MIT' },
    },
    servers: [{ url: '/api/v1', description: 'Aether OS API v1' }],
    tags: [
      { name: 'Agents', description: 'Agent lifecycle management' },
      { name: 'Filesystem', description: 'Virtual filesystem operations' },
      { name: 'Templates', description: 'Agent templates' },
      { name: 'System', description: 'System status and metrics' },
      { name: 'Events', description: 'Server-Sent Events' },
      { name: 'Cron', description: 'Scheduled jobs' },
      { name: 'Triggers', description: 'Event-driven triggers' },
      { name: 'Integrations', description: 'External service integrations' },
      { name: 'Slack', description: 'Slack webhook endpoints' },
      { name: 'Marketplace', description: 'Plugin and template marketplace' },
      { name: 'Organizations', description: 'Multi-tenant RBAC' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: { ...getSchemas() },
    },
    paths: { ...getPaths() },
    security: [{ bearerAuth: [] }],
  };
}
