# Phase 3 plan: public profile intelligence

> Status: **built** (2026-10-07), except the live check on a real Meta app (§10). This file is kept as the design record; the current behaviour is in [DATA_PIPELINE.md](DATA_PIPELINE.md), [DATABASE.md](DATABASE.md), [METRICS.md](METRICS.md) and [API_INTEGRATIONS.md](API_INTEGRATIONS.md) §4a. Small differences from the plan: posts keep `first_fetched_at` instead of a new `first_seen_at`; `profile_snapshots` links to its `sync_run_id` instead of a raw payload; `set_public_data_viewer` takes only the asset id; platform capabilities are the `public_data_status` / `private_data_status` columns and registry lists, without per-platform metric lists.
>
> Originally written 2026-10-07 as a proposal for review before any code changes.

## 1. What changes and why

Scopie's core use case is **public social intelligence and competitor monitoring**. Connecting an account with OAuth is an optional extra that adds private metrics. The product must work without CANNA Meta Business admin access.

Phase 2 was built around connected accounts: the sync scheduler skips competitors and anything without a connection, and connectors assume the owner's token. Phase 3 adds a second, independent mode and makes it the default.

| Mode          | Who                                                      | Authorization                            | Data                                                   |
| ------------- | -------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------ |
| **Public**    | Competitors, industry accounts, creators, CANNA accounts | None from the profile owner              | Only what the platform's official API exposes publicly |
| **Connected** | CANNA-owned accounts (optional)                          | OAuth by someone who manages the account | Adds private metrics (reach, saves, shares, …)         |

A connected profile is still observed publicly, so CANNA is always compared with competitors on the same public numbers.

## 2. Instagram: what Meta's official API allows

Checked against Meta's developer documentation on 2026-10-07. Items marked **UNCERTAIN** are confirmed on the first live test before the UI relies on them.

**Answer:** Instagram's **Business Discovery** endpoint returns public data about _other_ Instagram Business and Creator accounts by username, without their authorization. Meta describes it as a way to "get basic metadata and metrics about other Instagram professional accounts".

The request is made **through a "viewer" account**: an Instagram professional account that the Scopie user logs in to through Facebook Login, linked to a Facebook Page. The docs require only that the app user has this account and Page; they don't require it to belong to CANNA or to any particular business. So the viewer can be:

