import 'server-only';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireUser, type CurrentUser } from '@/lib/auth/session';
import type { OrgRole } from '@/lib/auth/permissions';
import { createClient } from '@/lib/db/server';
import type { Tables } from '@/lib/db/types';

export type Organization = Tables<'organizations'>;

export type OrgContext = {
  user: CurrentUser;
  org: Organization;
  role: OrgRole;
};

export type MyOrganization = Pick<Organization, 'id' | 'name' | 'slug' | 'is_demo'> & {
  role: OrgRole;
};

/** Organizations the signed-in user belongs to. */
export const listMyOrganizations = cache(async (): Promise<MyOrganization[]> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('role, organizations!inner(id, name, slug, is_demo)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map((row) => ({ ...row.organizations, role: row.role }));
});

/**
 * Resolves an organization by slug for the signed-in user. Responds 404 when the
 * organization doesn't exist or the user isn't a member (RLS hides it either way),
 * so the existence of other organizations is never revealed.
 */
export const getOrgContext = cache(async (slug: string): Promise<OrgContext> => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data: org, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw error;
  if (!org) notFound();

  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) notFound();

  return { user, org, role: membership.role };
});
