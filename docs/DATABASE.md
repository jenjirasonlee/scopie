# Scopie — Database Design

> PostgreSQL on Supabase. Status: §3 and §4 (except connections/credentials) are implemented in Phase 1; the rest is the target design. Last updated: 2026-10-06

## 0. Implemented in Phase 1

Migrations: `supabase/migrations/20261006000100_tenancy_and_roles.sql`, `…000200_social_accounts.sql`.

| Table                                     | Notes                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`, `role_permissions`         | Permission matrix as data (§7). Read-only for users.                                                                                                                                                                                          |
| `profiles`                                | Created by trigger on sign-up; stores `email` (mirrors auth, not user-editable), `full_name`, `timezone`. Visible to yourself and people who share an organization.                                                                           |
| `organizations`                           | Created only through `create_organization()` (makes the caller OWNER). `is_demo` flags demo orgs.                                                                                                                                             |
| `organization_members`                    | Role per user. Only OWNERs grant/change/remove OWNER. An organization always keeps one owner, except when an owner's whole user account is deleted (the organization is then left ownerless and must be reassigned by an operator).           |
| `platforms`, `countries`                  | Global reference data (8 platforms, all `planned`; ~55 ISO countries).                                                                                                                                                                        |
| `social_accounts`                         | As §4, plus `notes`, `created_by`. Users can't set `connection_status`, `primary_data_source`, `last_successful_sync_at` (trigger). No delete: deactivate instead. Owner must be a member. Unique handle per org+platform (case-insensitive). |
| `account_groups`, `account_group_members` | `kind` is `region` or `custom` (country uses the account column). No UI yet.                                                                                                                                                                  |
| `activity_log`                            | Written by triggers on accounts, memberships and organization updates.                                                                                                                                                                        |

Not yet created: `platform_connections`, `connection_credentials` (Phase 4) and everything in §5 onward.

## 1. Conventions

- Primary keys: `id uuid default gen_random_uuid()`.
- Every tenant-owned table has `organization_id uuid not null references organizations(id) on delete cascade`, indexed, and RLS enabled.
- Timestamps: `created_at timestamptz default now()`, `updated_at timestamptz` (trigger-maintained). All stored in UTC; display converts to the account's or org's timezone.
- Enumerations: Postgres `enum` types for stable state machines (status, role); lookup tables for user-editable taxonomies (pillars, formats).
- Soft delete only where history matters (`archived_at`); otherwise hard delete with cascades.
- Metric values: `numeric` (not float) for counts and rates; `bigint` acceptable for pure counts in snapshots.
- Raw platform payloads: `jsonb`, kept in separate tables so hot tables stay narrow.

## 2. Entity overview

```
organizations ─┬─ organization_members ── auth.users (profiles)
               ├─ invitations
               ├─ account_groups ── account_group_members ─┐
               ├─ social_accounts ─────────────────────────┘
               │     ├─ platform_connections ── connection_credentials (service-role only)
               │     ├─ account_metric_snapshots
               │     ├─ account_daily_stats (rollup)
               │     └─ posts ─┬─ post_media
               │               ├─ post_metric_snapshots
               │               ├─ post_latest_metrics (rollup)
               │               └─ post_tags (pillar/format/campaign/audience/topic)
               ├─ content_pillars, content_formats, campaigns, audiences, topics
               ├─ content_items ─┬─ content_versions ── content_assets
               │                 ├─ content_comments
               │                 └─ content_reviews
               ├─ strategies ─┬─ strategy_objectives (KPIs)
               │              ├─ strategy_pillars
               │              └─ strategy_scopes (country/groups)
               ├─ benchmark_groups ── benchmark_group_members
               ├─ sync_runs ── sync_run_events
               ├─ raw_payloads
               ├─ ai_generations ─┬─ ai_insights
               │                  └─ ai_recommendations
               ├─ reports ── report_sections
               ├─ notifications
               └─ activity_log

