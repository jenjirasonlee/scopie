import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  PermissionError,
  PlatformError,
  RateLimitError,
  TransientError,
  ValidationError,
} from '@/lib/platforms/errors';
import type { FetchLike } from '@/lib/platforms/http';
import {
  DEFAULT_GRAPH_VERSION,
  GraphClient,
  retryAfterFromHeaders,
  toGraphError,
} from '@/lib/platforms/meta/graph';

const TOKEN = 'EAAFixtureUserToken0000000000000000';
const APP_SECRET = 'fixture-app-secret';
const noSleep = () => Promise.resolve();

function graphError(code: number, message = `(#${code}) Fixture error`) {
  return { error: { message, type: 'OAuthException', code, fbtrace_id: 'AFixtureTrace' } };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeFetch(handler: (url: URL) => Response) {
  const calls: URL[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url);
    return handler(url);
  };
  return { fetch, calls };
}

describe('toGraphError', () => {
  const none = new Headers();

  it.each([190, 102, 463, 467])('maps code %i to AuthError', (code) => {
    const error = toGraphError(400, graphError(code), none);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe('auth');
  });

  it.each([4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014])(
    'maps code %i to RateLimitError',
    (code) => {
      const error = toGraphError(400, graphError(code), none);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.code).toBe('rate_limited');
    },
  );

  it('maps HTTP 429 to RateLimitError whatever the code', () => {
    expect(toGraphError(429, {}, none)).toBeInstanceOf(RateLimitError);
    expect(toGraphError(429, graphError(1), none)).toBeInstanceOf(RateLimitError);
  });

  it('reads retry-after from the business-use-case header', () => {
    const headers = new Headers({
      'x-business-use-case-usage': JSON.stringify({
        '100000000000001': [
          {
            type: 'pages',
            call_count: 100,
            total_cputime: 40,
            total_time: 60,
            estimated_time_to_regain_access: 7,
          },
        ],
      }),
    });
    const error = toGraphError(400, graphError(80001), headers) as RateLimitError;
    expect(error.retryAfterSeconds).toBe(7 * 60);
  });

  it.each([10, 200, 210, 299])('maps code %i to PermissionError', (code) => {
    const error = toGraphError(403, graphError(code), none);
    expect(error).toBeInstanceOf(PermissionError);
    expect(error.code).toBe('permission');
  });

  it('maps code 100 to an invalid_parameter PlatformError keeping the status', () => {
    const error = toGraphError(400, graphError(100), none);
    expect(error.constructor).toBe(PlatformError);
    expect(error.code).toBe('invalid_parameter');
    expect(error.status).toBe(400);
  });

  it('maps anything else to a generic platform_error', () => {
    const error = toGraphError(400, graphError(1, 'An unknown error occurred'), none);
    expect(error.code).toBe('platform_error');
    expect(error.message).toBe('An unknown error occurred');
    expect(toGraphError(404, {}, none).message).toBe('Graph API error (HTTP 404)');
    expect(toGraphError(400, graphError(300), none).code).toBe('platform_error');
  });

  it('redacts tokens that Meta echoes back in the message', () => {
    const error = toGraphError(
      400,
      graphError(190, `Malformed access token ${TOKEN} (access_token=${TOKEN})`),
      none,
    );
    expect(error.message).not.toContain(TOKEN);
  });
});

describe('retryAfterFromHeaders', () => {
  it('uses the longest wait across all business use cases, in seconds', () => {
    const headers = new Headers({
      'x-business-use-case-usage': JSON.stringify({
        '100000000000001': [{ type: 'pages', estimated_time_to_regain_access: 2 }],
        '17840000000000001': [
          { type: 'instagram', estimated_time_to_regain_access: 0 },
          { type: 'instagram', estimated_time_to_regain_access: 11 },
        ],
      }),
    });
    expect(retryAfterFromHeaders(headers)).toBe(660);
  });

  it('falls back to 15 minutes when no header says how long to wait', () => {
    expect(retryAfterFromHeaders(new Headers())).toBe(900);
    expect(
      retryAfterFromHeaders(
        new Headers({ 'x-app-usage': '{"call_count":100,"total_cputime":20,"total_time":30}' }),
      ),
    ).toBe(900);
    expect(
      retryAfterFromHeaders(
        new Headers({
          'x-business-use-case-usage': JSON.stringify({
            '100000000000001': [{ type: 'pages', estimated_time_to_regain_access: 0 }],
          }),
        }),
      ),
    ).toBe(900);
  });

  it('ignores a malformed header and keeps looking', () => {
    const headers = new Headers({
      'x-business-use-case-usage': '{not json',
      'x-ad-account-usage': JSON.stringify({ act: [{ estimated_time_to_regain_access: 3 }] }),
    });
    expect(retryAfterFromHeaders(headers)).toBe(180);
  });
});

