import { describe, it, expect } from 'vitest';
import * as KernelIndex from '../index.js';

describe('kernel index entry point', () => {
  it('can be imported without errors', () => {
    expect(KernelIndex).toBeDefined();
  });

  describe('exported classes', () => {
    const expectedClasses = [
      'Kernel',
      'EventBus',
      'ProcessManager',
      'VirtualFS',
      'PTYManager',
      'ContainerManager',
      'VNCManager',
      'BrowserManager',
      'PluginManager',
      'SnapshotManager',
      'StateStore',
      'MemoryManager',
      'CronManager',
      'AuthManager',
      'ClusterManager',
      'AppManager',
      'WebhookManager',
      'PluginRegistryManager',
      'IntegrationManager',
      'TemplateManager',
      'SkillManager',
      'RemoteAccessManager',
      'ResourceGovernor',
      'AuditLogger',
      'ModelRouter',
      'MetricsExporter',
      'ToolCompatLayer',
      'MCPManager',
      'OpenClawAdapter',
      'SlackIntegration',
    ] as const;

    it.each(expectedClasses)('exports %s as a function (class constructor)', (name) => {
      const exported = (KernelIndex as Record<string, unknown>)[name];
      expect(exported).toBeDefined();
      expect(typeof exported).toBe('function');
    });
  });

  describe('exported utility functions', () => {
    it('exports verifySlackSignature as a function', () => {
      expect(KernelIndex.verifySlackSignature).toBeDefined();
      expect(typeof KernelIndex.verifySlackSignature).toBe('function');
    });

    it('exports renderTemplate as a function', () => {
      expect(KernelIndex.renderTemplate).toBeDefined();
      expect(typeof KernelIndex.renderTemplate).toBe('function');
    });

    it('exports parseSlashCommand as a function', () => {
      expect(KernelIndex.parseSlashCommand).toBeDefined();
      expect(typeof KernelIndex.parseSlashCommand).toBe('function');
    });
  });

  it('does not export unexpected top-level keys', () => {
    const expectedExports = new Set([
      'Kernel',
      'EventBus',
      'ProcessManager',
      'VirtualFS',
      'PTYManager',
      'ContainerManager',
      'VNCManager',
      'BrowserManager',
      'PluginManager',
      'SnapshotManager',
      'StateStore',
      'MemoryManager',
      'CronManager',
      'AuthManager',
      'ClusterManager',
      'AppManager',
      'WebhookManager',
      'PluginRegistryManager',
      'IntegrationManager',
      'TemplateManager',
      'SkillManager',
      'RemoteAccessManager',
      'ResourceGovernor',
      'AuditLogger',
      'ModelRouter',
      'MetricsExporter',
      'ToolCompatLayer',
      'MCPManager',
      'OpenClawAdapter',
      'SlackIntegration',
      'verifySlackSignature',
      'renderTemplate',
      'parseSlashCommand',
    ]);

    const actualExports = Object.keys(KernelIndex);
    for (const key of actualExports) {
      expect(expectedExports.has(key)).toBe(true);
    }
  });

  it('exports the correct total number of named exports', () => {
    // 30 classes + 3 utility functions = 33 total
    expect(Object.keys(KernelIndex)).toHaveLength(33);
  });
});