Global (not tenant-owned): platforms, metric_definitions, platform_metric_map, countries
```

## 3. Identity, tenancy and roles

```sql
create type org_role as enum ('OWNER','ADMIN','MANAGER','EDITOR','VIEWER');

create table profiles (                -- 1:1 with auth.users
  id uuid primary key references auth.users on delete cascade,
  full_name text, avatar_url text, locale text, timezone text,
  created_at timestamptz default now()
);

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null, slug text not null unique,
  default_timezone text not null default 'UTC',
  settings jsonb not null default '{}',
  created_at timestamptz default now()
);

create table organization_members (
  organization_id uuid references organizations on delete cascade,
  user_id uuid references profiles on delete cascade,
  role org_role not null,
  created_at timestamptz default now(),
  primary key (organization_id, user_id)
);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  email citext not null, role org_role not null,
  token_hash text not null, expires_at timestamptz not null,
  invited_by uuid references profiles, accepted_at timestamptz
);
```

Roles are a fixed enum (five roles are easier to reason about in RLS), while the permission matrix is data in `permissions` + `role_permissions`. Policies call `has_org_permission(org, 'accounts.manage')`, so changing what a role may do is a data migration, not a policy rewrite. `lib/auth/permissions.ts` mirrors the matrix for the UI, and an integration test asserts both match.

RLS helpers (security definer, stable):

```sql
create function is_org_member(org uuid) returns boolean ...;
create function org_role_rank(org uuid) returns int ...;   -- OWNER=5 … VIEWER=1
create function has_org_role(org uuid, min org_role) returns boolean ...;
```

Typical policy: `using (is_org_member(organization_id))` for select; `with check (has_org_role(organization_id, 'EDITOR'))` for insert/update.

## 4. Platforms and social accounts

```sql
create table platforms (               -- global, seeded
  key text primary key,                -- 'instagram','facebook','linkedin','youtube','tiktok','x','reddit','discord'
  name text not null,
  connector_status text not null       -- 'available','planned','demo_only'
);

create table countries (code char(2) primary key, name text not null);  -- ISO 3166-1

create type account_connection_status as enum
  ('not_connected','connected','needs_reauth','error','demo');
create type data_source as enum
  ('live_api','public_api','manual','import','demo');

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  platform_key text not null references platforms,
  external_id text,                     -- platform's account/page/channel id
  handle text, display_name text not null,
  account_type text,                    -- 'business','creator','page','channel','company_page','server'…
  country_code char(2) references countries,
  language text,                        -- BCP 47
  timezone text,
  owner_user_id uuid references profiles,
  is_competitor boolean not null default false,
  is_active boolean not null default true,
  connection_status account_connection_status not null default 'not_connected',
  primary_data_source data_source not null default 'manual',
  last_successful_sync_at timestamptz,
  created_at timestamptz default now(),
  unique (organization_id, platform_key, external_id)
);

create table account_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  name text not null, kind text not null  -- 'country','region','custom'
);
create table account_group_members (
  group_id uuid references account_groups on delete cascade,
  social_account_id uuid references social_accounts on delete cascade,
  primary key (group_id, social_account_id)
);
```

Country is a column (every account has exactly one) **and** groups exist for regions and custom sets. "Country vs country" uses the column; "region vs region" uses groups.

### Connections and credentials

One OAuth grant often covers several accounts (one Meta login → many Pages and IG accounts). So connections are separate from accounts.

```sql
create table platform_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  platform_key text not null references platforms,
  connected_by uuid references profiles,
  external_user_id text,                -- id of the authorizing platform user
  granted_scopes text[] not null default '{}',
  status account_connection_status not null,
  token_expires_at timestamptz,
  last_error text, last_error_at timestamptz,
  created_at timestamptz default now()
);

alter table social_accounts add column connection_id uuid references platform_connections on delete set null;

