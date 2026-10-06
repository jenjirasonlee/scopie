import { afterAll, describe, expect, it } from 'vitest';
import { adminClient, anonClient, cleanup, createUser, uniqueEmail } from '../support/supabase';

afterAll(cleanup);

describe('authentication', () => {
  it('signs up a user and creates their profile', async () => {
    const client = anonClient();
    const email = uniqueEmail('signup');
    const { data, error } = await client.auth.signUp({
      email,
      password: 'a-strong-password',
      options: { data: { full_name: 'Sign Up Tester' } },
    });
    expect(error).toBeNull();
    const userId = data.user!.id;

    const { data: profile } = await adminClient()
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();
    expect(profile).toMatchObject({ email, full_name: 'Sign Up Tester' });
    await adminClient().auth.admin.deleteUser(userId);
  });

  it('signs in with the right password only', async () => {
    const user = await createUser('signin');
    const { data } = await user.client.auth.getUser();
    expect(data.user?.id).toBe(user.id);

    const { error } = await anonClient().auth.signInWithPassword({
      email: user.email,
      password: 'wrong-password',
    });
    expect(error?.message).toMatch(/invalid login credentials/i);
  });

  it('signs out and loses access', async () => {
    const user = await createUser('signout');
    const { data: before } = await user.client.from('profiles').select('id').eq('id', user.id);
    expect(before).toHaveLength(1);

    await user.client.auth.signOut();
    const { data: session } = await user.client.auth.getSession();
    expect(session.session).toBeNull();
    const { data: after } = await user.client.from('profiles').select('id').eq('id', user.id);
    expect(after ?? []).toHaveLength(0);
  });

  it('lets a user edit their own profile but not their email or anyone else’s profile', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');

    const { error } = await alice.client
      .from('profiles')
      .update({ full_name: 'Alice Updated' })
      .eq('id', alice.id);
    expect(error).toBeNull();

    const { error: emailError } = await alice.client
      .from('profiles')
      .update({ email: 'hijack@example.com' })
      .eq('id', alice.id);
    expect(emailError).not.toBeNull();

    const { data: changed } = await alice.client
      .from('profiles')
      .update({ full_name: 'Hacked' })
      .eq('id', bob.id)
      .select();
    expect(changed).toEqual([]);
  });

  it('shows nothing to signed-out visitors', async () => {
    const anon = anonClient();
    for (const table of [
      'profiles',
      'organizations',
      'organization_members',
      'social_accounts',
    ] as const) {
      const { data } = await anon.from(table).select('*');
      expect(data ?? [], table).toEqual([]);
    }
    const { error } = await anon.rpc('create_organization', {
      org_name: 'Nope',
      org_slug: 'nope-anon',
    });
    expect(error).not.toBeNull();
  });
});
