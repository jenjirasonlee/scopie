# Scopie — Platform Integrations

> Status: the Meta connector (Instagram + Facebook Pages) is built (Phase 2). Other platforms are planned (Phase 10) and get data through CSV import until then. Last updated: 2026-10-07
>
> **Accuracy rule:** platform APIs change often (metric renames, deprecations, access tiers, pricing). Everything below reflects our understanding at the time of writing and is marked **[verify]** where details must be re-checked against the platform's official documentation. Nothing here may be used to fabricate a metric: if the API doesn't return it, Scopie stores it as unavailable, with a reason.

## 1. Classes of data

Every stored post and metric carries a `data_source` (DATABASE.md §5.5):

| `data_source`   | Badge      | Meaning                                                                                                                  | How Scopie gets it                                          |
| --------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `authenticated` | `Live`     | Analytics for accounts the organization owns, authorized by an account admin via OAuth                                   | Platform insights APIs, written only by the sync worker     |
| `public`        | `Public`   | Data the platform's API makes available about accounts we don't own (e.g. competitor follower counts). **Not built yet** | Official public endpoints only (no scraping)                |
| `imported`      | `Imported` | Values from a CSV file (platform export or Scopie template)                                                              | Accounts → Import CSV; every row belongs to an import batch |
| `manual`        | `Manual`   | Typed in by a person                                                                                                     | Reserved; no entry screen yet                               |
| `demo`          | `DEMO`     | Fictional data for development                                                                                           | `pnpm db:seed`; accepted only in demo organizations         |

A metric that couldn't be read is stored with an `availability` instead of a value: `not_permitted` (scope missing or withheld), `not_applicable`, `pending` (the platform hasn't reported that day yet) or `error`. It is never stored as 0.

## 2. Connector contract

```ts
// lib/platforms/types.ts
export interface PlatformAdapter {
  readonly platformKey: string;
  /** Daily account metrics for each complete day in [since, until], plus running totals (e.g. followers) dated asOf. */
  getAccountMetrics(
    ctx: AccountContext,
    range: AccountMetricRange,
  ): Promise<NormalizedAccountMetric[]>;
  /** Newest posts first. Pass the previous page's cursor to continue. */
  listPosts(ctx: AccountContext, cursor: string | null): Promise<PostPage>;
  getPostMetrics(
    ctx: AccountContext,
    posts: Pick<NormalizedPost, 'externalId' | 'mediaFormat' | 'nativeType'>[],
  ): Promise<PostMetricsResult>; // metrics + per-post failures
  /** Raw responses collected since the last call, kept 30 days for debugging. */
  drainRawPayloads?(): RawPayload[];
}

export type AccountContext = {
  platformKey: string;
  externalId: string;
  accessToken: string; // decrypted by the sync worker, in memory only
  accountType: string | null;
};
```

Adapters never touch the database. The sync engine (`lib/sync/`) builds the `AccountContext` from encrypted credentials, calls the adapter, and writes the normalized records through `ingest()`. That keeps adapters pure and testable against saved responses (`tests/fixtures/meta/`). OAuth (connect, discover accounts, revoke) is separate from the adapter: `lib/platforms/meta/oauth.ts`, orchestrated by `lib/connections/`.

`lib/platforms/registry.ts` is the source of truth for which platforms have a connector (`CONNECTED_PLATFORMS`), which OAuth provider connects each (`PROVIDER_FOR_PLATFORM`) and how to build an adapter (`createAdapter`). The database column `platforms.connector_status` mirrors it, and an integration test checks they match.

Normalized metrics always carry `metricKey`, `sourceMetric`, `value | null`, `availability`, `period` (`lifetime` or `day`) and `metricDate`. Platform metric names are translated through `PLATFORM_METRIC_MAP` (`lib/metrics/registry.ts`), mirrored in the `platform_metric_map` table.

### Shared connector infrastructure

