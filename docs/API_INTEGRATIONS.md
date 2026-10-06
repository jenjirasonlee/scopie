# Scopie — Platform Integrations

> Status: Phase 0 design. Last updated: 2026-10-06
>
> **Accuracy rule:** platform APIs change often (metric renames, deprecations, access tiers, pricing). Everything below reflects our understanding at the time of writing and is marked **[verify]** where details must be re-checked against the platform's official documentation when the connector is built. Nothing here may be used to fabricate a metric: if the API doesn't return it, Scopie stores it as unavailable.

## 1. Three classes of data

| Class                         | Meaning                                                                                                                        | How Scopie gets it                                            | Badge          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | -------------- |
| **Authenticated first-party** | Analytics for accounts the organization owns, authorized by an account admin via OAuth                                         | Platform insights/analytics APIs                              | `Live`         |
| **Public**                    | Data the platform's API makes available about accounts we don't own (e.g. competitor follower counts, public post like counts) | Official public endpoints only (no scraping)                  | `Public`       |
| **Unavailable**               | Metric not offered by the API, not granted, or not for this account type                                                       | Stored as `availability = not_supported / permission_missing` | `N/A` + reason |

Also: `Manual` (typed in or CSV import, e.g. for a platform without API access) and `DEMO` (seed / mock connector).

## 2. Connector contract

```ts
// lib/platforms/types.ts
export type PlatformKey =
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'youtube'
  | 'tiktok'
  | 'x'
  | 'reddit'
  | 'discord'
  | 'demo';

export interface ConnectorCapabilities {
  auth: 'oauth2' | 'api_key' | 'bot_token' | 'none';
  supportsRefreshToken: boolean;
  supportsPublicLookup: boolean; // can fetch competitor/public data
  accountMetrics: MetricCapability[]; // which normalized metrics, from which source metric, which data class
  postMetrics: MetricCapability[];
  historyLimitDays?: number; // how far back insights go
  requiredScopes: { scope: string; purpose: string }[];
}

export interface MetricCapability {
  metricKey: string; // Scopie key, e.g. 'reach'
  sourceMetric: string; // platform's name
  dataClass: 'first_party' | 'public';
  comparabilityClass: string;
  accountTypes?: string[]; // e.g. only 'business'
}

export interface PlatformConnector {
  readonly key: PlatformKey;
  readonly isDemo: boolean; // demo connectors MUST set true
  capabilities(): ConnectorCapabilities;

  // OAuth (server-only)
  getAuthorizationUrl(input: { state: string; codeVerifier?: string; redirectUri: string }): URL;
  exchangeCode(input: {
    code: string;
    codeVerifier?: string;
    redirectUri: string;
  }): Promise<TokenSet>;
  refreshToken(tokens: TokenSet): Promise<TokenSet>; // throws NotSupported if platform has no refresh
  revoke(tokens: TokenSet): Promise<void>;

  // Discovery & health
  listAuthorizedAccounts(ctx: ConnectorContext): Promise<ExternalAccount[]>; // pages/IG accounts/channels the grant covers
  validatePermissions(ctx: ConnectorContext): Promise<PermissionReport>; // granted vs required scopes
  healthCheck(ctx: ConnectorContext): Promise<HealthStatus>;

  // Data
  getProfile(ctx: AccountContext): Promise<NormalizedProfile>;
  getPosts(
    ctx: AccountContext,
    opts: { since?: Date; cursor?: string },
  ): Promise<Page<NormalizedPost>>;
  getPostMetrics(ctx: AccountContext, postIds: string[]): Promise<NormalizedMetric[]>;
  getProfileMetrics(ctx: AccountContext, range: DateRange): Promise<NormalizedMetric[]>;
  getAudienceMetrics?(ctx: AccountContext): Promise<NormalizedMetric[]>; // optional, later
  lookupPublicAccount?(ctx: ConnectorContext, handle: string): Promise<PublicAccountSnapshot>;
}
```

`connect()` / `disconnect()` from the brief are app-level flows (`lib/platforms/connections.ts`) that use `getAuthorizationUrl`, `exchangeCode`, `listAuthorizedAccounts` and `revoke`, then persist via the encrypted credential store. Connectors never touch the database; they receive a decrypted `TokenSet` inside `ConnectorContext` and return normalized records plus raw payloads. That keeps them pure and fixture-testable.

