import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { completeMetaConnection } from '@/lib/connections/meta';
import { META_STATE_COOKIE, metaRedirectUri, orgForManager } from '@/lib/connections/route-helpers';
import { createAdminClient } from '@/lib/db/admin';
import { createClient } from '@/lib/db/server';
import { publicEnv } from '@/lib/env';
import { metaConfig, serverEnv } from '@/lib/server-env';

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Meta sends the user back here after "Connect with Meta".
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  let saved: { state?: string; slug?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(META_STATE_COOKIE)?.value ?? '{}');
  } catch {
    saved = {};
  }
  const slug = saved.slug ?? '';
  const finish = (query: string) => {
    const response = NextResponse.redirect(
      new URL(slug ? `/${slug}/settings/connections?${query}` : '/', request.url),
    );
    response.cookies.delete({ name: META_STATE_COOKIE, path: '/api/connections/meta' });
    return response;
  };

  const state = params.get('state') ?? '';
  if (!saved.state || !state || !sameState(saved.state, state)) return finish('error=state');
  if (params.get('error')) return finish('error=denied');
  const code = params.get('code');
  if (!code) return finish('error=denied');

  const supabase = await createClient();
  const org = await orgForManager(supabase, slug);
  const config = metaConfig();
  const encryptionKey = serverEnv().SCOPIE_ENCRYPTION_KEY;
  if (!org) return finish('error=permission');
  if (!config || !encryptionKey) return finish('error=not_configured');

  try {
    const result = await completeMetaConnection({
      admin: createAdminClient(),
      userClient: supabase,
      organizationId: org.id,
      userId: org.userId,
      code,
      redirectUri: metaRedirectUri(publicEnv().NEXT_PUBLIC_SITE_URL),
      config,
      encryptionKey,
    });
    const query = new URLSearchParams({
      connected: String(result.assets),
      linked: String(result.autoLinked),
    });
    if (result.missingScopes.length) query.set('missing', result.missingScopes.join(','));
    return finish(query.toString());
  } catch (error) {
    // Never log tokens: messages from lib/platforms are already redacted.
    console.error(
      'Meta connection failed:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return finish('error=meta');
  }
}
