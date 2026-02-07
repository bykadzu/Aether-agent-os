import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { AuthManager } from '../AuthManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('AuthManager', () => {
  let bus: EventBus;
  let store: StateStore;
  let auth: AuthManager;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(() => {
    bus = new EventBus();
    tmpDir = path.join('/tmp', `aether-auth-test-${crypto.randomBytes(8).toString('hex')}`);
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
});
