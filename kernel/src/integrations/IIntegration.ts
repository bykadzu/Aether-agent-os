/**
 * Aether Kernel - Integration Interface (v0.4 Wave 2)
 *
 * Defines the contract for external service integrations.
 * Each integration type (GitHub, Slack, etc.) implements this interface
 * to provide a uniform API for the IntegrationManager.
 */

export interface IntegrationActionDef {
  name: string;
  description: string;
  parameters?: Record<string, { type: string; description: string; required?: boolean }>;
}

export interface IIntegration {
  readonly type: string;
  getAvailableActions(): IntegrationActionDef[];
  testConnection(
    credentials: Record<string, string>,
  ): Promise<{ success: boolean; message: string }>;
  executeAction(
    action: string,
    params: Record<string, any>,
    credentials: Record<string, string>,
  ): Promise<any>;
}
