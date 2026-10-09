import { describe, expect, it, vi } from 'vitest';
import { TransientError } from '@/lib/platforms/errors';
import { fetchWithRetry, redactText, redactUrl, type FetchLike } from '@/lib/platforms/http';

const SECRET_URL =
  'https://graph.facebook.com/v24.0/oauth/access_token?client_id=1000000000000001' +
  '&client_secret=fixture-app-secret&code=fixture-auth-code&access_token=EAAFixtureUserToken000000000000' +
  '&appsecret_proof=deadbeefcafe&fb_exchange_token=EAAFixtureShortLived0000000000' +
  '&input_token=EAAFixtureInputToken00000000000&refresh_token=fixture-refresh&fields=id';

const SECRETS = [
  'fixture-app-secret',
  'fixture-auth-code',
  'EAAFixtureUserToken000000000000',
  'deadbeefcafe',
  'EAAFixtureShortLived0000000000',
  'EAAFixtureInputToken00000000000',
  'fixture-refresh',
];

function json(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch that plays back one scripted outcome per call. */
function scripted(outcomes: (Response | Error)[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = outcomes.shift();
    if (!next) throw new Error('no more scripted responses');
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch, calls };
}

const noSleep = () => Promise.resolve();

describe('redactUrl', () => {
  it('replaces every credential parameter and keeps the rest', () => {
    const redacted = redactUrl(SECRET_URL);
    for (const secret of SECRETS) expect(redacted).not.toContain(secret);
    const params = new URL(redacted).searchParams;
    for (const name of [
      'access_token',
      'client_secret',
      'code',
      'fb_exchange_token',
      'appsecret_proof',
      'input_token',
      'refresh_token',
    ]) {
      expect(params.get(name)).toBe('REDACTED');
    }
    expect(params.get('client_id')).toBe('1000000000000001');
    expect(params.get('fields')).toBe('id');
  });

  it('leaves URLs without credentials unchanged', () => {
    const url = 'https://graph.facebook.com/v24.0/17840000000000001/media?limit=50';
    expect(redactUrl(url)).toBe(url);
  });

  it('never echoes an unparseable URL', () => {
    expect(redactUrl('not a url access_token=EAAsecret')).toBe('[unparseable url]');
  });
});

describe('redactText', () => {
  it('removes token-looking query parameters from free text', () => {
    const text =
      'Bad request: access_token=EAAFixtureUserToken000000000000&client_secret=s3cret ' +
      'fb_exchange_token=abc refresh_token=xyz"';
    const redacted = redactText(text);
    expect(redacted).toContain('access_token=REDACTED');
    expect(redacted).toContain('client_secret=REDACTED');
    expect(redacted).toContain('fb_exchange_token=REDACTED');
    expect(redacted).toContain('refresh_token=REDACTED');
    expect(redacted).not.toMatch(/s3cret|abc|xyz|EAAFixture/);
  });

  it('removes bare Meta tokens (EA...) and leaves short words alone', () => {
    expect(redactText('Invalid token EAAFixtureUserToken000000000000 given')).toBe(
      'Invalid token REDACTED given',
    );
    expect(redactText('EACH user and EAST region')).toBe('EACH user and EAST region');
  });

  it('removes every credential parameter that redactUrl knows about', () => {
    const redacted = redactText(`connect ECONNRESET ${SECRET_URL}`);
    for (const secret of SECRETS) expect(redacted).not.toContain(secret);
    expect(redacted).toContain('client_id=1000000000000001');
  });

  it('does not treat parameters that merely end in a secret name as secrets', () => {
    expect(redactText('error_code=190&subcode=463')).toBe('error_code=190&subcode=463');
  });
});

describe('fetchWithRetry', () => {
  it('retries 5xx responses and returns the first success', async () => {
    const { fetch, calls } = scripted([json(500), json(503), json(200, { ok: true })]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
    const response = await fetchWithRetry(
      'https://example.test/a',
      {},
      {
        fetch,
        sleep,
        random: () => 0,
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    // Exponential backoff: 500ms, then 1000ms (no jitter with random() = 0).
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
  });

  it('adds jitter of up to the base delay', async () => {
    const { fetch } = scripted([json(502), json(502), json(200)]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
    await fetchWithRetry('https://example.test/a', {}, { fetch, sleep, random: () => 0.5 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([750, 1500]);
  });

  it('retries network errors and then succeeds', async () => {
    const { fetch, calls } = scripted([new TypeError('fetch failed'), json(200)]);
    const response = await fetchWithRetry('https://example.test/a', {}, { fetch, sleep: noSleep });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('passes the request init through with an abort signal', async () => {
    const { fetch, calls } = scripted([json(200)]);
    await fetchWithRetry('https://example.test/a', { method: 'DELETE' }, { fetch });
    expect(calls[0]!.init?.method).toBe('DELETE');
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns 4xx responses without retrying', async () => {
    for (const status of [400, 401, 403, 404, 429]) {
      const { fetch, calls } = scripted([json(status, { error: { code: 1 } }), json(200)]);
      const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
      const response = await fetchWithRetry('https://example.test/a', {}, { fetch, sleep });
      expect(response.status).toBe(status);
      expect(calls).toHaveLength(1);
      expect(sleep).not.toHaveBeenCalled();
    }
  });

  it('gives up after the configured attempts with a TransientError carrying the last status', async () => {
    const { fetch, calls } = scripted([json(500), json(500), json(502), json(200)]);
    const sleep = vi.fn<(ms: number) => Promise<void>>(noSleep);
    const error = await fetchWithRetry(SECRET_URL, {}, { fetch, sleep, attempts: 3 }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(TransientError);
    const transient = error as TransientError;
    expect(transient.code).toBe('transient');
    expect(transient.status).toBe(502);
    expect(transient.message).toContain('failed after 3 attempts');
    expect(transient.message).toContain('HTTP 502');
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2); // no sleep after the final attempt
  });

  it('redacts credentials from the URL and the network error in the final message', async () => {
    const networkError = new Error(`getaddrinfo ENOTFOUND while requesting ${SECRET_URL}`);
    const { fetch } = scripted([networkError, networkError]);
    const error = (await fetchWithRetry(
      SECRET_URL,
      {},
      {
        fetch,
        sleep: noSleep,
        attempts: 2,
      },
    ).catch((caught: unknown) => caught)) as TransientError;
    expect(error).toBeInstanceOf(TransientError);
    expect(error.status).toBeUndefined();
    expect(error.message).toContain('getaddrinfo ENOTFOUND');
    expect(error.message).toContain('access_token=REDACTED');
    for (const secret of SECRETS) expect(error.message).not.toContain(secret);
  });

  it('defaults to three attempts', async () => {
    const { fetch, calls } = scripted([json(500), json(500), json(500), json(200)]);
    await expect(
      fetchWithRetry('https://example.test/a', {}, { fetch, sleep: noSleep }),
    ).rejects.toBeInstanceOf(TransientError);
    expect(calls).toHaveLength(3);
  });

  it('aborts a request that exceeds the timeout and retries it', async () => {
    let call = 0;
    const fetch: FetchLike = (_url, init) => {
      call += 1;
      if (call > 1) return Promise.resolve(json(200, { attempt: call }));
      // First attempt hangs until the timeout aborts it.
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        );
      });
    };
    const response = await fetchWithRetry(
      'https://example.test/slow',
      {},
      {
        fetch,
        sleep: noSleep,
        timeoutMs: 5,
      },
    );
    expect(await response.json()).toEqual({ attempt: 2 });
  });

  it('reports a timeout on every attempt as a TransientError', async () => {
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        );
      });
    const error = (await fetchWithRetry(
      'https://example.test/slow',
      {},
      {
        fetch,
        sleep: noSleep,
        timeoutMs: 5,
        attempts: 2,
      },
    ).catch((caught: unknown) => caught)) as TransientError;
    expect(error).toBeInstanceOf(TransientError);
    expect(error.message).toContain('aborted');
  });
});
