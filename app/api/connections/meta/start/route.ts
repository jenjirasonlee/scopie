import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { META_STATE_COOKIE, metaRedirectUri, orgForManager } from '@/lib/connections/route-helpers';
import { createClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { metaAuthorizationUrl } from '@/lib/platforms/meta/oauth';
import { metaConfig, pipelineSetupGaps } from '@/lib/server-env';

// Starts "Connect with Meta". Only owners and admins of the organization may connect.
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get('org') ?? '';
  const back = (error: string) =>
    NextResponse.redirect(new URL(`/${slug}/settings/connections?error=${error}`, request.url));

  const supabase = await createClient();
  const org = await orgForManager(supabase, slug);
  if (!org) return NextResponse.redirect(new URL('/', request.url));

  const config = metaConfig();
  if (!config || pipelineSetupGaps().length) return back('not_configured');

  const state = randomBytes(24).toString('base64url');
  const response = NextResponse.redirect(
    metaAuthorizationUrl({
      config,
      redirectUri: metaRedirectUri(publicEnv().NEXT_PUBLIC_SITE_URL),
      state,
    }),
  );
  response.cookies.set(META_STATE_COOKIE, JSON.stringify({ state, slug: org.slug }), {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/api/connections/meta',
    maxAge: 600,
  });
  return response;
}
