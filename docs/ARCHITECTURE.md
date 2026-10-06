# Scopie — Architecture

> Status: Phase 1 (foundation) implemented. Sections marked _planned_ describe later phases.
> Last updated: 2026-10-06

## 0. Implementation status (Phase 1)

What exists in code today:

| Area                                                                               | Implemented in                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Next.js 16 App Router, strict TypeScript, Tailwind v4, shadcn-style components     | `app/`, `components/ui/`                                                   |
| Supabase Auth (email + password), session refresh, protected routes                | `proxy.ts`, `lib/db/proxy-session.ts`, `lib/auth/`                         |
| Organizations, membership, roles and permission matrix with RLS                    | `supabase/migrations/…_tenancy_and_roles.sql`, `lib/orgs/`, `lib/members/` |
| Platforms, countries, social accounts, account groups (tables), activity log       | `supabase/migrations/…_social_accounts.sql`, `lib/accounts/`               |
| App shell with all 12 navigation sections; unfinished ones are honest placeholders | `app/[orgSlug]/`, `lib/navigation.ts`                                      |
| DEMO seed                                                                          | `scripts/seed-demo.ts`                                                     |
| Unit, database integration and Playwright tests; CI                                | `tests/`, `.github/workflows/ci.yml`                                       |

Not implemented yet: connectors, OAuth token storage, sync engine and Trigger.dev, metrics and analytics, content, approvals, strategy, benchmarks, reports, AI, Storage uploads, member invitations. The rest of this document describes the target architecture; those parts are planned.

## 1. Repository inspection (Phase 0, step A–D)

- No existing Scopie repository was found on the owner's GitHub account (only `shark-flipbook` and `my-site-3`, both unrelated).
- No Scopie files exist in the project's shared folder.
- Conclusion: Scopie is a **greenfield project**. This document defines the architecture from scratch.

## 2. Goals that drive the architecture

| Goal                                                             | Architectural consequence                                                                                                                                                                 |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real data, never faked                                           | Every metric row carries `data_source` (`live_api`, `public_api`, `manual`, `import`, `demo`) and an availability state. Demo data is a first-class, visibly labelled source, not a hack. |
| Many platforms, all different                                    | Platform logic lives behind a `PlatformConnector` interface. The core analytics layer never imports platform code.                                                                        |
| Multi-tenant from day one                                        | Every tenant-owned table has `organization_id`; Supabase Row Level Security (RLS) enforces isolation in the database, not only in app code.                                               |
| Start small (30 accounts), scale later (millions of metric rows) | Append-only metric snapshots, partition-ready tables, daily rollup tables, background sync jobs, cursor pagination.                                                                       |
| AI that cites evidence                                           | AI never queries raw tables freely. It calls typed, read-only analytics tools that return data plus an evidence reference, and every generation is stored.                                |
| Open source, runnable by others                                  | Plain Next.js + Supabase + Trigger.dev, `.env.example`, seed data, docs for every setup step. No CANNA-specific code paths.                                                               |

## 3. System overview

```
                ┌───────────────────────────────────────────────┐
 Browser ──────▶│  Next.js (App Router)                         │
 (React,        │  • Server Components for reads                │
  shadcn/ui)    │  • Server Actions for mutations               │
                │  • Route Handlers: /api/oauth/*, /api/webhooks│
                │  • Domain modules in lib/ (pure TS)           │
                └──────────┬──────────────────────┬─────────────┘
                           │ supabase-js (user JWT,│ enqueue job
                           │ RLS enforced)         ▼
                ┌──────────▼──────────┐   ┌─────────────────────┐
                │ Supabase            │   │ Trigger.dev workers │
                │ • Postgres + RLS    │◀──│ • sync jobs         │
                │ • Auth              │   │ • rollups           │
                │ • Storage (assets)  │   │ • AI insight runs   │
                │ • Vault (secrets)   │   │ • weekly reports    │
                └─────────────────────┘   └──────────┬──────────┘
                                                     │ HTTPS
                                       ┌─────────────▼─────────────┐
                                       │ Platform APIs (Meta, etc.)│
                                       │ LLM provider (OpenAI)     │
                                       └───────────────────────────┘
```

Key rule: **browser code never talks to platform APIs or the LLM, and never sees tokens.** It only talks to our server, which talks to Supabase with the user's session (RLS applies). Workers use the Supabase service role and must scope every query by `organization_id` explicitly.

## 4. Tech stack (decided)

