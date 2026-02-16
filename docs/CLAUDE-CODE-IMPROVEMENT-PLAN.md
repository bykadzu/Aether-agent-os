# Aether-agent-os: Claude Code Improvement Plan

Copy-paste these prompts into Claude Code. Each prompt is self-contained and
uses agent teams (parallel subagents) for maximum throughput.

Run them in order — later phases depend on earlier ones.

---

## Phase 0: Critical Security Fixes (Day 1-2)

### Prompt 0A: Fix RBAC Bypass + Default Credentials + JWT Validation

```
Fix 3 critical security vulnerabilities in this codebase. Use agent teams to fix all 3 in parallel, then run tests.

**Fix 1 — RBAC Bypass (kernel/src/AuthManager.ts)**
- Line 868: `hasPermission()` returns `true` when orgs exist but no orgId specified. Change to return `false`.
- Lines 986-989: `checkPermission()` returns `true` when no policies exist (backward compat). Change to return `false` — deny by default.
- Add a comment explaining the deny-by-default policy.

**Fix 2 — Default Admin Credentials**
- In `shared/src/constants.ts` lines 61-62: remove the hardcoded `AUTH_DEFAULT_ADMIN_USER = 'admin'` and `AUTH_DEFAULT_ADMIN_PASS = 'aether'`.
- In `kernel/src/AuthManager.ts` lines 127-141: replace the hardcoded credentials with `crypto.randomBytes(16).toString('hex')` for the password. Print the generated password to console ONCE on first boot only. Add a warning: "CHANGE THIS PASSWORD IMMEDIATELY".
- Remove the password from any console.log statements after initial display.

**Fix 3 — JWT Algorithm Validation (kernel/src/AuthManager.ts)**
- In `verifyToken()` (lines 184-213): after splitting the token into parts, parse the header JSON and verify that `header.alg === 'HS256'`. If not, return null immediately before doing any signature verification.

After all 3 fixes, run the full test suite with `npx vitest run` and fix any test failures caused by the changes. The RBAC change will likely break tests that assume "no policies = allow" — update those tests to explicitly grant permissions first.
```

### Prompt 0B: Docker Container Hardening

```
Harden Docker container creation in kernel/src/ContainerManager.ts. The `create()` method (lines 192-265) is missing critical security flags.

1. After the `--cpus` argument (around line 200), add these security flags to the `args` array:
   - `'--cap-drop=ALL'` — drop all Linux capabilities
   - `'--no-new-privileges'` — prevent privilege escalation
   - `'--security-opt', 'no-new-privileges:true'` — belt and suspenders
   - `'--read-only'` — read-only root filesystem
   - `'--tmpfs', '/tmp:rw,noexec,nosuid,size=256m'` — writable /tmp with noexec

2. Change the shared volume mount (around line 213) from `:rw` to `:ro,noexec,nosuid`:
   ```
   return ['-v', `${sharedDir}:/home/agent/shared:ro,noexec,nosuid`];
   ```

3. Keep the agent home directory as `:rw` but add `:nosuid,nodev`:
   ```
   '-v', `${hostVolumePath}:${internalHomePath || '/home/aether'}:rw,nosuid,nodev`,
   ```

4. For GPU passthrough (line 245), change the default from `'all'` to `'0'` (single GPU).

Run `npx vitest run kernel/src/__tests__/ContainerManager` after and fix any test failures.
```

### Prompt 0C: Fix Command Injection in run_command

```
Fix the command injection vulnerability in runtime/src/tools.ts, the `run_command` tool (lines 226-297).

The problem: when no Docker container is available (fallback mode), line 268-279 uses `exec()` with `shell: true` and passes unsanitized agent-controlled input directly.

Fix approach:
1. Add a `ALLOW_HOST_EXECUTION` environment variable check (default: `false`). If false and no container exists, return an error: "Host execution disabled. Deploy agent in a container for shell access."

2. When host execution IS allowed (dev mode), add input sanitization:
   - Reject commands containing shell metacharacters for chaining: `; && || | \` $( \`
   - Use a regex allowlist: only allow alphanumeric, spaces, hyphens, dots, slashes, equals, and common flags
   - If rejected, return: "Command rejected: contains unsafe shell characters. Use a container for unrestricted execution."

3. Add a comment block explaining the security model: containers are the primary execution environment, host fallback is dev-only.

Run `npx vitest run runtime/src/__tests__/tools` and `npx vitest run runtime/src/__tests__/guards` after.
```