`NormalizedMetric` always includes `metricKey`, `sourceMetric`, `value | null`, `availability`, `period`, `metricDate`, `capturedAt`, `dataSource`.

### Shared connector infrastructure (`lib/platforms/http.ts`)

- Fetch wrapper with timeout, retry on 5xx/network with jittered backoff, and typed errors.
- Rate-limit awareness: reads platform headers (e.g. Meta `X-Business-Use-Case-Usage`, YouTube quota errors, X `x-rate-limit-*`) and throws `RateLimitError { retryAfter }` so the job system reschedules instead of hammering.
- URL/body redaction before logging.
- Zod schemas validate every response; unknown fields are kept in raw payloads, missing fields become `unavailable`, never defaults.

## 3. OAuth flow

1. ADMIN clicks **Connect Instagram/Facebook** → `GET /api/oauth/meta/start`.
2. Server creates signed `state` (user id, org id, nonce, 10-min expiry) and PKCE verifier if supported, stores verifier server-side, redirects to the platform.
3. Platform redirects to `/api/oauth/meta/callback?code&state`. Server verifies state, exchanges code, upgrades to long-lived token where applicable.
4. Tokens encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) into `connection_credentials`. `platform_connections` row stores granted scopes and expiry (no token).
5. `listAuthorizedAccounts` → user picks which accounts to add and sets country/language/owner for each.
6. Initial backfill job enqueued.

Lifecycle:

- **Expiry:** daily job refreshes tokens expiring within 7 days (where refresh exists). If refresh fails or the platform has no refresh, status → `needs_reauth`, ADMINs notified, accounts show "Reconnect".
- **Reconnect:** same flow; existing connection row updated, accounts re-linked by `external_id`.
- **Disconnect:** revoke at platform (best effort), delete credentials, set accounts `not_connected`. Historical data is kept and labelled with its original source.
- **Missing scopes:** `validatePermissions` lists missing scopes; affected metrics are recorded as `permission_missing`, not zero.
- Tokens never reach the browser, logs, AI prompts or error messages.

## 4. First real connector: Meta (Instagram + Facebook Pages)

### Decision

**Build the Meta connector first**, Instagram as the primary target, Facebook Pages in the same adapter.

Reasoning:

