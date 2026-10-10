import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { Database } from './types';

// /api/reports/weekly is called by the schedule, not a person; it checks its own secret.
const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/auth/confirm',
  '/auth/error',
  '/api/reports/weekly',
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * Refreshes the Supabase session cookie and redirects signed-out visitors
 * away from protected pages. Pages still verify the user themselves; this is
 * the first line of defence, not the only one.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getClaims() verifies the token's signature (locally when the project signs with asymmetric
  // keys, otherwise with Supabase Auth); do not trust getSession() here. Pages still call
  // getUser() themselves.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims.sub ? data.claims : null;

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = '';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return redirectWithCookies(url, response);
  }

  if (user && (pathname === '/sign-in' || pathname === '/sign-up')) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    return redirectWithCookies(url, response);
  }

  return response;
}

function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
