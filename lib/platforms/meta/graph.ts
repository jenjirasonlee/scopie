import { createHmac } from 'node:crypto';
import {
  AuthError,
  PermissionError,
  PlatformError,
  RateLimitError,
  ValidationError,
} from '../errors';
import { fetchWithRetry, redactText, type HttpOptions } from '../http';

/**
 * Graph API version. Pinned so Meta changes arrive on our schedule, not theirs.
 * Override with META_GRAPH_API_VERSION when upgrading; the metric map notes which
 * metrics to re-verify (docs/API_INTEGRATIONS.md §4).
 */
export const DEFAULT_GRAPH_VERSION = 'v24.0';

export type GraphClientOptions = HttpOptions & {
  version?: string;
  /** Adds appsecret_proof to every call, as Meta recommends for server-side requests. */
  appSecret?: string;
  /** Collects raw responses for debugging retention. */
  onResponse?: (endpoint: string, body: unknown) => void;
  /** Receives the app's platform rate-limit usage (0-100) after each call that reports it. */
  onUsage?: (percent: number) => void;
};

type GraphErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

const RATE_LIMIT_CODES = new Set([
  4, 17, 32, 613, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80014,
]);
const AUTH_CODES = new Set([102, 190, 463, 467]);

/** Reads Meta's usage headers for how long to wait before calling again. */
export function retryAfterFromHeaders(headers: Headers): number {
  for (const name of ['x-business-use-case-usage', 'x-app-usage', 'x-ad-account-usage']) {
    const raw = headers.get(name);
    if (!raw) continue;
    try {
      const parsed: unknown = JSON.parse(raw);
      const entries =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? Object.values(parsed as Record<string, unknown>).flat()
          : [];
      const minutes = entries
        .map((entry) =>
          entry && typeof entry === 'object'
            ? Number((entry as Record<string, unknown>).estimated_time_to_regain_access)
            : NaN,
        )
        .filter((value) => Number.isFinite(value) && value > 0);
      if (minutes.length) return Math.max(...minutes) * 60;
    } catch {
      // Ignore malformed headers; fall back to the default below.
    }
  }
  return 15 * 60;
}

/**
 * The highest percentage in Meta's X-App-Usage header (call count, CPU time, total time),
 * or null when the header is missing. Business Discovery counts against this limit.
 */
export function appUsagePercent(headers: Headers): number | null {
  const raw = headers.get('x-app-usage');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values = ['call_count', 'total_cputime', 'total_time']
      .map((key) => Number(parsed[key]))
      .filter((value) => Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  } catch {
    return null;
  }
}

/** Maps a Graph API error response to a typed connector error. */
export function toGraphError(
  status: number,
  body: GraphErrorBody,
  headers: Headers,
): PlatformError {
  const error = body.error ?? {};
  const code = error.code ?? 0;
  const message = redactText(error.message ?? `Graph API error (HTTP ${status})`);
  if (AUTH_CODES.has(code)) {
    return new AuthError(message);
  }
  if (RATE_LIMIT_CODES.has(code) || status === 429) {
    return new RateLimitError(retryAfterFromHeaders(headers), message);
  }
  if (code === 10 || (code >= 200 && code < 300)) {
    return new PermissionError(message);
  }
  if (code === 100) {
    return new PlatformError(message, 'invalid_parameter', status);
  }
  return new PlatformError(message, 'platform_error', status);
}

export class GraphClient {
  readonly version: string;
  private readonly options: GraphClientOptions;

  constructor(options: GraphClientOptions = {}) {
    this.options = options;
    this.version = options.version ?? DEFAULT_GRAPH_VERSION;
  }

  url(path: string, params: Record<string, string | number | undefined>): string {
    const url = new URL(`https://graph.facebook.com/${this.version}/${path.replace(/^\//, '')}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(
    method: 'GET' | 'DELETE',
    path: string,
    params: Record<string, string | number | undefined>,
    accessToken?: string,
  ): Promise<T> {
    const query = { ...params };
    if (accessToken) {
      query.access_token = accessToken;
      if (this.options.appSecret) {
        query.appsecret_proof = createHmac('sha256', this.options.appSecret)
          .update(accessToken)
          .digest('hex');
      }
    }
    const response = await fetchWithRetry(this.url(path, query), { method }, this.options);
    const usage = appUsagePercent(response.headers);
    if (usage !== null) this.options.onUsage?.(usage);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ValidationError(`Graph API returned a non-JSON response for ${path}`);
    }
    if (!response.ok || (body && typeof body === 'object' && 'error' in body)) {
      throw toGraphError(response.status, body as GraphErrorBody, response.headers);
    }
    this.options.onResponse?.(`${method} ${path}`, body);
    return body as T;
  }

  get<T>(path: string, params: Record<string, string | number | undefined>, accessToken?: string) {
    return this.request<T>('GET', path, params, accessToken);
  }
}
