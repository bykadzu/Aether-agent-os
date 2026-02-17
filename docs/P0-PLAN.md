# P0 Sweep: Implementation Plan

**Context:** Solo developer + Claude Code Max
**Scope:** All P0 blockers from ANALYSIS-REPORT.md — security, performance, tests
**Approach:** Ordered so each step unblocks or de-risks the next

---

## Phase 1: Unblock Tests (est. ~30 min)

Everything downstream depends on having a working test suite.

### 1.1 Install missing `better-sqlite3` dependency

The kernel's `StateStore.ts` imports `better-sqlite3` (line 13) but it's not in
`package.json`. This single missing dependency causes **13+ test files** to fail
to load, silently hiding dozens of test cases.

- **Action:** `npm install better-sqlite3 && npm install -D @types/better-sqlite3`
- **Verify:** `npx vitest run` — expect previously-hidden kernel tests to surface

### 1.2 Fix AETHER_ROOT constant test

`shared/__tests__/` has a failing assertion: `AETHER_ROOT is /tmp/aether`.
Likely an environment-dependent value. Check if the constant changed or needs
env-aware logic.

### 1.3 Fix browser/Docker test failures (13 tests)

The 13 visible failures are all in runtime browser tool tests:
- `routes through Docker container when available`
- `lazy-creates sandbox container when Docker is available`
- `uses BrowserManager when available`
- etc.

These likely need mock adjustments after a refactor. Fix the mocks, not the
production code.

**Exit criteria:** All existing tests pass. New kernel tests (previously hidden)
are visible — failures there get triaged in Phase 1.4.

### 1.4 Triage newly-surfaced kernel test failures

Once `better-sqlite3` is installed, these test files will load:
- AuthManager.test.ts, RBAC.test.ts, CronManager.test.ts
- MemoryManager.test.ts, WebhookManager.test.ts, SnapshotManager.test.ts
- RemoteAccessManager.test.ts, AuditLogger.test.ts
- IntegrationManager.test.ts, PluginRegistryManager.test.ts, etc.

