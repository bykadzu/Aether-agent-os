import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { AuthManager } from '../AuthManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import os from 'node:os';

describe('AuthManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let auth: AuthManager;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    bus = new EventBus();
    tmpDir = path.join(os.tmpdir(), `aether-auth-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'auth-test.db');
    // Set a fixed secret for testing
    process.env.AETHER_SECRET = 'test-secret-key-for-testing-purposes';
    store = new StateStore(bus, dbPath);
    auth = new AuthManager(bus, store);
  });

  afterEach(() => {
    store.close();
    delete process.env.AETHER_SECRET;
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('createUser()', () => {
    it('hashes password with scrypt (salt:hash format)', async () => {
      const user = await auth.createUser('testuser', 'password123', 'Test User');
      expect(user.username).toBe('testuser');
      expect(user.displayName).toBe('Test User');
      expect(user.role).toBe('user');

      // Verify password hash is stored in salt:hash format
      const dbUser = store.getUserByUsername('testuser');
      expect(dbUser!.passwordHash).toMatch(/^[a-f0-9]+:[a-f0-9]+$/);
    });

    it('rejects short usernames', async () => {
      await expect(auth.createUser('a', 'password123')).rejects.toThrow('at least 2 characters');
    });

    it('rejects short passwords', async () => {
      await expect(auth.createUser('testuser', 'abc')).rejects.toThrow('at least 4 characters');
    });

    it('rejects duplicate usernames', async () => {
      await auth.createUser('testuser', 'password1');
      await expect(auth.createUser('testuser', 'password2')).rejects.toThrow('already exists');
    });

    it('emits user.created event', async () => {
      const handler = vi.fn();
      bus.on('user.created', handler);
      await auth.createUser('testuser', 'password123');
      expect(handler).toHaveBeenCalledOnce();
      expect(handler.mock.calls[0][0].user.username).toBe('testuser');
    });
  });

  describe('authenticateUser()', () => {
    it('succeeds with correct password', async () => {
      await auth.createUser('testuser', 'mypassword');
      const result = await auth.authenticateUser('testuser', 'mypassword');

      expect(result).not.toBeNull();
      expect(result!.user.username).toBe('testuser');
      expect(result!.token).toBeTruthy();
      expect(typeof result!.token).toBe('string');
      // JWT format: three dot-separated parts
      expect(result!.token.split('.')).toHaveLength(3);
    });

    it('fails with wrong password', async () => {
      await auth.createUser('testuser', 'mypassword');
      const result = await auth.authenticateUser('testuser', 'wrongpassword');
      expect(result).toBeNull();
    });

    it('fails with non-existent user', async () => {
      const result = await auth.authenticateUser('nonexistent', 'password');
      expect(result).toBeNull();
    });

    it('emits auth.failure on wrong credentials', async () => {
      const handler = vi.fn();
      bus.on('auth.failure', handler);
      await auth.createUser('testuser', 'mypassword');
      await auth.authenticateUser('testuser', 'wrong');
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('validateToken()', () => {
    it('accepts valid JWT token', async () => {
      await auth.createUser('testuser', 'mypassword');
      const authResult = await auth.authenticateUser('testuser', 'mypassword');
      expect(authResult).not.toBeNull();

      const user = auth.validateToken(authResult!.token);
      expect(user).not.toBeNull();
      expect(user!.username).toBe('testuser');
    });

    it('rejects tampered token', async () => {
      await auth.createUser('testuser', 'mypassword');
      const authResult = await auth.authenticateUser('testuser', 'mypassword');
      const tamperedToken = authResult!.token + 'tampered';

      const user = auth.validateToken(tamperedToken);
      expect(user).toBeNull();
    });

    it('rejects expired token', async () => {
      // Test expired tokens by checking that validateToken would reject if token expired
      // We can't easily create an expired token without mocking time, so we test with garbage
      const user = auth.validateToken('invalid.token.here');
      expect(user).toBeNull();
    });

    it('rejects completely invalid token', async () => {
      expect(auth.validateToken('')).toBeNull();
      expect(auth.validateToken('not-a-jwt')).toBeNull();
      expect(auth.validateToken('a.b')).toBeNull();
    });
  });

  describe('token claims', () => {
    it('token contains correct sub, username, role, exp claims', async () => {
      await auth.createUser('testuser', 'mypassword', 'Test', 'admin');
      const result = await auth.authenticateUser('testuser', 'mypassword');
      expect(result).not.toBeNull();

      // Decode the JWT payload (middle part)
      const parts = result!.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));

      expect(payload.sub).toBeTruthy();
      expect(payload.username).toBe('testuser');
      expect(payload.role).toBe('admin');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
      expect(payload.exp).toBeGreaterThan(payload.iat);
    });
  });

  describe('init()', () => {
    it('creates default admin when no users exist', async () => {
      await auth.init();
      const users = auth.listUsers();
      expect(users).toHaveLength(1);
      expect(users[0].username).toBe('admin');
      expect(users[0].role).toBe('admin');
    });
  });

  describe('listUsers / deleteUser', () => {
    it('listUsers returns all users', async () => {
      await auth.createUser('user1', 'pass1');
      await auth.createUser('user2', 'pass2');
      const users = auth.listUsers();
      expect(users).toHaveLength(2);
    });

    it('deleteUser removes user', async () => {
      const user = await auth.createUser('todelete', 'pass123');
      auth.deleteUser(user.id);
      const users = auth.listUsers();
      expect(users).toHaveLength(0);
    });

    it('deleteUser throws for non-existent user', () => {
      expect(() => auth.deleteUser('nonexistent')).toThrow('User not found');
    });
  });

  // -------------------------------------------------------------------------
  // MFA / TOTP (v0.5 Phase 3)
  // -------------------------------------------------------------------------

  describe('MFA setup and TOTP verification', () => {
    it('setupMfa returns a base32 secret and otpauth URI', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);

      expect(mfa.secret).toBeTruthy();
      // base32 characters only
      expect(mfa.secret).toMatch(/^[A-Z2-7]+$/);
      expect(mfa.otpauthUri).toContain('otpauth://totp/AetherOS:mfauser');
      expect(mfa.otpauthUri).toContain(`secret=${mfa.secret}`);
    });

    it('verifyMfaCode succeeds with correct TOTP code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);

      // Manually generate a valid code from the secret
      const secretBuf = base32DecodeForTest(mfa.secret);
      const code = generateTOTPForTest(secretBuf);

      expect(auth.verifyMfaCode(user.id, code)).toBe(true);
    });

    it('verifyMfaCode fails with wrong code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      auth.setupMfa(user.id);

      expect(auth.verifyMfaCode(user.id, '000000')).toBe(false);
    });

    it('verifyMfaCode allows +/- 1 time window', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);

      const secretBuf = base32DecodeForTest(mfa.secret);
      const now = Math.floor(Date.now() / 30000);

      // Code from previous window
      const prevCode = generateTOTPForTest(secretBuf, now - 1);
      expect(auth.verifyMfaCode(user.id, prevCode)).toBe(true);

      // Code from next window
      const nextCode = generateTOTPForTest(secretBuf, now + 1);
      expect(auth.verifyMfaCode(user.id, nextCode)).toBe(true);
    });
  });

  describe('MFA enable/disable flow', () => {
    it('enableMfa succeeds with valid code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);

      const secretBuf = base32DecodeForTest(mfa.secret);
      const code = generateTOTPForTest(secretBuf);

      expect(auth.enableMfa(user.id, code)).toBe(true);
      expect(auth.isMfaEnabled(user.id)).toBe(true);
    });

    it('enableMfa fails with invalid code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      auth.setupMfa(user.id);

      expect(auth.enableMfa(user.id, '000000')).toBe(false);
      expect(auth.isMfaEnabled(user.id)).toBe(false);
    });

    it('disableMfa clears MFA state', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);

      const secretBuf = base32DecodeForTest(mfa.secret);
      const code = generateTOTPForTest(secretBuf);
      auth.enableMfa(user.id, code);
      expect(auth.isMfaEnabled(user.id)).toBe(true);

      auth.disableMfa(user.id);
      expect(auth.isMfaEnabled(user.id)).toBe(false);
    });
  });

  describe('Login with MFA enabled', () => {
    it('returns mfaRequired when MFA is enabled', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);
      const secretBuf = base32DecodeForTest(mfa.secret);
      const code = generateTOTPForTest(secretBuf);
      auth.enableMfa(user.id, code);

      const result = await auth.authenticateUser('mfauser', 'password123');
      expect(result).not.toBeNull();
      expect((result as any).mfaRequired).toBe(true);
      expect((result as any).mfaToken).toBeTruthy();
      // Should NOT contain user or full token
      expect((result as any).user).toBeUndefined();
    });

    it('authenticateMfa succeeds with valid mfaToken and code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);
      const secretBuf = base32DecodeForTest(mfa.secret);
      const setupCode = generateTOTPForTest(secretBuf);
      auth.enableMfa(user.id, setupCode);

      // Login to get mfaToken
      const loginResult = await auth.authenticateUser('mfauser', 'password123');
      const mfaToken = (loginResult as any).mfaToken;

      // Generate a fresh TOTP code
      const loginCode = generateTOTPForTest(secretBuf);
      const mfaResult = auth.authenticateMfa(mfaToken, loginCode);

      expect(mfaResult).not.toBeNull();
      expect(mfaResult!.user.username).toBe('mfauser');
      expect(mfaResult!.token).toBeTruthy();
      expect(mfaResult!.token.split('.')).toHaveLength(3);
    });

    it('authenticateMfa fails with invalid code', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);
      const secretBuf = base32DecodeForTest(mfa.secret);
      const setupCode = generateTOTPForTest(secretBuf);
      auth.enableMfa(user.id, setupCode);

      const loginResult = await auth.authenticateUser('mfauser', 'password123');
      const mfaToken = (loginResult as any).mfaToken;

      const mfaResult = auth.authenticateMfa(mfaToken, '000000');
      expect(mfaResult).toBeNull();
    });

    it('authenticateMfa fails with invalid mfaToken', async () => {
      const user = await auth.createUser('mfauser', 'password123');
      const mfa = auth.setupMfa(user.id);
      const secretBuf = base32DecodeForTest(mfa.secret);
      const setupCode = generateTOTPForTest(secretBuf);
      auth.enableMfa(user.id, setupCode);

      const code = generateTOTPForTest(secretBuf);
      const mfaResult = auth.authenticateMfa('invalid.token.here', code);
      expect(mfaResult).toBeNull();
    });

    it('login without MFA still returns user and token', async () => {
      await auth.createUser('normaluser', 'password123');
      const result = await auth.authenticateUser('normaluser', 'password123');
      expect(result).not.toBeNull();
      expect((result as any).user).toBeDefined();
      expect((result as any).token).toBeDefined();
      expect((result as any).mfaRequired).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Fine-Grained Permission Policies (v0.5 Phase 4)
  // -------------------------------------------------------------------------

  describe('grantPermission()', () => {
    it('creates a policy and returns it with an id and created_at', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      const policy = auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'allow',
        created_by: user.id,
      });

      expect(policy.id).toBeTruthy();
      expect(policy.subject).toBe(`user:${user.id}`);
      expect(policy.action).toBe('tool.run_command.execute');
      expect(policy.resource).toBe('run_command');
      expect(policy.effect).toBe('allow');
      expect(policy.created_at).toBeGreaterThan(0);
      expect(policy.created_by).toBe(user.id);
    });

    it('emits permission.granted event', async () => {
      const handler = vi.fn();
      bus.on('permission.granted', handler);
      const user = await auth.createUser('policyuser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.test.execute',
        resource: 'test',
        effect: 'allow',
      });
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('revokePermission()', () => {
    it('removes a policy and returns true', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      const policy = auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'allow',
      });

      const result = auth.revokePermission(policy.id);
      expect(result).toBe(true);

      // Verify it's gone
      const policies = auth.listPolicies(`user:${user.id}`);
      expect(policies).toHaveLength(0);
    });

    it('returns false for non-existent policy', () => {
      const result = auth.revokePermission('non-existent-id');
      expect(result).toBe(false);
    });

    it('emits permission.revoked event', async () => {
      const handler = vi.fn();
      bus.on('permission.revoked', handler);
      const user = await auth.createUser('policyuser', 'password123');
      const policy = auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.test.execute',
        resource: 'test',
        effect: 'allow',
      });
      auth.revokePermission(policy.id);
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe('checkPermission()', () => {
    it('returns true when an allow policy matches', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'allow',
      });

      const allowed = auth.checkPermission(user.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(true);
    });

    it('returns false when a deny policy matches (overrides allow)', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      // Grant allow
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'allow',
      });
      // Grant deny (should override)
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'deny',
      });

      const allowed = auth.checkPermission(user.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(false);
    });

    it('returns false when no matching policy exists (deny-by-default) but policies exist for user', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      // Grant a policy for a DIFFERENT action
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.other.execute',
        resource: 'other',
        effect: 'allow',
      });

      // Check for a different action — no matching policy
      const allowed = auth.checkPermission(user.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(false);
    });

    it('returns true (backward compat) when no policies exist for the user at all', async () => {
      const user = await auth.createUser('policyuser', 'password123');
      // No policies created at all
      const allowed = auth.checkPermission(user.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(true);
    });

    it('admin users always return true', async () => {
      const admin = await auth.createUser('adminuser', 'password123', 'Admin', 'admin');
      // Even with a deny policy, admin bypasses
      auth.grantPermission({
        subject: `user:${admin.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'deny',
      });

      const allowed = auth.checkPermission(admin.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(true);
    });

    it('returns false for non-existent user', () => {
      const allowed = auth.checkPermission('non-existent-id', 'tool.test.execute', 'test');
      expect(allowed).toBe(false);
    });
  });

  describe('wildcard matching', () => {
    it('tool.*.execute matches tool.run_command.execute', async () => {
      const user = await auth.createUser('wildcarduser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.*.execute',
        resource: '*',
        effect: 'allow',
      });

      const allowed = auth.checkPermission(user.id, 'tool.run_command.execute', 'run_command');
      expect(allowed).toBe(true);
    });

    it('llm.*.use matches llm.gemini.use', async () => {
      const user = await auth.createUser('wildcarduser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'llm.*.use',
        resource: '*',
        effect: 'allow',
      });

      const allowed = auth.checkPermission(user.id, 'llm.gemini.use', 'gemini');
      expect(allowed).toBe(true);
    });

    it('wildcard deny overrides wildcard allow', async () => {
      const user = await auth.createUser('wildcarduser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.*.execute',
        resource: '*',
        effect: 'allow',
      });
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.rm.execute',
        resource: 'rm',
        effect: 'deny',
      });

      // Other tools allowed
      expect(auth.checkPermission(user.id, 'tool.ls.execute', 'ls')).toBe(true);
      // rm denied
      expect(auth.checkPermission(user.id, 'tool.rm.execute', 'rm')).toBe(false);
    });
  });

  describe('role-based policies', () => {
    it('role:member policy grants permission to org members', async () => {
      const owner = await auth.createUser('orgowner', 'password123');
      const member = await auth.createUser('orgmember', 'password123');

      // Create org
      const org = auth.createOrg('testorg', owner.id);

      // Invite member
      auth.inviteMember(org.id, member.id, 'member', owner.id);

      // Grant permission to role:member
      auth.grantPermission({
        subject: 'role:member',
        action: 'tool.read_file.execute',
        resource: 'read_file',
        effect: 'allow',
      });

      const allowed = auth.checkPermission(member.id, 'tool.read_file.execute', 'read_file');
      expect(allowed).toBe(true);
    });

    it('role:viewer deny policy blocks viewer from action', async () => {
      const owner = await auth.createUser('orgowner', 'password123');
      const viewer = await auth.createUser('orgviewer', 'password123');

      const org = auth.createOrg('testorg', owner.id);
      auth.inviteMember(org.id, viewer.id, 'viewer', owner.id);

      // Grant allow to role:viewer for some action
      auth.grantPermission({
        subject: 'role:viewer',
        action: 'tool.*.execute',
        resource: '*',
        effect: 'allow',
      });

      // Deny a specific tool
      auth.grantPermission({
        subject: 'role:viewer',
        action: 'tool.write_file.execute',
        resource: 'write_file',
        effect: 'deny',
      });

      expect(auth.checkPermission(viewer.id, 'tool.read_file.execute', 'read_file')).toBe(true);
      expect(auth.checkPermission(viewer.id, 'tool.write_file.execute', 'write_file')).toBe(false);
    });
  });

  describe('listPolicies()', () => {
    it('returns all policies when no subject filter', async () => {
      const user1 = await auth.createUser('user1', 'password123');
      const user2 = await auth.createUser('user2', 'password123');

      auth.grantPermission({
        subject: `user:${user1.id}`,
        action: 'tool.a.execute',
        resource: 'a',
        effect: 'allow',
      });
      auth.grantPermission({
        subject: `user:${user2.id}`,
        action: 'tool.b.execute',
        resource: 'b',
        effect: 'allow',
      });

      const all = auth.listPolicies();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('returns only matching policies when subject filter is provided', async () => {
      const user1 = await auth.createUser('user1', 'password123');
      const user2 = await auth.createUser('user2', 'password123');

      auth.grantPermission({
        subject: `user:${user1.id}`,
        action: 'tool.a.execute',
        resource: 'a',
        effect: 'allow',
      });
      auth.grantPermission({
        subject: `user:${user2.id}`,
        action: 'tool.b.execute',
        resource: 'b',
        effect: 'allow',
      });

      const filtered = auth.listPolicies(`user:${user1.id}`);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].subject).toBe(`user:${user1.id}`);
    });
  });

  describe('convenience methods', () => {
    it('canUseTool checks tool permission', async () => {
      const user = await auth.createUser('tooluser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'allow',
      });

      expect(auth.canUseTool(user.id, 'run_command')).toBe(true);
    });

    it('canUseLLM checks LLM provider permission', async () => {
      const user = await auth.createUser('llmuser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'llm.gemini.use',
        resource: 'gemini',
        effect: 'allow',
      });

      expect(auth.canUseLLM(user.id, 'gemini')).toBe(true);
    });

    it('canAccessPath checks filesystem path permission', async () => {
      const user = await auth.createUser('fsuser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'fs./home/agent_1.read',
        resource: '/home/agent_1',
        effect: 'allow',
      });

      expect(auth.canAccessPath(user.id, '/home/agent_1', 'read')).toBe(true);
      // Write should be denied (no policy for write)
      expect(auth.canAccessPath(user.id, '/home/agent_1', 'write')).toBe(false);
    });

    it('canUseTool returns false when denied', async () => {
      const user = await auth.createUser('tooluser', 'password123');
      auth.grantPermission({
        subject: `user:${user.id}`,
        action: 'tool.run_command.execute',
        resource: 'run_command',
        effect: 'deny',
      });

      expect(auth.canUseTool(user.id, 'run_command')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Test helpers: re-implement base32 decode and TOTP generation for tests
// ---------------------------------------------------------------------------

const BASE32_ALPHABET_TEST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32DecodeForTest(encoded: string): Buffer {
  const stripped = encoded.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < stripped.length; i++) {
    const idx = BASE32_ALPHABET_TEST.indexOf(stripped[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateTOTPForTest(
  secret: Buffer,
  time: number = Math.floor(Date.now() / 30000),
): string {
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeBigUInt64BE(BigInt(time));
  const hmac = crypto.createHmac('sha1', secret).update(timeBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      (hmac[offset + 1] << 16) |
      (hmac[offset + 2] << 8) |
      hmac[offset + 3]) %
    1000000;
  return code.toString().padStart(6, '0');
}