create table connection_credentials (   -- RLS: no policies for authenticated → service role only
  connection_id uuid primary key references platform_connections on delete cascade,
  organization_id uuid not null,
  ciphertext bytea not null,            -- AES-256-GCM of JSON {access_token, refresh_token, …}
  iv bytea not null, auth_tag bytea not null,
  key_version int not null,
  updated_at timestamptz default now()
);
```

This replaces the brief's `api_connections`, `oauth_tokens` and `social_account_connections` with two tables that match how OAuth actually works.

## 5. Universal social data model

### 5.1 Metric dictionary (global)

```sql
create type metric_scope as enum ('account','post');
create type metric_kind  as enum ('count','rate','duration_seconds','ratio');

create table metric_definitions (
  key text primary key,                 -- 'reach','impressions','views','likes','reactions','comments',
                                        -- 'shares','saves','clicks','link_clicks','video_views','watch_time',
                                        -- 'avg_watch_duration','completion_rate','followers','following',
                                        -- 'subscribers','profile_views','engagements', …
  scope metric_scope not null,
  kind metric_kind not null,
  label text not null,
  definition text not null,             -- shown in UI tooltip
  is_derived boolean not null default false,
  formula text                          -- for derived metrics, human-readable
);

create table platform_metric_map (
  platform_key text references platforms,
  source_metric text not null,          -- exact name in platform API, e.g. 'total_interactions'
  api_version text,                     -- e.g. Graph API 'v23.0'
  metric_key text references metric_definitions,
  scope metric_scope not null,
  comparability_class text not null,    -- see 5.4
  notes text,
  primary key (platform_key, source_metric, scope)
);
```

`platform_metric_map` is data, not code, so the UI can explain "Instagram `views` → Scopie `views` (class: `meta_views`)".

### 5.2 Posts

```sql
create table posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_account_id uuid not null references social_accounts on delete cascade,
  platform_key text not null,
  external_id text not null,
  permalink text,
  published_at timestamptz not null,
  native_type text,                      -- platform's own type: 'REELS','CAROUSEL_ALBUM','IMAGE','VIDEO','link','short'…
  format_id uuid references content_formats,   -- Scopie's normalized format (Reel, Carousel, Static, Short video…)
  caption text,
  language text,
  content_item_id uuid references content_items on delete set null,  -- link back to planned content
  data_source data_source not null,
  created_at timestamptz default now(),
  unique (social_account_id, external_id)
);

create table post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts on delete cascade,
  organization_id uuid not null,
  position int not null, media_type text, thumbnail_url text, duration_seconds numeric
);

create table post_tags (                 -- metadata for content intelligence
  post_id uuid references posts on delete cascade,
  organization_id uuid not null,
  tag_type text not null,                -- 'pillar','campaign','audience','topic','cta'
  tag_id uuid,                           -- fk resolved by tag_type (pillar/campaign/audience/topic)
  value text,                            -- for free-text tags like CTA
  source text not null,                  -- 'content_item','manual','ai_suggested'
  primary key (post_id, tag_type, coalesce(tag_id::text, value))
);
```

(The last `primary key` is illustrative; implemented as a unique index on the expression.)

### 5.3 Metric snapshots (append-only facts)

```sql
create table post_metric_snapshots (
  id bigint generated always as identity,
  organization_id uuid not null,
  post_id uuid not null references posts on delete cascade,
  metric_key text not null references metric_definitions,
  source_metric text not null,           -- exact platform name
  value numeric,                         -- null = requested but not returned
  availability text not null,            -- 'available','unavailable','not_supported','permission_missing','error'
  data_source data_source not null,
  metric_date date,                      -- for daily-breakdown metrics; null for lifetime
  period text not null,                  -- 'lifetime','day','week','28d'
  captured_at timestamptz not null,
  sync_run_id uuid,
  primary key (post_id, captured_at, metric_key, id)
);