describe('GraphClient', () => {
  it('builds versioned URLs and drops undefined params', () => {
    const client = new GraphClient();
    expect(client.version).toBe(DEFAULT_GRAPH_VERSION);
    const url = new URL(client.url('/17840000000000001/media', { limit: 50, after: undefined }));
    expect(url.pathname).toBe(`/${DEFAULT_GRAPH_VERSION}/17840000000000001/media`);
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('after')).toBe(false);
    expect(new GraphClient({ version: 'v25.0' }).url('me', {})).toBe(
      'https://graph.facebook.com/v25.0/me',
    );
  });

  it('sends the token and appsecret_proof = HMAC-SHA256(token, app secret)', async () => {
    const { fetch, calls } = fakeFetch(() => respond(200, { id: '17840000000000001' }));
    const client = new GraphClient({ fetch, appSecret: APP_SECRET });
    await client.get('me', { fields: 'id' }, TOKEN);
    const expected = createHmac('sha256', APP_SECRET).update(TOKEN).digest('hex');
    expect(calls[0]!.searchParams.get('access_token')).toBe(TOKEN);
    expect(calls[0]!.searchParams.get('appsecret_proof')).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(calls[0]!.searchParams.get('fields')).toBe('id');
  });

  it('sends no appsecret_proof without an app secret, and no token params without a token', async () => {
    const { fetch, calls } = fakeFetch(() => respond(200, {}));
    await new GraphClient({ fetch }).get('me', {}, TOKEN);
    expect(calls[0]!.searchParams.has('appsecret_proof')).toBe(false);
    await new GraphClient({ fetch, appSecret: APP_SECRET }).get('oauth/access_token', {});
    expect(calls[1]!.searchParams.has('access_token')).toBe(false);
    expect(calls[1]!.searchParams.has('appsecret_proof')).toBe(false);
  });

  it('reports successful responses to onResponse', async () => {
    const onResponse = vi.fn();
    const { fetch } = fakeFetch(() => respond(200, { id: '1' }));
    await new GraphClient({ fetch, onResponse }).get('me', {}, TOKEN);
    expect(onResponse).toHaveBeenCalledWith('GET me', { id: '1' });
  });

  it('turns error bodies into typed errors, even with HTTP 200', async () => {
    const onResponse = vi.fn();
    const { fetch } = fakeFetch(() => respond(200, graphError(10)));
    await expect(
      new GraphClient({ fetch, onResponse }).get('me', {}, TOKEN),
    ).rejects.toBeInstanceOf(PermissionError);
    expect(onResponse).not.toHaveBeenCalled();
  });

  it('reads retry-after from the response headers on a rate limit', async () => {
    const { fetch } = fakeFetch(() =>
      respond(400, graphError(80002), {
        'x-business-use-case-usage': JSON.stringify({
          '17840000000000001': [{ type: 'instagram', estimated_time_to_regain_access: 4 }],
        }),
      }),
    );
    const error = await new GraphClient({ fetch })
      .get('17840000000000001/insights', {}, TOKEN)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterSeconds).toBe(240);
  });

  it('rejects a non-JSON response with a ValidationError', async () => {
    const { fetch } = fakeFetch(() => respond(200, '<html>oops</html>'));
    await expect(new GraphClient({ fetch }).get('me', {}, TOKEN)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('never puts the token or proof in thrown error messages', async () => {
    const proof = createHmac('sha256', APP_SECRET).update(TOKEN).digest('hex');
    const cases: { name: string; handler: () => Response; type: unknown }[] = [
      {
        name: 'auth error echoing the token',
        handler: () =>
          respond(400, graphError(190, `Invalid OAuth access token - Cannot parse ${TOKEN}`)),
        type: AuthError,
      },
      {
        name: 'permission error',
        handler: () => respond(403, graphError(10)),
        type: PermissionError,
      },
      {
        name: 'unknown error echoing the URL',
        handler: () =>
          respond(
            400,
            graphError(
              1,
              `Bad request to /me?access_token=${TOKEN}&appsecret_proof=${proof}&fields=id`,
            ),
          ),
        type: PlatformError,
      },
      { name: 'server error', handler: () => respond(500, {}), type: TransientError },
    ];
    for (const { name, handler, type } of cases) {
      const { fetch } = fakeFetch(handler);
      const error = await new GraphClient({ fetch, appSecret: APP_SECRET, sleep: noSleep })
        .get('me', { fields: 'id' }, TOKEN)
        .catch((caught: unknown) => caught);
      expect(error, name).toBeInstanceOf(type as typeof Error);
      const message = (error as Error).message;
      expect(message, name).not.toContain(TOKEN);
      expect(message, name).not.toContain(proof);
    }
  });

  it('does not retry 4xx Graph errors', async () => {
    const { fetch, calls } = fakeFetch(() => respond(400, graphError(190)));
    await expect(
      new GraphClient({ fetch, sleep: noSleep }).get('me', {}, TOKEN),
    ).rejects.toBeInstanceOf(AuthError);
    expect(calls).toHaveLength(1);
  });

  it('uses DELETE for request("DELETE")', async () => {
    const methods: (string | undefined)[] = [];
    const fetch: FetchLike = async (_url, init) => {
      methods.push(init?.method);
      return respond(200, { success: true });
    };
    await new GraphClient({ fetch }).request('DELETE', 'me/permissions', {}, TOKEN);
    expect(methods).toEqual(['DELETE']);
  });
});
