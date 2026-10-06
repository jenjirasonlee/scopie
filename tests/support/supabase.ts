import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';

export type Client = SupabaseClient<Database>;

const url = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Service-role client. Bypasses RLS: use only to arrange test state, never to assert access. */
export function adminClient(): Client {
  return createClient<Database>(url(), process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
}

/** Anonymous client, as an unauthenticated browser would be. */
export function anonClient(): Client {
  return createClient<Database>(url(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options);
}

export const TEST_PASSWORD = 'integration-test-password';

export type TestUser = { id: string; email: string; client: Client };

const createdUsers: string[] = [];
const createdOrgs: string[] = [];

export function uniqueEmail(label: string) {
  return `${label}-${randomUUID().slice(0, 8)}@scopie.test`;
}

/** Creates a confirmed user and returns a client signed in as that user (RLS applies). */
export async function createUser(label: string, fullName = `${label} tester`): Promise<TestUser> {
  const email = uniqueEmail(label);
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  createdUsers.push(data.user.id);
  const client = anonClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInError) throw signInError;
  return { id: data.user.id, email, client };
}

/** Creates an organization through the public RPC, so the user becomes its OWNER. */
export async function createOrg(owner: TestUser, name = 'Test Org') {
  const slug = `t-${randomUUID().slice(0, 12)}`;
  const { data, error } = await owner.client.rpc('create_organization', {
    org_name: name,
    org_slug: slug,
  });
  if (error) throw error;
  createdOrgs.push(data.id);
  return data;
}

export async function addMember(
  orgId: string,
  user: TestUser,
  role: Database['public']['Enums']['org_role'],
) {
  const { error } = await adminClient()
    .from('organization_members')
    .insert({ organization_id: orgId, user_id: user.id, role });
  if (error) throw error;
}

export async function cleanup() {
  const admin = adminClient();
  if (createdOrgs.length)
    await admin.from('organizations').delete().in('id', createdOrgs.splice(0));
  for (const id of createdUsers.splice(0)) await admin.auth.admin.deleteUser(id);
}