---

## Phase 1: Type Safety & Error Handling (Week 1)

### Prompt 1A: Fix `as any` in Kernel and StateStore

```
Fix type safety issues across the two worst files. Use agent teams to work on both files in parallel.

**File 1: kernel/src/StateStore.ts (52 `as any` casts)**
- Read the entire file. For every `as any`, determine the correct type from context (the prepared statement return type, the function signature, etc.)
- Common patterns to fix:
  - `.get(...) as any` → type the return with an interface (create interfaces at the top of the file if needed)
  - `.all(...) as any` → same, use array type
  - `.run(...) as any` → typically returns `Database.RunResult`
- Group related interfaces: ProcessRow, MemoryRow, CronJobRow, WebhookRow, etc.

**File 2: kernel/src/Kernel.ts (52 `as any` casts)**
- Read the entire file. Most `as any` casts are in the handleCommand() switch — they cast command payloads.
- Import the correct command types from `@aether/shared` protocol.ts.
- Replace `(cmd as any).field` with proper discriminated union narrowing: after the switch case matches `cmd.type`, TypeScript should narrow the type automatically.

After both files are done, run `npx vitest run` to verify nothing breaks.
```

### Prompt 1B: Fix all `catch (err: any)` patterns

```
Fix all 229 instances of `catch (err: any)` across the codebase. Use agent teams — assign one team per directory.

**Pattern to apply everywhere:**
```typescript
// BEFORE (unsafe):
catch (err: any) {
  return { success: false, output: `Error: ${err.message}` };
}

// AFTER (safe):
catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  return { success: false, output: `Error: ${message}` };
}
```

Search for `catch (err: any)` and `catch (e: any)` in these directories:
- Team 1: `runtime/src/` (37 instances in tools.ts alone)
- Team 2: `kernel/src/` (all kernel subsystems)
- Team 3: `server/src/` + `components/` (UI and server code)

Do NOT change any logic — only make the error variable properly typed. Run `npx vitest run` after all changes.
```

---

## Phase 2: God Class Refactoring (Week 2-3)

### Prompt 2A: Split Kernel.ts handleCommand() into Command Handlers

```
Refactor the god class kernel/src/Kernel.ts (2,784 lines, 117 case statements in handleCommand()).

Step 1: Create a CommandHandler interface in kernel/src/handlers/ICommandHandler.ts:
```typescript
import { KernelCommand, KernelEvent } from '@aether/shared';

export interface CommandHandler {
  readonly commandTypes: string[];
  handle(cmd: KernelCommand, userId?: string): Promise<KernelEvent>;
}
```

Step 2: Create handler files in kernel/src/handlers/ — one per domain. Use agent teams to create 6 handlers in parallel:

- `ProcessCommandHandler.ts` — process.spawn, process.signal, process.list, process.info, process.approve, process.reject, agent.pause, agent.resume, agent.continue
- `FilesystemCommandHandler.ts` — fs.read, fs.write, fs.mkdir, fs.rm, fs.ls, fs.stat, fs.mv, fs.cp, fs.watch, fs.unwatch + fs.createShared, fs.mountShared, fs.unmountShared, fs.listShared
- `AuthCommandHandler.ts` — auth.login, auth.register, auth.validate, user.list, user.delete + org.*, permission.*
- `AutomationCommandHandler.ts` — cron.*, trigger.*, webhook.*
- `EcosystemCommandHandler.ts` — app.*, plugin.*, integration.*, template.*, skill.*
- `InfraCommandHandler.ts` — cluster.*, remote.*, vnc.*, gpu.*, browser.*, resource.*, process.setPriority, process.getQueue

Step 3: Each handler gets the kernel instance injected and delegates to the appropriate subsystem. Move the case body directly — don't rewrite logic.

Step 4: Replace handleCommand() in Kernel.ts with a handler registry:
```typescript
private handlers: Map<string, CommandHandler> = new Map();

private registerHandlers() {
  const all = [new ProcessCommandHandler(this), new FilesystemCommandHandler(this), ...];
  for (const h of all) {
    for (const type of h.commandTypes) {
      this.handlers.set(type, h);
    }
  }
}

