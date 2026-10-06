import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, createOrg, createUser, type TestUser } from '../support/supabase';

let alice: TestUser;
let bob: TestUser;
let aliceOrg: { id: string; slug: string };
let bobOrg: { id: string };
let aliceAccountId: string;

beforeAll(async () => {
  alice = await createUser('tenant-alice');
  bob = await createUser('tenant-bob');
  aliceOrg = await createOrg(alice, 'Alice Org');
  bobOrg = await createOrg(bob, 'Bob Org');
  const { data, error } = await alice.client
    .from('social_accounts')
    .insert({
      organization_id: aliceOrg.id,
      platform_key: 'instagram',
      display_name: 'Alice IG',
      handle: 'alice_ig',
    })
    .select('id')
    .single();
  if (error) throw error;
  aliceAccountId = data.id;
});

afterAll(cleanup);

describe('organization isolation', () => {
  it('makes the creator the owner of a new organization', async () => {
    const { data } = await alice.client
      .from('organization_members')
      .select('role')
      .eq('organization_id', aliceOrg.id)
      .eq('user_id', alice.id)
      .single();
    expect(data?.role).toBe('OWNER');
  });

  it('only shows a user their own organizations', async () => {
    const { data } = await bob.client.from('organizations').select('id');
    expect(data?.map((org) => org.id)).toEqual([bobOrg.id]);
    const { data: bySlug } = await bob.client
      .from('organizations')
      .select('id')
      .eq('slug', aliceOrg.slug);
    expect(bySlug).toEqual([]);
  });

  it('hides other organizations’ members and accounts', async () => {
    const { data: members } = await bob.client
      .from('organization_members')
      .select('user_id')
      .eq('organization_id', aliceOrg.id);
    expect(members).toEqual([]);

    const { data: accounts } = await bob.client.from('social_accounts').select('id');
    expect(accounts).toEqual([]);

    const { data: activity } = await bob.client
      .from('activity_log')
      .select('id')
      .eq('organization_id', aliceOrg.id);
    expect(activity).toEqual([]);
  });

  it('hides profiles of people who share no organization', async () => {
    const { data } = await bob.client.from('profiles').select('id').eq('id', alice.id);
    expect(data).toEqual([]);
  });

  it('blocks writing into another organization', async () => {
    const { error: insertError } = await bob.client
      .from('social_accounts')
      .insert({ organization_id: aliceOrg.id, platform_key: 'facebook', display_name: 'Intruder' });
    expect(insertError).not.toBeNull();

    const { data: updated } = await bob.client
      .from('social_accounts')
      .update({ display_name: 'Hijacked' })
      .eq('id', aliceAccountId)
      .select();
    expect(updated).toEqual([]);

    const { data: orgUpdate } = await bob.client
      .from('organizations')
      .update({ name: 'Hijacked' })
      .eq('id', aliceOrg.id)
      .select();
    expect(orgUpdate).toEqual([]);

    const { error: joinError } = await bob.client
      .from('organization_members')
      .insert({ organization_id: aliceOrg.id, user_id: bob.id, role: 'OWNER' });
    expect(joinError).not.toBeNull();
  });

  it('blocks moving an account into another organization', async () => {
    const { error } = await alice.client
      .from('social_accounts')
      .update({ organization_id: bobOrg.id })
      .eq('id', aliceAccountId);
    expect(error).not.toBeNull();
  });

  it('does not allow creating organizations except through create_organization', async () => {
    const { error } = await alice.client
      .from('organizations')
      .insert({ name: 'Direct', slug: 'direct-insert-test' });
    expect(error).not.toBeNull();
  });

  it('rejects duplicate organization URLs', async () => {
    const { error } = await bob.client.rpc('create_organization', {
      org_name: 'Copy',
      org_slug: aliceOrg.slug,
    });
    expect(error?.code).toBe('23505');
  });
});
