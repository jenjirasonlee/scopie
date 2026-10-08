# Scopie — Architecture

> Status: Phase 1 (Foundation), Phase 2 (Real social data pipeline) and Phase 3 (Public profile intelligence, see [PHASE_3_PLAN.md](PHASE_3_PLAN.md)) implemented. Sections marked _planned_ describe later phases.
> Last updated: 2026-10-07

## 0. Implementation status

Roadmap: 1 Foundation ✅ · 2 Real social data pipeline ✅ · 3 Public profile intelligence ✅ · 4 Benchmarking + YouTube · 5 Content management + calendar · 6 Review + approval · 7 Content strategy · 8 AI analyst + recommendations · 9 Weekly intelligence reports · 10 More platforms · 11 Productivity + career intelligence. See ROADMAP.md.

**Product focus (2026-10-07):** Scopie is first a public social intelligence and competitor monitoring tool. Public profiles are observed through official APIs without the owner's authorization; OAuth connections are optional enrichment for CANNA-owned accounts. The core product must work without CANNA Meta Business admin access. See §2a.

What exists in code today:

| Area                                                                                                 | Implemented in                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Next.js 16 App Router, strict TypeScript, Tailwind v4, shadcn-style components                       | `app/`, `components/ui/`                                                                                            |
| Supabase Auth (email + password), session refresh, protected routes                                  | `proxy.ts`, `lib/db/proxy-session.ts`, `lib/auth/`                                                                  |
| Organizations, membership, roles and permission matrix with RLS                                      | `supabase/migrations/…_tenancy_and_roles.sql`, `lib/orgs/`, `lib/members/`                                          |
| Platforms, countries, social accounts, account groups (tables), activity log                         | `supabase/migrations/…_social_accounts.sql`, `lib/accounts/`                                                        |
| App shell with all 12 navigation sections; unfinished ones are honest placeholders                   | `app/[orgSlug]/`, `lib/navigation.ts`                                                                               |
| Metric dictionary and platform metric map (code mirror of the database tables)                       | `lib/metrics/registry.ts`, `…_data_pipeline.sql`                                                                    |
| Posts, append-only metric snapshots, read-model views, import batches, sync tables                   | `supabase/migrations/…_data_pipeline.sql`                                                                           |
| Single write path for all social data (sync, CSV import, demo)                                       | `lib/ingest/ingest.ts`                                                                                              |
| Platform adapter interface, HTTP retry/redaction, typed errors, registry                             | `lib/platforms/`                                                                                                    |
| Meta connector: OAuth, Instagram and Facebook Page adapters                                          | `lib/platforms/meta/`, `lib/connections/`, `app/api/connections/meta/`                                              |
| Encrypted token storage (AES-256-GCM)                                                                | `lib/crypto/tokens.ts`, `connection_credentials`                                                                    |
| Sync engine, scheduler and worker; Trigger.dev task and standalone script                            | `lib/sync/`, `trigger/sync.ts`, `trigger.config.ts`, `scripts/sync-worker.ts`                                       |
| CSV import (account metrics, posts)                                                                  | `lib/imports/`, `app/[orgSlug]/accounts/import/`                                                                    |
| DEMO seed: org, accounts, and generated posts and metrics                                            | `scripts/seed-demo.ts`, `lib/demo/generate.ts`                                                                      |
| Business role, access type, provenance labels, observation dates, profile snapshots                  | `supabase/migrations/…_public_intelligence.sql`, `lib/accounts/labels.ts`                                           |
| Public Instagram collector (Business Discovery) and the three public sync jobs                       | `lib/platforms/meta/business-discovery.ts`, `lib/sync/public-jobs.ts`                                               |
| Settings → Public data (viewer account), add profile with preview, bulk add, remove profile and data | `app/[orgSlug]/settings/public-data/`, `app/[orgSlug]/accounts/new/`, `lib/public-data/`, `components/public-data/` |
| Profile page: coverage line, observation history, profile changes                                    | `components/pipeline/account-data-panels.tsx`, `lib/pipeline/queries.ts`                                            |
| Dashboard and analytics                                                                              | `lib/analytics/`, `app/[orgSlug]/dashboard/`                                                                        |
| Benchmarks and benchmark groups; YouTube public collector                                            | `lib/analytics/benchmark*.ts`, `lib/benchmarks/`, `app/[orgSlug]/benchmarks/`, `lib/platforms/youtube/`             |
| Content taxonomy screens                                                                             | `lib/taxonomy/`, `app/[orgSlug]/settings/taxonomy/`                                                                 |
| Content items, versions and private file uploads                                                     | `…_content_hub.sql`, `lib/content/`, `app/[orgSlug]/content/`, `app/api/content-assets/`                            |
| Calendar (month, week, list) in the organization's time zone                                         | `lib/calendar/`, `components/calendar/`, `app/[orgSlug]/calendar/`                                                  |
| Review and approval, comments, in-app notifications                                                  | `…_review_approval.sql`, `lib/approvals/`, `app/[orgSlug]/approvals/`, `app/[orgSlug]/notifications/`               |
| Unit, database integration and Playwright tests; CI                                                  | `tests/`, `.github/workflows/ci.yml`                                                                                |

