# Scopie — Platform Integrations

> Status: the Meta connector (Instagram + Facebook Pages) is built (Phase 2). Public Instagram data through Business Discovery is built (Phase 3, §4a). Public YouTube data through the Data API is built (Phase 4, §4b); other platforms are planned (Phase 10) and get data through CSV import until then. Last updated: 2026-10-07
>
> **Accuracy rule:** platform APIs change often (metric renames, deprecations, access tiers, pricing). Everything below reflects our understanding at the time of writing and is marked **[verify]** where details must be re-checked against the platform's official documentation. Nothing here may be used to fabricate a metric: if the API doesn't return it, Scopie stores it as unavailable, with a reason.

## 1. Classes of data

Every stored post and metric carries a `data_source` (DATABASE.md §5.5):

| `data_source`    | Badge       | Meaning                                                                                | How Scopie gets it                                          |
| ---------------- | ----------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `live_public`    | `PUBLIC`    | Public data about any professional account, read without the owner's authorization     | Official public endpoints only (no scraping); sync worker   |
| `live_connected` | `CONNECTED` | Analytics for accounts the organization owns, authorized by an account admin via OAuth | Platform insights APIs, written only by the sync worker     |
| `imported`       | `IMPORTED`  | Values from a CSV file (platform export or Scopie template)                            | Accounts → Import CSV; every row belongs to an import batch |
| `estimated`      | `ESTIMATED` | Reserved; nothing produces it yet                                                      | —                                                           |
| `demo`           | `DEMO`      | Fictional data for development                                                         | `pnpm db:seed`; accepted only in demo organizations         |

A metric that couldn't be read is stored with an `availability` instead of a value: `not_permitted` (scope missing or withheld), `not_applicable`, `hidden_by_owner` (for example hidden like counts), `not_public` (only the owner can see it), `pending` (the platform hasn't reported that day yet) or `error`. It is never stored as 0.

## 2. Connector contract

