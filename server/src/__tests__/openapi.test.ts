/**
 * Aether OS - OpenAPI Specification Tests
 *
 * Validates the generated OpenAPI 3.0.0 spec covers all endpoints
 * and includes required schemas, tags, and security definitions.
 */

import { describe, it, expect } from 'vitest';
import { generateOpenApiSpec } from '../openapi.js';

describe('generateOpenApiSpec', () => {
  const spec = generateOpenApiSpec() as any;

  it('returns a valid OpenAPI 3.0.0 object', () => {
    expect(spec.openapi).toBe('3.0.0');
    expect(spec).toHaveProperty('info');
    expect(spec).toHaveProperty('paths');
    expect(spec).toHaveProperty('components');
  });

  it('info section has title and version', () => {
    expect(spec.info.title).toBe('Aether OS API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.description).toContain('Aether OS');
    expect(spec.info.license.name).toBe('MIT');
  });

  it('has all 11 tags', () => {
    const tagNames = spec.tags.map((t: any) => t.name);
    expect(tagNames).toHaveLength(11);
    expect(tagNames).toContain('Agents');
    expect(tagNames).toContain('Filesystem');
    expect(tagNames).toContain('Templates');
    expect(tagNames).toContain('System');
    expect(tagNames).toContain('Events');
    expect(tagNames).toContain('Cron');
    expect(tagNames).toContain('Triggers');
    expect(tagNames).toContain('Integrations');
    expect(tagNames).toContain('Slack');
    expect(tagNames).toContain('Marketplace');
    expect(tagNames).toContain('Organizations');
  });

  it('defines bearerAuth security scheme', () => {
    expect(spec.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('paths object covers all 53 endpoint paths', () => {
    const pathKeys = Object.keys(spec.paths);
    // Count total operations (GET, POST, DELETE, PATCH, PUT) across all paths
    let opCount = 0;
    for (const path of pathKeys) {
      const methods = Object.keys(spec.paths[path]);
      opCount += methods.length;
    }
    // 52 original endpoints + 1 openapi.json = 53
    expect(opCount).toBeGreaterThanOrEqual(53);
  });

  it('includes specific required paths', () => {
    const pathKeys = Object.keys(spec.paths);
    expect(pathKeys).toContain('/agents');
    expect(pathKeys).toContain('/agents/{uid}');
    expect(pathKeys).toContain('/agents/{uid}/message');
    expect(pathKeys).toContain('/agents/{uid}/timeline');
    expect(pathKeys).toContain('/agents/{uid}/memory');
    expect(pathKeys).toContain('/agents/{uid}/plan');
    expect(pathKeys).toContain('/agents/{uid}/profile');
    expect(pathKeys).toContain('/fs/{path}');
    expect(pathKeys).toContain('/templates');
    expect(pathKeys).toContain('/templates/{id}');
    expect(pathKeys).toContain('/system/status');
    expect(pathKeys).toContain('/system/metrics');
    expect(pathKeys).toContain('/events');
    expect(pathKeys).toContain('/cron');
    expect(pathKeys).toContain('/cron/{id}');
    expect(pathKeys).toContain('/triggers');
    expect(pathKeys).toContain('/triggers/{id}');
    expect(pathKeys).toContain('/integrations');
    expect(pathKeys).toContain('/integrations/{id}');
    expect(pathKeys).toContain('/integrations/{id}/test');
    expect(pathKeys).toContain('/integrations/{id}/execute');
    expect(pathKeys).toContain('/integrations/slack/commands');
    expect(pathKeys).toContain('/integrations/slack/events');
    expect(pathKeys).toContain('/marketplace/plugins');
    expect(pathKeys).toContain('/marketplace/plugins/{id}');
    expect(pathKeys).toContain('/marketplace/templates');
    expect(pathKeys).toContain('/marketplace/templates/{id}');
    expect(pathKeys).toContain('/orgs');
    expect(pathKeys).toContain('/orgs/{orgId}');
    expect(pathKeys).toContain('/orgs/{orgId}/members');
    expect(pathKeys).toContain('/orgs/{orgId}/members/{userId}');
    expect(pathKeys).toContain('/orgs/{orgId}/teams');
    expect(pathKeys).toContain('/orgs/{orgId}/teams/{teamId}');
    expect(pathKeys).toContain('/orgs/{orgId}/teams/{teamId}/members');
    expect(pathKeys).toContain('/orgs/{orgId}/teams/{teamId}/members/{userId}');
    expect(pathKeys).toContain('/openapi.json');
  });

  it('component schemas are defined', () => {
    const schemaNames = Object.keys(spec.components.schemas);
    expect(schemaNames).toContain('Agent');
    expect(schemaNames).toContain('AgentSpawnRequest');
    expect(schemaNames).toContain('Template');
    expect(schemaNames).toContain('Organization');
    expect(schemaNames).toContain('OrgMember');
    expect(schemaNames).toContain('Team');
    expect(schemaNames).toContain('Integration');
    expect(schemaNames).toContain('IntegrationRegisterRequest');
    expect(schemaNames).toContain('CronJob');
    expect(schemaNames).toContain('CronJobCreateRequest');
    expect(schemaNames).toContain('Trigger');
    expect(schemaNames).toContain('TriggerCreateRequest');
    expect(schemaNames).toContain('Plugin');
    expect(schemaNames).toContain('TemplateMarketplaceEntry');
    expect(schemaNames).toContain('Error');
    expect(schemaNames).toContain('SuccessResponse');
    expect(schemaNames).toContain('ListResponse');
  });

  it('Agent schema has required properties', () => {
    const agent = spec.components.schemas.Agent;
    expect(agent.properties).toHaveProperty('uid');
    expect(agent.properties).toHaveProperty('role');
    expect(agent.properties).toHaveProperty('goal');
    expect(agent.properties).toHaveProperty('model');
    expect(agent.properties).toHaveProperty('status');
    expect(agent.properties).toHaveProperty('pid');
    expect(agent.properties).toHaveProperty('ttyId');
    expect(agent.properties).toHaveProperty('created_at');
  });

  it('AgentSpawnRequest has required fields', () => {
    const schema = spec.components.schemas.AgentSpawnRequest;
    expect(schema.required).toContain('role');
    expect(schema.required).toContain('goal');
  });

  it('Slack endpoints have no auth requirement', () => {
    const slackCommands = spec.paths['/integrations/slack/commands'].post;
    const slackEvents = spec.paths['/integrations/slack/events'].post;
    expect(slackCommands.security).toEqual([]);
    expect(slackEvents.security).toEqual([]);
  });

  it('server is configured for /api/v1', () => {
    expect(spec.servers[0].url).toBe('/api/v1');
  });
});
