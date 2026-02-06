/**
 * Aether Kernel - Auth Manager
 *
 * Handles user authentication, token creation/validation, and user management.
 * Uses Node.js built-in crypto for password hashing (scrypt) and token signing
 * (HMAC-SHA256 manual JWT). No external dependencies.
 */

import * as crypto from 'node:crypto';
import { EventBus } from './EventBus.js';
import { StateStore } from './StateStore.js';
import {
  UserInfo,
  AUTH_TOKEN_EXPIRY,
  AUTH_DEFAULT_ADMIN_USER,
  AUTH_DEFAULT_ADMIN_PASS,
} from '@aether/shared';

interface TokenPayload {
  sub: string;       // userId
  username: string;
  role: 'admin' | 'user';
  iat: number;       // issued at (ms)
  exp: number;       // expiry (ms)
}

export class AuthManager {
  private bus: EventBus;
  private store: StateStore;
  private secret: string;

  constructor(bus: EventBus, store: StateStore) {
    this.bus = bus;
    this.store = store;

    // Use env var or generate random secret
    this.secret = process.env.AETHER_SECRET || crypto.randomBytes(32).toString('hex');
    if (!process.env.AETHER_SECRET) {
      console.log(`[Auth] Generated signing secret: ${this.secret.substring(0, 8)}...`);
      console.log('[Auth] Set AETHER_SECRET env var to persist tokens across restarts');
    }
  }

  /**
   * Initialize auth system. Creates default admin if no users exist.
   */
  async init(): Promise<void> {
    const userCount = this.store.getUserCount();
    if (userCount === 0) {
      console.log('[Auth] No users found. Creating default admin account...');
      await this.createUser(AUTH_DEFAULT_ADMIN_USER, AUTH_DEFAULT_ADMIN_PASS, 'Administrator', 'admin');
      console.log('');
      console.log('  ╔════════════════════════════════════════════╗');
      console.log('  ║  DEFAULT ADMIN CREDENTIALS                  ║');
      console.log(`  ║  Username: ${AUTH_DEFAULT_ADMIN_USER.padEnd(33)}║`);
      console.log(`  ║  Password: ${AUTH_DEFAULT_ADMIN_PASS.padEnd(33)}║`);
      console.log('  ║                                              ║');
      console.log('  ║  ⚠ Change this password after first login!  ║');
      console.log('  ╚════════════════════════════════════════════╝');
      console.log('');
    }
  }

  // ---------------------------------------------------------------------------
  // Password Hashing
  // ---------------------------------------------------------------------------

  private hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  private verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
  }

  // ---------------------------------------------------------------------------
  // Token System (Manual HMAC-SHA256 JWT)
  // ---------------------------------------------------------------------------

  private base64UrlEncode(data: string): string {
    return Buffer.from(data).toString('base64url');
  }

  private base64UrlDecode(data: string): string {
    return Buffer.from(data, 'base64url').toString('utf-8');
  }

  private createToken(payload: TokenPayload): string {
    const header = this.base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = this.base64UrlEncode(JSON.stringify(payload));
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(`${header}.${body}`)
      .digest('base64url');
    return `${header}.${body}.${signature}`;
  }

  private verifyToken(token: string): TokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [header, body, signature] = parts;

      // Verify signature
      const expected = crypto
        .createHmac('sha256', this.secret)
        .update(`${header}.${body}`)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
        return null;
      }

      // Decode payload
      const payload: TokenPayload = JSON.parse(this.base64UrlDecode(body));

      // Check expiry
      if (Date.now() > payload.exp) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // User Management
  // ---------------------------------------------------------------------------

  /**
   * Create a new user. Returns UserInfo on success.
   */
  async createUser(username: string, password: string, displayName?: string, role?: 'admin' | 'user'): Promise<UserInfo> {
    // Validate
    if (!username || username.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }
    if (!password || password.length < 4) {
      throw new Error('Password must be at least 4 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      throw new Error('Username must be alphanumeric (hyphens and underscores allowed)');
    }

    // Check for duplicates
    const existing = this.store.getUserByUsername(username);
    if (existing) {
      throw new Error(`Username "${username}" already exists`);
    }

    const id = crypto.randomUUID();
    const passwordHash = this.hashPassword(password);
    const now = Date.now();

    this.store.createUser({
      id,
      username,
      displayName: displayName || username,
      passwordHash,
      role: role || 'user',
      createdAt: now,
    });

    const userInfo: UserInfo = {
      id,
      username,
      displayName: displayName || username,
      role: role || 'user',
    };

    this.bus.emit('user.created', { user: userInfo });
    return userInfo;
  }

  /**
   * Authenticate a user. Returns token and user info, or null on failure.
   */
  async authenticateUser(username: string, password: string): Promise<{ user: UserInfo; token: string } | null> {
    const record = this.store.getUserByUsername(username);
    if (!record) {
      this.bus.emit('auth.failure', { reason: 'Invalid credentials' });
      return null;
    }

    if (!this.verifyPassword(password, record.passwordHash)) {
      this.bus.emit('auth.failure', { reason: 'Invalid credentials' });
      return null;
    }

    // Update last login
    this.store.updateUserLogin(record.id);

    const now = Date.now();
    const payload: TokenPayload = {
      sub: record.id,
      username: record.username,
      role: record.role as 'admin' | 'user',
      iat: now,
      exp: now + AUTH_TOKEN_EXPIRY,
    };

    const token = this.createToken(payload);

    const user: UserInfo = {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      role: record.role as 'admin' | 'user',
    };

    this.bus.emit('auth.success', { user, token });
    return { user, token };
  }

  /**
   * Validate a token and return user info, or null if invalid.
   */
  validateToken(token: string): UserInfo | null {
    const payload = this.verifyToken(token);
    if (!payload) return null;

    // Verify user still exists
    const record = this.store.getUserById(payload.sub);
    if (!record) return null;

    return {
      id: record.id,
      username: record.username,
      displayName: record.displayName,
      role: record.role as 'admin' | 'user',
    };
  }

  /**
   * List all users (admin only).
   */
  listUsers(): UserInfo[] {
    return this.store.getAllUsers().map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role as 'admin' | 'user',
    }));
  }

  /**
   * Delete a user (admin only).
   */
  deleteUser(id: string): void {
    const user = this.store.getUserById(id);
    if (!user) throw new Error('User not found');
    this.store.deleteUser(id);
    this.bus.emit('user.deleted', { userId: id });
  }

  /**
   * Update a user's profile.
   */
  updateUser(id: string, updates: { displayName?: string; role?: string }): void {
    const user = this.store.getUserById(id);
    if (!user) throw new Error('User not found');
    this.store.updateUser(id, updates);
  }

  /**
   * Check if registration is open.
   */
  isRegistrationOpen(): boolean {
    return process.env.AETHER_REGISTRATION_OPEN !== 'false';
  }
}