create table account_metric_snapshots (
  id bigint generated always as identity,
  organization_id uuid not null,
  social_account_id uuid not null references social_accounts on delete cascade,
  metric_key text not null references metric_definitions,
  source_metric text not null,
  value numeric,
  availability text not null,
  data_source data_source not null,
  metric_date date not null,
  period text not null,
  captured_at timestamptz not null,
  sync_run_id uuid,
  primary key (social_account_id, metric_date, metric_key, id)
);
```

Every row records source platform (via account/post), source metric, normalized metric, collection time, metric date, data source and availability, as required.

Why snapshots: post metrics keep growing for days after publishing. Re-capturing lets us show "engagement at 7 days" fairly across posts of different ages and keeps history if a platform later changes or removes a metric.

### 5.4 Comparability

Each mapped metric has a `comparability_class`. Two values may be compared or summed only if their classes match. Examples:

| Class                   | Includes                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `count_followers`       | IG followers, FB page followers, LinkedIn followers, YouTube subscribers (labelled "Audience size") |
| `reach_unique_accounts` | IG reach, FB reach (Meta definition: unique accounts)                                               |
| `meta_views`            | IG/FB `views` (Meta's 2025+ unified views definition)                                               |
| `youtube_views`         | YouTube views                                                                                       |
| `interactions_meta`     | likes+comments+shares+saves on Meta                                                                 |

The analytics layer (`lib/analytics/comparability.ts`) checks classes before any cross-platform aggregate. Mixed classes → the metric is shown per platform or "Not comparable".

### 5.5 Rollups (what the UI reads)

```sql
create table post_latest_metrics (       -- one row per post, latest value of each key, wide
  post_id uuid primary key references posts on delete cascade,
  organization_id uuid not null,
  social_account_id uuid not null,
  published_at timestamptz not null,
  reach numeric, impressions numeric, views numeric, likes numeric, reactions numeric,
  comments numeric, shares numeric, saves numeric, clicks numeric, link_clicks numeric,
  video_views numeric, watch_time_seconds numeric, avg_watch_duration_seconds numeric,
  engagements numeric,                   -- sum of available interactions, per platform definition
  engagement_rate_reach numeric,         -- engagements / reach * 100, null if reach null
  data_source data_source not null,
  updated_at timestamptz not null
);

create table account_daily_stats (
  social_account_id uuid not null,
  organization_id uuid not null,
  stat_date date not null,
  followers numeric, follower_delta numeric,
  reach numeric, impressions numeric, views numeric, profile_views numeric,
  posts_published int, engagements numeric,
  data_source data_source not null,
  primary key (social_account_id, stat_date)
);
```

Derived metrics (engagement rate, follower growth %) are computed in **one** place: SQL functions mirrored by `lib/analytics` unit tests that assert both give the same result.

## 6. Content, approvals, strategy

```sql
create table content_pillars (id uuid pk, organization_id uuid, name text, description text, color text, archived_at timestamptz);
create table content_formats (id uuid pk, organization_id uuid, name text, platform_key text null, native_types text[]);
create table campaigns       (id uuid pk, organization_id uuid, name text, starts_on date, ends_on date, objective text);
create table audiences       (id uuid pk, organization_id uuid, name text, description text);
create table topics          (id uuid pk, organization_id uuid, name text);

create type content_status as enum
 ('IDEA','DRAFT','IN_REVIEW','CHANGES_REQUESTED','APPROVED','SCHEDULED','PUBLISHED','ANALYSED','REJECTED','ARCHIVED');

create table content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  status content_status not null default 'IDEA',
  current_version_id uuid,               -- fk to content_versions, set after insert
  owner_user_id uuid references profiles,
  country_code char(2), platform_keys text[] not null default '{}',
  pillar_id uuid, format_id uuid, campaign_id uuid, audience_id uuid,
  strategy_objective_id uuid,
  source_recommendation_id uuid,         -- if created from an AI recommendation
  planned_publish_at timestamptz, published_at timestamptz,
  created_by uuid, created_at timestamptz default now(), updated_at timestamptz
);