```ts
// lib/platforms/types.ts
export interface PrivateDataAdapter {
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

Public data has its own interface, `PublicProfileCollector`, described in §4a. It reads a profile by handle with an app-level credential (`PublicContext`), never the profile owner's token.

Adapters and collectors never touch the database. The sync engine (`lib/sync/`) builds the `AccountContext` from encrypted credentials, calls the adapter, and writes the normalized records through `ingest()`. That keeps adapters pure and testable against saved responses (`tests/fixtures/meta/`). OAuth (connect, discover accounts, revoke) is separate from the adapter: `lib/platforms/meta/oauth.ts`, orchestrated by `lib/connections/`.

`lib/platforms/registry.ts` is the source of truth for which platforms have a private-data connector (`CONNECTED_PLATFORMS`) and a public collector (`PUBLIC_DATA_PLATFORMS`), which OAuth provider connects each (`PROVIDER_FOR_PLATFORM`), and how to build them (`createAdapter`, `createPublicCollector`). The database columns `platforms.private_data_status` and `platforms.public_data_status` mirror it, and an integration test checks they match.

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

- **`lib/platforms/meta/graph.ts`** — `GraphClient`: pinned Graph API version (`DEFAULT_GRAPH_VERSION = 'v24.0'`, override with `META_GRAPH_API_VERSION`), `appsecret_proof` on every call, and mapping of Graph error codes to the typed errors. Rate-limit waits come from Meta's `X-Business-Use-Case-Usage` / `X-App-Usage` headers (`estimated_time_to_regain_access`), defaulting to 15 minutes. `appUsagePercent()` reads the highest of `call_count`, `total_cputime` and `total_time` from `X-App-Usage` after every response, so public jobs can pause before the limit is reached.

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
4. The user is sent back to Settings → Connections with how many accounts were found and linked, and any permissions that weren't granted. Other discovered accounts can be linked to a Scopie account from that page (`link_connection_asset`). Only profiles with the business role "Own profile" (`owned`) can be linked. A discovered Instagram account can also be chosen as the viewer account for public data (§4a).
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
- **Public data for other accounts** comes from Business Discovery (§4a), with fewer metrics than insights.
- No audience demographics, no paid/boosted split (`is_paid` stays unknown), no webhooks.

## 4a. Public data: Instagram Business Discovery

Built in Phase 3 (`lib/platforms/meta/business-discovery.ts`). Business Discovery returns public data about other Instagram Business and Creator accounts by username. The account owner authorizes nothing. Scopie uses only fields Meta documents as public, and never scrapes. Plain-language setup: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md).

Reference: [Business Discovery](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery) · [Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting)

### Viewer account

Meta requires each request to come from an Instagram professional account of the app user: the **viewer account**. Scopie calls `GET /{viewer-ig-id}?fields=business_discovery.username(<handle>){…}` with the token of the Facebook Page the viewer is linked to.

- Any Instagram Business or Creator account linked to a Facebook Page that the connecting person manages. It doesn't need to be a CANNA brand account; a dedicated research account works. It must be a real, properly operated account.
- It is connected through the normal **Connect with Meta** flow (§3), then chosen in **Settings → Public data** (`set_public_data_viewer`). One viewer per organization.
- No CANNA Meta Business admin access is needed.
- If Meta rejects the viewer's token, its connection becomes "Needs reconnect" and public jobs fail with `viewer_auth` until it is reconnected. Tracked profiles are not marked as broken.

### Permissions and access level

- **Permissions:** Meta's Business Discovery reference lists `instagram_basic`, `instagram_manage_insights` and `pages_read_engagement`, plus `ads_read` or `ads_management` when Page access comes through Business Manager (checked 2026-10-07). The connector already requests the first three (§4). It does not request `ads_read` or `ads_management`; if your Page access comes through Business Manager and lookups fail, that is the first thing to check **[verify]**.
- **Access level:** **uncertain until a live test.** With Standard Access an app works for people with a role on the app. Whether Standard Access is enough to look up accounts outside the app's role holders, or whether Advanced Access (App Review and Business Verification) is needed, will be confirmed on the first live test. A hosted Scopie serving other companies would need Advanced Access.

### Fields used

| Business Discovery field                                                   | Scopie                           | Notes                                                              |
| -------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------ |
| `id`, `username`                                                           | `external_id`, handle            | The id is stored on first observation and checked every time after |
| `biography`, `website`                                                     | `profile_snapshots`              | A new snapshot only when something changed                         |
| `name`, `profile_picture_url`                                              | `profile_snapshots`              | Not marked public by Meta; requested, and dropped if Meta refuses  |
| `followers_count`                                                          | `followers` (`audience_size`)    | Current value only; history is Scopie's own daily observations     |
| `media_count`                                                              | `posts_total` (`posts_total`)    | Current value only                                                 |
| `media{id, caption, media_type, media_product_type, permalink, timestamp}` | posts                            | 25 per page, newest first. Hashtags come from the caption          |
| `media{like_count}`                                                        | `likes` (`likes`)                | Missing when the owner hides likes → `hidden_by_owner`             |
| `media{comments_count}`                                                    | `comments` (`comments`)          |                                                                    |
| `media{view_count}`                                                        | `views` (`ig_public_reel_views`) | Reels only (else `not_applicable`); includes paid views            |

Errors: a username that isn't a readable Business or Creator account comes back as an invalid parameter. Scopie retries once without the optional fields, then reports `profile_not_found` and stores nothing.

### Rate limits

Business Discovery counts against the Graph API platform limit: about 200 calls per hour per app user, reported in the `X-App-Usage` header. Scopie:

- pauses public jobs for an hour when `X-App-Usage` reaches 80%, keeping what was saved, and skips the remaining public jobs in that worker pass;
- limits add-profile previews to 30 per organization per hour;
- spends about 30 daily calls plus about 240 refresh calls for 30 profiles, plus a one-off backfill of up to 20 pages per profile (see [DATA_PIPELINE.md](DATA_PIPELINE.md) §3.1).

### Not available

| Data                                              | Why                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| Personal and age-restricted accounts              | Business Discovery returns only Business and Creator accounts       |
| Reach, impressions, saves, shares, profile visits | Insights; only the account owner can read them                      |
| Audience demographics                             | Insights                                                            |
| Following count                                   | Not marked public                                                   |
| Comment text                                      | The comments edge isn't public                                      |
| Stories                                           | Not returned by Business Discovery                                  |
| Follower history and earlier post metrics         | Only current totals; Scopie builds history from the day it is added |
| Hashtag search                                    | Needs Meta's Instagram Public Content Access feature (Phase 10)     |

## 4b. Public data: YouTube Data API

Built in Phase 4 (`lib/platforms/youtube/public.ts`). The YouTube Data API v3 returns public channel and video statistics for any public channel with only an API key: no OAuth, no Google account of the channel owner, no Meta app. Plain-language setup: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md#youtube).

Reference: [channels.list](https://developers.google.com/youtube/v3/docs/channels/list) · [playlistItems.list](https://developers.google.com/youtube/v3/docs/playlistItems/list) · [videos.list](https://developers.google.com/youtube/v3/docs/videos/list) · [Quota](https://developers.google.com/youtube/v3/determine_quota_cost)

### API key

- One server-wide key in `YOUTUBE_API_KEY` (server only, never `NEXT_PUBLIC_`). There is no viewer account and nothing per organization.
- The key is sent in the `X-Goog-Api-Key` header, never in the URL, so it can't end up in logs or stored request URLs. `redactText` also removes anything shaped like a Google API key.
- Without the key, YouTube channels can still be added but nothing is scheduled for them, and **Settings → Public data** says "API key missing".
- A rejected key (`keyInvalid`, `keyExpired`) fails the run with an auth error; it never marks the channel as broken.

### Calls

| Call                                                       | Used for                                 | Quota |
| ---------------------------------------------------------- | ---------------------------------------- | ----- |
| `channels.list?part=snippet,statistics,contentDetails`     | Channel, totals and its uploads playlist | 1     |
| `playlistItems.list?playlistId=<uploads>&maxResults=50`    | Video ids, newest first, with page token | 1     |
| `videos.list?part=snippet,statistics,status&id=<up to 50>` | Each video's details and statistics      | 1     |

Channels are looked up by handle (`forHandle=@name`) or channel id (`id=UC…`); channel links of both kinds are accepted.

### Fields used

| Data API field                          | Scopie                                 | Notes                                                                                    |
| --------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`, `snippet.customUrl`               | `external_id`, handle                  | The channel id is checked on every observation                                           |
| `snippet.title`, `snippet.description`  | `profile_snapshots`                    | A new snapshot only when something changed                                               |
| `statistics.subscriberCount`            | `followers` (`yt_subscribers_rounded`) | Rounded by YouTube to 3 significant figures; `hiddenSubscriberCount` → `hidden_by_owner` |
| `statistics.videoCount`                 | `posts_total` (`posts_total`)          | Public videos only                                                                       |
| `statistics.viewCount` (channel)        | `views` (`yt_channel_views`)           | Lifetime channel views                                                                   |
| `snippet.title/description/publishedAt` | posts                                  | Hashtags come from title and description                                                 |
| `statistics.viewCount` (video)          | `views` (`yt_public_views`)            | Never compared with connected YouTube Analytics views                                    |
| `statistics.likeCount`                  | `likes` (`likes`)                      | Missing when the owner hides likes → `hidden_by_owner`                                   |
| `statistics.commentCount`               | `comments` (`comments`)                | Missing when comments are off → `hidden_by_owner`                                        |