1. **Importance to CANNA:** country marketing accounts for a brand like CANNA are predominantly Instagram and Facebook; these are where most of the ~30 accounts and most posting volume are expected to be. **[verify with Jen's account list]**
2. **One authorization, many accounts:** a single Facebook Login for Business grant by someone with access to CANNA's Meta Business portfolio can cover every country's Page and linked Instagram professional account. That makes the 30-account case realistic in one connection.
3. **Mature first-party insights:** reach, views, likes, comments, shares, saves, follower counts and more at account and post level.
4. **Legitimate public competitor data:** Instagram's Business Discovery endpoint returns public fields (followers count, media count, recent media with like/comment counts where not hidden) for other professional accounts.
5. **Access is achievable for an internal tool:** when the Meta app is owned by (or its testers include) the people who administer the accounts, it can run with standard access while in development/internal use; App Review and Business Verification are needed only to serve other organizations' accounts. **[verify current Meta access-level rules]**

Alternatives considered:

- **YouTube** — technically the easiest (Google OAuth, generous public API), but likely less central to CANNA's account mix. Chosen as connector #2.
- **LinkedIn** — company page analytics require approval for LinkedIn's Community Management API; not reliably obtainable early. Planned, with manual/CSV import meanwhile.
- **TikTok, X, Reddit, Discord** — gated access, paid tiers, or limited analytics (see §6).

### Meta technical notes

- Requires Instagram **professional** accounts (Business or Creator). Personal accounts are unsupported and shown as such.
- Two Instagram login options exist: _Instagram API with Facebook Login_ (IG account linked to a Facebook Page; also unlocks Page insights) and _Instagram API with Instagram Login_. Scopie uses **Facebook Login for Business** so one grant covers both Facebook Pages and Instagram. **[verify]**
- Expected permissions **[verify exact names at build time]**:

| Scope                       | Purpose                                   |
| --------------------------- | ----------------------------------------- |
| `pages_show_list`           | List Pages the user manages               |
| `pages_read_engagement`     | Read Page posts and engagement            |
| `read_insights`             | Facebook Page insights                    |
| `instagram_basic`           | Instagram profile and media               |
| `instagram_manage_insights` | Instagram account and media insights      |
| `business_management`       | Access assets via Meta Business portfolio |

- Tokens: short-lived user token → exchanged for a long-lived user token (~60 days); Page tokens derived from it. For production, a **System User** token in CANNA's Business portfolio is preferable (not tied to one employee). **[verify]**
- Rate limits: Business Use Case (BUC) limits per app/asset, reported in response headers; connector reads them and backs off.
- Metric churn: during 2024–2025 Meta consolidated several Instagram/Facebook impression and play metrics into a unified **`views`** metric and deprecated others. Scopie pins metric names per Graph API version in `platform_metric_map`, and treats "views" and legacy "impressions" as **different comparability classes**. **[verify current metric list for the pinned API version]**
- Stories: story insights are only retrievable for a short window after posting; capturing them reliably needs Meta webhooks or frequent polling. Out of V1; documented as a known gap.
- History: insights history is limited (account-level time series do not go back indefinitely); the initial backfill pulls what is available and records the earliest date obtained.

## 5. Development/demo connector

`lib/integrations/demo/` implements `PlatformConnector` with `isDemo = true`, generating deterministic, seeded data for any platform key. Rules:

- Every record it produces has `data_source = 'demo'`.
- Accounts it creates are named "… (DEMO)" and have `connection_status = 'demo'`.
- The UI shows a persistent "Contains demo data" banner in any view mixing demo data.
- The demo connector cannot be enabled in an org flagged `production` unless an ADMIN explicitly toggles "allow demo data".

## 6. Platform capability matrix (planning)

Legend: ✓ available · ◐ limited / approval needed · ✗ not available via official API · ? to verify

| Platform       | Auth                   | Own-account analytics                                                                                                                   | Public/competitor data                                                                          | Access hurdle                                                             | Phase                        |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------- |
| Instagram      | Meta OAuth             | ✓ reach, views, interactions, saves, shares, followers                                                                                  | ◐ Business Discovery: followers, media count, per-post likes/comments for professional accounts | Pro account; App Review for multi-tenant                                  | **4 (first)**                |
| Facebook Pages | Meta OAuth             | ✓ Page & post insights (subject to Meta deprecations)                                                                                   | ◐ limited public Page fields                                                                    | Page admin; App Review for multi-tenant                                   | 4                            |
| YouTube        | Google OAuth + API key | ✓ YouTube Analytics API: views, watch time, avg view duration, subs gained/lost, likes, shares                                          | ✓ Data API: channel subscriber count (rounded), video views/likes/comments                      | Daily quota; Google OAuth verification for public release                 | 14 (#2)                      |
| LinkedIn       | LinkedIn OAuth         | ◐ Org page follower/share statistics via Community Management API                                                                       | ✗ no general competitor API                                                                     | Partner application/approval                                              | 14; manual import until then |
| TikTok         | TikTok OAuth           | ◐ Display API: follower/like/video counts, per-video views/likes/comments/shares; richer business analytics via TikTok API for Business | ✗ (Research API is for academic research, not usable here)                                      | App review                                                                | 14                           |
| X              | OAuth 2.0              | ◐ public + (own, recent) non-public tweet metrics                                                                                       | ◐ public metrics                                                                                | Paid API tier required                                                    | 14 (optional)                |
| Reddit         | OAuth                  | ◐ post score, comments, subreddit subscribers; no reach/impressions                                                                     | ◐ same public data                                                                              | Commercial use terms                                                      | later                        |
| Discord        | Bot token              | ◐ community metrics (member counts, message activity in channels the bot can see)                                                       | ✗                                                                                               | Bot added by server admin; Server Insights not in public API **[verify]** | later                        |

All rows marked ◐ or ? are verified before the connector is built and recorded in that connector's README (`lib/integrations/<platform>/README.md`), including exact scopes and metric names.

## 7. Adding a new platform connector (contributor guide summary)

1. Create `lib/integrations/<platform>/` with `connector.ts`, `schemas.ts` (Zod for API responses), `mapping.ts`, `README.md` (scopes, metrics, limits, setup).
2. Implement `PlatformConnector`; declare honest `capabilities()`.
3. Add rows to `platform_metric_map` via migration, with `comparability_class`.
4. Register in `lib/platforms/registry.ts`.
5. Add recorded-fixture tests: happy path, pagination, rate limit, expired token, missing scope, metric not returned.
6. Add env vars to `.env.example` and setup steps to `docs/oauth/<platform>.md`.