Not implemented yet: strategy, AI, reports, connectors other than Meta, public data for platforms other than Instagram and YouTube, email notifications, member invitations. The rest of this document describes the target architecture; those parts are planned. The data pipeline itself is described in [DATA_PIPELINE.md](DATA_PIPELINE.md), metrics in [METRICS.md](METRICS.md).

## 1. Repository inspection (initial design, before Phase 1)

- No existing Scopie repository was found on the owner's GitHub account (only `shark-flipbook` and `my-site-3`, both unrelated).
- No Scopie files exist in the project's shared folder.
- Conclusion: Scopie is a **greenfield project**. This document defines the architecture from scratch.

## 2. Goals that drive the architecture

| Goal                                                             | Architectural consequence                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real data, never faked                                           | Every post and metric row carries `data_source` and an availability state, and the database enforces who may write which source: `live_public`, `live_connected`, `imported`, `estimated`, `demo` (UI: PUBLIC, CONNECTED, IMPORTED, ESTIMATED, DEMO). Demo data is a first-class, visibly labelled source. |
| Many platforms, all different                                    | Platform logic lives behind the `PublicProfileCollector` and `PrivateDataAdapter` interfaces. The core analytics layer never imports platform code.                                                                                                                                                        |
| Multi-tenant from day one                                        | Every tenant-owned table has `organization_id`; Supabase Row Level Security (RLS) enforces isolation in the database, not only in app code.                                                                                                                                                                |
| Start small (30 accounts), scale later (millions of metric rows) | Append-only metric snapshots, partition-ready tables, daily rollup tables, background sync jobs, cursor pagination.                                                                                                                                                                                        |
| AI that cites evidence                                           | AI never queries raw tables freely. It calls typed, read-only analytics tools that return data plus an evidence reference, and every generation is stored.                                                                                                                                                 |
| Open source, runnable by others                                  | Plain Next.js + Supabase + Trigger.dev, `.env.example`, seed data, docs for every setup step. No CANNA-specific code paths.                                                                                                                                                                                |

## 2a. Public and connected profiles (Phase 3)

