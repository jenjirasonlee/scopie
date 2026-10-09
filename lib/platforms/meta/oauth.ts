import { z } from 'zod';
import type { MetaConfig } from '@/lib/server-env';
import { GraphClient, DEFAULT_GRAPH_VERSION } from './graph';
import type { HttpOptions } from '../http';
import { nextCursor, pagingSchema, parseGraph } from './shared';

/**
 * Permissions Scopie asks for, and why. Read-only: Scopie never posts or changes
 * anything on Meta. Shown on the Connections screen before connecting.
 */
export const META_SCOPES = [
  { scope: 'pages_show_list', purpose: 'List the Facebook Pages you manage' },
  {
    scope: 'pages_read_engagement',
    purpose: 'Read Page posts and their reactions, comments and shares',
  },
  { scope: 'read_insights', purpose: 'Read Page and post insights (reach, impressions)' },
  { scope: 'instagram_basic', purpose: 'Read Instagram profile and posts' },
  { scope: 'instagram_manage_insights', purpose: 'Read Instagram insights (reach, views, saves)' },
  {
    scope: 'business_management',
    purpose: 'Find Pages and Instagram accounts owned by your business portfolio',
  },
] as const;

export function metaAuthorizationUrl(input: {
  config: MetaConfig;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(
    `https://www.facebook.com/${input.config.version ?? DEFAULT_GRAPH_VERSION}/dialog/oauth`,
  );
  url.searchParams.set('client_id', input.config.appId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('state', input.state);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', META_SCOPES.map((entry) => entry.scope).join(','));
  return url.toString();
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const meSchema = z.object({ id: z.string(), name: z.string().optional() });
const permissionsSchema = z.object({
  data: z.array(z.object({ permission: z.string(), status: z.string() })),
});
const pagesSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string().optional(),
      access_token: z.string().optional(),
      instagram_business_account: z
        .object({ id: z.string(), username: z.string().optional(), name: z.string().optional() })
        .optional(),
    }),
  ),
  paging: pagingSchema,
});

export type MetaToken = { accessToken: string; expiresAt: Date | null };

/** An account the Meta login can see. Tokens stay server-side; see lib/connections/meta.ts. */
export type MetaAsset = {
  platformKey: 'facebook' | 'instagram';
  externalId: string;
  name: string | null;
  handle: string | null;
  accountType: string;
  parentExternalId: string | null;
  /** Page access token. Instagram calls use the token of the Page it is linked to. */
  accessToken: string | null;
};

export class MetaOAuth {
  private readonly graph: GraphClient;

  constructor(
    private readonly config: MetaConfig,
    http: HttpOptions = {},
    private readonly now: () => Date = () => new Date(),
  ) {
    this.graph = new GraphClient({ ...http, version: config.version, appSecret: config.appSecret });
  }

  private toToken(body: unknown): MetaToken {
    const token = parseGraph(tokenSchema, body, 'token');
    return {
      accessToken: token.access_token,
      expiresAt: token.expires_in ? new Date(this.now().getTime() + token.expires_in * 1000) : null,
    };
  }

  /** Swaps the code from the redirect for a short-lived user token. */
  async exchangeCode(code: string, redirectUri: string): Promise<MetaToken> {
    return this.toToken(
      await this.graph.get('oauth/access_token', {
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        redirect_uri: redirectUri,
        code,
      }),
    );
  }

  /** Swaps a short-lived user token for a long-lived one (about 60 days). */
  async exchangeLongLived(shortLived: string): Promise<MetaToken> {
    return this.toToken(
      await this.graph.get('oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: this.config.appId,
        client_secret: this.config.appSecret,
        fb_exchange_token: shortLived,
      }),
    );
  }

  async me(userToken: string) {
    return parseGraph(meSchema, await this.graph.get('me', { fields: 'id,name' }, userToken), 'me');
  }

  async grantedScopes(userToken: string): Promise<string[]> {
    const body = parseGraph(
      permissionsSchema,
      await this.graph.get('me/permissions', {}, userToken),
      'permissions',
    );
    return body.data.filter((entry) => entry.status === 'granted').map((entry) => entry.permission);
  }

  /**
   * Facebook Pages the user manages and the Instagram professional accounts linked to them.
   * Page tokens obtained from a long-lived user token do not expire on their own.
   */
  async discoverAssets(userToken: string): Promise<MetaAsset[]> {
    const assets: MetaAsset[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 20; page++) {
      const body = parseGraph(
        pagesSchema,
        await this.graph.get(
          'me/accounts',
          {
            fields: 'id,name,access_token,instagram_business_account{id,username,name}',
            limit: 100,
            after: cursor ?? undefined,
          },
          userToken,
        ),
        'pages',
      );
      for (const fbPage of body.data) {
        assets.push({
          platformKey: 'facebook',
          externalId: fbPage.id,
          name: fbPage.name ?? null,
          handle: null,
          accountType: 'page',
          parentExternalId: null,
          accessToken: fbPage.access_token ?? null,
        });
        const ig = fbPage.instagram_business_account;
        if (ig) {
          assets.push({
            platformKey: 'instagram',
            externalId: ig.id,
            name: ig.name ?? ig.username ?? null,
            handle: ig.username ?? null,
            accountType: 'business',
            parentExternalId: fbPage.id,
            accessToken: fbPage.access_token ?? null,
          });
        }
      }
      cursor = nextCursor(body.paging);
      if (!cursor) break;
    }
    return assets;
  }

  /** Removes Scopie's access on Meta's side. */
  async revoke(userToken: string): Promise<void> {
    await this.graph.request('DELETE', 'me/permissions', {}, userToken);
  }
}
