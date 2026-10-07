import { TransientError } from './errors';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HttpOptions = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  /** Attempts in total for network errors and 5xx responses. */
  attempts?: number;
  timeoutMs?: number;
  random?: () => number;
};

const SECRET_PARAMS = [
  'access_token',
  'client_secret',
  'code',
  'fb_exchange_token',
  'appsecret_proof',
  'input_token',
  'refresh_token',
];

/** Removes credentials from a URL so it can be logged or stored. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const param of SECRET_PARAMS) {
      if (parsed.searchParams.has(param)) parsed.searchParams.set(param, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

/** Removes anything that looks like a token from free text (error messages from platforms). */
export function redactText(text: string): string {
  return text
    .replace(new RegExp(`\\b(${SECRET_PARAMS.join('|')})=[^&\\s"]+`, 'gi'), '$1=REDACTED')
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, 'REDACTED');
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * fetch with a timeout and retries for network errors and 5xx responses, with
 * jittered exponential backoff. 4xx responses are returned to the caller, which maps
 * them to typed errors (rate limit, auth, permission).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: HttpOptions = {},
): Promise<Response> {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const attempts = options.attempts ?? 3;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const random = options.random ?? Math.random;

  let lastError = 'unknown error';
  let lastStatus: number | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, { ...init, signal: controller.signal });
      if (response.status < 500) return response;
      lastStatus = response.status;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) {
      const base = 500 * 2 ** (attempt - 1);
      await sleep(base + Math.floor(random() * base));
    }
  }
  throw new TransientError(
    `Request to ${redactUrl(url)} failed after ${attempts} attempts: ${redactText(lastError)}`,
    lastStatus,
  );
}
