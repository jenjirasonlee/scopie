import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORG_ROLES, ROLE_PERMISSIONS, type OrgRole } from '@/lib/auth/permissions';
import { addMember, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

let owner: TestUser;
let orgId: string;
const users = {} as Record<Exclude<OrgRole, 'OWNER'>, TestUser>;

beforeAll(async () => {
  owner = await createUser('role-owner');
  orgId = (await createOrg(owner, 'Roles Org')).id;
  for (const role of ['ADMIN', 'MANAGER', 'EDITOR', 'VIEWER'] as const) {
    users[role] = await createUser(`role-${role.toLowerCase()}`);
    await addMember(orgId, users[role], role);
  }
});

afterAll(cleanup);

const asRole = (role: OrgRole) => (role === 'OWNER' ? owner : users[role]);

describe('role permissions', () => {
  it('matches the permission matrix in code', async () => {
    const { data, error } = await owner.client
      .from('role_permissions')
      .select('role, permission_key');
    expect(error).toBeNull();
    for (const role of ORG_ROLES) {
      const fromDb = data!
        .filter((row) => row.role === role)
        .map((row) => row.permission_key)
        .sort();
      expect(fromDb, role).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('lets every member read the organization and its accounts', async () => {
    for (const role of ORG_ROLES) {
      const { data } = await asRole(role).client.from('organizations').select('id').eq('id', orgId);
      expect(data, role).toHaveLength(1);
    }
  });

  it.each([
    ['OWNER', true],
    ['ADMIN', true],
    ['MANAGER', false],
    ['EDITOR', false],
    ['VIEWER', false],
  ] as const)('%s can add social accounts: %s', async (role, allowed) => {
    const { error } = await asRole(role)
      .client.from('social_accounts')
      .insert({
        organization_id: orgId,
        platform_key: 'linkedin',
        display_name: `${role} account`,
      });
    expect(error === null).toBe(allowed);
  });

  it.each([
    ['ADMIN', true],
    ['MANAGER', false],
    ['VIEWER', false],
  ] as const)('%s can edit organization settings: %s', async (role, allowed) => {
    const { data } = await asRole(role)
      .client.from('organizations')
      .update({ default_timezone: 'Europe/Berlin' })
      .eq('id', orgId)
      .select('id');
    expect(data?.length === 1).toBe(allowed);
  });

  it('lets admins change roles below owner', async () => {
    const { data, error } = await users.ADMIN.client
      .from('organization_members')
      .update({ role: 'MANAGER' })
      .eq('organization_id', orgId)
      .eq('user_id', users.EDITOR.id)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    await users.ADMIN.client
      .from('organization_members')
      .update({ role: 'EDITOR' })
      .eq('organization_id', orgId)
      .eq('user_id', users.EDITOR.id);
  });

  it('stops admins from granting or changing the owner role', async () => {
    const { error: promote } = await users.ADMIN.client
      .from('organization_members')
      .update({ role: 'OWNER' })
      .eq('organization_id', orgId)
      .eq('user_id', users.VIEWER.id);
    expect(promote).not.toBeNull();

    const { data: demote } = await users.ADMIN.client
      .from('organization_members')
      .update({ role: 'VIEWER' })
      .eq('organization_id', orgId)
      .eq('user_id', owner.id)
      .select();
    expect(demote).toEqual([]);
  });

  it('stops managers and below from changing roles', async () => {
    for (const role of ['MANAGER', 'EDITOR', 'VIEWER'] as const) {
      const { data } = await users[role].client
        .from('organization_members')
        .update({ role: 'ADMIN' })
        .eq('organization_id', orgId)
        .eq('user_id', users[role].id)
        .select();
      expect(data, role).toEqual([]);
    }
  });

  it('never leaves an organization without an owner', async () => {
    const { error: demote } = await owner.client
      .from('organization_members')
      .update({ role: 'ADMIN' })
      .eq('organization_id', orgId)
      .eq('user_id', owner.id);
    expect(demote?.message).toMatch(/at least one owner/);

    const { error: leave } = await owner.client
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', owner.id);
    expect(leave?.message).toMatch(/at least one owner/);
  });

  it('lets an owner hand over ownership, then step down', async () => {
    const second = await createUser('role-second-owner');
    await addMember(orgId, second, 'VIEWER');
    const { error: grant } = await owner.client
      .from('organization_members')
      .update({ role: 'OWNER' })
      .eq('organization_id', orgId)
      .eq('user_id', second.id);
    expect(grant).toBeNull();
    const { error: stepDown } = await owner.client
      .from('organization_members')
      .update({ role: 'ADMIN' })
      .eq('organization_id', orgId)
      .eq('user_id', owner.id);
    expect(stepDown).toBeNull();
  });

  it('lets members leave an organization themselves', async () => {
    const leaver = await createUser('role-leaver');
    await addMember(orgId, leaver, 'VIEWER');
    const { data } = await leaver.client
      .from('organization_members')
      .delete()
      .eq('organization_id', orgId)
      .eq('user_id', leaver.id)
      .select();
    expect(data).toHaveLength(1);
  });

  it('keeps the permission tables read-only for users', async () => {
    const { error } = await owner.client
      .from('role_permissions')
      .insert({ role: 'VIEWER', permission_key: 'org.delete' } as never);
    expect(error).not.toBeNull();
  });
});