| Concern             | Choice                                                 | Notes                                                                                                                               |
| ------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Framework           | Next.js (App Router), React, TypeScript `strict`       | Server Components by default; client components only where interactive.                                                             |
| UI                  | Tailwind CSS, shadcn/ui, Lucide                        | shadcn components copied into `components/ui`, themed via CSS variables.                                                            |
| Tables              | TanStack Table (via shadcn data-table pattern)         | Tables are the primary UI.                                                                                                          |
| Charts              | Recharts                                               | Wrapped in our own `components/charts` so the library can be swapped.                                                               |
| DB / Auth / Storage | Supabase (Postgres 15+, Auth, Storage, Vault)          | Migrations via Supabase CLI, SQL-first.                                                                                             |
| DB access in TS     | `supabase-js` + generated types (`supabase gen types`) | Complex analytics live in SQL views/functions, called via RPC. No ORM: keeps RLS honest and avoids a second schema source of truth. |
| Background jobs     | Trigger.dev v3                                         | Scheduled + on-demand tasks, retries, concurrency limits per platform.                                                              |
| AI                  | OpenAI API behind `lib/ai/providers` interface         | Provider-agnostic; Anthropic etc. can be added.                                                                                     |
| Validation          | Zod                                                    | Every server action input, every connector response, every AI structured output.                                                    |
| Forms               | React Hook Form + Zod resolver                         |                                                                                                                                     |
| Tests               | Vitest (unit/integration), Playwright (E2E)            | Integration tests run against a local Supabase.                                                                                     |
| Lint/format         | ESLint, Prettier                                       | CI blocks on lint, typecheck, tests.                                                                                                |
| Package manager     | pnpm                                                   |                                                                                                                                     |
| Logging             | Structured JSON logger (`pino`) with token redaction   | Shipped to stdout; works with any log drain.                                                                                        |
| License             | Apache-2.0                                             | Permissive, with explicit patent grant.                                                                                             |

## 5. Repository structure

Single Next.js app (no monorepo yet — one deployable is simpler; we split only if a second deployable appears).

```
scopie/
├─ app/                          # Routes only: thin, compose lib/ + components/
│  ├─ (auth)/sign-in, sign-up        # + auth/confirm route, onboarding
│  ├─ (app)/[orgSlug]/
│  │  ├─ dashboard/  analytics/  accounts/  content/  calendar/
│  │  ├─ approvals/  strategy/  benchmarks/  reports/  insights/
│  │  ├─ productivity/  settings/
│  ├─ api/
│  │  ├─ oauth/[platform]/start, callback
│  │  └─ webhooks/[platform]
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
│  ├─ platforms/                 # connector interface, registry, shared types
│  ├─ integrations/              # one folder per platform adapter
│  │  ├─ meta/                   #   instagram + facebook (one Graph API, one OAuth)
│  │  ├─ youtube/
│  │  ├─ demo/                   #   clearly-labelled demo connector
│  │  └─ …
│  ├─ sync/                      # sync orchestration, normalization pipeline
│  ├─ metrics/                   # metric dictionary + normalization map
│  ├─ analytics/                 # calculation layer (rates, medians, deltas, comparability)
│  ├─ benchmarks/
│  ├─ content/                   # content items, versions, assets
│  ├─ approvals/                 # state machine, review decisions
│  ├─ strategy/
│  ├─ reports/
│  ├─ ai/                        # providers, tools, prompts, insight + recommendation engines
│  ├─ crypto/                    # token encryption helpers
│  └─ observability/             # logger, error types
├─ trigger/                      # Trigger.dev task definitions (call into lib/)
├─ supabase/
│  ├─ migrations/                # SQL, ordered
│  ├─ seed/                      # DEMO DATA generators
│  └─ tests/                     # pgTAP RLS tests
├─ schemas/                      # Zod schemas shared by forms, actions, connectors
├─ hooks/                        # client React hooks
├─ types/                        # cross-cutting TS types
├─ tests/
│  ├─ unit/  integration/  e2e/
└─ docs/
```

Why this shape:

- **`app/` is thin.** Pages fetch via `lib/` functions and render components. Business rules are testable without React or Next.
- **`lib/platforms` vs `lib/integrations`.** `platforms` is the contract (interface, registry, capability types). `integrations/<platform>` are adapters. Core code imports only `platforms`.
- **`lib/metrics` + `lib/analytics` are the single source of truth** for what a metric means and how it is calculated. The UI, reports and AI all call the same functions.
- **`trigger/` holds only job wiring.** The actual sync logic is in `lib/sync` so it can be unit-tested and run manually.

## 6. Domain boundaries

