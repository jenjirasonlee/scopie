import 'server-only';
import { can, type OrgRole } from '@/lib/auth/permissions';
import type { ServerClient } from '@/lib/db/server';

/** The org and role for a slug, or null when the user isn't a member (RLS hides it). */
export async function orgForManager(
  supabase: ServerClient,
  slug: string,
): Promise<{ id: string; slug: string; userId: string } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: org } = await supabase
    .from('organizations')
    .select('id, slug')
    .eq('slug', slug)
    .maybeSingle();
  if (!org) return null;
  const { data: membership } = await supabase
    .from('organization_members')
    .select('role')
    .eq('organization_id', org.id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership || !can(membership.role as OrgRole, 'accounts.manage')) return null;
  return { id: org.id, slug: org.slug, userId: user.id };
}

export const META_STATE_COOKIE = 'scopie_meta_oauth';

export function metaRedirectUri(siteUrl: string): string {
  return new URL('/api/connections/meta/callback', siteUrl).toString();
}
