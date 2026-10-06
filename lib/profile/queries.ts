import 'server-only';
import { requireUser } from '@/lib/auth/session';
import { createClient } from '@/lib/db/server';

export async function getMyProfile() {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, timezone, created_at')
    .eq('id', user.id)
    .single();
  if (error) throw error;
  return data;
}