Videos that haven't premiered yet (`liveBroadcastContent = upcoming`) are skipped. Live broadcasts are stored as `live`, everything else as `video`.

### Quota

The default quota is 10,000 units a day per Google Cloud project; every call Scopie makes costs 1 unit. A daily observation or a refresh costs 3 units (channel, one page of uploads, its videos), and a backfill up to 41 (20 pages). 30 channels cost about 90 units for daily observations and about 720 for refreshes every 3 hours, plus a one-off backfill of up to about 1,200: well under 10% of the quota on a normal day. When YouTube reports `quotaExceeded`, `dailyLimitExceeded` or `rateLimitExceeded`, the run is retried an hour later and nothing is stored for the gap.

### Not available

| Data                                         | Why                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------- |
| Exact subscriber counts                      | The public API rounds them to 3 significant figures                 |
| Watch time, retention, traffic sources       | YouTube Analytics API; only the channel owner can authorize it      |
| Audience demographics                        | YouTube Analytics API                                               |
| Whether a video is a Short                   | Not exposed by the Data API; stored as `video`                      |
| Subscriber history and earlier video metrics | Only current totals; Scopie builds history from the day it is added |
| Dislike counts                               | Removed from the public API in 2021                                 |

## 4c. Public data: X API v2

Built in Phase 10 (`lib/platforms/x/public.ts`). The official X API v2 returns public profile and post metrics for any public X account with an app-only Bearer token: no login from the account owner. Plain-language setup: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md#x-key).