async handleCommand(cmd: KernelCommand, userId?: string): Promise<KernelEvent> {
  const handler = this.handlers.get(cmd.type);
  if (!handler) return { type: 'error', message: `Unknown command: ${cmd.type}` };
  return handler.handle(cmd, userId);
}
```

Step 5: Run `npx vitest run` and fix any failures.

The goal: Kernel.ts goes from 2,784 lines to ~300 lines. Each handler is 200-400 lines and independently testable.
```

### Prompt 2B: Split StateStore into Domain Stores

```
Refactor kernel/src/StateStore.ts (3,118 lines, 213 prepared statements) into domain-specific stores.

Step 1: Create kernel/src/stores/ directory with these files (use agent teams for parallel creation):

- `ProcessStore.ts` — process, log, file metadata, metrics statements
- `MemoryStore.ts` — memory, memory FTS, reflection, plan, feedback, profile statements
- `AuthStore.ts` — user, org, team, member, MFA, permission policy statements
- `AutomationStore.ts` — cron, trigger, webhook, webhook DLQ statements
- `EcosystemStore.ts` — app, plugin registry, plugin ratings, plugin settings, integration, template statements
- `InteropStore.ts` — MCP server, OpenClaw import, skill embedding, skill proposal statements

Step 2: Each store class:
- Takes the `better-sqlite3` Database instance in constructor
- Declares its own prepared statements
- Exposes typed methods (not raw SQL results)
- Has its own `initSchema()` method for its tables + indexes

Step 3: StateStore.ts becomes a facade:
```typescript
export class StateStore {
  readonly processes: ProcessStore;
  readonly memory: MemoryStore;
  readonly auth: AuthStore;
  readonly automation: AutomationStore;
  readonly ecosystem: EcosystemStore;
  readonly interop: InteropStore;

  constructor(dbPath?: string) {
    this.db = new Database(dbPath || ':memory:');
    this.processes = new ProcessStore(this.db);
    this.memory = new MemoryStore(this.db);
    // ... etc
  }
}
```

Step 4: Update all imports across the kernel — subsystems that call `this.state.insertWebhook(...)` now call `this.state.automation.insertWebhook(...)`.

Step 5: Run `npx vitest run` and fix failures.

Goal: StateStore.ts goes from 3,118 lines to ~100 lines. Each domain store is 200-500 lines.
```

---

## Phase 3: Testing (Week 3-4)

### Prompt 3A: Add Missing Kernel Subsystem Tests

```
Add unit tests for the 9 untested kernel subsystems. Use agent teams — create all 9 test files in parallel.

For each subsystem, create a test file in kernel/src/__tests__/ following the existing test patterns (look at ProcessManager.test.ts or MemoryManager.test.ts for the style).

Create tests for:
1. `AetherMCPServer.test.ts` — test tool registration, tool listing, tool execution
2. `AgentSubprocess.test.ts` — test spawn, signal, exit handling
3. `AppManager.test.ts` — test install, uninstall, enable, disable, list
4. `ClusterManager.test.ts` — test node registration, heartbeat, drain
5. `PTYManager.test.ts` — test open, input, resize, close (mock node-pty)
6. `SkillForge.test.ts` — test discover, create, compose, rollback
7. `VNCManager.test.ts` — test session creation, WebSocket proxy setup
8. `SnapshotManager.test.ts` — test create, list, restore, delete

Each test file should:
- Mock external dependencies (Docker, node-pty, network)
- Test happy path + error cases
- Test edge cases (null inputs, missing resources, concurrent operations)
- Have at least 5 test cases per subsystem

Run `npx vitest run kernel/src/__tests__/` after all files are created and fix failures.
```

### Prompt 3B: Add Agent Lifecycle Integration Test

```
Create an integration test that exercises the full agent lifecycle: spawn → execute → complete.

Create file: runtime/src/__tests__/agent-lifecycle.integration.test.ts

Test scenario:
1. Create a Kernel instance with in-memory StateStore
2. Boot the kernel
3. Spawn an agent process with a simple goal: "Write hello.txt with content 'hello world'"
4. Mock the LLM provider to return a sequence of tool calls:
   - Step 1: write_file("hello.txt", "hello world")
   - Step 2: complete("Task done")
5. Run the agent loop
6. Assert:
   - Process went through states: created → running → completed
   - File exists in VirtualFS at /home/agent_{pid}/hello.txt
   - File content is "hello world"
   - Agent logs contain thought, action, observation entries
   - Memory was stored (episodic + procedural)
   - Exit code is 0

Add a second test for failure:
1. Mock LLM to return invalid tool call
2. Assert agent enters failed state
3. Assert error is logged

Run with `npx vitest run runtime/src/__tests__/agent-lifecycle`.
```

