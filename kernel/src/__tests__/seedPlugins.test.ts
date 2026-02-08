/**
 * Aether Kernel - Seed Plugins Tests
 *
 * Validates the 3 reference plugin manifests have correct structure,
 * expected IDs, categories, tools, and settings.
 */

import { describe, it, expect } from 'vitest';
import { getDefaultPlugins } from '../seedPlugins.js';

describe('getDefaultPlugins', () => {
  const plugins = getDefaultPlugins();

  it('returns an array of 3 plugins', () => {
    expect(plugins).toHaveLength(3);
  });

  it('all plugins have required PluginRegistryManifest fields', () => {
    for (const p of plugins) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.version).toBe('string');
      expect(typeof p.author).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(typeof p.category).toBe('string');
      expect(typeof p.icon).toBe('string');
      expect(Array.isArray(p.tools)).toBe(true);
    }
  });

  it('has the expected plugin IDs', () => {
    const ids = plugins.map((p) => p.id);
    expect(ids).toContain('aether-plugin-s3');
    expect(ids).toContain('aether-plugin-slack');
    expect(ids).toContain('aether-plugin-github');
  });

  it('categories match expected values', () => {
    const byId = Object.fromEntries(plugins.map((p) => [p.id, p]));
    expect(byId['aether-plugin-s3'].category).toBe('data-sources');
    expect(byId['aether-plugin-slack'].category).toBe('notification-channels');
    expect(byId['aether-plugin-github'].category).toBe('tools');
  });

  it('each plugin has at least 3 tools', () => {
    for (const p of plugins) {
      expect(p.tools.length).toBeGreaterThanOrEqual(3);
      for (const tool of p.tools) {
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
        expect(tool.parameters).toBeDefined();
      }
    }
  });

  it('each plugin has settings defined', () => {
    for (const p of plugins) {
      expect(Array.isArray(p.settings)).toBe(true);
      expect(p.settings!.length).toBeGreaterThan(0);
      for (const setting of p.settings!) {
        expect(typeof setting.key).toBe('string');
        expect(typeof setting.label).toBe('string');
        expect(typeof setting.type).toBe('string');
      }
    }
  });

  it('each plugin has keywords', () => {
    for (const p of plugins) {
      expect(Array.isArray(p.keywords)).toBe(true);
      expect(p.keywords!.length).toBeGreaterThan(0);
    }
  });

  it('all versions are 1.0.0', () => {
    for (const p of plugins) {
      expect(p.version).toBe('1.0.0');
    }
  });

  it('all authors are Aether OS Team', () => {
    for (const p of plugins) {
      expect(p.author).toBe('Aether OS Team');
    }
  });
});
