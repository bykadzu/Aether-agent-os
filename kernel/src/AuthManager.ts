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
  Permission,
  OrgRole,
  TeamRole,
  ROLE_PERMISSIONS,
  Organization,
  Team,
  OrgMember,
  TeamMember,
} from '@aether/shared';

interface TokenPayload {
  sub: string; // userId
  username: string;
  role: 'admin' | 'user';
  iat: number; // issued at (ms)
  exp: number; // expiry (ms)
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
      await this.createUser(
        AUTH_DEFAULT_ADMIN_USER,
        AUTH_DEFAULT_ADMIN_PASS,
        'Administrator',
        'admin',
      );
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
  async createUser(
    username: string,
    password: string,
    displayName?: string,
    role?: 'admin' | 'user',
  ): Promise<UserInfo> {
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
  async authenticateUser(
    username: string,
    password: string,
  ): Promise<{ user: UserInfo; token: string } | null> {
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
    return this.store.getAllUsers().map((u) => ({
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

  // ---------------------------------------------------------------------------
  // Organizations (v0.5 RBAC)
  // ---------------------------------------------------------------------------

  /**
   * Create a new organization. The creator becomes the owner.
   */
  createOrg(name: string, ownerUid: string, displayName?: string): Organization {
    if (!name || name.length < 2) {
      throw new Error('Organization name must be at least 2 characters');
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error('Organization name must be alphanumeric (hyphens and underscores allowed)');
    }

    const existing = this.store.getOrgByName(name);
    if (existing) {
      throw new Error(`Organization "${name}" already exists`);
    }

    const id = crypto.randomUUID();
    const now = Date.now();

    this.store.insertOrg({
      id,
      name,
      display_name: displayName || name,
      owner_uid: ownerUid,
      settings: '{}',
      created_at: now,
      updated_at: now,
    });

    // Add owner as a member with 'owner' role
    this.store.insertOrgMember({
      id: crypto.randomUUID(),
      org_id: id,
      user_id: ownerUid,
      role: 'owner',
      joined_at: now,
    });

    const org = this.getOrg(id)!;
    this.bus.emit('org.created', { org });
    return org;
  }

  /**
   * Delete an organization. Only owner can delete.
   */
  deleteOrg(orgId: string, requesterUid: string): void {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    // Check: requester must be owner or system admin
    const user = this.store.getUserById(requesterUid);
    if (org.owner_uid !== requesterUid && user?.role !== 'admin') {
      throw new Error('Only the organization owner can delete it');
    }

    this.store.deleteOrg(orgId);
    this.bus.emit('org.deleted', { orgId });
  }

  /**
   * List organizations. If userId provided, only orgs the user is a member of.
   */
  listOrgs(userId?: string): Organization[] {
    const rows = userId ? this.store.getOrgsByUser(userId) : this.store.getAllOrgs();
    return rows.map((r: any) => this.toOrganization(r));
  }

  /**
   * Get a single organization by ID.
   */
  getOrg(orgId: string): Organization | undefined {
    const row = this.store.getOrg(orgId);
    return row ? this.toOrganization(row) : undefined;
  }

  /**
   * Update organization settings.
   */
  updateOrg(
    orgId: string,
    updates: { settings?: Record<string, any>; displayName?: string },
    requesterUid: string,
  ): Organization {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    if (!this.hasPermission(requesterUid, 'org.settings', orgId)) {
      throw new Error('Insufficient permissions');
    }

    this.store.updateOrg(orgId, {
      settings: updates.settings ? JSON.stringify(updates.settings) : undefined,
      display_name: updates.displayName,
    });

    const updated = this.getOrg(orgId)!;
    this.bus.emit('org.updated', { org: updated });
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Org Members
  // ---------------------------------------------------------------------------

  /**
   * Invite a user to an organization with a given role.
   */
  inviteMember(orgId: string, userId: string, role: OrgRole, inviterUid: string): void {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    if (!this.hasPermission(inviterUid, 'members.invite', orgId)) {
      throw new Error('Insufficient permissions to invite members');
    }

    // Cannot invite as owner
    if (role === 'owner') {
      throw new Error('Cannot invite with owner role');
    }

    const existing = this.store.getOrgMember(orgId, userId);
    if (existing) {
      throw new Error('User is already a member of this organization');
    }

    // Verify user exists
    const user = this.store.getUserById(userId);
    if (!user) throw new Error('User not found');

    this.store.insertOrgMember({
      id: crypto.randomUUID(),
      org_id: orgId,
      user_id: userId,
      role,
      joined_at: Date.now(),
    });

    this.bus.emit('org.member.invited', { orgId, userId, role });
  }

  /**
   * Remove a member from an organization.
   */
  removeMember(orgId: string, userId: string, requesterUid: string): void {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    // Cannot remove the owner
    if (org.owner_uid === userId) {
      throw new Error('Cannot remove the organization owner');
    }

    if (!this.hasPermission(requesterUid, 'members.remove', orgId)) {
      throw new Error('Insufficient permissions to remove members');
    }

    const member = this.store.getOrgMember(orgId, userId);
    if (!member) throw new Error('User is not a member of this organization');

    this.store.deleteOrgMember(orgId, userId);
    this.bus.emit('org.member.removed', { orgId, userId });
  }

  /**
   * Update a member's role in an organization.
   */
  updateMemberRole(orgId: string, userId: string, newRole: OrgRole, requesterUid: string): void {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    if (!this.hasPermission(requesterUid, 'members.update', orgId)) {
      throw new Error('Insufficient permissions to update member roles');
    }

    // Cannot change owner role
    if (org.owner_uid === userId && newRole !== 'owner') {
      throw new Error('Cannot change the owner role');
    }

    // Cannot promote to owner
    if (newRole === 'owner') {
      throw new Error('Cannot promote to owner role');
    }

    const member = this.store.getOrgMember(orgId, userId);
    if (!member) throw new Error('User is not a member of this organization');

    this.store.updateOrgMemberRole(orgId, userId, newRole);
    this.bus.emit('org.member.updated', { orgId, userId, role: newRole });
  }

  /**
   * List members of an organization.
   */
  listMembers(orgId: string): OrgMember[] {
    return this.store.getOrgMembers(orgId).map((r: any) => ({
      id: r.id,
      orgId: r.org_id,
      userId: r.user_id,
      role: r.role as OrgRole,
      joinedAt: r.joined_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  /**
   * Create a team within an organization.
   */
  createTeam(orgId: string, name: string, requesterUid: string, description?: string): Team {
    const org = this.store.getOrg(orgId);
    if (!org) throw new Error('Organization not found');

    if (!this.hasPermission(requesterUid, 'teams.create', orgId)) {
      throw new Error('Insufficient permissions to create teams');
    }

    const id = crypto.randomUUID();
    this.store.insertTeam({
      id,
      org_id: orgId,
      name,
      description: description || '',
      created_at: Date.now(),
    });

    const team = this.getTeam(id)!;
    this.bus.emit('org.team.created', { team });
    return team;
  }

  /**
   * Delete a team.
   */
  deleteTeam(teamId: string, requesterUid: string): void {
    const team = this.store.getTeam(teamId);
    if (!team) throw new Error('Team not found');

    if (!this.hasPermission(requesterUid, 'teams.delete', team.org_id)) {
      throw new Error('Insufficient permissions to delete teams');
    }

    this.store.deleteTeam(teamId);
    this.bus.emit('org.team.deleted', { teamId });
  }

  /**
   * Get a team by ID.
   */
  getTeam(teamId: string): Team | undefined {
    const row = this.store.getTeam(teamId);
    return row
      ? {
          id: row.id,
          orgId: row.org_id,
          name: row.name,
          description: row.description,
          createdAt: row.created_at,
        }
      : undefined;
  }

  /**
   * List teams in an organization.
   */
  listTeams(orgId: string): Team[] {
    return this.store.getTeamsByOrg(orgId).map((r: any) => ({
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
    }));
  }

  /**
   * Add a user to a team.
   */
  addToTeam(teamId: string, userId: string, requesterUid: string, role: TeamRole = 'member'): void {
    const team = this.store.getTeam(teamId);
    if (!team) throw new Error('Team not found');

    if (!this.hasPermission(requesterUid, 'teams.manage', team.org_id)) {
      throw new Error('Insufficient permissions to manage team members');
    }

    // User must be an org member
    const orgMember = this.store.getOrgMember(team.org_id, userId);
    if (!orgMember) throw new Error('User must be an organization member first');

    const existing = this.store.getTeamMember(teamId, userId);
    if (existing) throw new Error('User is already a team member');

    this.store.insertTeamMember({
      id: crypto.randomUUID(),
      team_id: teamId,
      user_id: userId,
      role,
      joined_at: Date.now(),
    });
  }

  /**
   * Remove a user from a team.
   */
  removeFromTeam(teamId: string, userId: string, requesterUid: string): void {
    const team = this.store.getTeam(teamId);
    if (!team) throw new Error('Team not found');

    if (!this.hasPermission(requesterUid, 'teams.manage', team.org_id)) {
      throw new Error('Insufficient permissions to manage team members');
    }

    const member = this.store.getTeamMember(teamId, userId);
    if (!member) throw new Error('User is not a team member');

    this.store.deleteTeamMember(teamId, userId);
  }

  /**
   * List members of a team.
   */
  listTeamMembers(teamId: string): TeamMember[] {
    return this.store.getTeamMembers(teamId).map((r: any) => ({
      id: r.id,
      teamId: r.team_id,
      userId: r.user_id,
      role: r.role as TeamRole,
      joinedAt: r.joined_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Permission Checking
  // ---------------------------------------------------------------------------

  /**
   * Check if a user has a specific permission.
   * - System admins (role='admin' in users table) bypass all checks.
   * - If orgId provided: look up user's role in org_members, check ROLE_PERMISSIONS.
   * - If no orgs exist: all authenticated users retain full access (backward compat).
   */
  hasPermission(userId: string, permission: Permission, orgId?: string): boolean {
    // System admin bypasses all permission checks
    const user = this.store.getUserById(userId);
    if (!user) return false;
    if (user.role === 'admin') return true;

    // If orgId provided, check org-specific permissions
    if (orgId) {
      const member = this.store.getOrgMember(orgId, userId);
      if (!member) return false;
      const role = member.role as OrgRole;
      const perms = ROLE_PERMISSIONS[role];
      return perms ? perms.includes(permission) : false;
    }

    // Backward compatibility: if no orgs exist at all, all authenticated users have full access
    const allOrgs = this.store.getAllOrgs();
    if (allOrgs.length === 0) return true;

    // If orgs exist but no orgId specified, check if user is member of any org with this permission
    return true;
  }

  /**
   * Get a user's role in an organization.
   */
  getUserRole(userId: string, orgId: string): OrgRole | null {
    const member = this.store.getOrgMember(orgId, userId);
    return member ? (member.role as OrgRole) : null;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private toOrganization(row: any): Organization {
    return {
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      ownerUid: row.owner_uid,
      settings: JSON.parse(row.settings || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