Reference: [User lookup by username](https://docs.x.com/x-api/users/user-lookup-by-username) · [User posts timeline](https://docs.x.com/x-api/users/get-posts) · [Post lookup by ids](https://docs.x.com/x-api/posts/post-lookup-by-post-ids) · [Pricing](https://developer.x.com/#pricing) · [Developer terms](https://developer.x.com/en/developer-terms/agreement-and-policy)

### Key and setup

- One server-wide app-only Bearer token in `X_BEARER_TOKEN` (server only, never `NEXT_PUBLIC_`, never in a client component, never logged). Set it on the web server and, if the sync runs there, in Trigger.dev.
- X is **pay-per-use**: credits are bought in the developer portal and every resource read is billed. Scopie never retries a billed read in a loop and never pages beyond its cap.
- The token is sent in the `Authorization: Bearer` header, never in a URL. `redactText` removes `Bearer …` and anything shaped like an X Bearer token from error text.
- Without the token, X profiles can still be added, but nothing is scheduled for them; **Settings → Public data** and **Add profile** say "X needs an API key on the server".
- A rejected token (401) fails the run with an auth error; it never marks the profile as broken.

### Calls

| Call                                                                                                                                                                                 | Used for                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `GET /2/users/by/username/:username?user.fields=public_metrics,description,profile_image_url,url,verified,protected,created_at,name,entities`                                        | Profile, totals, protected flag                               |
| `GET /2/users/:id/tweets?exclude=retweets,replies&tweet.fields=created_at,public_metrics,attachments,entities,referenced_tweets&expansions=attachments.media_keys&media.fields=type` | Own posts, newest first, with `since_id` or `start_time`      |
| `GET /2/tweets?ids=…` (same fields)                                                                                                                                                  | Re-reading stored posts; posts not returned have been deleted |

Handles are accepted as `@name`, `name`, or an `x.com` / `twitter.com` profile link (1–15 letters, digits, `_`).

### Fields used

| X field                          | Scopie                          | Notes                                                                            |
| -------------------------------- | ------------------------------- | -------------------------------------------------------------------------------- |
| `id`, `username`                 | `external_id`, handle           | The user id is checked on every observation                                      |
| `name`, `description`, `url`     | `profile_snapshots`             | The `t.co` website link is replaced by its expanded URL                          |
| `public_metrics.followers_count` | `followers` (`audience_size`)   |                                                                                  |
| `public_metrics.following_count` | `following` (`following`)       |                                                                                  |
| `public_metrics.tweet_count`     | `posts_total` (`x_tweet_count`) | Includes replies and reposts, so not compared with other platforms               |
| `like_count`                     | `likes` (`likes`)               |                                                                                  |
| `reply_count`                    | `comments` (`comments`)         | Replies                                                                          |
| `retweet_count`                  | `shares` (`reposts`)            | Reposts                                                                          |
| `quote_count`                    | `quotes` (`quotes`)             | New metric in Phase 10                                                           |
| `bookmark_count`                 | `saves` (`x_bookmarks`)         | Public on X                                                                      |
| `impression_count`               | `views` (`x_public_views`)      | X shows it as "views"; its own class, never compared with other platforms' views |
| media `type`                     | `media_format`                  | `photo` → image; `video`, `animated_gif` → video; no media → text                |

A count X leaves out is stored as `not_public`, never 0. Quote posts are kept (`native_type = quote`); replies and reposts are not read.

### Cost and limits

X bills per resource read (about **$0.010 per user and $0.005 per post**, each counted once per UTC day; check the current price list). To keep this low, X profiles get **only the daily observation** (no `public_posts_refresh`, no `public_backfill`), planned by the sync job from what is stored:

- the profile (1 user read);
- posts newer than the newest stored one (`since_id`); on the first read, posts of the last 30 days (`start_time`);
- re-reads of stored posts that are due a snapshot, only until they have their 7-day value (`ENGAGEMENT_AGE_DAYS` plus the 15% tolerance of `post_metrics_at_age`), oldest first;
- at most **50 posts per profile per run** (`X_MAX_POSTS_PER_RUN`), re-reads first, and at most 3 timeline requests.

A post is read about 5 times in its first week (new, then at about 1, 2, 3 and 7 days): roughly $0.025 per post plus $0.01 per profile per day. 20 profiles posting twice a day cost about $0.20 + $1.00 a day. When the cap leaves new posts unread, `earliest_post_at` moves forward to the oldest post read and a warning is logged, so the gap is never counted as "no posts". Post history starts at the first read: older posts are never bought.

HTTP 429 waits until `x-rate-limit-reset`. HTTP 402 or a credits error ("CreditsDepleted") stops the profile's reads for 24 hours with "X credits are used up"; nothing is stored for the gap.

### Deleted content (X developer terms)

Content deleted on X must be deleted here. Every re-read asks for the stored post ids; **a post X no longer returns (deleted, withheld or now protected) is deleted from Scopie with all its metric snapshots**, and the run logs `posts_removed`. Post text is never kept in `raw_payloads` (replaced by `[not kept]`), so deleted text doesn't linger for the 30-day debug retention. Posts older than the re-read window are not checked again (that would be billed); removing the profile in Scopie deletes everything stored for it.

### Not available

| Data                                                   | Why                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Protected accounts                                     | Only approved followers can see them; Scopie refuses them with a clear message |
| Link clicks, profile visits, video views, demographics | Non-public metrics need the owner's login (OAuth)                              |
| Posts from before the first read (beyond 30 days)      | Each post read is billed; history starts at the first observation              |
| Follower history                                       | Only current totals; history builds from the day the profile is added          |

## 4d. Public data: Bluesky (AT Protocol)

Built in Phase 10 (`lib/platforms/bluesky/public.ts`). Bluesky's public AppView serves every public profile and post with no key and no login.

Reference: [app.bsky.actor.getProfile](https://docs.bsky.app/docs/api/app-bsky-actor-get-profile) · [app.bsky.feed.getAuthorFeed](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed) · [Rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)

### Key and setup

None. Bluesky profiles are scheduled like YouTube channels (daily observation, post refresh every 3 hours, one backfill of up to 12 months) as soon as they are added.

### Calls

| Call                                                                                       | Used for                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------ |
| `GET https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=<handle>`            | Profile, totals, DID, labels         |
| `GET …/app.bsky.feed.getAuthorFeed?actor=<did>&filter=posts_no_replies&limit=100&cursor=…` | Own posts, newest first, with cursor |

Handles are accepted as `@name.bsky.social`, `name.bsky.social`, a custom domain (`brand.com`), a DID, or a `https://bsky.app/profile/<handle>` link. A bare name (`@brand`) means `brand.bsky.social`. Feed items with a `reason` (reposts of others) are skipped.

### Fields used

| Field                                         | Scopie                             | Notes                                                                               |
| --------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `did`, `handle`                               | `external_id`, handle              | The DID is checked on every observation                                             |
| `displayName`, `description`, `avatar`        | `profile_snapshots`                |                                                                                     |
| `followersCount`                              | `followers` (`audience_size`)      |                                                                                     |
| `followsCount`                                | `following` (`following`)          |                                                                                     |
| `postsCount`                                  | `posts_total` (`bsky_posts_count`) | Includes replies                                                                    |
| `post.uri`, `record.text`, `record.createdAt` | post id, caption, published time   | Permalink `https://bsky.app/profile/<handle>/post/<rkey>`                           |
| `likeCount`, `replyCount`                     | `likes`, `comments`                |                                                                                     |
| `repostCount`, `quoteCount`                   | `shares` (`reposts`), `quotes`     |                                                                                     |
| embed type                                    | `media_format`                     | images → image; video → video; external link card → link; text or quote only → text |

A count the AppView leaves out is stored as `not_public`, never 0.

### Limits

The public AppView allows about 3,000 requests per 5 minutes per IP. HTTP 429 waits for `Retry-After` or `ratelimit-reset`. Accounts that set "discourage apps from showing my account to logged-out users" (label `!no-unauthenticated`) are not read and the add-profile preview says so. Unknown, deactivated or taken-down accounts report "Bluesky has no public account".

### Not available

| Data                  | Why                                                          |
| --------------------- | ------------------------------------------------------------ |
| Views or impressions  | Bluesky doesn't count them                                   |
| Audience demographics | Not collected by Bluesky                                     |
| Follower history      | Only current totals; history builds from the day it is added |

## 5. DEMO data

There is no demo connector or demo platform. `lib/demo/generate.ts` produces deterministic fictional posts and metrics (connected-style for own profiles, public-API-style for public Instagram profiles, YouTube channels and every X and Bluesky profile, since those platforms have no owner connection), and `scripts/seed-demo.ts` writes them through the same `ingest()` path as real data with `data_source = 'demo'`. The database accepts `demo` data only in organizations with `is_demo = true`, demo accounts have `connection_status = 'demo'`, and the UI labels them **DEMO**. See DATABASE.md §10.

## 6. Platform capability matrix (planning)

Legend: ✓ available · ◐ limited / approval needed · ✗ not available via official API · ? to verify. Public/competitor data checked 2026-10-09. What the app shows comes from `platforms.public_data_status` and `PUBLIC_DATA_UNAVAILABLE_REASONS` in `lib/public-data/shared.ts`. CSV import works for every platform.

| Platform       | Auth                   | Own-account analytics                                                                                                                   | Public/competitor data                                                                                                                            | Access hurdle                                                                         | Phase                      |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| Instagram      | Meta OAuth             | ✓ built: reach, views, interactions, likes, comments, shares, saves, followers, Reels watch time (§4)                                   | ✓ Business Discovery through a viewer account: followers, post count, bio, website, posts, likes (unless hidden), comment count, Reel views (§4a) | Pro account + Facebook Page for the viewer; App Review only to serve other businesses | **2 ✅**, public: **3 ✅** |
| Facebook Pages | Meta OAuth             | ✓ built: followers, Page reach and engagements, post reactions/comments/shares/reach/impressions/clicks (subject to Meta deprecations)  | ◐ other Pages need Meta's **Page Public Content Access** feature (App Review) and business verification; not built                                | PPCA approval + business verification                                                 | **2 ✅**                   |
| YouTube        | Google OAuth + API key | ✓ YouTube Analytics API: views, watch time, avg view duration, subs gained/lost, likes, shares                                          | ✓ Data API: subscriber count (rounded), video views/likes/comments (§4b)                                                                          | Daily quota (10,000 units); public data needs only an API key                         | 4 (public)                 |
| X              | OAuth 2.0 + Bearer     | ◐ non-public metrics (impressions detail, link clicks) of own recent posts need the owner's OAuth (not built)                           | ✓ API v2 app-only: followers, following, post count, per post likes/replies/reposts/quotes/bookmarks/views; protected accounts excluded (§4c)     | Pay-per-use credits, billed per read                                                  | public: **10 ✅**          |
| Bluesky        | none (public AppView)  | ✗ no private analytics exist                                                                                                            | ✓ AppView: followers, following, post count, per post likes/replies/reposts/quotes; no views (§4d)                                                | None; respects the "no logged-out apps" label                                         | public: **10 ✅**          |
| LinkedIn       | LinkedIn OAuth         | ◐ Org page follower/share statistics via Community Management API                                                                       | ✗ no general competitor API                                                                                                                       | Partner application/approval                                                          | CSV import                 |
| Threads        | Meta OAuth             | ◐ Threads API: own profile and post insights                                                                                            | ◐ reading other profiles needs Meta's approval for extra permissions; not available to Scopie                                                     | App Review                                                                            | CSV import                 |
| TikTok         | TikTok OAuth           | ◐ Display API: follower/like/video counts, per-video views/likes/comments/shares; richer business analytics via TikTok API for Business | ✗ no official way to read other accounts' numbers (Research API is for academic research only)                                                    | App review                                                                            | CSV import                 |
| Pinterest      | Pinterest OAuth        | ◐ API v5: own account and Pin analytics                                                                                                 | ✗ no official way to read other accounts' numbers                                                                                                 | App review                                                                            | CSV import                 |
| Reddit         | OAuth                  | ◐ post score, comments, subreddit subscribers; no reach/impressions                                                                     | ◐ same public data, but commercial use needs Reddit's written approval                                                                            | Commercial use terms                                                                  | CSV import                 |
| Discord        | Bot token              | ◐ community metrics (member counts, message activity in channels the bot can see)                                                       | ✗                                                                                                                                                 | Bot added by server admin; Server Insights not in public API **[verify]**             | later                      |

Until a platform has a connector, its accounts get data through CSV import (Scopie templates, plus column aliases for common exports such as LinkedIn's). All rows marked ◐ or ? are verified before the connector is built and documented here, including exact scopes and metric names.

## 7. Adding a new platform connector

1. Create `lib/platforms/<provider>/` with an adapter implementing `PrivateDataAdapter` and/or a collector implementing `PublicProfileCollector` (Zod schemas for every response; missing values become an availability reason, never defaults) and, if needed, an OAuth module like `meta/oauth.ts`.
2. Add mappings to `PLATFORM_METRIC_MAP` in `lib/metrics/registry.ts` **and** the same rows to `platform_metric_map` in a migration, each with a `comparability_class`. Add new metrics to both `METRIC_DEFINITIONS` and `metric_definitions`. Integration tests check code and database match.
3. Register it in `lib/platforms/registry.ts` (`CONNECTED_PLATFORMS`, `PROVIDER_FOR_PLATFORM`, `createAdapter`; or `PUBLIC_DATA_PLATFORMS`, `createPublicCollector`, plus `KEYLESS_PUBLIC_PLATFORMS` or `BILLED_PUBLIC_PLATFORMS` when it needs no key or bills per read; a server key goes in `publicApiCredential` in `lib/server-env.ts`) and, in the same migration, set `platforms.private_data_status` or `public_data_status` to `'available'`, and `reporting_timezone`.
4. Add connect/callback routes under `app/api/connections/<provider>/` and a `lib/connections/<provider>.ts` that stores tokens only through `connection_credentials`.
5. Add fixture tests (`tests/fixtures/<provider>/`): happy path, pagination, rate limit, expired token, missing permission, metric not returned.
6. Add env vars to `lib/server-env.ts` and `.env.example`, and setup steps to this document.
