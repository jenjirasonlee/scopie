import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { publicEnv } from '@/lib/env';
import { serverEnv } from '@/lib/server-env';
import type { Database } from './types';

/**
 * Supabase client with the service role. It bypasses Row Level Security, so it is
 * used in exactly three places: the platform OAuth callback (to store encrypted
 * tokens no user can read), disconnecting a platform (to revoke the token), and
 * the sync worker. Every caller checks the user's permission first.
 * Never import this from a client component or pass its results to the browser.
 */
export function createAdminClient() {
  const key = serverEnv().SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient<Database>(publicEnv().NEXT_PUBLIC_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AdminClient = ReturnType<typeof createAdminClient>;
