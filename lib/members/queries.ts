import 'server-only';
import { createClient } from '@/lib/db/server';
import type { OrgRole } from '@/lib/auth/permissions';

export type Member = {
  userId: string;
  email: string;
  fullName: string | null;
  role: OrgRole;
  joinedAt: string;
};

const ROLE_ORDER: Record<OrgRole, number> = {
  OWNER: 0,
  ADMIN: 1,
  MANAGER: 2,
  EDITOR: 3,
  VIEWER: 4,
};

export async function listMembers(orgId: string): Promise<Member[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('organization_members')
    .select('user_id, role, created_at, profiles!inner(email, full_name)')
    .eq('organization_id', orgId);
  if (error) throw error;
  return data
    .map((row) => ({
      userId: row.user_id,
      email: row.profiles.email,
      fullName: row.profiles.full_name,
      role: row.role,
      joinedAt: row.created_at,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.email.localeCompare(b.email));
}