| Concept       | Values                                                 | Set by                                                                             |
| ------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Business role | owned, competitor, industry, influencer, other         | The user                                                                           |
| Access type   | public, connected, imported, demo                      | The `social_accounts_derive_access` trigger (users can't set it, same rule as D12) |
| Provenance    | live_public, live_connected, imported, estimated, demo | The writer of each value; checked by `check_fact_source()`                         |

- **Public mode** (default): a profile is observed through the platform's official public API. For Instagram that is Business Discovery, called through one _viewer_ account per organization: any Instagram professional account linked to a Facebook Page that the Scopie user manages, connected with the existing Meta connector and chosen in Settings → Public data. Competitors authorize nothing. Setup guide: [PUBLIC_DATA_SETUP.md](PUBLIC_DATA_SETUP.md).
- **Connected mode** (optional): the Meta OAuth path, limited to `owned` profiles, adds private metrics. A connected profile keeps its public observations so comparisons with competitors stay like for like.
- **Connectors:** a `PublicProfileCollector` reads public profiles with an app-level credential; a `PrivateDataAdapter` reads connected accounts. Both write through `ingest()`. `lib/platforms/registry.ts` lists which platforms have each (`PUBLIC_DATA_PLATFORMS`, `CONNECTED_PLATFORMS`), mirrored by `platforms.public_data_status` and `private_data_status`.
- **History** is built only from Scopie's own repeated observations. Each profile records first observed, last observed, earliest available post and last sync attempt. Nothing is back-filled or interpolated.

Details, Meta's documented limits and the full change list: [PHASE_3_PLAN.md](PHASE_3_PLAN.md), [API_INTEGRATIONS.md](API_INTEGRATIONS.md) §4a.

## 3. System overview

```
                ┌───────────────────────────────────────────────┐
 Browser ──────▶│  Next.js (App Router)                         │
 (React,        │  • Server Components for reads                │
  shadcn/ui)    │  • Server Actions for mutations               │
                │  • Route Handlers: /api/connections/*         │
                │  • Domain modules in lib/ (pure TS)           │
                └──────────┬────────────────────────────────────┘
                           │ supabase-js (user JWT, RLS enforced);
                           │ "Sync now" inserts a queued sync_runs row
                ┌──────────▼──────────┐   ┌─────────────────────┐
                │ Supabase            │   │ Sync worker         │
                │ • Postgres + RLS    │◀──│ (Trigger.dev cron   │
                │ • Auth              │   │  or pnpm sync:worker│
                │ • sync_runs = queue │   │ • sync jobs         │
                │ • Storage (planned) │   │ • later: AI runs,   │
                │                     │   │   weekly reports    │
                └─────────────────────┘   └──────────┬──────────┘
                                                     │ HTTPS
                                       ┌─────────────▼─────────────┐
                                       │ Platform APIs (Meta, etc.)│
                                       │ LLM provider (planned)    │
                                       └───────────────────────────┘
```

Key rule: **browser code never talks to platform APIs or the LLM, and never sees tokens.** It only talks to our server, which talks to Supabase with the user's session (RLS applies). Besides the worker, only the Meta OAuth routes, the disconnect action and the add-profile preview call Meta, from the server. The service role is used in exactly four places: the OAuth callback, disconnecting a connection, the add-profile preview (to read the viewer token and count lookups, `lib/public-data/actions.ts`), and the sync worker (`lib/db/admin.ts`, `lib/sync/worker.ts`). They must scope every query by `organization_id` or a specific row id explicitly.

## 4. Tech stack (decided)

| Concern             | Choice                                                 | Notes                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework           | Next.js (App Router), React, TypeScript `strict`       | Server Components by default; client components only where interactive.                                                                                                    |
| UI                  | Tailwind CSS, shadcn/ui, Lucide                        | shadcn components copied into `components/ui`, themed via CSS variables.                                                                                                   |
| Tables              | TanStack Table (via shadcn data-table pattern)         | Tables are the primary UI.                                                                                                                                                 |
| Charts              | Recharts                                               | Wrapped in our own `components/charts` so the library can be swapped.                                                                                                      |
| DB / Auth / Storage | Supabase (Postgres 15+, Auth, Storage, Vault)          | Migrations via Supabase CLI, SQL-first.                                                                                                                                    |
| DB access in TS     | `supabase-js` + generated types (`supabase gen types`) | Complex analytics live in SQL views/functions, called via RPC. No ORM: keeps RLS honest and avoids a second schema source of truth.                                        |
| Background jobs     | Trigger.dev v4                                         | One scheduled task every 15 minutes runs the sync tick; the queue itself lives in Postgres (`sync_runs`), so `pnpm sync:worker` can run the same code without Trigger.dev. |
| AI                  | OpenAI API behind `lib/ai/providers` interface         | Provider-agnostic; Anthropic etc. can be added.                                                                                                                            |
| Validation          | Zod                                                    | Every server action input, every connector response, every AI structured output.                                                                                           |
| Forms               | React Hook Form + Zod resolver                         |                                                                                                                                                                            |
| Tests               | Vitest (unit/integration), Playwright (E2E)            | Integration tests run against a local Supabase.                                                                                                                            |
| Lint/format         | ESLint, Prettier                                       | CI blocks on lint, typecheck, tests.                                                                                                                                       |
| Package manager     | pnpm                                                   |                                                                                                                                                                            |
| Logging             | Structured JSON logger (`pino`) with token redaction   | Shipped to stdout; works with any log drain.                                                                                                                               |
| License             | Apache-2.0                                             | Permissive, with explicit patent grant.                                                                                                                                    |

## 5. Repository structure

Single Next.js app (no monorepo yet — one deployable is simpler; we split only if a second deployable appears).

```
scopie/
├─ app/                          # Routes only: thin, compose lib/ + components/
│  ├─ (auth)/sign-in, sign-up        # + auth/confirm route, onboarding
│  ├─ [orgSlug]/
│  │  ├─ dashboard/  analytics/  accounts/ (+ import/)  content/  calendar/
│  │  ├─ approvals/  strategy/  benchmarks/  reports/  insights/
│  │  ├─ productivity/  settings/ (+ connections/, public-data/)
│  ├─ api/
│  │  └─ connections/meta/start, callback   # OAuth (one folder per provider)
│  └─ layout.tsx
├─ components/
│  ├─ ui/                        # shadcn primitives
│  ├─ charts/                    # Recharts wrappers (TrendChart, ComparisonBar…)
│  ├─ data-table/                # generic table, column helpers
│  ├─ metrics/                   # MetricValue, MetricDefinitionTooltip, SourceBadge
│  └─ layout/                    # AppShell, Sidebar, OrgSwitcher
├─ lib/                          # Domain logic. No React imports.
│  ├─ auth/                      # session helpers, requireRole()
│  ├─ db/                        # supabase clients (server/user, service), generated types
│  ├─ orgs/                      # organizations, members, invitations
│  ├─ accounts/                  # social accounts, groups (country/region)
│  ├─ platforms/                 # adapter interface, registry, http retry/redaction, typed errors
│  │  ├─ meta/                   #   Graph client, OAuth, Instagram + Facebook adapters, Business Discovery collector
│  │  └─ …                       #   one folder per provider (youtube/ next)
│  ├─ connections/               # connect/link/unlink/disconnect flows (server actions, OAuth completion)
│  ├─ public-data/               # viewer account, add-profile preview, bulk add, remove profile and data
│  ├─ ingest/                    # the single write path for posts and metric snapshots
│  ├─ imports/                   # CSV templates, parsing, import runs
│  ├─ sync/                      # engine, public jobs, scheduler (queue), schedule constants, worker, credentials
│  ├─ pipeline/                  # read queries for sync runs, posts and metrics
│  ├─ demo/                      # DEMO DATA generator
│  ├─ metrics/                   # metric dictionary + platform metric map
│  ├─ analytics/                 # calculation layer for the dashboard (growth, frequency, engagement, comparability)
│  ├─ benchmarks/
│  ├─ content/                   # content items, versions, assets
│  ├─ approvals/                 # state machine, review decisions
│  ├─ strategy/
│  ├─ reports/
│  ├─ ai/                        # providers, tools, prompts, insight + recommendation engines
│  ├─ crypto/                    # token encryption (AES-256-GCM)
│  ├─ server-env.ts              # server-only env vars (Meta app, encryption key, service role)
│  └─ observability/             # planned: logger
├─ trigger/                      # Trigger.dev task definitions (call into lib/)
├─ scripts/                      # seed-demo.ts, sync-worker.ts
├─ supabase/
│  └─ migrations/                # SQL, ordered
├─ schemas/                      # Zod schemas shared by forms, actions, connectors
├─ hooks/                        # client React hooks
├─ types/                        # cross-cutting TS types
├─ tests/
│  ├─ unit/  integration/  e2e/
└─ docs/
```

Why this shape:

- **`app/` is thin.** Pages fetch via `lib/` functions and render components. Business rules are testable without React or Next.
- **`lib/platforms` holds the contract and the adapters.** `types.ts`, `registry.ts`, `http.ts` and `errors.ts` are the contract and shared plumbing; `meta/` (and later one folder per provider) are adapters. Adapters never touch the database. The sync engine reaches adapters only through `createAdapter()`, and analytics code never imports `lib/platforms`.
- **`lib/ingest` is the only writer** of posts and metric snapshots, for live sync, CSV import and demo data alike, so every source passes the same checks.
- **`lib/metrics` + `lib/analytics` are the single source of truth** for what a metric means and how it is calculated. The UI, reports and AI all call the same functions.
- **`trigger/` holds only job wiring.** The actual sync logic is in `lib/sync` so it can be unit-tested and run without Trigger.dev (`pnpm sync:worker`).

## 6. Domain boundaries

| Module      | Owns                                                                               | Depends on                      |
| ----------- | ---------------------------------------------------------------------------------- | ------------------------------- |
| orgs        | organizations, members, roles, invitations                                         | auth, db                        |
| accounts    | social accounts, account groups (country/region/custom)                            | orgs                            |
| platforms   | adapters, OAuth clients, connector registry                                        | metrics                         |
| connections | connect/link/unlink/disconnect flows, encrypted credential storage                 | platforms, crypto, db           |
| public-data | viewer account, add-profile preview and bulk add, profile removal                  | platforms, sync (credentials)   |
| ingest      | validated writes of posts and metric snapshots                                     | metrics, db                     |
| imports     | CSV templates, parsing, import batches                                             | ingest                          |
| sync        | sync jobs, queue, runs, logs, backoff                                              | platforms, ingest, crypto       |
| metrics     | metric dictionary, platform→normalized mapping, comparability classes              | —                               |
| analytics   | aggregates, rates, medians, period comparison, comparability checks                | metrics, db                     |
| benchmarks  | groups, rankings                                                                   | analytics                       |
| content     | content items, versions, assets, taxonomy (pillars, formats, campaigns, audiences) | orgs                            |
| approvals   | review state machine, decisions, comments                                          | content                         |
| strategy    | strategies, objectives, KPIs, pillar links                                         | content taxonomy                |
| ai          | providers, tools, insight/recommendation engines, generations log                  | analytics, benchmarks, strategy |
| reports     | weekly report assembly, snapshots                                                  | analytics, ai                   |

Rule: dependencies point downward only. `analytics` never imports `platforms`; `ai` never imports `db` directly for analytics — it uses `analytics` functions exposed as tools.

## 7. Request and data flows

### 7.1 Reading the dashboard

The dashboard (`app/[orgSlug]/dashboard/`) reads through `lib/analytics`, which computes everything from stored observations with RLS on. The rules come from PHASE_3_PLAN.md §8:

- Nothing is interpolated or back-filled; a day without an observation is a gap.
- Observed growth uses the first and last follower observation in the range and needs at least two observations at least 24 hours apart.
- Posting frequency is counted only after `earliest_post_at`.
- Public engagement per post is likes plus comments at a fixed post age (7 days by default); posts with hidden likes are excluded and the count says so.
- Two values are compared only if they share metric key, comparability class and data source. CANNA is compared with competitors on its `live_public` values even when connected.
- Derived metrics are computed at read time and never stored. Demo organizations show DEMO-labelled data; real organizations never do.

### 7.2 Syncing an account

The queue is the `sync_runs` table. Four job types run per connected account: `account_daily` (daily), `posts_incremental` (every 6 h), `post_metrics_refresh` (hourly, snapshots at post ages 1, 2, 3, 7, 14, 30, 90 days) and `backfill` (until the oldest post is reached). Details in [DATA_PIPELINE.md](DATA_PIPELINE.md).

1. Every 15 minutes the Trigger.dev task `scopie-scheduled-sync` (or `pnpm sync:worker --watch`) runs one tick (`syncTick` in `lib/sync/worker.ts`): mark runs stuck `running` for over an hour as failed, queue jobs that are due (connected jobs for every active account on an `active` connection; public jobs, §7.2a), run the queue, and delete raw payloads older than 30 days.
2. "Sync now" calls `request_sync()`, which inserts a `manual` run. A partial unique index allows one queued or running run per account and job type, so duplicates are impossible.
3. The engine claims a run (`queued` → `running`), loads the account's encrypted token and decrypts it in memory (`lib/sync/credentials.ts`), and calls the adapter.
4. Results go through `ingest()` as `live_connected` data, with the run id. Progress (rows written, backfill cursor) is saved as it goes; raw responses are stored in `raw_payloads`.
5. The run ends `succeeded`, `partial` or `failed` with counts, an error code and up to 100 `sync_run_events`.
6. Failures: an auth error sets the connection and its accounts to `needs_reauth` and stops their jobs until reconnected; a rate limit pauses the job until Meta's suggested time; other errors back off 15 min, 30, 60… up to 24 h, and after 3 in a row the account shows "Sync error".

Concurrency: one tick processes the queue sequentially, oldest first, so a token never runs two jobs at once.

### 7.2a Observing a public profile

Three job types run per active public profile on the same `sync_runs` queue, in organizations that chose a viewer account: `public_profile_daily` (every 24 h: profile fields, followers, post count, first page of posts), `public_posts_refresh` (every 3 h, up to 4 pages: snapshots of posts under 31 days old at capture ages 1–30 days) and `public_backfill` (hourly until done: back up to 12 months or 20 pages, then sets `earliest_post_at`). The engine loads the viewer's Page token (`loadPublicContext`) and runs `runPublicJob` (`lib/sync/public-jobs.ts`), which writes through `ingest()` as `live_public`.

- A failed observation writes nothing for that day, so charts show a gap.
- When Meta's `X-App-Usage` reaches 80%, the run stops (`usage_paused`), the job waits an hour and the rest of the pass skips public jobs.
- If the viewer's token is rejected, its connection is marked "Needs reconnect" (`viewer_auth`); tracked profiles are not.
- If a handle now belongs to a different account id, the run fails (`profile_changed`) and stores nothing.

Details in [DATA_PIPELINE.md](DATA_PIPELINE.md) §3.1 and §4.

### 7.3 Approving content

Server Action `approvals.decide({ contentItemId, versionId, decision, comment })` → validates role (MANAGER+) and current state → inserts immutable `content_reviews` row → transitions status → writes `activity_log` → notifies owner.

### 7.4 AI insight run

Scheduled weekly (and on demand). Worker computes candidate signals deterministically in SQL/TS (deltas, z-scores, segment medians) → passes only those structured facts to the LLM → LLM writes wording and ranks; output validated by Zod → stored with `evidence` references. See AI_ARCHITECTURE.md.

## 8. Security architecture

- **Auth:** Supabase Auth with email + password (implemented). Magic links and Google/Microsoft SSO can be added later. Sessions via `@supabase/ssr` cookies; `proxy.ts` refreshes the session on every request and redirects signed-out visitors, and every page and server action re-verifies the user (`requireUser`, `getOrgContext`). Email confirmation links land on `/auth/confirm`.
- **Tenancy:** RLS on every tenant table using `is_org_member(org_id)` and `has_org_permission(org_id, permission)` SQL helpers; child rows use composite `(id, organization_id)` foreign keys so they can't point across organizations. Integration tests (`tests/integration/`) assert cross-org reads fail.
- **Roles:** OWNER > ADMIN > MANAGER > EDITOR > VIEWER. Permission matrix in DATABASE.md §7. Checked in SQL (RLS) **and** in server actions (`requireRole`) for clear errors.
- **Token storage:** OAuth tokens (Meta long-lived user token and Page tokens) encrypted at rest with AES-256-GCM using `SCOPIE_ENCRYPTION_KEY` from server env (`lib/crypto/tokens.ts`), stored in `connection_credentials`, a table with no RLS policies and all grants revoked from `authenticated`; only the service role (OAuth callback, disconnect, sync worker) reads it. Key rotation is possible via the `key_version` prefix. (Supabase Vault considered; app-level encryption chosen for portability to any Postgres.)
- **Never log tokens:** `lib/platforms/http.ts` redacts `access_token`, `client_secret`, `code`, `fb_exchange_token`, `appsecret_proof`, `input_token`, `refresh_token` and Meta-style token strings from URLs and error messages before they are logged or stored in `sync_runs`. Tokens never reach the browser.
- **OAuth:** random `state` in an httpOnly cookie (10-min TTL, scoped to the callback path), compared timing-safe; permission re-checked in the callback. Meta's flow is server-side with the app secret (no PKCE); every Graph call carries `appsecret_proof`.
- **Who may write data:** only the sync worker can write `live_public` and `live_connected` data; users can write only `imported` data, `demo` data only lands in demo orgs, and users can't set connection fields. Enforced by database triggers (DATABASE.md §5.5).
- **Uploads** (Phase 5): private Supabase Storage bucket `content-assets` (or a local folder in development) under `org/{orgId}/content/{itemId}/…`, written only by the server. The type is checked from the file's bytes against an allow-list (PNG, JPEG, GIF, WebP, MP4, MOV, PDF; no SVG or HTML) with size limits. Files are served through `/api/content-assets/{id}` after an RLS check, with `nosniff`, a sandbox CSP and private caching. CSV imports are parsed in memory (5 MB limit) and not stored.
- **Rate limiting:** "Sync now" can't pile up (one queued run per account and job). Add-profile previews are limited to 30 per organization per hour (`public_profile_lookups`). Public jobs pause at 80% of Meta's app usage. Per-user limits on AI chat are _planned_.
- **Audit:** `activity_log` for account, membership, organization, platform connection, viewer account and import changes; later content/approval changes and `ai_generations` for every model call.
- **Secrets:** only in env vars, validated by `lib/server-env.ts`; `.env.example` lists names only. `SUPABASE_SERVICE_ROLE_KEY`, `SCOPIE_ENCRYPTION_KEY`, `META_APP_SECRET` (and later LLM keys) are server-only (never `NEXT_PUBLIC_`).

## 9. Performance and scale

Designing for 100+ orgs, thousands of accounts, millions of posts and tens of millions of metric rows:

- Metric snapshots are **append-only**, narrow (one metric per row), guarded against duplicates by unique indexes, and have BRIN indexes on `captured_at`. They can be converted to declarative range partitions by month without schema change.
- **Read models** (`post_metrics_latest`, `post_metrics_at_age`, `account_metrics_daily`) are views today; when they get slow they become tables refreshed incrementally by sync jobs, not on page load.
- Materialized views only for org-wide aggregates refreshed by jobs; never refreshed in a request.
- Cursor (keyset) pagination on all list endpoints.
- Next.js caching: per-request dedupe; `revalidateTag('org:{id}:analytics')` after sync completes.

## 10. Observability

- Logs never contain token values (see §8). A structured logger with `orgId`, `syncRunId`, `platform`, `requestId` is _planned_.
- Connector error taxonomy (`lib/platforms/errors.ts`): `AuthError`, `PermissionError`, `RateLimitError`, `ValidationError`, `TransientError` (all `PlatformError`). Ingest rejections are counted per run with a sample.
- `sync_runs` + `sync_run_events` are the user-visible health record, shown on each account's page and in Settings → Connections. A System health page (failing connections, rate-limit hits, AI errors) is _planned_.
- Optional Sentry via env var; not required to run.

## 11. Testing strategy

| Layer                                                                                       | Tool                                                                     | What                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric normalization, analytics math, benchmarks, approval state machine, AI input builders | Vitest unit                                                              | Pure functions, table-driven tests, golden files for connector payloads.                                                                                |
| RLS, permissions and data rules                                                             | Vitest integration against local Supabase                                | Member can read own org, non-member cannot, role limits on writes; data-source rules, token secrecy, code/database mirrors (metrics, connector status). |
| Connectors                                                                                  | Vitest with saved fixtures (`tests/fixtures/meta/`, no live calls in CI) | Parsing, pagination, rate-limit and error mapping, retries, redaction, unavailable-metric handling.                                                     |
| Server actions                                                                              | Vitest integration against local Supabase                                | Imports, linking, sync engine; later approval flow and content versioning.                                                                              |
| E2E                                                                                         | Playwright                                                               | Sign in → create org → add account → see demo dashboard → create content → submit → approve.                                                            |

## 12. Key decisions log

| #   | Decision                                                                                                                                                                                                | Why                                                                                                                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Single Next.js app, no monorepo                                                                                                                                                                         | One deployable; less tooling. Revisit if a public API or separate worker image is needed.                                                                                                                                                |
| D2  | supabase-js + SQL, no ORM                                                                                                                                                                               | RLS stays the security boundary; generated types give type safety; analytics are SQL-heavy anyway.                                                                                                                                       |
| D3  | First real connector: **Meta (Instagram + Facebook Pages)**, built in Phase 2                                                                                                                           | Highest relevance to CANNA's country accounts, one OAuth covers both platforms, mature insights API. Full reasoning and setup in API_INTEGRATIONS.md §4.                                                                                 |
| D4  | Append-only, narrow metric snapshots with an availability enum (`available`, `not_permitted`, `not_applicable`, `pending`, `error`), a duplicate-guard unique index and `post_age_hours` set by trigger | Enables trend history and fair "value at N days" comparisons; a missing number is a reason, never a zero; retries are idempotent.                                                                                                        |
| D5  | AI computes nothing numeric                                                                                                                                                                             | All numbers come from the analytics layer; the model only explains, ranks and suggests, citing evidence ids.                                                                                                                             |
| D6  | App-level token encryption (AES-256-GCM)                                                                                                                                                                | Works on any Postgres host, testable, supports key rotation.                                                                                                                                                                             |
| D7  | Apache-2.0 license                                                                                                                                                                                      | Permissive open source with patent grant.                                                                                                                                                                                                |
| D8  | Keep Next.js 16 Cache Components on; the Supabase server client calls `connection()`                                                                                                                    | Every page is per-user, so data loads at request time behind `<Suspense>` while the shell (sidebar, headers) prerenders. `connection()` marks Supabase calls as request-time, since auth checks token expiry against the clock.          |
| D9  | Permission matrix stored in `public.role_permissions` and mirrored in `lib/auth/permissions.ts`                                                                                                         | RLS policies call `has_org_permission()`; the UI uses the TS copy only to decide what to show. An integration test asserts they match.                                                                                                   |
| D10 | Org slugs at the URL root (`/{slug}/dashboard`) with a reserved-word list                                                                                                                               | Short, readable URLs; `lib/orgs/slug.ts` blocks collisions with app routes.                                                                                                                                                              |
| D11 | Membership check in the org layout (`OrgGate`) plus in every data function                                                                                                                              | Non-members see the not-found page. Because the check streams behind Suspense, the HTTP status is 200 rather than 404; no data is rendered either way.                                                                                   |
| D12 | Users can never set connection status, data source or sync time                                                                                                                                         | A database trigger forces manual accounts to `not_connected`/`manual`; only trusted server code (service role) can set them. Prevents presenting manual accounts as connected.                                                           |
| D13 | Metric dictionary carries unit, aggregation rule and higher-is-better; derived metrics are computed, never stored                                                                                       | One definition for UI, reports and AI; the snapshot trigger rejects derived keys so a stored rate can't drift from its inputs. See METRICS.md.                                                                                           |
| D14 | Posts store their own country and language (with source), `media_format` separate from editorial `content_format_id`, and real FK columns for pillar, campaign, audiences and CTA                       | History survives account changes; objective format vs editorial label stay distinct; tags are queryable and can't point across orgs.                                                                                                     |
| D15 | Data sources renamed `authenticated` / `public` / `imported` / `manual` / `demo` (UI: Live / Public / Imported / Manual / DEMO), with database rules                                                    | Superseded by D22 in Phase 3. `demo` only in demo orgs; `authenticated` only for connected accounts and never written by users; `imported` requires an import batch; value and availability must agree.                                  |
| D16 | `social_accounts` gains `tracking_started_at`, `history_available_from`, `connection_id` and `unique (id, organization_id)`; account types validated via `platform_account_types`                       | Phase 3 renamed `tracking_started_at` to `first_observed_at` and added `last_observed_at` and `earliest_post_at` (PHASE_3_PLAN.md C3). Analytics can say when tracking started and how far history goes; child tables use composite FKs. |
| D17 | No `demo` platform; `lib/platforms/registry.ts` (`CONNECTED_PLATFORMS`) is the source of connector capabilities and `platforms.connector_status` mirrors it                                             | Phase 3 replaced `connector_status` with `public_data_status` and `private_data_status` (D24). One source of truth; an integration test checks the mirror.                                                                               |
| D18 | Reporting timezone per platform (`platforms.reporting_timezone`); Meta daily values are dated `end_time` minus 12 hours                                                                                 | "1 September" means the platform's own day, in both PST and PDT.                                                                                                                                                                         |
| D19 | Sync queue in Postgres (`sync_runs`), driven by a 15-minute tick from Trigger.dev or `pnpm sync:worker`                                                                                                 | Runs anywhere Postgres runs; one active run per account and job by unique index; Trigger.dev is optional.                                                                                                                                |
| D20 | Public social intelligence is the core product; OAuth connections are optional enrichment                                                                                                               | Jen's product decision, 2026-10-07. Scopie must work without CANNA Meta Business admin access.                                                                                                                                           |
| D21 | Business role and access type are separate fields; `is_competitor` and `primary_data_source` are replaced                                                                                               | A CANNA account can be public or connected; a competitor is always public. One flag couldn't express both.                                                                                                                               |
| D22 | Provenance values `live_public`, `live_connected`, `imported`, `estimated`, `demo`                                                                                                                      | Public observations must never look like connected data; estimates are never shown as live.                                                                                                                                              |
| D23 | Instagram public data via Business Discovery through a viewer account, using the Phase 2 Meta connector                                                                                                 | The only official way to read other professional accounts; no scraping. The viewer can be any professional account the user manages.                                                                                                     |
| D24 | Connectors split into `PublicProfileCollector` and `PrivateDataAdapter`; platform capabilities as `public_data_status` / `private_data_status`                                                          | The UI shows only metrics a profile can have; public collection needs no owner token.                                                                                                                                                    |
| D25 | Profile snapshots stored only when a public field changed                                                                                                                                               | Keeps the table small and shows exactly when a profile was edited.                                                                                                                                                                       |
| D26 | Public jobs pause at 80% of Meta's `X-App-Usage`; add-profile previews capped at 30 per organization per hour                                                                                           | Leaves room for connected syncs and previews; a busy form can't starve the daily observations.                                                                                                                                           |
| D27 | `remove_profile_and_data()` deletes a profile and everything stored about it                                                                                                                            | Meta Platform Terms §3.d require deleting data when it is no longer needed or on request.                                                                                                                                                |