create table content_versions (          -- immutable once submitted
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_item_id uuid not null references content_items on delete cascade,
  version_number int not null,
  description text, caption text, cta text, hashtags text[], notes text,
  created_by uuid, created_at timestamptz default now(),
  submitted_at timestamptz,              -- after this, row is read-only (trigger enforced)
  unique (content_item_id, version_number)
);

create table content_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_version_id uuid not null references content_versions on delete cascade,
  storage_path text not null, mime_type text not null, bytes bigint not null,
  width int, height int, duration_seconds numeric, position int
);

create table content_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_item_id uuid not null references content_items on delete cascade,
  content_version_id uuid references content_versions,
  parent_id uuid references content_comments,
  author_id uuid not null, body text not null,
  mentions uuid[] not null default '{}',
  resolved_at timestamptz, created_at timestamptz default now()
);

create type review_decision as enum ('APPROVED','CHANGES_REQUESTED','REJECTED','COMMENTED');

create table content_reviews (           -- append-only approval history
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_item_id uuid not null references content_items on delete cascade,
  content_version_id uuid not null references content_versions,
  reviewer_id uuid not null,
  decision review_decision not null,
  comment text,
  step int not null default 1,           -- future multi-step approvals
  created_at timestamptz default now()
);
```

Status transitions are enforced by `lib/approvals/state-machine.ts` and mirrored by a DB trigger so no client can skip states.

| From                                 | To                                        | Who                                                             |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------------------------- |
| IDEA                                 | DRAFT                                     | EDITOR+                                                         |
| DRAFT / CHANGES_REQUESTED            | IN_REVIEW (submits a version)             | EDITOR+ (owner)                                                 |
| IN_REVIEW                            | APPROVED / CHANGES_REQUESTED / REJECTED   | MANAGER+, not the version's author unless ADMIN+ (configurable) |
| APPROVED                             | SCHEDULED                                 | EDITOR+                                                         |
| APPROVED / SCHEDULED                 | PUBLISHED (link post)                     | EDITOR+                                                         |
| PUBLISHED                            | ANALYSED (auto after N days with metrics) | system                                                          |
| any non-terminal                     | ARCHIVED                                  | ADMIN+ or owner                                                 |
| APPROVED / SCHEDULED, content edited | DRAFT (new version; approval invalidated) | EDITOR+                                                         |

Strategy:

```sql
create table strategies (id uuid pk, organization_id uuid, name text, period_start date, period_end date,
  tone_of_voice text, priorities text[], status text);
create table strategy_scopes     (strategy_id uuid, country_code char(2) null, account_group_id uuid null);
create table strategy_audiences  (strategy_id uuid, audience_id uuid);
create table strategy_objectives (id uuid pk, strategy_id uuid, organization_id uuid, name text,
  kpi_metric_key text references metric_definitions, target_value numeric, target_period text);
create table strategy_pillars    (strategy_id uuid, pillar_id uuid, target_share numeric);  -- % of output
create table strategy_platforms  (strategy_id uuid, platform_key text);
create table strategy_competitors(strategy_id uuid, social_account_id uuid);
```

## 7. Permission matrix

| Action                                        | VIEWER | EDITOR | MANAGER | ADMIN |      OWNER       |
| --------------------------------------------- | :----: | :----: | :-----: | :---: | :--------------: |
| View analytics, content, reports              |   ✓    |   ✓    |    ✓    |   ✓   |        ✓         |
| Create/edit content, comment                  |        |   ✓    |    ✓    |   ✓   |        ✓         |
| Approve / request changes / reject            |        |        |    ✓    |   ✓   |        ✓         |
| Manage strategy, benchmarks, taxonomy         |        |        |    ✓    |   ✓   |        ✓         |
| Add accounts, connect platforms, trigger sync |        |        |         |   ✓   |        ✓         |
| Manage members and roles                      |        |        |         |   ✓   | ✓ (incl. owners) |
| Delete organization, transfer ownership       |        |        |         |       |        ✓         |

## 8. Benchmarks, sync, AI, reports, system

```sql
create table benchmark_groups (id uuid pk, organization_id uuid, name text, description text, platform_key text null);
create table benchmark_group_members (group_id uuid, social_account_id uuid, primary key (group_id, social_account_id));