- a CANNA Instagram account someone already manages, or
- a dedicated professional account (for example the marketing team's own research account) linked to a new Facebook Page that the same person creates.

Either way **no CANNA Meta Business admin access is needed**, and competitors never authorize anything. The viewer must be a real, properly operated account under Instagram's terms, not a fake persona.

### 2.1 Metric classification

| Data                                       | Classification                       | Notes                                                                                                                          |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Lookup by username                         | AVAILABLE_PUBLICLY                   | Business and Creator accounts only. Age-gated accounts return nothing. Personal accounts can't be read.                        |
| Username, biography, website               | AVAILABLE_PUBLICLY                   | Marked "Public" on the IG User reference                                                                                       |
| Follower count (`followers_count`)         | AVAILABLE_PUBLICLY                   | Current value only                                                                                                             |
| Post count (`media_count`)                 | AVAILABLE_PUBLICLY                   | Current value only                                                                                                             |
| Following count (`follows_count`)          | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Not marked Public                                                                                                              |
| Display name, profile picture              | UNCERTAIN                            | Not marked Public; test                                                                                                        |
| Posts (media list)                         | AVAILABLE_PUBLICLY                   | Paged list, newest first. A returned media id can't be fetched directly; posts are refreshed by paging the list again.         |
| Post URL, caption, timestamp               | AVAILABLE_PUBLICLY                   | Caption has `@` removed for non-admins. `permalink` is unavailable on carousel children.                                       |
| Media type, surface (`media_product_type`) | AVAILABLE_PUBLICLY                   | FEED / REELS (AD and STORY not expected through discovery)                                                                     |
| Media file URL, thumbnail                  | AVAILABLE_PUBLICLY                   | Omitted when the post contains copyrighted material                                                                            |
| Likes (`like_count`)                       | AVAILABLE_PUBLICLY                   | Omitted when the owner hides likes. Shown in Meta's Business Discovery examples.                                               |
| Comment count (`comments_count`)           | AVAILABLE_PUBLICLY                   | Excludes comments on the caption and carousel children                                                                         |
| Views (`view_count`)                       | AVAILABLE_PUBLICLY (Reels only)      | Includes paid and organic views; Business Discovery only. No views for photos or carousels.                                    |
| Reposts, totals including ads              | UNCERTAIN                            | `reposts_count`, `total_like_count`, `total_comments_count` are marked Public but new; test                                    |
| Hashtags                                   | AVAILABLE_PUBLICLY (derived)         | Scopie extracts them from the caption                                                                                          |
| Comment text                               | NOT_AVAILABLE                        | The `comments` edge isn't public                                                                                               |
| Shares, saves                              | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Media insights; `saved_count` "only accessible by the media owner"                                                             |
| Reach, impressions, profile visits         | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Insights                                                                                                                       |
| Meta's engagement (`total_interactions`)   | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Scopie's _public engagement_ = likes + comments, computed and labelled as such                                                 |
| Follower demographics                      | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Insights                                                                                                                       |
| Historical follower counts                 | NOT_AVAILABLE                        | Scopie builds history by observing daily                                                                                       |
| Historical post metrics                    | NOT_AVAILABLE                        | Only current totals; Scopie re-observes                                                                                        |
| Competitor insights                        | NOT_AVAILABLE                        | Insights only cover your own accounts                                                                                          |
| Competitor Stories                         | NOT_AVAILABLE                        | Not returned by Business Discovery                                                                                             |
| Hashtag search                             | AVAILABLE_PUBLICLY after approval    | Needs the "Instagram Public Content Access" feature; 30 unique hashtags per 7 days; recent media covers 24 hours; no usernames |
| Posts tagging or mentioning CANNA          | AVAILABLE_ONLY_FOR_CONNECTED_ACCOUNT | Through CANNA's own connection                                                                                                 |

### 2.2 Requirements

- **API:** Instagram API with Facebook Login (`graph.facebook.com`). Business Discovery is documented for Facebook Login only, which is what the Phase 2 Meta connector uses.
- **Permissions:** `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`; plus `ads_read` or `ads_management` when Page access comes through Business Manager. Phase 2 already requests these.
- **Facebook Page:** required for the viewer account only.
- **Access level:** Standard Access while Scopie serves accounts its own users manage. A hosted Scopie serving other companies would need Advanced Access, App Review and Business Verification. Whether Standard Access covers Business Discovery for every target is **UNCERTAIN** until tested; Meta's docs suggest it does because the query runs on the app user's own account.
- **Rate limits:** Business Discovery and hashtag search use the Graph API platform limit, "200 \* number of users" calls per hour per app, reported in the `X-App-Usage` header. With one app user that's about 4,800 calls a day.
- **Terms:** Meta Platform Terms §3.a forbid surveillance tools, selling or licensing platform data, and building profiles of people without consent; §3.d requires deleting data when no longer needed or when Meta or the user asks. Periodic collection for business benchmarking is the stated purpose of Business Discovery. Influencers are individuals, so Scopie stores only their public account and post metrics. A short legal or privacy check by CANNA is recommended before launch.

### 2.3 Platforms that need no Meta connection at all

| Platform | Route                                                                                                                                         | Status                                        |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| YouTube  | YouTube Data API v3 with a server-side API key. `channels.list` accepts `forHandle`, 1 quota unit per call; default quota 10,000 units a day. | Officially supported; recommended for Phase 4 |
| Any      | CSV import (built in Phase 2)                                                                                                                 | Works today                                   |

Facebook Pages need Meta's "Page Public Content Access" approval. TikTok, X and LinkedIn have no free official route for other people's profiles: they stay on CSV import until a licensed provider or API access is in place (Phase 10).

Sources:
[Instagram APIs](https://developers.facebook.com/products/instagram/apis/) ·
[Business Discovery reference](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery) ·
[Business Discovery guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery) ·
[IG User](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user) ·
[IG Media](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media) ·
[Media insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights) ·
[Insights](https://developers.facebook.com/docs/instagram-platform/insights) ·
[Hashtag search](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-hashtag-search) ·
[Platform overview](https://developers.facebook.com/docs/instagram-platform/overview) ·
[Rate limits](https://developers.facebook.com/docs/graph-api/overview/rate-limiting) ·
[Platform Terms](https://developers.facebook.com/terms/dfc_platform_terms/) ·
[YouTube channels.list](https://developers.google.com/youtube/v3/docs/channels/list) ·
[YouTube getting started](https://developers.google.com/youtube/v3/getting-started)

## 3. Phase 2 code review: reuse

These carry over unchanged or nearly so:

| Part                                                                                    | Where                                     | Phase 3 use                                                         |
| --------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Posts and append-only post and account metric snapshots, with availability and post age | `…_data_pipeline.sql`                     | Store public posts and observations exactly as connected ones       |
| Duplicate guards and `post_age_hours`                                                   | same                                      | Fair "likes at 7 days" comparisons for public posts                 |
| Metric dictionary and platform metric map with comparability classes                    | `lib/metrics/registry.ts`, DB mirror      | Add public source metrics and classes; same comparability checks    |
| `ingest()` single write path                                                            | `lib/ingest/ingest.ts`                    | Public collector writes through it with `live_public`               |
| Sync engine, queue, backoff, rate-limit pauses, run history                             | `lib/sync/`                               | New public job types run on the same queue                          |
| Meta HTTP client: retries, error mapping, redaction, `appsecret_proof`                  | `lib/platforms/http.ts`, `meta/graph.ts`  | Business Discovery calls reuse it                                   |
| Meta OAuth, encrypted tokens, connection assets                                         | `lib/platforms/meta/`, `lib/connections/` | Supplies the viewer account's token; connected enrichment unchanged |
| CSV import                                                                              | `lib/imports/`                            | Unchanged; covers platforms without a public API                    |
| DEMO generator and seed                                                                 | `lib/demo/`, `scripts/seed-demo.ts`       | Extended with DEMO public competitor profiles                       |
| Data source badge, sync status badge, recent posts, sync card                           | `components/pipeline/`                    | Relabelled and reused on profile pages                              |
| Tests and fixtures                                                                      | `tests/`                                  | Extended; Business Discovery fixtures added                         |

## 4. Phase 2 code review: what changes

| #   | Today                                                                                                   | Change                                                                                                                                                                                                                             | Files                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| C1  | `social_accounts.is_competitor` boolean                                                                 | `business_role` enum: `owned`, `competitor`, `industry`, `influencer`, `other`. Existing rows: `true` → `competitor`, `false` → `owned`.                                                                                           | migration, `schemas/social-account.ts`, account form and pages, `lib/connections/meta.ts`, scheduler, seed, tests |
| C2  | `primary_data_source` per account                                                                       | `access_type` enum: `public`, `connected`, `imported`, `demo`. Set by the system, never by users (same trigger pattern as D12).                                                                                                    | migration, account pages, labels                                                                                  |
| C3  | `tracking_started_at`, `history_available_from`, `last_successful_sync_at`                              | `first_observed_at` (renamed from `tracking_started_at`), `last_observed_at`, `earliest_post_at`, `last_sync_attempt_at`; `created_at` is "added on"; `history_available_from` kept for connected daily metrics                    | migration, `lib/sync/engine.ts`, sync card                                                                        |
| C4  | `data_source` enum: `authenticated`, `public`, `imported`, `manual`, `demo`                             | `live_connected`, `live_public`, `imported`, `estimated`, `demo`. `manual` removed (no screen writes it; any rows become `imported`). `estimated` reserved: no producer in Phase 3, and analytics never mixes it with live values. | migration (new enum type, swap columns), `lib/ingest`, imports, demo, badges, docs                                |
| C5  | `check_fact_source`: `authenticated` needs a connection                                                 | `live_connected` needs a connection; `live_public` needs a platform whose public collector exists; users may write only `imported`                                                                                                 | migration, integration tests                                                                                      |
| C6  | `link_connection_asset` refuses competitor accounts                                                     | Refuses anything not `business_role = owned`                                                                                                                                                                                       | migration                                                                                                         |
| C7  | `enqueueDueJobs` skips competitors and accounts without an active connection                            | Two passes: public jobs for every active profile on a platform with public collection and a configured viewer; connected jobs as today                                                                                             | `lib/sync/scheduler.ts`, `schedule.ts`                                                                            |
| C8  | `PrivateDataAdapter` takes an `AccountContext` with the owner's token                                   | Split: `PrivateDataAdapter` (today's interface, renamed) and new `PublicProfileCollector` (below)                                                                                                                                  | `lib/platforms/types.ts`, registry, engine                                                                        |
| C9  | `platforms.connector_status` and `CONNECTED_PLATFORMS`                                                  | Capabilities per platform: `publicData` and `privateData`, each with its metric list. `platforms` gets `public_data_status` and `private_data_status`, mirrored and tested.                                                        | `lib/platforms/registry.ts`, migration, integration test                                                          |
| C10 | Data source badge: Live / Public / Imported / Manual / DEMO                                             | PUBLIC / CONNECTED / IMPORTED / ESTIMATED / DEMO                                                                                                                                                                                   | `components/pipeline/data-source-badge.tsx`, labels                                                               |
| C11 | `metric_availability`: `available`, `not_permitted`, `not_applicable`, `pending`, `error`               | Add `hidden_by_owner` (likes hidden) and `not_public` (exists only for connected accounts)                                                                                                                                         | migration, registry, badges                                                                                       |
| C12 | Read models (`account_metrics_daily`, `post_metrics_latest`, `post_metrics_at_age`) return every source | Expose `data_source`; analytics filters to one provenance per comparison                                                                                                                                                           | migration, `lib/pipeline/queries.ts`                                                                              |
| C13 | Rate-limit reading uses Meta's BUC header                                                               | Also read `X-App-Usage` (platform limit used by Business Discovery)                                                                                                                                                                | `lib/platforms/meta/graph.ts`                                                                                     |

Nothing is deleted from the Meta connector. OAuth, insights collection and the Connections screen keep working; they become optional enrichment.

## 5. Database changes (one migration)

```text
enum  business_role           owned | competitor | industry | influencer | other
enum  profile_access_type     public | connected | imported | demo
enum  data_source (replaced)  live_connected | live_public | imported | estimated | demo
enum  metric_availability     + hidden_by_owner, + not_public
enum  sync_job_type           + public_profile_daily, + public_posts_refresh, + public_backfill

social_accounts
  - is_competitor, - primary_data_source
  + business_role (not null), + access_type (system-set)
  ~ tracking_started_at → first_observed_at
  + last_observed_at, + earliest_post_at, + last_sync_attempt_at

profile_snapshots (new, append-only, written only when something changed)
  organization_id, social_account_id, observed_at, data_source,
  username, display_name, biography, website, profile_picture_url,
  raw_ref (raw_payloads id)
  RLS: org members read; service role writes

public_data_viewers (new)
  organization_id, platform_key, connection_asset_id (the viewer account),
  created_by, created_at; one per org and platform
  RLS: org members read; accounts.manage writes through an RPC that checks the asset belongs to the org and its connection is active

posts
  + hashtags text[] (extracted from caption, lower-cased)
  + first_seen_at (when Scopie first saw the post; first_seen_at − published_at shows "already old when found")

platforms
  - connector_status
  + public_data_status, + private_data_status (available | planned | not_available)

account_metric_snapshots / post_metric_snapshots
  no shape change; public rows use data_source = live_public
  + metric keys: following, posts_total (account, lifetime)
  + platform_metric_map rows for business_discovery:followers_count, media_count,
    like_count, comments_count, view_count (class ig_public_reel_views: includes paid views, so never compared with insights views)

RPCs
  + set_public_data_viewer(platform_key, asset_id)
  + remove_profile_and_data(account_id): deletes the profile's posts, snapshots,
    profile_snapshots and raw payloads (Meta Platform Terms §3.d)
  ~ link_connection_asset: owned profiles only
  ~ check_fact_source: new source rules (C5)
```

Existing data migrates in the same migration: `authenticated` → `live_connected`, `public` → `live_public`, `manual` → `imported` (none expected), `demo` stays. Integration tests cover the migration on the seeded database.

## 6. Connector changes

```ts
// lib/platforms/types.ts (proposed)
type PlatformCapabilities = {
  publicData: { available: boolean; profileMetrics: MetricKey[]; postMetrics: MetricKey[] };
  privateData: { available: boolean; profileMetrics: MetricKey[]; postMetrics: MetricKey[] };
};

interface PublicProfileCollector {
  platformKey: string;
  /** Preview for the "add profile" form. Throws NotFound / NotProfessional / AgeGated. */
  lookupProfile(ctx: PublicContext, handle: string): Promise<PublicProfile>;
  /** Profile fields, followers, post count and the first page of posts with their metrics. */
  observeProfile(ctx: PublicContext, handle: string): Promise<PublicObservation>;
  /** Further pages of posts, each with metrics as of now. */
  listPosts(ctx: PublicContext, handle: string, cursor: string | null): Promise<PublicPostPage>;
}

type PublicContext = { credential: string }; // viewer token (Instagram) or API key (YouTube), server only
```

- **Instagram:** `lib/platforms/meta/business-discovery.ts`. One call returns the profile plus a page of posts with `like_count`, `comments_count`, `view_count`. Missing `like_count` → `hidden_by_owner`; `view_count` on non-Reels → `not_applicable`; shares, saves, reach → not requested, shown as `not_public`.
- **YouTube** (Phase 4): `lib/platforms/youtube/public.ts` with `YOUTUBE_API_KEY`.
- The viewer token is loaded and decrypted like today's Page tokens, only in the worker and in the lookup server action, never sent to the browser or logged.

## 7. Sync jobs for public profiles

| Job                    | Every  | Does                                                                                                                                                                      |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public_profile_daily` | 24 h   | One observation: profile fields (snapshot only if changed), `followers`, `posts_total`, first page of posts. Sets `first_observed_at` once, `last_observed_at` each time. |
| `public_posts_refresh` | 3 h    | Pages through posts published in the last 31 days and stores a snapshot for each post that has reached a capture age (1, 2, 3, 7, 14, 30 days), as in Phase 2.            |
| `public_backfill`      | hourly | After a profile is added, pages back up to 12 months or 20 pages, storing each post once with its current totals and `first_seen_at`. Records `earliest_post_at`.         |

Budget: 30 profiles cost about 30 daily calls + about 240 refresh calls + a one-off backfill, well under about 4,800 a day. The worker pauses when `X-App-Usage` passes 80%. A failed observation is a failed `sync_runs` row; nothing is written for that day, so charts show a gap, never a zero or a repeated value.

## 8. Analytics (new `lib/analytics/`)

All numbers come from stored observations; nothing is interpolated or back-filled.

- **Observed growth:** first and last follower observation inside the range: `(last − first) / first`, shown with both dates ("+4.4% from 7 Oct to 6 Nov, 30 observations"). Needs at least two observations at least 24 hours apart.
- **Posting frequency:** posts per week from `published_at`. Only for periods after `earliest_post_at`, so incomplete history isn't counted as "no posts".
- **Public engagement per post:** likes + comments at a fixed post age (7 days by default) from `post_metrics_at_age`. Median and mean, with post count. Posts with hidden likes are excluded and the count says so.
- **Format mix, top posts, hashtags:** from posts and public snapshots.
- **Comparability rule:** two values are compared only if they share metric key, comparability class and provenance. CANNA is compared on its `live_public` values even when connected. A metric missing for one side is shown as unavailable for that side, not as zero.
- **Groups:** profile vs profile, CANNA (owned) vs competitors, competitor vs competitor, country vs country (profiles grouped by `country_code`, using medians so one large account doesn't dominate).

## 9. Phase 3 scope

**In scope**

1. Database migration and code changes C1–C13.
2. Settings → Public data: choose the viewer Instagram account from a Meta connection, with plain instructions for creating one.
3. Add profile: platform, handle, role, country → live preview of what can be tracked → save. Bulk add from a CSV list of handles. Clear messages for personal, unknown and age-restricted accounts, with CSV import offered instead.
4. Public Instagram collector and the three public sync jobs.
5. Profile page: observation history, coverage line ("observed since 7 Oct; posts back to March 2024"), only the metrics the profile's capabilities declare, with PUBLIC / CONNECTED / IMPORTED / DEMO labels.
6. Remove profile and its data.
7. Analytics layer (§8) with unit tests on fixed data.
8. First dashboard from real stored observations: monitored profiles, top growing, top public engagement, posting frequency, top posts, profile comparison, follower trend charts with gaps, date range filter (7, 30, 90 days, custom). Empty states explain what will appear once observations exist. Demo organizations show DEMO-labelled data; real organizations never do.
9. "What changed?" panel: rule-based statements computed by the analytics layer, each with a "see the data" link to the filtered comparison. Examples: "Competitor A published 40% more posts than CANNA this week (12 vs 9)"; "Competitor B's median public engagement per post at 7 days is higher than CANNA's over the observed period (412 vs 288, 20 and 18 posts)". Wording never claims causes. Minimum sample sizes are applied (for example at least 5 posts per side) and the statement is skipped otherwise.
10. Docs: DATA_PIPELINE, METRICS, API_INTEGRATIONS, DATABASE, ARCHITECTURE updated; a setup guide for the viewer account.
11. Tests: migration and source rules, Business Discovery fixtures (hidden likes, non-Reels views, personal account, age-gated, rate-limit), scheduler, analytics math, insight rules, end-to-end add-profile and dashboard flows.

**Not in Phase 3**

- YouTube public collector (Phase 4, so Scopie can run with no Meta app at all).
- Hashtag search (needs Meta approval).
- AI-written topics, content gaps and recommendations (Phase 8).
- Facebook Pages public data, TikTok, X, LinkedIn (Phase 10; CSV until then).

**Exit criteria:** a competitor's Instagram profile added by username is observed daily on a real Meta app; its posts and metrics appear with PUBLIC labels; the dashboard and "What changed?" show only stored values; tests green.

## 10. Needed before Phase 3 can be verified live

1. Merge PR #1 (Phase 2).
2. A viewer account: any Instagram professional account linked to a Facebook Page that the person setting up Scopie manages. It can be a dedicated account; CANNA Business admin access isn't needed.
3. A Meta developer app created by that person (Facebook Login for Business, Instagram API), with `META_APP_ID` and `META_APP_SECRET` in the environment.
4. A first list of competitor, industry and creator handles.

Development can start before 2–4 using saved API responses; the live check happens once they exist.