---

## Phase 4: Performance (Week 4)

### Prompt 4A: Add Database Indexes + Fix N+1 Queries

```
Fix database performance issues. Use agent teams for parallel work.

**Team 1: Add composite indexes (kernel/src/StateStore.ts or the new domain stores)**

In the schema initialization, add these indexes after table creation:

```sql
-- Memory hot path: agent + layer + importance
CREATE INDEX IF NOT EXISTS idx_memories_agent_layer ON agent_memories(agent_uid, layer, importance DESC);

-- Cron scheduling: enabled jobs sorted by next_run
CREATE INDEX IF NOT EXISTS idx_cron_enabled_next ON cron_jobs(enabled, next_run);

-- Event triggers: enabled triggers by event type
CREATE INDEX IF NOT EXISTS idx_triggers_enabled_event ON event_triggers(enabled, event_type);

-- Webhook dispatch: enabled webhooks by event
CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);

-- Audit log queries: timestamp + event type
CREATE INDEX IF NOT EXISTS idx_audit_timestamp_type ON audit_log(timestamp DESC, event_type);

-- Process lookup: owner + state
CREATE INDEX IF NOT EXISTS idx_processes_owner_state ON processes(owner_uid, state);
```

**Team 2: Fix N+1 memory loading in runtime/src/AgentLoop.ts**

In the `getMemoriesForContext()` call (around line 137-140), the current code loads all memories then filters. Change the MemoryManager to accept filter parameters and do the filtering in SQL:

```typescript
// In MemoryManager.ts, update getMemoriesForContext():
getMemoriesForContext(agentUid: string, goal: string, limit = 10): Memory[] {
  // Use FTS5 with LIMIT directly in SQL instead of loading all + filtering in JS
  const ftsResults = this.stmts.searchMemoriesFts.all(goal, agentUid, limit);
  // Fill remaining slots with high-importance memories (also with LIMIT)
  const remaining = limit - ftsResults.length;
  if (remaining > 0) {
    const topMemories = this.stmts.getTopMemoriesByImportance.all(agentUid, remaining);
    // merge and deduplicate
  }
  return results;
}
```

Add the new prepared statements for `searchMemoriesFts` and `getTopMemoriesByImportance` with proper WHERE clauses and LIMITs.

Run `npx vitest run` after both teams finish.
```

### Prompt 4B: Add WebSocket Backpressure

```
Add WebSocket backpressure and rate limiting to server/src/index.ts.

1. **Per-client buffer cap** — around the WebSocket message sending code (look for `ws.send`):
   - Track buffered amount per client: `ws.bufferedAmount`
   - If `ws.bufferedAmount > 10 * 1024 * 1024` (10MB), skip non-critical events
   - Critical events (process.spawned, process.exited, error) are never dropped
   - Non-critical events (agent.thought, agent.observation) are dropped with a counter
   - Log: "Dropped N events for slow client {id}" when dropping

2. **WebSocket command rate limiting** — in the message handler:
   - Track commands per client per second using a sliding window
   - If > 20 commands/sec, send back: `{ type: 'error', message: 'Rate limited', code: 'RATE_LIMITED' }`
   - Don't process the command

3. **Add a simple implementation** — no external deps:
```typescript
class ClientRateLimiter {
  private windows = new Map<string, number[]>();

  isAllowed(clientId: string, maxPerSec: number): boolean {
    const now = Date.now();
    const window = this.windows.get(clientId) || [];
    const recent = window.filter(t => now - t < 1000);
    if (recent.length >= maxPerSec) return false;
    recent.push(now);
    this.windows.set(clientId, recent);
    return true;
  }
}
```

Run `npx vitest run server/` after.
```

---

## Phase 5: Structured Logging + Observability (Week 4)

### Prompt 5A: Replace console.log with structured logger

```
Replace all console.log/warn/error statements with a structured logger across the kernel.

Step 1: Create kernel/src/logger.ts:
```typescript
import { createWriteStream } from 'fs';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