- **`lib/platforms/http.ts`** — `fetchWithRetry`: 20 s timeout, 3 attempts for network errors and 5xx with jittered exponential backoff (0.5 s, 1 s…); 4xx responses go back to the caller. `redactUrl` / `redactText` strip `access_token`, `client_secret`, `code`, `fb_exchange_token`, `appsecret_proof`, `input_token`, `refresh_token` and anything that looks like a Meta token before a URL or message is logged or stored.
- **`lib/platforms/errors.ts`** — typed errors; the sync engine decides what to do from the type, never from platform error codes:

| Error             | Meaning                                  | What happens                                                   |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------- |
| `AuthError`       | Token rejected or expired                | Connection and its accounts → `needs_reauth`; syncing stops    |
| `PermissionError` | A scope is missing for this request      | That metric is stored as `not_permitted`; not retried          |
| `RateLimitError`  | Platform asked us to slow down           | Job pauses until `retryAfterSeconds`; work done so far is kept |
| `ValidationError` | Response didn't match the Zod schema     | Not retried; never turned into default values                  |
| `TransientError`  | Network failure or 5xx after all retries | Job retried later with backoff                                 |

- **`lib/platforms/meta/graph.ts`** — `GraphClient`: pinned Graph API version (`DEFAULT_GRAPH_VERSION = 'v24.0'`, override with `META_GRAPH_API_VERSION`), `appsecret_proof` on every call, and mapping of Graph error codes to the typed errors. Rate-limit waits come from Meta's `X-Business-Use-Case-Usage` / `X-App-Usage` headers (`estimated_time_to_regain_access`), defaulting to 15 minutes.

Failure handling and the sync schedule are described in [DATA_PIPELINE.md](DATA_PIPELINE.md).

## 3. OAuth flow and token lifecycle

1. An OWNER or ADMIN clicks **Connect with Meta** in Settings → Connections → `GET /api/connections/meta/start?org={slug}`.
2. The server checks `accounts.manage` and that the Meta app, encryption key and service role key are configured. It creates a random `state`, stores it in an httpOnly cookie (10 minutes, scoped to `/api/connections/meta`) and redirects to Meta's OAuth dialog with the scopes in §4.
3. Meta redirects to `/api/connections/meta/callback?code&state`. The server compares the state (timing-safe), re-checks the user's permission, then (`lib/connections/meta.ts`):
   - exchanges the code for a short-lived user token, then for a **long-lived user token (~60 days)**;
   - reads the Meta user, the scopes actually granted, and the Facebook Pages the user manages with their linked Instagram professional accounts;
   - upserts `platform_connections` (one row per org + Meta user; granted scopes and expiry, no token);
   - stores the user token and one **Page token per Page** (obtained from the long-lived user token) encrypted in `connection_credentials`; Instagram accounts use their Page's token;
   - records every discovered Page and Instagram account in `connection_assets`;
   - auto-links Scopie accounts that already match (same platform ID, or same Instagram handle for an account without one).
4. The user is sent back to Settings → Connections with how many accounts were found and linked, and any permissions that weren't granted. Other discovered accounts can be linked to a Scopie account from that page (`link_connection_asset`). Competitor accounts can't be linked.
5. The next scheduled sync picks up the linked accounts (or an admin clicks "Sync now").

**Token security.** Tokens are encrypted at rest with AES-256-GCM (`lib/crypto/tokens.ts`, key `SCOPIE_ENCRYPTION_KEY`, versioned for rotation). `connection_credentials` has no RLS policies and all grants revoked, so only the service role (OAuth callback, disconnect, sync worker) can read it. Tokens are never sent to the browser, never logged, and redacted from error messages.

**Expiry and reconnect.** There is no automatic token refresh. Per Meta's docs, Page tokens obtained from a long-lived user token don't expire on their own but are invalidated when, for example, the user loses their Page role, changes their password or removes the app **[verify]**. When Meta rejects a token, the connection and its accounts are set to `needs_reauth`, syncing stops for them, and Settings → Connections shows **Needs reconnect**. Reconnecting is the same flow, done by the same Facebook user: the existing connection row is updated, new tokens replace the old ones, and accounts waiting on it go back to `connected`.

**Missing scopes.** Granted scopes are stored on the connection and missing ones are shown after connecting. Metrics Meta refuses for lack of permission are stored as `not_permitted`.

