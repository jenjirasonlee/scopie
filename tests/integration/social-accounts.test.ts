import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  adminClient,
  cleanup,
  createOrg,
  createUser,
  type TestUser,
} from '../support/supabase';

let admin: TestUser;
let teammate: TestUser;
let outsider: TestUser;
let orgId: string;

beforeAll(async () => {
  admin = await createUser('acct-admin');
  teammate = await createUser('acct-teammate');
  outsider = await createUser('acct-outsider');
  orgId = (await createOrg(admin, 'Accounts Org')).id;
  await addMember(orgId, teammate, 'EDITOR');
  await createOrg(outsider, 'Outsider Org');
});

afterAll(cleanup);

describe('social accounts', () => {
  it('creates a manual account that is never marked as connected', async () => {
    const { data, error } = await admin.client
      .from('social_accounts')
      .insert({
        organization_id: orgId,
        platform_key: 'instagram',
        display_name: 'CANNA Germany',
        handle: 'canna_de',
        country_code: 'DE',
        language: 'de',
        // A user trying to fake a live connection:
        connection_status: 'connected',
        primary_data_source: 'authenticated',
        last_successful_sync_at: new Date().toISOString(),
      })
      .select()
      .single();
    expect(error).toBeNull();
    expect(data).toMatchObject({
      connection_status: 'not_connected',
      primary_data_source: 'manual',
      last_successful_sync_at: null,
      is_active: true,
      created_by: admin.id,
    });
  });

  it('cannot be switched to connected by a user later either', async () => {
    const { data: account } = await admin.client
      .from('social_accounts')
      .insert({
        organization_id: orgId,
        platform_key: 'facebook',
        display_name: 'CANNA DE Facebook',
      })
      .select('id')
      .single();
    const { data } = await admin.client
      .from('social_accounts')
      .update({ connection_status: 'connected', primary_data_source: 'authenticated' })
      .eq('id', account!.id)
      .select()
      .single();
    expect(data).toMatchObject({
      connection_status: 'not_connected',
      primary_data_source: 'manual',
    });
  });

  it('allows trusted server code (service role) to set connection status', async () => {
    const { data } = await adminClient()
      .from('social_accounts')
      .insert({
        organization_id: orgId,
        platform_key: 'youtube',
        display_name: 'Demo channel',
        connection_status: 'demo',
        primary_data_source: 'demo',
      })
      .select()
      .single();
    expect(data).toMatchObject({ connection_status: 'demo', primary_data_source: 'demo' });
  });

  it('rejects the same handle twice on one platform (case-insensitive)', async () => {
    const { error } = await admin.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'instagram',
      display_name: 'Duplicate',
      handle: 'CANNA_DE',
    });
    expect(error?.code).toBe('23505');
  });

  it('allows the same handle on another platform or in another organization', async () => {
    const { error: otherPlatform } = await admin.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'tiktok',
      display_name: 'TikTok',
      handle: 'canna_de',
    });
    expect(otherPlatform).toBeNull();

    const { data: outsiderOrg } = await outsider.client.from('organizations').select('id').single();
    const { error: otherOrg } = await outsider.client.from('social_accounts').insert({
      organization_id: outsiderOrg!.id,
      platform_key: 'instagram',
      display_name: 'Same handle',
      handle: 'canna_de',
    });
    expect(otherOrg).toBeNull();
  });

  it('assigns country and platform from the reference tables only', async () => {
    const { error: badCountry } = await admin.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'instagram',
      display_name: 'Bad',
      country_code: 'ZZ',
    });
    expect(badCountry?.code).toBe('23503');
    const { error: badPlatform } = await admin.client
      .from('social_accounts')
      .insert({ organization_id: orgId, platform_key: 'myspace', display_name: 'Bad' });
    expect(badPlatform?.code).toBe('23503');
  });

  it('requires the account owner to be a member of the organization', async () => {
    const { error: member } = await admin.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'x',
      display_name: 'Owned',
      owner_user_id: teammate.id,
    });
    expect(member).toBeNull();
    const { error: nonMember } = await admin.client.from('social_accounts').insert({
      organization_id: orgId,
      platform_key: 'reddit',
      display_name: 'Owned',
      owner_user_id: outsider.id,
    });
    expect(nonMember?.message).toMatch(/owner must be a member/);
  });

  it('edits, deactivates and reactivates an account, without deleting it', async () => {
    const { data: account } = await admin.client
      .from('social_accounts')
      .insert({
        organization_id: orgId,
        platform_key: 'linkedin',
        display_name: 'CANNA NL',
        country_code: 'NL',
      })
      .select('id')
      .single();

    const { data: edited } = await admin.client
      .from('social_accounts')
      .update({ display_name: 'CANNA Netherlands', country_code: 'BE' })
      .eq('id', account!.id)
      .select()
      .single();
    expect(edited).toMatchObject({ display_name: 'CANNA Netherlands', country_code: 'BE' });

    const { data: off } = await admin.client
      .from('social_accounts')
      .update({ is_active: false })
      .eq('id', account!.id)
      .select('is_active')
      .single();
    expect(off?.is_active).toBe(false);
    const { data: on } = await admin.client
      .from('social_accounts')
      .update({ is_active: true })
      .eq('id', account!.id)
      .select('is_active')
      .single();
    expect(on?.is_active).toBe(true);

    const { data: deleted } = await admin.client
      .from('social_accounts')
      .delete()
      .eq('id', account!.id)
      .select();
    expect(deleted ?? []).toEqual([]);
    const { data: stillThere } = await admin.client
      .from('social_accounts')
      .select('id')
      .eq('id', account!.id);
    expect(stillThere).toHaveLength(1);
  });

  it('records account changes in the activity log', async () => {
    const { data: account } = await admin.client
      .from('social_accounts')
      .insert({ organization_id: orgId, platform_key: 'discord', display_name: 'Community' })
      .select('id')
      .single();
    await admin.client.from('social_accounts').update({ is_active: false }).eq('id', account!.id);

    const { data: log } = await teammate.client
      .from('activity_log')
      .select('action, actor_id, changes')
      .eq('entity_id', account!.id)
      .order('id');
    expect(log?.map((row) => row.action)).toEqual(['insert', 'update']);
    expect(log?.[1]?.actor_id).toBe(admin.id);
    expect(log?.[1]?.changes).toMatchObject({ is_active: { from: true, to: false } });
  });

  it('lets an editor read but not change accounts', async () => {
    const { data: visible } = await teammate.client
      .from('social_accounts')
      .select('id')
      .eq('organization_id', orgId);
    expect(visible?.length).toBeGreaterThan(0);
    const { data: changed } = await teammate.client
      .from('social_accounts')
      .update({ display_name: 'Editor edit' })
      .eq('organization_id', orgId)
      .select();
    expect(changed).toEqual([]);
  });
});