class Logger {
  private level: LogLevel;
  private context: Record<string, unknown>;

  constructor(context: Record<string, unknown> = {}, level?: LogLevel) {
    this.level = level || (process.env.LOG_LEVEL as LogLevel) || 'info';
    this.context = context;
  }

  child(ctx: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...ctx }, this.level);
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.context,
      ...data,
    };
    const out = level === 'error' ? process.stderr : process.stdout;
    out.write(JSON.stringify(entry) + '\n');
  }

  debug(msg: string, data?: Record<string, unknown>) { this.log('debug', msg, data); }
  info(msg: string, data?: Record<string, unknown>) { this.log('info', msg, data); }
  warn(msg: string, data?: Record<string, unknown>) { this.log('warn', msg, data); }
  error(msg: string, data?: Record<string, unknown>) { this.log('error', msg, data); }
}

export const logger = new Logger({ service: 'aether-kernel' });
export { Logger };
```

Step 2: Use agent teams to replace console statements in parallel across these files:
- Team 1: kernel/src/Kernel.ts (54 console statements) — use `logger.child({ subsystem: 'kernel' })`
- Team 2: kernel/src/StateStore.ts (13 statements) — use `logger.child({ subsystem: 'state' })`
- Team 3: runtime/src/AgentLoop.ts (14 statements) — use `logger.child({ subsystem: 'agent-loop' })`
- Team 4: server/src/index.ts — use `logger.child({ subsystem: 'server' })`

Replace patterns:
- `console.log('  ✓ Subsystem ready')` → `logger.info('Subsystem ready', { subsystem: 'name' })`
- `console.error('Failed:', err)` → `logger.error('Operation failed', { error: err.message })`
- Remove emoji from log messages (they break JSON parsing in log aggregators)

Run `npx vitest run` after all teams finish.
```

---

## Phase 6: Lazy Loading + UI Performance (Week 5)

### Prompt 6A: Lazy-load remaining UI apps

```
In App.tsx, only 6 of 23 apps are lazy-loaded. Lazy-load the remaining 17 to cut initial bundle by ~60%.

Find all direct imports of app components at the top of App.tsx (lines 4-42 approximately). For every app component that is NOT already using `React.lazy()`, convert it:

```typescript
// BEFORE:
import { AgentDashboard } from './components/apps/AgentDashboard';

// AFTER:
const AgentDashboard = lazy(() => import('./components/apps/AgentDashboard'));
```

Apps that should definitely be lazy-loaded (they're large):
- SettingsApp (1,751 lines)
- AgentDashboard (1,343 lines)
- CanvasApp (1,664 lines)
- WriterApp (1,228 lines)
- FileExplorer
- ChatApp
- NotesApp
- TerminalApp
- SheetsApp (if not already lazy)
- SystemMonitorApp
- MemoryInspectorApp

Make sure each lazy-loaded component is wrapped in `<Suspense fallback={<div>Loading...</div>}>` where it's rendered.

Run `npx vitest run` after.
```

---

## Validation: Run Full Suite After Each Phase

### Prompt (run after each phase):

```
Run the full test suite and report results:
1. `npx vitest run` — unit + integration tests
2. `npx tsc --noEmit` — type checking
3. Report: total tests, passed, failed, and any type errors
If anything fails, fix it before moving on.
```

---

## Summary: Execution Order

| Phase | Focus | Effort | Prompt(s) |
|-------|-------|--------|-----------|
| 0A | RBAC + creds + JWT | 2-3 hrs | Security fixes |
| 0B | Docker hardening | 1-2 hrs | Container flags |
| 0C | Command injection | 1-2 hrs | Exec sanitization |
| 1A | `as any` removal | 4-6 hrs | Type safety |
| 1B | `catch (err: any)` | 3-4 hrs | Error handling |
| 2A | Kernel god class | 8-12 hrs | Command handlers |
| 2B | StateStore split | 6-10 hrs | Domain stores |
| 3A | Missing tests | 4-6 hrs | 9 test files |
| 3B | Integration test | 2-3 hrs | Lifecycle test |
| 4A | DB indexes + N+1 | 2-3 hrs | Query performance |
| 4B | WS backpressure | 2-3 hrs | Rate limiting |
| 5A | Structured logging | 3-4 hrs | Replace console |
| 6A | Lazy loading | 1-2 hrs | Bundle size |