**Disconnect.** Revokes the grant at Meta (`DELETE /me/permissions`, best effort), deletes the stored tokens, marks the connection `revoked`, unlinks its accounts and cancels their queued syncs. Data already collected stays, labelled with its original source.

## 4. First real connector: Meta (Instagram + Facebook Pages)

### Decision

**Meta was built first**, Instagram as the primary target, Facebook Pages in the same OAuth connection.

1. **Importance to CANNA:** country marketing accounts for a brand like CANNA are predominantly Instagram and Facebook. **[verify with Jen's account list]**
2. **One authorization, many accounts:** one Meta login by someone who manages the Pages covers every country's Page and its linked Instagram professional account.
3. **Mature first-party insights:** reach, views, interactions, saves, follower counts and more at account and post level.
4. **Access is achievable for an internal tool** (see setup step 7).

Alternatives considered: **YouTube** (easy OAuth and public API, less central to CANNA's mix; next connector), **LinkedIn** (company page analytics need Community Management API approval), **TikTok, X, Reddit, Discord** (gated access, paid tiers or limited analytics; see §6).

### Setting up the Meta connector

You need a Meta app and the server environment variables in step 5. Meta's developer UI changes often; if a screen looks different, **check Meta's current docs**.

1. **Create a Meta app.** Go to [developers.facebook.com](https://developers.facebook.com/) → My Apps → Create app, and choose the **Business** app type. Connect it to your business portfolio if asked.
2. **Add Facebook Login for Business** to the app (Add product).
3. **Set the redirect URI.** In Facebook Login for Business → Settings, add this to _Valid OAuth Redirect URIs_:

   ```
   {NEXT_PUBLIC_SITE_URL}/api/connections/meta/callback
   ```

   For local development that is `http://localhost:3000/api/connections/meta/callback`. It must match `NEXT_PUBLIC_SITE_URL` exactly. Meta may require HTTPS for anything other than localhost **[verify]**.

4. **Permissions.** Scopie asks for these (`META_SCOPES` in `lib/platforms/meta/oauth.ts`). All are read-only; Scopie never posts or changes anything on Meta. They are requested with the `scope` parameter of the OAuth dialog, not a Login for Business configuration ID; if Meta requires a configuration for your app, check Meta's current docs.

   | Permission                  | Why Scopie needs it                                                |
   | --------------------------- | ------------------------------------------------------------------ |
   | `pages_show_list`           | List the Facebook Pages you manage                                 |
   | `pages_read_engagement`     | Read Page posts and their reactions, comments and shares           |
   | `read_insights`             | Read Page and post insights (reach, impressions)                   |
   | `instagram_basic`           | Read Instagram profile and posts                                   |
   | `instagram_manage_insights` | Read Instagram insights (reach, views, saves)                      |
   | `business_management`       | Find Pages and Instagram accounts owned by your business portfolio |

5. **Environment variables** (in `.env.local` for the web app, and in the sync worker's environment, e.g. the Trigger.dev project):

   | Variable                    | Value                                                                                                                                                                                                |
   | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `META_APP_ID`               | App settings → Basic → App ID (numeric)                                                                                                                                                              |
   | `META_APP_SECRET`           | App settings → Basic → App secret. Server-only.                                                                                                                                                      |
   | `META_GRAPH_API_VERSION`    | Optional, e.g. `v24.0`. Defaults to `DEFAULT_GRAPH_VERSION` in `lib/platforms/meta/graph.ts`. Re-verify metric names when changing it.                                                               |
   | `SCOPIE_ENCRYPTION_KEY`     | 32 random bytes, base64: `openssl rand -base64 32`. Encrypts tokens. Keep it secret and stable: if it changes or is lost, stored tokens can't be decrypted and every connection must be reconnected. |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API (local: shown by `pnpm db:start`). Server-only; used by the OAuth callback, disconnect and the worker.                                                   |

   Until these are set, Settings → Connections says what is missing and CSV import still works.

6. **Accounts.** Instagram accounts must be **professional** (Business or Creator) and linked to a Facebook Page. The person connecting must manage those Pages.
7. **Access level.** An app with standard access can be used by people who have a role on the app (admin, developer, tester) for the Pages and Instagram accounts they manage, which fits an internal tool. App Review (advanced access) and Business Verification are needed only to let other businesses connect their assets. Meta changes these rules; **check Meta's current docs** before relying on this.
8. **Connect.** As an OWNER or ADMIN, open Settings → Connections → **Connect with Meta**, approve, then link any accounts that weren't linked automatically.
9. **Run the sync worker** (`pnpm sync:worker`, or the Trigger.dev task; see ARCHITECTURE.md §7.2). The worker also needs `NEXT_PUBLIC_SUPABASE_URL`.

### What is collected

From `PLATFORM_METRIC_MAP` (`lib/metrics/registry.ts`). Account metrics are daily unless noted; post metrics are lifetime totals, captured at fixed post ages.

| Platform  | Scope   | Meta metric                                                                    | Scopie metric                                     | Notes                                                                 |
| --------- | ------- | ------------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------- |
| Instagram | account | `followers_count`                                                              | `followers`                                       | Current total only, recorded as of the day it is read                 |
| Instagram | account | `follower_count`                                                               | `followers_gained`                                | Daily new followers; recent days only                                 |
| Instagram | account | `reach`, `views`, `profile_views`, `total_interactions`                        | `reach`, `views`, `profile_views`, `interactions` | Daily totals, one request per day                                     |
| Instagram | post    | `reach`, `views`, `likes`, `comments`, `shares`, `saved`, `total_interactions` | same keys (`saved` → `saves`)                     | Feed posts, carousels and Reels                                       |
| Instagram | post    | `ig_reels_video_view_total_time`, `ig_reels_avg_watch_time`                    | `watch_time`, `avg_watch_duration`                | Reels only; milliseconds converted to seconds                         |
| Facebook  | account | `followers_count`                                                              | `followers`                                       | Current total only                                                    |
| Facebook  | account | `page_impressions_unique`, `page_post_engagements`                             | `reach`, `interactions`                           | Daily **[verify against current Page Insights metrics]**              |
| Facebook  | post    | `reactions`, `comments` (summary counts), `shares`                             | `reactions`, `comments`, `shares`                 | Post fields. A post with no shares has no `shares` field; stored as 0 |
| Facebook  | post    | `post_impressions_unique`, `post_impressions`, `post_clicks`                   | `reach`, `impressions`, `link_clicks`             | **[verify against current Page Insights metrics]**                    |

Daily values use Meta's reporting timezone (Pacific): the report date is `end_time` minus 12 hours. Media formats are mapped from Meta's types (Reels → `short_video`, `CAROUSEL_ALBUM` → `carousel`, etc.); the raw type is kept in `native_type`. If Instagram rejects a batch of insight metrics because one doesn't apply, the adapter retries them one by one so the rest still arrive.

### Known gaps

- **Follower history:** Meta gives only the current follower total, so follower history starts when Scopie starts tracking. Followers lost is not collected.
- **Insights history is limited:** the first daily sync asks for 28 days of account metrics; older account metrics can only come from CSV import. The post backfill pulls older posts and records the oldest one reached as `history_available_from`; older posts get one lifetime snapshot at their current age, not early-age values.
- **Stories** are not collected: Scopie lists posts from the Instagram media endpoint and doesn't poll stories, whose insights are only available for a short time after posting **[verify]**.
- **Impressions on Instagram** are not collected (Meta replaced them with `views` in 2025); Instagram `views` and Facebook `impressions` are different comparability classes. **Facebook video views** and completion rate are not collected.
- **No public/competitor data** yet (e.g. Instagram Business Discovery); competitor accounts can only get data by CSV import.
- No audience demographics, no paid/boosted split (`is_paid` stays unknown), no webhooks.

## 5. DEMO data

There is no demo connector or demo platform. `lib/demo/generate.ts` produces deterministic fictional posts and metrics, and `scripts/seed-demo.ts` writes them through the same `ingest()` path as real data with `data_source = 'demo'`. The database accepts `demo` data only in organizations with `is_demo = true`, demo accounts have `connection_status = 'demo'`, and the UI labels them **DEMO**. See DATABASE.md §10.

## 6. Platform capability matrix (planning)

Legend: ✓ available · ◐ limited / approval needed · ✗ not available via official API · ? to verify

| Platform       | Auth                   | Own-account analytics                                                                                                                   | Public/competitor data                                                                                                                                                                                                                      | Access hurdle                                                                         | Phase                     |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------- |
| Instagram      | Meta OAuth             | ✓ built: reach, views, interactions, likes, comments, shares, saves, followers, Reels watch time (§4)                                   | ✓ Business Discovery through a viewer account: followers, post count, bio, website, posts with link, caption, time, type, likes (unless hidden), comment count, Reel views. Checked 2026-10-07; see PHASE_3_PLAN.md §2 (Phase 3, not built) | Pro account + Facebook Page for the viewer; App Review only to serve other businesses | **2 ✅**, public: 3       |
| Facebook Pages | Meta OAuth             | ✓ built: followers, Page reach and engagements, post reactions/comments/shares/reach/impressions/clicks (subject to Meta deprecations)  | ◐ limited public Page fields (not built)                                                                                                                                                                                                    | Page role; App Review for other businesses                                            | **2 ✅**                  |
| YouTube        | Google OAuth + API key | ✓ YouTube Analytics API: views, watch time, avg view duration, subs gained/lost, likes, shares                                          | ✓ Data API: channel subscriber count (rounded), video views/likes/comments                                                                                                                                                                  | Daily quota (10,000 units); public data needs only an API key                         | 4 (public)                |
| LinkedIn       | LinkedIn OAuth         | ◐ Org page follower/share statistics via Community Management API                                                                       | ✗ no general competitor API                                                                                                                                                                                                                 | Partner application/approval                                                          | 10; CSV import until then |
| TikTok         | TikTok OAuth           | ◐ Display API: follower/like/video counts, per-video views/likes/comments/shares; richer business analytics via TikTok API for Business | ✗ (Research API is for academic research, not usable here)                                                                                                                                                                                  | App review                                                                            | 10                        |
| X              | OAuth 2.0              | ◐ public + (own, recent) non-public tweet metrics                                                                                       | ◐ public metrics                                                                                                                                                                                                                            | Paid API tier required                                                                | later (optional)          |
| Reddit         | OAuth                  | ◐ post score, comments, subreddit subscribers; no reach/impressions                                                                     | ◐ same public data                                                                                                                                                                                                                          | Commercial use terms                                                                  | later                     |
| Discord        | Bot token              | ◐ community metrics (member counts, message activity in channels the bot can see)                                                       | ✗                                                                                                                                                                                                                                           | Bot added by server admin; Server Insights not in public API **[verify]**             | later                     |

Until a platform has a connector, its accounts get data through CSV import (Scopie templates, plus column aliases for common exports such as LinkedIn's). All rows marked ◐ or ? are verified before the connector is built and documented here, including exact scopes and metric names.

## 7. Adding a new platform connector

1. Create `lib/platforms/<provider>/` with an adapter implementing `PlatformAdapter` (Zod schemas for every response; missing values become an availability reason, never defaults) and, if needed, an OAuth module like `meta/oauth.ts`.
2. Add mappings to `PLATFORM_METRIC_MAP` in `lib/metrics/registry.ts` **and** the same rows to `platform_metric_map` in a migration, each with a `comparability_class`. Add new metrics to both `METRIC_DEFINITIONS` and `metric_definitions`. Integration tests check code and database match.
3. Register it in `lib/platforms/registry.ts` (`CONNECTED_PLATFORMS`, `PROVIDER_FOR_PLATFORM`, `createAdapter`) and, in the same migration, set `platforms.connector_status = 'available'` and `reporting_timezone`.
4. Add connect/callback routes under `app/api/connections/<provider>/` and a `lib/connections/<provider>.ts` that stores tokens only through `connection_credentials`.
5. Add fixture tests (`tests/fixtures/<provider>/`): happy path, pagination, rate limit, expired token, missing permission, metric not returned.
6. Add env vars to `lib/server-env.ts` and `.env.example`, and setup steps to this document.
