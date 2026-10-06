import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { connection } from 'next/server';
import { publicEnv } from '@/lib/env';
import type { Database } from './types';

/**
 * Supabase client acting as the signed-in user. Every query goes through
 * Row Level Security, so it can only see the user's own organizations.
 */
export async function createClient() {
  // Auth checks token expiry against the current time, so this must run per request,
  // never during prerendering (Cache Components would flag the Date.now() call).
  await connection();
  const env = publicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // proxy.ts refreshes the session cookie on every request instead.
          }
        },
      },
    },
  );
}

export type ServerClient = Awaited<ReturnType<typeof createClient>>;
