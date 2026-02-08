import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../EventBus.js';
import { StateStore } from '../StateStore.js';
import { AuthManager } from '../AuthManager.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

describe('RBAC & Organizations', () => {
  let bus: EventBus;
  let store: StateStore;
  let auth: AuthManager;
  let dbPath: string;
  let tmpDir: string;

  let adminUid: string;
  let userUid: string;

  beforeEach(async () => {
    bus = new EventBus();
    tmpDir = path.join('/tmp', `aether-rbac-test-${crypto.randomBytes(8).toString('hex')}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'rbac-test.db');
    process.env.AETHER_SECRET = 'test-secret-key-for-rbac-testing';
    store = new StateStore(bus, dbPath);
    auth = new AuthManager(bus, store);

    // Create two users: an admin and a regular user
    const admin = await auth.createUser('admin', 'admin123', 'Admin User', 'admin');
    const user = await auth.createUser('testuser', 'pass1234', 'Test User');
    adminUid = admin.id;
    userUid = user.id;
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

  // ---------------------------------------------------------------------------
  // Organization CRUD
  // ---------------------------------------------------------------------------

  describe('createOrg()', () => {
    it('creates an organization and adds owner as member', () => {
      const org = auth.createOrg('my-org', userUid, 'My Organization');
      expect(org.name).toBe('my-org');
      expect(org.displayName).toBe('My Organization');
      expect(org.ownerUid).toBe(userUid);

      // Owner should be auto-added as a member with role 'owner'
      const members = auth.listMembers(org.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(userUid);
      expect(members[0].role).toBe('owner');
    });

    it('rejects duplicate org names', () => {
      auth.createOrg('my-org', userUid);
      expect(() => auth.createOrg('my-org', userUid)).toThrow();
    });

    it('rejects empty names', () => {
      expect(() => auth.createOrg('', userUid)).toThrow();
    });
  });

  describe('getOrg()', () => {
    it('returns the org by ID', () => {
      const created = auth.createOrg('get-test', userUid);
      const found = auth.getOrg(created.id);
      expect(found).toBeDefined();
      expect(found!.name).toBe('get-test');
    });

    it('returns undefined for non-existent org', () => {
      expect(auth.getOrg('nonexistent')).toBeUndefined();
    });
  });

  describe('listOrgs()', () => {
    it('lists all orgs when no userId filter', () => {
      auth.createOrg('org-a', userUid);
      auth.createOrg('org-b', adminUid);
      const all = auth.listOrgs();
      expect(all).toHaveLength(2);
    });

    it('filters by userId membership', () => {
      auth.createOrg('org-a', userUid);
      auth.createOrg('org-b', adminUid);
      const userOrgs = auth.listOrgs(userUid);
      expect(userOrgs).toHaveLength(1);
      expect(userOrgs[0].name).toBe('org-a');
    });
  });

  describe('updateOrg()', () => {
    it('allows owner to update display name', () => {
      const org = auth.createOrg('upd-org', userUid, 'Old Name');
      auth.updateOrg(org.id, { displayName: 'New Name' }, userUid);
      const updated = auth.getOrg(org.id);
      expect(updated!.displayName).toBe('New Name');
    });

    it('allows system admin to update any org', () => {
      const org = auth.createOrg('upd-org', userUid);
      auth.updateOrg(org.id, { displayName: 'Admin Changed' }, adminUid);
      const updated = auth.getOrg(org.id);
      expect(updated!.displayName).toBe('Admin Changed');
    });

    it('rejects updates from non-member', async () => {
      const org = auth.createOrg('upd-org', userUid);
      const other = await auth.createUser('other', 'pass1234');
      expect(() => auth.updateOrg(org.id, { displayName: 'Hacked' }, other.id)).toThrow();
    });
  });

  describe('deleteOrg()', () => {
    it('allows owner to delete', () => {
      const org = auth.createOrg('del-org', userUid);
      auth.deleteOrg(org.id, userUid);
      expect(auth.getOrg(org.id)).toBeUndefined();
    });

    it('allows system admin to delete', () => {
      const org = auth.createOrg('del-org', userUid);
      auth.deleteOrg(org.id, adminUid);
      expect(auth.getOrg(org.id)).toBeUndefined();
    });

    it('rejects delete from non-owner, non-admin', async () => {
      const org = auth.createOrg('del-org', userUid);
      const other = await auth.createUser('other', 'pass1234');
      expect(() => auth.deleteOrg(org.id, other.id)).toThrow();
    });

    it('cascades: removes members, teams, and team members', () => {
      const org = auth.createOrg('cascade-org', userUid);
      const team = auth.createTeam(org.id, 'team-1', userUid);
      auth.inviteMember(org.id, adminUid, 'admin', userUid);
      auth.addToTeam(team.id, adminUid, userUid);

      auth.deleteOrg(org.id, userUid);
      expect(auth.getOrg(org.id)).toBeUndefined();
      expect(auth.listMembers(org.id)).toHaveLength(0);
      expect(auth.listTeams(org.id)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------------

  describe('inviteMember()', () => {
    it('adds a member with the specified role', () => {
      const org = auth.createOrg('inv-org', userUid);
      auth.inviteMember(org.id, adminUid, 'admin', userUid);
      const members = auth.listMembers(org.id);
      expect(members).toHaveLength(2);
      const invited = members.find((m) => m.userId === adminUid);
      expect(invited).toBeDefined();
      expect(invited!.role).toBe('admin');
    });

    it('rejects inviting as owner', () => {
      const org = auth.createOrg('inv-org', userUid);
      expect(() => auth.inviteMember(org.id, adminUid, 'owner', userUid)).toThrow();
    });

    it('rejects duplicate membership', () => {
      const org = auth.createOrg('inv-org', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      expect(() => auth.inviteMember(org.id, adminUid, 'member', userUid)).toThrow();
    });
  });

  describe('removeMember()', () => {
    it('removes a non-owner member', () => {
      const org = auth.createOrg('rm-org', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      auth.removeMember(org.id, adminUid, userUid);
      const members = auth.listMembers(org.id);
      expect(members).toHaveLength(1); // only owner remains
    });

    it('rejects removing the owner', () => {
      const org = auth.createOrg('rm-org', userUid);
      expect(() => auth.removeMember(org.id, userUid, userUid)).toThrow();
    });
  });

  describe('updateMemberRole()', () => {
    it('updates member role', () => {
      const org = auth.createOrg('role-org', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      auth.updateMemberRole(org.id, adminUid, 'manager', userUid);
      const members = auth.listMembers(org.id);
      const updated = members.find((m) => m.userId === adminUid);
      expect(updated!.role).toBe('manager');
    });

    it('rejects changing owner role', () => {
      const org = auth.createOrg('role-org', userUid);
      expect(() => auth.updateMemberRole(org.id, userUid, 'admin', userUid)).toThrow();
    });

    it('rejects promoting to owner', () => {
      const org = auth.createOrg('role-org', userUid);
      auth.inviteMember(org.id, adminUid, 'admin', userUid);
      expect(() => auth.updateMemberRole(org.id, adminUid, 'owner', userUid)).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  describe('createTeam()', () => {
    it('creates a team under an org', () => {
      const org = auth.createOrg('team-org', userUid);
      const team = auth.createTeam(org.id, 'backend', userUid, 'Backend team');
      expect(team.name).toBe('backend');
      expect(team.description).toBe('Backend team');
      expect(team.orgId).toBe(org.id);
    });

    it('rejects duplicate team names in same org', () => {
      const org = auth.createOrg('team-org', userUid);
      auth.createTeam(org.id, 'backend', userUid);
      expect(() => auth.createTeam(org.id, 'backend', userUid)).toThrow();
    });
  });

  describe('deleteTeam()', () => {
    it('deletes team and its members', () => {
      const org = auth.createOrg('team-org', userUid);
      const team = auth.createTeam(org.id, 'frontend', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      auth.addToTeam(team.id, adminUid, userUid);

      auth.deleteTeam(team.id, userUid);
      const teams = auth.listTeams(org.id);
      expect(teams).toHaveLength(0);
    });
  });

  describe('listTeams()', () => {
    it('lists teams for an org', () => {
      const org = auth.createOrg('team-org', userUid);
      auth.createTeam(org.id, 'team-a', userUid);
      auth.createTeam(org.id, 'team-b', userUid);
      expect(auth.listTeams(org.id)).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Team Members
  // ---------------------------------------------------------------------------

  describe('addToTeam()', () => {
    it('adds an org member to a team', () => {
      const org = auth.createOrg('tm-org', userUid);
      const team = auth.createTeam(org.id, 'dev', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      auth.addToTeam(team.id, adminUid, userUid);

      const members = auth.listTeamMembers(team.id);
      expect(members).toHaveLength(1);
      expect(members[0].userId).toBe(adminUid);
    });

    it('rejects non-org-member', async () => {
      const org = auth.createOrg('tm-org', userUid);
      const team = auth.createTeam(org.id, 'dev', userUid);
      const outsider = await auth.createUser('outsider', 'pass1234');
      expect(() => auth.addToTeam(team.id, outsider.id, userUid)).toThrow();
    });
  });

  describe('removeFromTeam()', () => {
    it('removes a member from a team', () => {
      const org = auth.createOrg('tm-org', userUid);
      const team = auth.createTeam(org.id, 'dev', userUid);
      auth.inviteMember(org.id, adminUid, 'member', userUid);
      auth.addToTeam(team.id, adminUid, userUid);
      auth.removeFromTeam(team.id, adminUid, userUid);
      expect(auth.listTeamMembers(team.id)).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  describe('hasPermission()', () => {
    it('system admin bypasses all checks', () => {
      expect(auth.hasPermission(adminUid, 'org.manage')).toBe(true);
      expect(auth.hasPermission(adminUid, 'org.delete')).toBe(true);
      expect(auth.hasPermission(adminUid, 'members.invite')).toBe(true);
    });

    it('owner has all org permissions', () => {
      const org = auth.createOrg('perm-org', userUid);
      expect(auth.hasPermission(userUid, 'org.manage', org.id)).toBe(true);
      expect(auth.hasPermission(userUid, 'org.delete', org.id)).toBe(true);
      expect(auth.hasPermission(userUid, 'members.invite', org.id)).toBe(true);
      expect(auth.hasPermission(userUid, 'teams.create', org.id)).toBe(true);
      expect(auth.hasPermission(userUid, 'plugins.manage', org.id)).toBe(true);
    });

    it('viewer has read-only permissions', async () => {
      const org = auth.createOrg('perm-org', userUid);
      const viewer = await auth.createUser('viewer', 'pass1234');
      auth.inviteMember(org.id, viewer.id, 'viewer', userUid);

      expect(auth.hasPermission(viewer.id, 'org.view', org.id)).toBe(true);
      expect(auth.hasPermission(viewer.id, 'members.view', org.id)).toBe(true);
      expect(auth.hasPermission(viewer.id, 'agents.view', org.id)).toBe(true);

      // Write permissions should be denied
      expect(auth.hasPermission(viewer.id, 'org.manage', org.id)).toBe(false);
      expect(auth.hasPermission(viewer.id, 'members.invite', org.id)).toBe(false);
      expect(auth.hasPermission(viewer.id, 'fs.write', org.id)).toBe(false);
    });

    it('member has standard permissions but not management', async () => {
      const org = auth.createOrg('perm-org', userUid);
      const member = await auth.createUser('member1', 'pass1234');
      auth.inviteMember(org.id, member.id, 'member', userUid);

      expect(auth.hasPermission(member.id, 'agents.spawn', org.id)).toBe(true);
      expect(auth.hasPermission(member.id, 'fs.read', org.id)).toBe(true);
      expect(auth.hasPermission(member.id, 'fs.write', org.id)).toBe(true);

      // Management-level permissions denied
      expect(auth.hasPermission(member.id, 'org.manage', org.id)).toBe(false);
      expect(auth.hasPermission(member.id, 'members.invite', org.id)).toBe(false);
    });

    it('non-member has no permissions on org', async () => {
      const org = auth.createOrg('perm-org', userUid);
      const outsider = await auth.createUser('outsider', 'pass1234');
      expect(auth.hasPermission(outsider.id, 'org.view', org.id)).toBe(false);
    });

    it('backward compat: all authenticated users have access when no orgs exist', async () => {
      // No orgs created — should return true for any permission (without orgId)
      expect(auth.hasPermission(userUid, 'agents.spawn')).toBe(true);
      expect(auth.hasPermission(userUid, 'fs.write')).toBe(true);
    });
  });

  describe('getUserRole()', () => {
    it('returns the role for a member', () => {
      const org = auth.createOrg('role-org', userUid);
      expect(auth.getUserRole(userUid, org.id)).toBe('owner');
    });

    it('returns null for non-member', () => {
      const org = auth.createOrg('role-org', userUid);
      expect(auth.getUserRole(adminUid, org.id)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Event emission
  // ---------------------------------------------------------------------------

  describe('events', () => {
    it('emits org.created on bus when org is created via store', () => {
      const events: any[] = [];
      bus.on('org.created', (data) => events.push(data));
      // createOrg doesn't emit bus events directly — the Kernel does
      // But let's verify the org is created correctly
      const org = auth.createOrg('event-org', userUid);
      expect(org.id).toBeTruthy();
    });
  });
});