create type sync_status as enum ('queued','running','succeeded','partial','failed','cancelled');
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_account_id uuid, connection_id uuid, platform_key text not null,
  job_type text not null,                -- 'profile','posts_incremental','posts_backfill','metrics_refresh'
  trigger text not null,                 -- 'schedule','manual','retry'
  status sync_status not null,
  started_at timestamptz, completed_at timestamptz,
  records_processed int default 0, records_failed int default 0,
  cursor jsonb,                          -- incremental sync position
  error_code text, error_message text,   -- never contains tokens
  retry_count int default 0, triggered_by uuid
);
create table sync_run_events (id bigint identity pk, sync_run_id uuid, organization_id uuid,
  level text, code text, message text, context jsonb, created_at timestamptz);
create table raw_payloads (id bigint identity pk, organization_id uuid, sync_run_id uuid,
  endpoint text, payload jsonb, captured_at timestamptz);   -- retention job deletes > 30 days

create table ai_generations (            -- audit of every model call
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  purpose text not null,                 -- 'insights','recommendations','report','chat','assistant'
  provider text not null, model text not null,
  prompt_version text not null,
  input_digest jsonb not null,           -- the structured facts sent (no secrets)
  output jsonb, tokens_in int, tokens_out int, cost_usd numeric,
  status text not null, error text,
  requested_by uuid, created_at timestamptz default now()
);
create table ai_insights (id uuid pk, organization_id uuid, generation_id uuid, period_start date, period_end date,
  kind text, title text, body text, severity text, evidence jsonb not null, status text, created_at timestamptz);
create table ai_recommendations (id uuid pk, organization_id uuid, generation_id uuid, insight_id uuid null,
  title text, observation text, evidence jsonb not null, recommendation text, expected_impact text,
  confidence text, relevant_account_ids uuid[], suggested_experiment jsonb,
  status text default 'open',            -- open, accepted, dismissed, done
  decided_by uuid, decided_at timestamptz, created_at timestamptz);

create table reports (id uuid pk, organization_id uuid, kind text, period_start date, period_end date,
  title text, status text, generation_id uuid, data_snapshot jsonb, created_by uuid, created_at timestamptz);
create table report_sections (id uuid pk, report_id uuid, organization_id uuid, position int,
  kind text, title text, body jsonb);

create table notifications (id uuid pk, organization_id uuid, user_id uuid, kind text, payload jsonb,
  read_at timestamptz, created_at timestamptz);
create table activity_log (id bigint identity pk, organization_id uuid, actor_id uuid, action text,
  entity_type text, entity_id uuid, diff jsonb, created_at timestamptz);
```

## 9. Indexing and scale plan

- `posts (organization_id, published_at desc)`, `posts (social_account_id, published_at desc)`.
- `post_latest_metrics (organization_id, published_at desc)` + partial indexes on common sorts.
- `account_daily_stats (organization_id, stat_date)`.
- Snapshot tables: BRIN on `captured_at` (cheap, fits append-only); convert to monthly partitions when > ~50M rows.
- `post_tags (organization_id, tag_type, tag_id)` for content-intelligence filters.
- `content_items (organization_id, status, planned_publish_at)` for calendar and queue.
- Every RLS policy column (`organization_id`) indexed.

## 10. Seed data

`supabase/seed/` creates an org "CANNA (DEMO)" with fictional accounts — CANNA Netherlands, Germany, Spain, France, Italy, UK — across Instagram, Facebook, LinkedIn, YouTube, plus two fictional competitors. Generated 180 days of posts and metrics with realistic skew (log-normal engagement, a few outliers, weekly seasonality), content items in every status, an approval history with three versions, one strategy per market, and sample insights. **Every seeded row has `data_source = 'demo'`** and every seeded account name ends with "(DEMO)".
