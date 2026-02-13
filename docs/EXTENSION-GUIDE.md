# Aether OS Extension Guide

> How to extend, customize, and build on top of Aether OS.
> Last updated: 2026-02-13 (post-v0.5)

---

## Table of Contents

1. [How to Add a New Tool](#1-how-to-add-a-new-tool)
2. [How to Add a New Kernel Subsystem](#2-how-to-add-a-new-kernel-subsystem)
3. [How to Add a Plugin](#3-how-to-add-a-plugin)
4. [How to Add a New LLM Provider](#4-how-to-add-a-new-llm-provider)
5. [How to Add a UI App](#5-how-to-add-a-ui-app)
6. [How to Add an Integration](#6-how-to-add-an-integration)
7. [How to Add an Agent Type / Role](#7-how-to-add-an-agent-type--role)

---

## 1. How to Add a New Tool

Tools are the actions agents can take. They are defined in `runtime/src/tools.ts` as an array of `ToolDefinition` objects and executed within the AgentLoop's act phase.

### Step 1: Define the tool

Open `runtime/src/tools.ts` and add a new entry to the tools array:

```typescript
{
  name: 'my_new_tool',
  description: 'One-line description of what this tool does. Be specific -- the LLM reads this.',
  parameters: {
    type: 'object',
    properties: {
      input_param: {
        type: 'string',
        description: 'What this parameter is for',
      },
      optional_param: {
        type: 'number',
        description: 'An optional numeric parameter',
      },
    },
    required: ['input_param'],
  },
  execute: async (args, context) => {
    // context provides:
    //   context.kernel   -- Kernel instance (access all subsystems)
    //   context.pid      -- Current agent's PID
    //   context.uid      -- Current agent's UID ('agent_{pid}')
    //   context.config   -- Agent's AgentConfig
    //   context.signal   -- AbortSignal for cancellation

    const { input_param, optional_param } = args;

    // Do the work...
    const result = await someOperation(input_param);

    // Return a string result (this becomes the observation for the agent)
    return `Tool completed: ${result}`;
  },
}
```

### Step 2: Access kernel subsystems

The `context.kernel` object gives you access to every subsystem:

```typescript
// Filesystem
const fs = context.kernel.fs;
await fs.writeFile(`/home/${context.uid}/output.txt`, content);

// State persistence
const state = context.kernel.state;
state.logAction(context.pid, step, 'action', 'my_new_tool', content);

// EventBus (notify UI)
context.kernel.bus.emit('my_tool.completed', { pid: context.pid, result });

// Memory
const memory = context.kernel.memory;
memory.store({ agent_uid: context.uid, layer: 'semantic', content: 'learned fact' });

// Container execution
const container = context.kernel.containers;
const output = await container.exec(context.pid, 'ls -la /workspace');

// Browser
const browser = context.kernel.browser;
const screenshot = await browser.getScreenshot(sessionId);
```

### Step 3: Add the tool to the LLM's tool list

Tools are automatically included in the LLM's available tools list since they're part of the tools array. No additional registration needed. The AgentLoop in `runtime/src/AgentLoop.ts` passes all tools to the LLM's `chat()` method.

### Step 4: Update shared types (if adding new events)

If your tool emits new event types, add them to `shared/src/protocol.ts`:

```typescript
// In the KernelEvent discriminated union:
| { type: 'my_tool.completed'; pid: number; result: string }
```

### Tool Design Guidelines

- **Return strings.** The tool result becomes the agent's observation. Make it informative but concise.
- **Handle errors gracefully.** Return error messages as strings (e.g., `"Error: file not found"`), don't throw unless truly fatal.
- **Check the abort signal.** For long-running operations, check `context.signal.aborted` periodically.
- **Emit events.** If the UI should react to your tool's actions, emit events on the EventBus.
- **Log actions.** Use `state.logAction()` so the action appears in the agent's log history.
- **Respect sandboxing.** Use `context.kernel.fs` (not raw `fs`) for file operations. Use `context.kernel.containers.exec()` for shell commands in sandboxed mode.

---

## 2. How to Add a New Kernel Subsystem

Kernel subsystems are classes instantiated by `Kernel.ts` that provide a specific capability. They communicate via the EventBus and may use the StateStore for persistence.

### Step 1: Create the subsystem file

Create `kernel/src/MySubsystem.ts`:

```typescript
/**
 * Aether Kernel - My Subsystem
 *
 * Brief description of what this subsystem does.
 */

import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';

export class MySubsystem {
  private bus: EventBus;
  private state: StateStore;

  constructor(bus: EventBus, state: StateStore) {
    this.bus = bus;
    this.state = state;
  }

  /**
   * Initialize the subsystem. Called during kernel boot.
   * Use this for async initialization (DB migrations, external checks, etc.)
   */
  async init(): Promise<void> {
    // Set up event listeners
    this.bus.on('some.event', (data) => {
      this.handleSomeEvent(data);
    });
  }

  /**
   * Shutdown the subsystem. Called during kernel shutdown.
   */
  async shutdown(): Promise<void> {
    // Clean up resources
  }

  // Public API methods...
  doSomething(param: string): string {
    const result = `processed: ${param}`;
    this.bus.emit('my_subsystem.done', { result });
    return result;
  }

  private handleSomeEvent(data: any): void {
    // React to events from other subsystems
  }
}
```

### Step 2: Add persistence (if needed)

If your subsystem needs to persist data, add a table to `kernel/src/StateStore.ts`:

1. Add the `CREATE TABLE` statement in `initSchema()`:

```typescript
// In initSchema():
CREATE TABLE IF NOT EXISTS my_table (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_my_table_created ON my_table(created_at);
```

2. Add prepared statements in `initStatements()`:

```typescript
// In the stmts object declaration (type annotation):
insertMyRecord: Database.Statement;
getMyRecord: Database.Statement;
getAllMyRecords: Database.Statement;
deleteMyRecord: Database.Statement;

// In initStatements():
insertMyRecord: this.db.prepare(`
  INSERT INTO my_table (id, data, created_at) VALUES (@id, @data, @createdAt)
`),
getMyRecord: this.db.prepare(`SELECT * FROM my_table WHERE id = ?`),
getAllMyRecords: this.db.prepare(`SELECT * FROM my_table ORDER BY created_at DESC`),
deleteMyRecord: this.db.prepare(`DELETE FROM my_table WHERE id = ?`),
```

3. Add public methods to StateStore for your subsystem:

```typescript
insertMyRecord(record: { id: string; data: string; createdAt: number }): void {
  this.stmts.insertMyRecord.run(record);
}

getMyRecord(id: string): any {
  return this.stmts.getMyRecord.get(id);
}
```

### Step 3: Wire into the Kernel

Open `kernel/src/Kernel.ts`:

1. Import your subsystem:
```typescript
import { MySubsystem } from './MySubsystem.js';
```

2. Add as a property:
```typescript
readonly mySubsystem: MySubsystem;
```

3. Instantiate in the constructor:
```typescript
this.mySubsystem = new MySubsystem(this.bus, this.state);
```

4. Initialize in `boot()`:
```typescript
await this.mySubsystem.init();
```

5. Shut down in `shutdown()`:
```typescript
await this.mySubsystem.shutdown();
```

6. Add command handling in `handleCommand()`:
```typescript
case 'my_subsystem.doSomething': {
  const result = this.mySubsystem.doSomething(cmd.param);
  return { type: 'my_subsystem.result', result };
}
```

### Step 4: Add protocol types

In `shared/src/protocol.ts`, add command and event types:

```typescript
// Command:
| { type: 'my_subsystem.doSomething'; param: string }

// Event:
| { type: 'my_subsystem.result'; result: string }
| { type: 'my_subsystem.done'; result: string }
```

---

## 3. How to Add a Plugin

Plugins extend agent capabilities at runtime. Each plugin is a directory loaded per-agent from their `~/.config/plugins/` directory.

### Plugin Structure

```
my-plugin/
├── manifest.json    # Plugin metadata and tool declarations
└── handler.js       # Exported functions for each tool/hook
```

### Step 1: Create manifest.json

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What this plugin does",
  "author": "Your Name",
  "tools": [
    {
      "name": "my_plugin_action",
      "description": "What this action does",
      "parameters": {
        "type": "object",
        "properties": {
          "input": {
            "type": "string",
            "description": "Input parameter"
          }
        },
        "required": ["input"]
      }
    }
  ],
  "hooks": {
    "onAgentStart": true,
    "onAgentComplete": true
  }
}
```

### Step 2: Create handler.js

```javascript
// handler.js
// Each exported function matches a tool name or hook name from the manifest.

export async function my_plugin_action(args, context) {
  const { input } = args;
  // Process...
  return `Plugin result: ${input}`;
}

export async function onAgentStart(context) {
  // Called when the agent starts (if declared in manifest.hooks)
  console.log(`Plugin initialized for agent ${context.uid}`);
}

export async function onAgentComplete(context) {
  // Called when the agent completes
}
```

### Step 3: Install the plugin

Place the plugin directory in the agent's plugin path:
```
~/.aether/home/agent_{pid}/.config/plugins/my-plugin/
```

Or use the `PluginManager` API:
```typescript
kernel.pluginManager.installPlugin(agentUid, pluginPath);
```

The `PluginManager.loadPluginsForAgent(agentUid)` method is called by the AgentLoop at startup. It reads each plugin's manifest, validates handler paths (security: no directory traversal), and dynamically imports the handler module.

### Plugin Security

- Handler paths are validated to stay within the plugin directory (no `..` traversal)
- Plugins run in the same Node.js process as the kernel (no sandboxing)
- Only install trusted plugins

---

## 4. How to Add a New LLM Provider

LLM providers are classes implementing the `LLMProvider` interface. They live in `runtime/src/llm/`.

### Step 1: Implement the interface

Create `runtime/src/llm/MyProvider.ts`:

```typescript
import type {
  LLMProvider,
  ChatMessage,
  LLMResponse,
  ToolDefinition,
} from './LLMProvider.js';

export class MyProvider implements LLMProvider {
  name = 'myprovider';
  private apiKey: string;
  private model: string;

  constructor(model?: string) {
    this.apiKey = process.env.MYPROVIDER_API_KEY || '';
    this.model = model || 'my-default-model';
  }

  /**
   * Check if this provider is configured and available.
   */
  isAvailable(): boolean {
    return !!this.apiKey;
  }

  /**
   * Whether this provider supports vision (image analysis).
   */
  supportsVision(): boolean {
    return true; // or false
  }

  /**
   * Main chat completion method.
   * Takes conversation messages + available tools, returns LLM response.
   */
  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<LLMResponse> {
    // Convert Aether message format to your API's format
    const apiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    // Convert Aether tool definitions to your API's function format
    const apiFunctions = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    // Call your LLM API
    const response = await fetch('https://api.myprovider.com/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: apiMessages,
        tools: apiFunctions,
      }),
    });

    const data = await response.json();

    // Convert response to Aether format
    return {
      content: data.message?.content || '',
      toolCalls: data.message?.tool_calls?.map((tc: any) => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })) || [],
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
    };
  }

  /**
   * Optional: Analyze an image (if supportsVision() returns true).
   */
  async analyzeImage(
    imageBase64: string,
    prompt: string,
  ): Promise<string> {
    // Call your vision API
    return 'Image analysis result';
  }
}
```

### Step 2: Register the provider

Open `runtime/src/llm/index.ts` and add your provider:

1. Import:
```typescript
import { MyProvider } from './MyProvider.js';
```

2. Add to the provider registry:
```typescript
// In the providers map/switch:
case 'myprovider':
  return new MyProvider(model);
```

3. Add to `listProviders()`:
```typescript
{ name: 'myprovider', available: new MyProvider().isAvailable() }
```

### Step 3: Support model string parsing

The `parseModelString()` function handles strings like `"myprovider:my-model-v3"`:

```typescript
// In parseModelString():
// Already handled generically: splits on ':' -> { provider, model }
// No changes needed if your provider name matches.
```

### Step 4: Add environment variable

Document your new env var in `.env.example` and `docs/ARCHITECTURE.md`:
```
MYPROVIDER_API_KEY=your-api-key-here
```

### Step 5: Add to ModelRouter (optional)

If you want the ModelRouter to use your provider for certain tiers, update `kernel/src/ModelRouter.ts`:

```typescript
// In the routing table:
flash: 'myprovider:my-fast-model',
standard: 'myprovider:my-balanced-model',
frontier: 'myprovider:my-best-model',
```

### LLM Provider Interface Reference

```typescript
interface LLMProvider {
  name: string;
  chat(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<LLMResponse>;
  isAvailable(): boolean;
  supportsVision?(): boolean;
  analyzeImage?(imageBase64: string, prompt: string): Promise<string>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;     // For tool result messages
  name?: string;           // Tool name for tool results
}

interface LLMResponse {
  content: string;         // Text response
  toolCalls: ToolCall[];   // Tool calls requested by the LLM
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: object;      // JSON Schema
}
```

---

## 5. How to Add a UI App

Desktop apps are React components rendered inside draggable/resizable windows. They are lazy-loaded for performance.

### Step 1: Create the component

Create `components/apps/MyApp.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { useKernel } from '../../services/useKernel';

interface MyAppProps {
  windowId: string;
}

export default function MyApp({ windowId }: MyAppProps) {
  const { sendCommand, events } = useKernel();
  const [data, setData] = useState<string>('');

  useEffect(() => {
    // Subscribe to kernel events
    const unsub = events.on('my_subsystem.result', (event) => {
      setData(event.result);
    });
    return unsub;
  }, []);

  const handleAction = async () => {
    // Send command to kernel
    const response = await sendCommand({
      type: 'my_subsystem.doSomething',
      param: 'hello',
    });
    setData(response.result);
  };

  return (
    <div style={{ padding: '16px', height: '100%' }}>
      <h2>My App</h2>
      <button onClick={handleAction}>Do Something</button>
      <pre>{data}</pre>
    </div>
  );
}
```

### Step 2: Register in App.tsx

Open `App.tsx` and add your app:

1. Add a lazy import:
```typescript
const MyApp = lazy(() => import('./components/apps/MyApp'));
```

2. Add to the app registry (the apps array/map):
```typescript
{
  id: 'my-app',
  name: 'My App',
  icon: '/icons/my-app.svg',  // or an inline SVG component
  component: MyApp,
  defaultSize: { width: 600, height: 400 },
  category: 'tools',  // or 'productivity', 'development', 'media', 'system'
}
```

3. Add to the Dock if it should appear by default:
The Dock (`components/os/Dock.tsx`) renders from the apps registry. Adding to the registry makes it available through the app launcher.

### Step 3: Add an icon

Place an SVG icon at `public/icons/my-app.svg` (keep it simple, single-color works best with the theme system).

### UI Patterns

- **Use `useKernel()`** for all kernel communication (WebSocket commands and event subscriptions).
- **Lazy-load heavy dependencies** (Monaco, xterm.js, etc.) with `React.lazy()` + `Suspense`.
- **Responsive design** -- Windows can be resized to any size. Use CSS flexbox/grid.
- **Dark mode support** -- Use CSS variables from the theme system, not hardcoded colors.
- **Error boundaries** -- Wrap in `ErrorBoundary` for graceful crash recovery.

---

## 6. How to Add an Integration

Integrations connect Aether OS to external services (GitHub, Slack, S3, Discord, etc.). They are managed by the `IntegrationManager` subsystem.

### Step 1: Define the integration type

In `shared/src/protocol.ts`, add your integration type to the `IntegrationType` union:

```typescript
type IntegrationType = 'github' | 'slack' | 's3' | 'discord' | 'my_service';
```

### Step 2: Add connection logic

In `kernel/src/IntegrationManager.ts`, add a handler for your integration type:

```typescript
// In the connect/test method:
case 'my_service': {
  // Validate credentials
  const { apiKey, endpoint } = credentials;
  if (!apiKey) throw new Error('API key required');

  // Test connection
  const resp = await fetch(`${endpoint}/health`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) throw new Error('Connection failed');

  return { status: 'connected' };
}
```

### Step 3: Add execution methods

Add methods that agents can call through tools:

```typescript
async executeMyService(integrationId: string, action: string, params: any): Promise<any> {
  const integration = this.state.getIntegration(integrationId);
  if (!integration || !integration.enabled) {
    throw new Error('Integration not found or disabled');
  }

  const credentials = JSON.parse(integration.credentials);

  switch (action) {
    case 'send_notification':
      return this.myServiceSendNotification(credentials, params);
    case 'fetch_data':
      return this.myServiceFetchData(credentials, params);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
```

### Step 4: Add agent tools (optional)

If agents should be able to use your integration directly, add tools in `runtime/src/tools.ts`:

```typescript
{
  name: 'my_service_send',
  description: 'Send a notification via My Service integration',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Message to send' },
      channel: { type: 'string', description: 'Target channel' },
    },
    required: ['message'],
  },
  execute: async (args, context) => {
    const integrations = context.kernel.integrations;
    // Find first enabled my_service integration
    const all = integrations.listByType('my_service');
    if (all.length === 0) return 'Error: My Service integration not configured';

    const result = await integrations.executeMyService(
      all[0].id,
      'send_notification',
      args,
    );
    return `Sent: ${result.id}`;
  },
}
```

### Step 5: Add UI settings

Add a configuration panel in `components/apps/SettingsApp.tsx` under the Integrations section. The pattern follows the existing GitHub/Slack/S3 panels: credential input fields, a "Test Connection" button, and enable/disable toggle.

### Integration Data Flow

```
UI: SettingsApp -> "Connect My Service"
  |
  v
kernel.handleCommand({ type: 'integration.connect', config })
  |
  v
IntegrationManager.connect(config)
  -> validates credentials
  -> tests connection
  -> stores in SQLite: integrations table
  -> emits 'integration.connected'
  |
  v
Agent uses my_service_send tool
  -> IntegrationManager.executeMyService()
  -> logs to integration_logs table
  -> returns result to agent
```

---

## 7. How to Add an Agent Type / Role

Agent types (roles) define the personality, capabilities, and default behavior of agents. They're defined as templates in the runtime layer.

### Step 1: Add a template

Open `runtime/src/templates.ts` and add a new template:

```typescript
{
  id: 'my-specialist',
  name: 'My Specialist',
  description: 'An agent specialized in doing X',
  icon: 'wrench',  // emoji or icon name
  category: 'development',  // or 'research', 'writing', 'data', 'general'
  config: {
    role: 'my-specialist',
    goal: '',  // User fills this in
    model: 'gemini:gemini-2.0-flash',  // Default model
    priority: 3,
    maxSteps: 50,
    sandbox: false,
    tools: [
      // Optionally restrict to specific tools
      'read_file', 'write_file', 'run_command', 'my_custom_tool',
    ],
  },
  suggestedGoals: [
    'Analyze the codebase and generate a report',
    'Set up CI/CD pipeline for the project',
    'Review and optimize database queries',
  ],
  systemPromptPrefix: `You are a specialist in X. You have deep expertise in:
- Capability 1
- Capability 2
- Capability 3

When approaching tasks, you should:
1. First analyze the current state
2. Plan your approach
3. Execute methodically
4. Verify results`,
}
```

### Step 2: Template marketplace (optional)

To publish your template to the marketplace, use the `TemplateManager`:

```typescript
kernel.handleCommand({
  type: 'template.publish',
  template: {
    name: 'My Specialist',
    description: 'An agent specialized in doing X',
    icon: 'wrench',
    category: 'development',
    config: { role: 'my-specialist', goal: '', maxSteps: 50 },
    suggestedGoals: ['...'],
    author: 'your-username',
    tags: ['development', 'specialist'],
  },
});
```

Templates appear in the agent creation UI dropdown and in the AppStore/marketplace UI.

### Step 3: Custom system prompt behavior

The system prompt is built in `runtime/src/AgentLoop.ts`. The `role` and `goal` from the AgentConfig are injected into the prompt. If you added a `systemPromptPrefix` in the template, it's prepended to the standard system prompt.

The standard prompt structure:

```
You are {role}. Your goal: {goal}

{systemPromptPrefix from template, if any}

{Memory context: relevant memories from previous sessions}

{Active plan: current plan tree rendered as markdown checklist}

You have access to the following tools: {tool list}

{Additional context: user messages, IPC messages}
```

### Role-Specific Tool Restrictions

If `config.tools` is specified in the template, only those tools are available to the agent. If omitted, all 30+ built-in tools are available. This lets you create focused agents:

```typescript
// A read-only researcher agent:
tools: ['read_file', 'list_files', 'browse_web', 'recall', 'remember', 'think', 'complete'],

// A full-access developer agent:
tools: undefined,  // all tools available
```

### Agent Configuration Reference

```typescript
interface AgentConfig {
  role: string;          // Agent role identifier
  goal: string;          // Natural language goal
  model?: string;        // LLM model string ('provider:model')
  priority?: number;     // 1-5 (1=highest), default 3
  maxSteps?: number;     // Max loop iterations, default 50
  sandbox?: boolean;     // Run in Docker container
  graphical?: boolean;   // Graphical desktop (Xvfb + VNC)
  gpu?: GPUConfig;       // GPU passthrough config
  tools?: string[];      // Restrict available tools
  teamId?: string;       // Team association
  parentGoal?: string;   // For delegated sub-tasks
  context?: string;      // Additional context injected into prompt
}
```

---

## General Extension Patterns

### Adding Protocol Types

All type definitions live in `shared/src/protocol.ts`. When extending the system:

1. Add command types to the `KernelCommand` discriminated union
2. Add event types to the `KernelEvent` discriminated union
3. Add any supporting interfaces/types
4. Run `npm run typecheck` to verify the compiler catches all switch cases

### Adding Constants

System-wide constants go in `shared/src/constants.ts`:

```typescript
export const MY_CONSTANT = 42;
export const MY_TIMEOUT_MS = 30000;
```

### Adding REST API Endpoints

REST endpoints are defined in `server/src/routes/v1.ts`. Follow the existing pattern:

```typescript
router.get('/api/v1/my-resource', requireAuth, async (req, res) => {
  const result = await kernel.handleCommand({ type: 'my.list' }, req.user);
  res.json(result);
});

router.post('/api/v1/my-resource', requireAuth, async (req, res) => {
  const result = await kernel.handleCommand(
    { type: 'my.create', ...req.body },
    req.user,
  );
  res.json(result);
});
```

### Testing

Tests live in `kernel/src/__tests__/`. Use vitest:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { MySubsystem } from '../MySubsystem.js';
import { EventBus } from '../EventBus.js';

describe('MySubsystem', () => {
  let bus: EventBus;
  let sub: MySubsystem;

  beforeEach(() => {
    bus = new EventBus();
    sub = new MySubsystem(bus);
  });

  it('should do something', () => {
    const result = sub.doSomething('test');
    expect(result).toBe('processed: test');
  });
});
```

Run tests:
```bash
npm test                    # All tests
npm test -- --grep MySubsystem  # Just your tests
```

### Build and Verify

After making changes:

```bash
npm run typecheck          # TypeScript compiler check
npm run lint               # ESLint
npm test                   # Run all tests
npm run build              # Full production build
npm run dev                # Start development server with hot reload
```