| Module                   | Owns                                                                               | Depends on                      |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------- |
| orgs                     | organizations, members, roles, invitations                                         | auth, db                        |
| accounts                 | social accounts, account groups (country/region/custom)                            | orgs                            |
| platforms + integrations | connectors, OAuth, capability declarations                                         | crypto, metrics                 |
| sync                     | sync jobs, runs, logs, normalization into metric tables                            | platforms, metrics              |
| metrics                  | metric dictionary, platform→normalized mapping                                     | —                               |
| analytics                | aggregates, rates, medians, period comparison, comparability checks                | metrics, db                     |
| benchmarks               | groups, rankings                                                                   | analytics                       |
| content                  | content items, versions, assets, taxonomy (pillars, formats, campaigns, audiences) | orgs                            |
| approvals                | review state machine, decisions, comments                                          | content                         |
| strategy                 | strategies, objectives, KPIs, pillar links                                         | content taxonomy                |
| ai                       | providers, tools, insight/recommendation engines, generations log                  | analytics, benchmarks, strategy |
| reports                  | weekly report assembly, snapshots                                                  | analytics, ai                   |

Rule: dependencies point downward only. `analytics` never imports `integrations`; `ai` never imports `db` directly for analytics — it uses `analytics` functions exposed as tools.

## 7. Request and data flows

### 7.1 Reading the dashboard

1. Server Component calls `analytics.getOverview({ orgId, range, compareTo, filters })`.
2. That calls a Postgres function over the daily rollup tables (RLS on).
3. Result includes, per metric: value, previous value, delta, `definition_key`, and source mix (e.g. "28 accounts live API, 2 demo").
4. UI renders `MetricValue` with a definition tooltip and a `SourceBadge`.

### 7.2 Syncing an account

1. Schedule (or a user clicking "Sync now") enqueues `sync.account` in Trigger.dev with `{ orgId, socialAccountId, mode: 'incremental' | 'backfill' }`.
2. Worker creates a `sync_runs` row (`running`), loads and decrypts the connection token server-side.
3. Calls the connector (`getProfile`, `getPosts(since)`, `getPostMetrics`, `getProfileMetrics`). Connector handles rate limits and returns raw payloads + normalized records.
4. Raw payloads stored (JSONB, retained N days) for audit and re-normalization; normalized rows upserted into `posts`, `post_metric_snapshots`, `account_metric_snapshots`.
5. Rollups recomputed for affected days. Run marked `succeeded` / `partial` / `failed` with counts and error.
6. On token failure, connection status becomes `needs_reauth` and an in-app notification is raised.

Concurrency: Trigger.dev queue per `platform + connection` so we respect per-token rate limits; a global concurrency cap per platform app.

### 7.3 Approving content

Server Action `approvals.decide({ contentItemId, versionId, decision, comment })` → validates role (MANAGER+) and current state → inserts immutable `content_reviews` row → transitions status → writes `activity_log` → notifies owner.

### 7.4 AI insight run

Scheduled weekly (and on demand). Worker computes candidate signals deterministically in SQL/TS (deltas, z-scores, segment medians) → passes only those structured facts to the LLM → LLM writes wording and ranks; output validated by Zod → stored with `evidence` references. See AI_ARCHITECTURE.md.

## 8. Security architecture

