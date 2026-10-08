import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember, cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

let owner: TestUser;
let manager: TestUser;
let editor: TestUser;
let orgId: string;
let accountId: string;

beforeAll(async () => {
  owner = await createUser('groups-owner');
  manager = await createUser('groups-manager');
  editor = await createUser('groups-editor');
  orgId = (await createOrg(owner, 'Groups Org')).id;
  await addMember(orgId, manager, 'MANAGER');
  await addMember(orgId, editor, 'EDITOR');
  const { data, error } = await owner.client
    .from('social_accounts')
    .insert({
      organization_id: orgId,
      platform_key: 'instagram',
      display_name: 'Rival',
      handle: 'rival_groups',
      business_role: 'competitor',
    })
    .select('id')
    .single();
  if (error) throw error;
  accountId = data.id;
});

afterAll(cleanup);

describe('benchmark groups', () => {
  it('can be created and filled by managers', async () => {
    const { data: group, error } = await manager.client
      .from('account_groups')
      .insert({ organization_id: orgId, name: 'Spain competitors', kind: 'custom' })
      .select('id')
      .single();
    expect(error).toBeNull();
    const { error: memberError } = await manager.client
      .from('account_group_members')
      .insert({ organization_id: orgId, group_id: group!.id, social_account_id: accountId });
    expect(memberError).toBeNull();
  });

  it('leave region groups and profiles to owners and admins', async () => {
    const { error: regionError } = await manager.client
      .from('account_groups')
      .insert({ organization_id: orgId, name: 'Iberia', kind: 'region' });
    expect(regionError).not.toBeNull();
    const { error: profileError } = await manager.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'instagram',
      display_name: 'Another',
      handle: 'another_groups',
      business_role: 'competitor',
    });
    expect(profileError).not.toBeNull();
  });

  it('are read-only for editors', async () => {
    const { error } = await editor.client
      .from('account_groups')
      .insert({ organization_id: orgId, name: 'Editor group', kind: 'custom' });
    expect(error).not.toBeNull();
  });
});