Run the full suite, document which pass and which fail. Fix test-level issues
(bad mocks, missing setup) — do NOT fix production code yet (that's Phase 2+).

---

## Phase 2: Critical Security Fixes (est. ~2-3 hrs)

These are the "stop everything and fix now" items. Each is a localized change.

### 2.1 Remove default admin credentials — AuthManager.ts:127-142

**Problem:** Hardcoded `AUTH_DEFAULT_ADMIN_USER` / `AUTH_DEFAULT_ADMIN_PASS`
imported from `@aether/shared`. Printed to console in plaintext on first boot.

**Fix:**
1. On first boot (no users exist), generate a random 24-char password using
   `crypto.randomBytes(18).toString('base64url')`
2. Print the generated password once, then never again
3. Add a `force_password_change` flag to the user record
4. Remove the hardcoded password constant from `@aether/shared`

**Files:** `kernel/src/AuthManager.ts`, `shared/src/constants.ts`

### 2.2 Fix RBAC bypass — AuthManager.ts:863-868

**Problem:** `hasPermission()` returns `true` unconditionally on line 868 when
orgs exist but no `orgId` is specified. Every authenticated user gets full admin.

**Fix:** Change line 868 from `return true` to iterate user's org memberships
and check if ANY of them grant the requested permission. If none do, return
`false` (deny-by-default).

```typescript
// BEFORE (line 868):
return true;

// AFTER:
const userOrgs = this.store.getUserOrgs(userId);
return userOrgs.some(org =>
  this.orgHasPermission(org.org_id, userId, permission)
);
```

**Files:** `kernel/src/AuthManager.ts`

### 2.3 Eliminate command injection — tools.ts:251-279

**Problem:** When `AETHER_ALLOW_HOST_EXEC` is set and no Docker container
exists, `args.command` (agent-controlled) is passed directly to
`child_process.exec()` — full shell injection.

**Fix (option A — recommended):** Remove the host execution fallback entirely.
Delete the `AETHER_ALLOW_HOST_EXEC` code path. If no container is available,
return an error. Agents must run in containers.

**Fix (option B — if fallback needed):** Replace `exec()` with `execFile()`,
parse commands into argv arrays, and block shell metacharacters. But option A is
simpler and more secure.

**Files:** `runtime/src/tools.ts`

### 2.4 Restrict CORS — server/src/index.ts:232

**Problem:** `Access-Control-Allow-Origin: *` allows any website to make
authenticated API calls.

**Fix:**
1. Add `AETHER_CORS_ORIGINS` env var (comma-separated allowlist)
2. Default to `http://localhost:5173,http://localhost:3000` (dev servers)
3. Validate `Origin` header against allowlist; reject if not matched
4. In production mode (NODE_ENV=production), require explicit configuration

```typescript
const allowedOrigins = (process.env.AETHER_CORS_ORIGINS || 'http://localhost:5173').split(',');
const origin = req.headers.origin;
if (origin && allowedOrigins.includes(origin)) {
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
}
```

**Files:** `server/src/index.ts`

### 2.5 Docker container hardening — ContainerManager.ts:192-226

**Problem:** Containers run with default capabilities, no read-only FS, shared
mounts are `rw` with no `noexec`.

**Fix:** Add security flags to the Docker `args` array:

```typescript
// After '--cpus' line, add:
'--cap-drop', 'ALL',
'--cap-add', 'NET_BIND_SERVICE',
'--security-opt', 'no-new-privileges:true',
'--pids-limit', '256',
```

And change the shared mount from `:rw` to `:ro,noexec,nosuid`:
```typescript
// Line 213: shared mount
return ['-v', `${sharedDir}:/home/agent/shared:ro,noexec,nosuid`];
```

**Files:** `kernel/src/ContainerManager.ts`

### 2.6 JWT algorithm validation — AuthManager.ts:174-213

**Problem:** `verifyToken()` doesn't check the `alg` field in the JWT header.

**Fix:** After parsing the header, verify `alg === 'HS256'`:

```typescript
const headerObj = JSON.parse(this.base64UrlDecode(header));
if (headerObj.alg !== 'HS256') return null;
```

**Files:** `kernel/src/AuthManager.ts`

---

## Phase 3: Performance — Database Indexes & N+1 Fix (est. ~1 hr)

### 3.1 Add composite indexes — StateStore.ts

Add three composite indexes after the existing index definitions:

```sql
-- Memory hot path (lines 420-422 area)
CREATE INDEX IF NOT EXISTS idx_memories_agent_layer_importance
  ON agent_memories(agent_uid, layer, importance DESC);

-- Cron scheduling hot path (lines 445-446 area)
CREATE INDEX IF NOT EXISTS idx_cron_enabled_next_run
  ON cron_jobs(enabled, next_run);

-- Event trigger dispatch (lines 463-464 area)
CREATE INDEX IF NOT EXISTS idx_triggers_enabled_event
  ON event_triggers(enabled, event_type);
```

**Files:** `kernel/src/StateStore.ts`

### 3.2 Fix N+1 memory loading — StateStore.ts + MemoryManager.ts

**Problem:** `getMemoriesByAgent()` loads ALL rows for an agent, then JS filters
to top-N by importance. For 1000 memories, 999 rows are wasted per query.

**Fix:**
1. Add a new prepared statement with `ORDER BY importance DESC LIMIT ?`:
   ```sql
   SELECT ... FROM agent_memories
   WHERE agent_uid = ? ORDER BY importance DESC LIMIT ?
   ```
2. Update `MemoryManager.recall()` to pass `limit` through to the DB query
3. Update `getMemoriesForContext()` to use the limited query path

**Files:** `kernel/src/StateStore.ts`, `kernel/src/MemoryManager.ts`

---

## Phase 4: Verify & Ship (est. ~30 min)

### 4.1 Run full test suite

`npx vitest run` — all tests must pass.

### 4.2 Manual smoke test checklist

- [ ] Server starts without printing hardcoded credentials
- [ ] CORS rejects requests from unlisted origins
- [ ] `AETHER_ALLOW_HOST_EXEC` code path is gone (or locked down)
- [ ] Docker containers start with `--cap-drop ALL` visible in `docker inspect`
- [ ] Invalid JWT `alg` header is rejected

### 4.3 Commit and push

One commit per phase, or one per logical fix — whichever is clearer in git log.

---

## What This Does NOT Cover (deferred to P1/P2)

- HTTPS enforcement (requires TLS cert infrastructure — P1)
- God class refactoring (Kernel.ts, StateStore.ts — P2)
- Structured logging replacement (54 console.logs — P1)
- 317 `as any` removals (P2)
- WebSocket backpressure/rate limiting (P1)
- Missing test coverage for 9 kernel subsystems (P2)
- SQLite → PostgreSQL migration (P2)

---

## Execution Order Summary

| # | Task | Risk | Files | Est. |
|---|------|------|-------|------|
| 1.1 | Install better-sqlite3 | Low | package.json | 5 min |
| 1.2 | Fix AETHER_ROOT test | Low | shared/ | 10 min |
| 1.3 | Fix browser test mocks | Low | runtime tests | 15 min |
| 1.4 | Triage new kernel tests | Low | kernel tests | varies |
| 2.1 | Random admin password | **Critical** | AuthManager.ts, shared/ | 30 min |
| 2.2 | Fix RBAC bypass | **Critical** | AuthManager.ts | 15 min |
| 2.3 | Remove host exec fallback | **Critical** | tools.ts | 15 min |
| 2.4 | Restrict CORS origins | **High** | index.ts | 20 min |
| 2.5 | Docker container hardening | **High** | ContainerManager.ts | 20 min |
| 2.6 | JWT alg validation | Medium | AuthManager.ts | 10 min |
| 3.1 | Composite DB indexes | **High** | StateStore.ts | 15 min |
| 3.2 | Fix N+1 memory query | **High** | StateStore.ts, MemoryManager.ts | 30 min |
| 4.1 | Full test run | — | — | 10 min |
| 4.2 | Smoke test | — | — | 15 min |