- **Auth:** Supabase Auth with email + password (implemented). Magic links and Google/Microsoft SSO can be added later. Sessions via `@supabase/ssr` cookies; `proxy.ts` refreshes the session on every request and redirects signed-out visitors, and every page and server action re-verifies the user (`requireUser`, `getOrgContext`). Email confirmation links land on `/auth/confirm`.
- **Tenancy:** RLS on every tenant table using `is_org_member(org_id)` and `has_org_role(org_id, min_role)` SQL helpers. pgTAP tests assert cross-org reads fail.
- **Roles:** OWNER > ADMIN > MANAGER > EDITOR > VIEWER. Permission matrix in DATABASE.md §7. Checked in SQL (RLS) **and** in server actions (`requireRole`) for clear errors.
- **Token storage:** OAuth tokens encrypted at rest with AES-256-GCM using a key from server env (`TOKEN_ENCRYPTION_KEY`), stored in `connection_credentials`, a table with RLS that denies all access to `authenticated` users; only the service role (workers, OAuth callback) reads it. Key rotation supported via `key_version` column. (Supabase Vault considered; app-level envelope encryption chosen for portability to any Postgres.)
- **Never log tokens:** logger has a redaction list (`access_token`, `refresh_token`, `code`, `client_secret`, `authorization`). Connector HTTP client strips query-string tokens before logging URLs.
- **OAuth:** state parameter (signed, bound to user + org, 10-min TTL) and PKCE where the platform supports it.
- **Uploads:** Supabase Storage private bucket per org path (`org/{orgId}/content/{itemId}/…`), storage RLS, MIME/size allow-list, signed URLs for viewing.
- **Rate limiting:** per-user limits on AI chat and "Sync now" (Postgres-backed token bucket, no extra infra).
- **Audit:** `activity_log` for content/approval/settings/connection changes; `ai_generations` for every model call.
- **Secrets:** only in env vars; `.env.example` lists names only. `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, platform client secrets are server-only (never `NEXT_PUBLIC_`).

## 9. Performance and scale

Designing for 100+ orgs, thousands of accounts, millions of posts and tens of millions of metric rows:

- Metric snapshots are **append-only** and indexed by `(social_account_id, captured_at)` / `(post_id, captured_at)`. Tables are written so they can be converted to declarative range partitions by month without schema change.
- **Rollup tables** (`account_daily_stats`, `post_latest_metrics`) are what the UI reads; they are recomputed incrementally by sync jobs, not on page load.
- Materialized views only for org-wide aggregates refreshed by jobs; never refreshed in a request.
- Cursor (keyset) pagination on all list endpoints.
- Next.js caching: per-request dedupe; `revalidateTag('org:{id}:analytics')` after sync completes.

## 10. Observability

- Structured logs with `orgId`, `syncRunId`, `platform`, `requestId`, never token values.
- Error taxonomy: `AuthError`, `RateLimitError`, `PlatformApiError`, `PermissionMissingError`, `NormalizationError`, `AiError`.
- `sync_runs` + `sync_run_events` tables are the user-visible health record. A Settings → System health page (Phase 5+) lists failing connections, last successful sync, rate-limit hits, AI errors.
- Optional Sentry via env var; not required to run.

## 11. Testing strategy

| Layer                                                                                       | Tool                                                | What                                                                                         |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Metric normalization, analytics math, benchmarks, approval state machine, AI input builders | Vitest unit                                         | Pure functions, table-driven tests, golden files for connector payloads.                     |
| RLS and permissions                                                                         | pgTAP (Supabase)                                    | Every table: member can read own org, non-member cannot, role limits on writes.              |
| Connectors                                                                                  | Vitest with recorded fixtures (no live calls in CI) | Parsing, pagination, rate-limit backoff, token-expiry handling, unavailable-metric handling. |
| Server actions                                                                              | Vitest integration against local Supabase           | Approval flow, content versioning.                                                           |
| E2E                                                                                         | Playwright                                          | Sign in → create org → add account → see demo dashboard → create content → submit → approve. |

## 12. Key decisions log

| #   | Decision                                                                                        | Why                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Single Next.js app, no monorepo                                                                 | One deployable; less tooling. Revisit if a public API or separate worker image is needed.                                                                                                                                       |
| D2  | supabase-js + SQL, no ORM                                                                       | RLS stays the security boundary; generated types give type safety; analytics are SQL-heavy anyway.                                                                                                                              |
| D3  | First real connector: **Meta (Instagram + Facebook Pages)**                                     | Highest relevance to CANNA's country accounts, one OAuth covers both platforms, mature insights API. Full reasoning in API_INTEGRATIONS.md §4.                                                                                  |
| D4  | Append-only metric snapshots + rollups                                                          | Enables trend history, re-normalization, and fast dashboards.                                                                                                                                                                   |
| D5  | AI computes nothing numeric                                                                     | All numbers come from the analytics layer; the model only explains, ranks and suggests, citing evidence ids.                                                                                                                    |
| D6  | App-level token encryption (AES-256-GCM)                                                        | Works on any Postgres host, testable, supports key rotation.                                                                                                                                                                    |
| D7  | Apache-2.0 license                                                                              | Permissive open source with patent grant.                                                                                                                                                                                       |
| D8  | Keep Next.js 16 Cache Components on; the Supabase server client calls `connection()`            | Every page is per-user, so data loads at request time behind `<Suspense>` while the shell (sidebar, headers) prerenders. `connection()` marks Supabase calls as request-time, since auth checks token expiry against the clock. |
| D9  | Permission matrix stored in `public.role_permissions` and mirrored in `lib/auth/permissions.ts` | RLS policies call `has_org_permission()`; the UI uses the TS copy only to decide what to show. An integration test asserts they match.                                                                                          |
| D10 | Org slugs at the URL root (`/{slug}/dashboard`) with a reserved-word list                       | Short, readable URLs; `lib/orgs/slug.ts` blocks collisions with app routes.                                                                                                                                                     |
| D11 | Membership check in the org layout (`OrgGate`) plus in every data function                      | Non-members see the not-found page. Because the check streams behind Suspense, the HTTP status is 200 rather than 404; no data is rendered either way.                                                                          |
| D12 | Users can never set connection status, data source or sync time                                 | A database trigger forces manual accounts to `not_connected`/`manual`; only trusted server code (service role) can set them. Prevents presenting manual accounts as connected.                                                  |
