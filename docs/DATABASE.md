# Scopie — Database Design

> PostgreSQL on Supabase. Status: §3, §4, §5 and §8.1–8.2 are implemented (Phases 1, 2 and 3); §6 and §8.3 are the target design for later phases. Last updated: 2026-10-07

## 0. What is implemented

Migrations:

- `supabase/migrations/20261006000100_tenancy_and_roles.sql` and `…000200_social_accounts.sql` (Phase 1, Foundation)
- `supabase/migrations/20261007000100_data_pipeline.sql` (Phase 2, Real social data pipeline)
- `supabase/migrations/20261008000100_public_intelligence.sql` (Phase 3, Public profile intelligence)

Phase 1:

| Table                                     | Notes                                                                                                                                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissions`, `role_permissions`         | Permission matrix as data (§7). Read-only for users.                                                                                                                                                                                |
| `profiles`                                | Created by trigger on sign-up; stores `email` (mirrors auth, not user-editable), `full_name`, `timezone`. Visible to yourself and people who share an organization.                                                                 |
| `organizations`                           | Created only through `create_organization()` (makes the caller OWNER). `is_demo` flags demo orgs; only demo orgs may hold `demo` data (§5.5).                                                                                       |
| `organization_members`                    | Role per user. Only OWNERs grant/change/remove OWNER. An organization always keeps one owner, except when an owner's whole user account is deleted (the organization is then left ownerless and must be reassigned by an operator). |
| `platforms`, `countries`                  | Global reference data (8 platforms; ~55 ISO countries).                                                                                                                                                                             |
| `social_accounts`                         | §4. Users can't set connection fields (trigger). No direct delete: deactivate, or remove with all its data through `remove_profile_and_data()` (§8.2). Owner must be a member. Unique handle per org+platform (case-insensitive).   |
| `account_groups`, `account_group_members` | `kind` is `region` or `custom` (country uses the account column). No UI yet.                                                                                                                                                        |
| `activity_log`                            | Written by triggers on accounts, memberships, organization updates, platform connections and import batches.                                                                                                                        |

Phase 2:

| Table / object                                                              | Section |
| --------------------------------------------------------------------------- | ------- |
| `platform_account_types`, `platforms.reporting_timezone`                    | §4      |
| `platform_connections`, `connection_credentials`, `connection_assets`       | §4.1    |
| `metric_definitions`, `platform_metric_map`                                 | §5.1    |
| `posts`, `post_media`, `post_audiences`                                     | §5.2    |
| `content_pillars`, `content_formats`, `campaigns`, `audiences`, `cta_types` | §5.3    |
| `post_metric_snapshots`, `account_metric_snapshots`                         | §5.4    |
| Views `post_metrics_latest`, `post_metrics_at_age`, `account_metrics_daily` | §5.7    |
| `import_batches`                                                            | §5.8    |
| `sync_state`, `sync_runs`, `sync_run_events`, `raw_payloads`                | §8.1    |
| RPCs `link_connection_asset`, `unlink_social_account`, …                    | §8.2    |

Phase 3:

| Table / object                                                                                                                          | Section    |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `data_source` replaced: `live_public`, `live_connected`, `imported`, `estimated`, `demo`                                                | §5.5       |
| `metric_availability` + `hidden_by_owner`, `not_public`; `sync_job_type` + three public jobs                                            | §5.4, §8.1 |
| `platforms.public_data_status`, `private_data_status` (replace `connector_status`)                                                      | §4         |
| `social_accounts.business_role`, `access_type` (derived by trigger), observation dates (replace `is_competitor`, `primary_data_source`) | §4         |
| `profile_snapshots`                                                                                                                     | §4.2       |
| `public_data_viewers`, `public_profile_lookups`                                                                                         | §4.3       |
| `posts.hashtags` (from the caption)                                                                                                     | §5.2       |
| Metrics `following`, `posts_total`, `public_engagement`; Business Discovery rows in `platform_metric_map`                               | §5.1, §5.6 |
| Read models return one row per data source                                                                                              | §5.7       |
| RPCs `set_public_data_viewer`, `clear_public_data_viewer`, `remove_profile_and_data`; new `request_sync`, `link_connection_asset`       | §8.2       |

Existing data was migrated in place: `authenticated` → `live_connected`, `public` → `live_public`,
`manual` → `imported`; `is_competitor = true` → `competitor`, otherwise `owned`.

Not yet created: invitations, notifications, everything content/approval/strategy beyond the minimal taxonomy (§6), benchmarks, AI and reports (§8.3).

How data moves through these tables end to end (sync schedule, failure handling) is in [DATA_PIPELINE.md](DATA_PIPELINE.md); what each metric means is in [METRICS.md](METRICS.md).

## 1. Conventions

- Primary keys: `id uuid default gen_random_uuid()` (fact tables use `bigint generated always as identity`).
- Every tenant-owned table has `organization_id uuid not null references organizations(id) on delete cascade` (or a composite FK that implies it), and RLS enabled.
- Child rows reference their parent with a **composite FK `(parent_id, organization_id)`** against a `unique (id, organization_id)` on the parent, so a row can never point at another organization's data.
- Timestamps: `created_at timestamptz default now()`, `updated_at timestamptz` (trigger-maintained). All stored in UTC; display converts to the account's or org's timezone.
- Enumerations: Postgres `enum` types for stable state machines (status, role, availability, data source); lookup tables for user-editable taxonomies (pillars, formats, campaigns).
- Soft delete only where history matters (deactivate accounts, `removed_at` on posts); otherwise hard delete with cascades.
- Metric values: `numeric`, never negative, never a stand-in zero for a missing value.
- Raw platform payloads: `jsonb`, in `raw_payloads`, so hot tables stay narrow.
- Fields only trusted server code may set are protected by `before insert/update` triggers that check `is_end_user()`; the service role (sync worker, OAuth callback, seed script) bypasses them.

## 2. Entity overview

```
organizations ─┬─ organization_members ── auth.users (profiles)
               ├─ account_groups ── account_group_members ─┐
               ├─ platform_connections ─┬─ connection_credentials (service-role only)
               │                        └─ connection_assets ──(linked_account_id)──┐
               │                                 └─ public_data_viewers (one per org + platform)
               ├─ social_accounts ──────────────────────────────────────────────────┘
               │     ├─ account_metric_snapshots
               │     ├─ profile_snapshots
               │     ├─ sync_state, sync_runs ── sync_run_events, raw_payloads
               │     ├─ import_batches
               │     └─ posts ─┬─ post_media
               │               ├─ post_audiences ── audiences
               │               ├─ post_metric_snapshots
               │               └─ pillar / campaign / content_format / cta_type (FK columns)
               ├─ content_pillars, content_formats, campaigns, audiences, cta_types
               ├─ public_profile_lookups (service-role only)
               └─ activity_log

Global (not tenant-owned): platforms, platform_account_types, countries,
                           metric_definitions, platform_metric_map
Read models (views): post_metrics_latest, post_metrics_at_age, account_metrics_daily

Planned: invitations, content_items/versions/reviews, strategies, benchmark_groups,
         ai_generations/insights/recommendations, reports, notifications
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

create table invitations (             -- planned, not yet created
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
create type platform_data_status as enum ('available','planned','not_available');

create table platforms (                -- global, seeded
  key text primary key,                 -- 'instagram','facebook','linkedin','youtube','tiktok','x','reddit','discord'
  name text not null,
  public_data_status platform_data_status not null default 'planned',   -- read without the owner's login
  private_data_status platform_data_status not null default 'planned',  -- read through OAuth
  reporting_timezone text,              -- calendar the platform's daily numbers use
  sort_order int not null default 100
);

create table platform_account_types (   -- global, seeded: which account types each platform has
  platform_key text references platforms on delete cascade,
  key text not null,                    -- 'business','creator','page','company_page','channel','community',…
  label text not null,
  primary key (platform_key, key)
);

create table countries (code char(2) primary key, name text not null);  -- ISO 3166-1

create type account_connection_status as enum
  ('not_connected','connected','needs_reauth','error','demo');
create type data_source as enum
  ('live_public','live_connected','imported','estimated','demo');
create type business_role as enum ('owned','competitor','industry','influencer','other');
create type profile_access_type as enum ('public','connected','imported','demo');

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  platform_key text not null references platforms,
  display_name text not null, handle text,
  external_id text,                     -- platform's account/page/channel id
  account_type text,                    -- FK (platform_key, account_type) → platform_account_types
  country_code char(2) references countries,
  language text,                        -- BCP 47
  timezone text,
  owner_user_id uuid references profiles,
  business_role business_role not null default 'owned',   -- why CANNA tracks it; set by the user
  access_type profile_access_type not null default 'imported',  -- how Scopie gets data; set by trigger
  is_active boolean not null default true,
  connection_status account_connection_status not null default 'not_connected',
  last_successful_sync_at timestamptz,  -- last successful connected sync
  last_sync_attempt_at timestamptz,     -- last run of any job
  first_observed_at timestamptz,        -- first public observation, or when it was connected
  last_observed_at timestamptz,         -- latest public observation
  earliest_post_at timestamptz,         -- public backfill finished: every post since then is stored
  history_available_from date,          -- oldest post the connected backfill reached
  connection_id uuid references platform_connections on delete set null,
  notes text, created_by uuid, created_at timestamptz, updated_at timestamptz,
  unique (id, organization_id),
  unique (id, organization_id, platform_key)
);
```

- **Data status mirrors code.** `lib/platforms/registry.ts` is the source of truth: `PUBLIC_DATA_PLATFORMS` (Instagram) has `public_data_status = 'available'`, `CONNECTED_PLATFORMS` (Instagram, Facebook) has `private_data_status = 'available'`. YouTube is `planned` for both; Facebook public data is `planned`; LinkedIn, TikTok, X and Discord are `not_available` for public data. An integration test asserts code and table match. There is no `demo` platform: demo data is a data source, not a platform.
- **Business role and access type are separate.** `business_role` is what the user picks. `access_type` is always derived by the `social_accounts_derive_access` trigger on every insert and update: a demo organization → `demo`; a linked connection → `connected`; a platform with public data → `public`; otherwise `imported`. Users can't set it.
- **Reporting timezone.** Instagram, Facebook and YouTube report daily values on Pacific time (`America/Los_Angeles`). For Meta, a daily value's report date is its `end_time` minus 12 hours (`metaReportDate()` in `lib/platforms/meta/shared.ts`), which lands inside the reported day in both PST and PDT.
- **Account types** are validated per platform by the FK to `platform_account_types`, so an Instagram account can't be typed `page`.
- **Protected fields.** A trigger stops users from setting `connection_status`, `last_successful_sync_at`, `last_sync_attempt_at`, `first_observed_at`, `last_observed_at`, `earliest_post_at`, `history_available_from`, `connection_id` and `created_by`. Once an account is connected or observed, users also can't change its `external_id` or `platform_key`; once observed, not its `handle` either. Its identity comes from the platform. An account becomes connected only through `link_connection_asset()` (§8.2), and only if it is `owned`.
- **Identity check.** The first public observation stores the platform's account id in `external_id`. Later observations compare it; if the handle now belongs to another account, the run fails with `profile_changed` and nothing is stored.
- Unique `(organization_id, platform_key, lower(handle))` and `(organization_id, platform_key, external_id)`, both partial (when not null). No delete policy: accounts are deactivated so history survives, or removed with all their data through `remove_profile_and_data()`.

Country is a column (every account has exactly one) **and** groups exist for regions and custom sets. "Country vs country" uses the column; "region vs region" uses groups.

### 4.1 Connections and credentials

One OAuth grant covers several accounts (one Meta login → many Pages and Instagram accounts), so connections are separate from accounts.

```sql
create type connection_status as enum ('active','needs_reauth','revoked','error');

create table platform_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  provider text not null,               -- 'meta','google','linkedin','tiktok','x','reddit','discord'
  external_user_id text not null,       -- the authorizing platform user
  display_name text,
  status connection_status not null default 'active',
  scopes text[] not null default '{}',  -- permissions actually granted
  token_expires_at timestamptz, last_refreshed_at timestamptz, last_error text,
  connected_by uuid references profiles on delete set null,
  created_at timestamptz, updated_at timestamptz,
  unique (organization_id, provider, external_user_id),
  unique (id, organization_id)
);

create table connection_credentials (   -- no RLS policies, all grants revoked: service role only
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null, organization_id uuid not null,   -- FK → platform_connections, cascade
  asset_external_id text,               -- null = the user token; else the asset (Facebook Page) it belongs to
  ciphertext text not null,             -- "v<keyVersion>:<iv>:<tag>:<ciphertext>", AES-256-GCM
  key_version int not null,
  expires_at timestamptz,
  updated_at timestamptz
);  -- unique (connection_id, asset_external_id) nulls not distinct

create table connection_assets (        -- accounts the connection can see
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null, connection_id uuid not null,   -- FK → platform_connections, cascade
  platform_key text not null references platforms,
  external_id text not null, name text, handle text, account_type text,
  parent_external_id text,              -- e.g. the Facebook Page an Instagram account is linked to
  linked_account_id uuid references social_accounts on delete set null,
  discovered_at timestamptz,
  unique (connection_id, platform_key, external_id)
);
```

Members can read `platform_connections` and `connection_assets` (never tokens); only the service role writes them. Tokens are encrypted by `lib/crypto/tokens.ts` with `SCOPIE_ENCRYPTION_KEY`, which never touches the database; `key_version` allows key rotation. Instagram accounts use the token of the Page they are linked to, so only the user token and one token per Page are stored. See [API_INTEGRATIONS.md](API_INTEGRATIONS.md) §3.

### 4.2 Profile snapshots

```sql
create table profile_snapshots (        -- append-only; a new row only when something changed
  id bigint generated always as identity primary key,
  organization_id uuid not null, social_account_id uuid not null,  -- FK → social_accounts, cascade
  observed_at timestamptz not null,
  data_source data_source not null,
  username text, display_name text, biography text, website text,
  profile_picture_url text, account_type text,
  sync_run_id uuid references sync_runs on delete set null
);
```

The daily public observation writes a row when the username, display name, bio or website changed, or
when a profile picture appeared or disappeared (picture URLs are signed and change daily, so a new URL
alone doesn't count). So the table stays small and shows when a profile was edited. Members read;
only the service role writes.

### 4.3 Viewer account and lookups

```sql
create table public_data_viewers (      -- the account public data is requested through
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations on delete cascade,
  platform_key text not null references platforms,
  connection_asset_id uuid not null references connection_assets on delete cascade,
  created_by uuid references profiles on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, platform_key)
);

create table public_profile_lookups (   -- service role only; counts add-profile previews
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations on delete cascade,
  requested_by uuid references profiles on delete set null,
  platform_key text not null references platforms,
  looked_up_at timestamptz not null default now()
);
```

- `public_data_viewers`: one viewer per organization and platform. Members read it; it is written only
  through `set_public_data_viewer()` and `clear_public_data_viewer()` (§8.2). Changes go to the
  activity log. Removing the connection asset removes the viewer.
- `public_profile_lookups`: one row per add-profile preview, so an organization gets at most 30 an
  hour (`LOOKUPS_PER_HOUR` in `lib/public-data/shared.ts`). Nothing about the looked-up profile is
  kept. No user role can read or write it.

## 5. Universal social data model

The rules below are enforced in the database, not only in `lib/ingest/ingest.ts` (the single write path for sync, CSV import and the demo generator), so a bug in one writer can't store bad data.

### 5.1 Metric dictionary (global)

```sql
create type metric_unit        as enum ('count','percent','seconds');
create type metric_aggregation as enum ('sum','last','recompute','not_additive');
create type metric_scope       as enum ('account','post');

create table metric_definitions (
  key text primary key,                 -- 'followers','reach','views','interactions','engagement_rate_reach', …
  label text not null,
  definition text not null,             -- shown in UI tooltips
  unit metric_unit not null,
  aggregation metric_aggregation not null,   -- how values combine across days/posts/accounts
  higher_is_better boolean not null,
  applies_to_accounts boolean not null, applies_to_posts boolean not null,
  is_derived boolean not null default false,
  formula text,                         -- required when derived
  inputs text[] not null default '{}',
  sort_order int not null
);

create table platform_metric_map (
  platform_key text references platforms,
  scope metric_scope not null,
  source_metric text not null,          -- exact platform name, e.g. 'total_interactions', 'saved'
  metric_key text not null references metric_definitions,
  comparability_class text not null,    -- see 5.6
  api_version text,
  value_transform text,                 -- null or 'ms_to_seconds'
  notes text,
  primary key (platform_key, scope, source_metric)
);
```

26 metrics are seeded (Phase 3 added `following`, `posts_total` and the derived `public_engagement`). `lib/metrics/registry.ts` mirrors both tables (`METRIC_DEFINITIONS`, `PLATFORM_METRIC_MAP`); an integration test asserts they match. Both are read-only for users. The full dictionary is in [METRICS.md](METRICS.md).

**Derived metrics are computed, never stored.** `follower_change`, `follower_growth_rate`, `posts_published`, `public_engagement` and the three engagement rates are `is_derived`; the snapshot trigger rejects them. Reach is `not_additive`: it can't be summed across days, posts or accounts.

### 5.2 Posts

```sql
create type media_format    as enum ('image','carousel','short_video','long_video','video','text','link','story','live','other');
create type tag_source      as enum ('content_item','manual','imported','ai_suggested','ai_confirmed');
create type language_source as enum ('declared','account_default','detected');

create table posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_account_id uuid not null, platform_key text not null,  -- FK (id, org, platform) → social_accounts
  external_id text not null,
  permalink text,
  published_at timestamptz not null,
  published_local_date date not null,   -- set by trigger in the account's (or org's) timezone
  media_format media_format not null default 'other',   -- objective format, from the platform
  native_type text,                     -- platform's own type, e.g. 'REELS/VIDEO', 'added_video'
  caption text, caption_updated_at timestamptz,
  language text, language_source language_source,
  country_code char(2) references countries,           -- defaults to the account's country
  content_format_id uuid, content_format_source tag_source,  -- editorial format (org taxonomy)
  pillar_id uuid,   pillar_source tag_source,
  campaign_id uuid, campaign_source tag_source,
  cta_type_id uuid, cta_text text, cta_source tag_source,
  is_paid boolean,                      -- null = unknown
  is_shared_post boolean not null default false,   -- e.g. an Instagram collab post on two accounts
  removed_at timestamptz,
  data_source data_source not null,
  import_batch_id uuid,
  hashtags text[] not null default '{}',   -- from the caption, lower-cased; set by trigger
  first_fetched_at timestamptz, last_fetched_at timestamptz, last_metrics_at timestamptz,
  created_at timestamptz, updated_at timestamptz,
  unique (social_account_id, external_id),
  unique (id, organization_id)
);

create table post_media (               -- carousel children etc.; written only by the server
  id uuid primary key, organization_id uuid not null, post_id uuid not null,
  position int not null, media_type text not null, external_id text,
  duration_seconds numeric, width int, height int,
  unique (post_id, position)
);

create table post_audiences (           -- many-to-many: a post can target several audiences
  post_id uuid, audience_id uuid, organization_id uuid not null,
  source tag_source not null default 'manual',
  primary key (post_id, audience_id)
);
```

- Posts store their **own** country and language, so moving an account to another market later doesn't rewrite history. The trigger fills them from the account when not given (`language_source = 'account_default'`).
- `media_format` (what the platform says it is) is separate from `content_format_id` (the team's editorial format, e.g. "Product demo").
- Pillar, campaign, CTA, content format and audiences are real FK columns (composite with `organization_id`), each with a `*_source` saying who set it.
- **Users may only tag posts** (`content.edit`, EDITOR+). On update, the trigger keeps every platform field (caption, dates, format, source…) and sets the changed tag's source to `manual`. Users can insert posts only as `imported`, and can't delete posts (except through `remove_profile_and_data()`).
- **Hashtags** are extracted from the caption by the trigger (`extract_hashtags()`), so they always match it. A GIN index supports hashtag queries.
- `first_fetched_at` is when Scopie first saw the post; it never changes. A post found by a backfill was already old when found.

### 5.3 Minimal content taxonomy

`content_pillars`, `content_formats`, `campaigns` (+ `starts_on`, `ends_on`), `audiences` and `cta_types`: each is `(id, organization_id, name, description, is_active, created_at)` with a case-insensitive unique name per org. Members read; `strategy.manage` (MANAGER+) writes; no deletes (deactivate). The full content hub (§6) builds on these.

### 5.4 Metric snapshots (append-only facts)

```sql
create type metric_availability as enum
  ('available','not_permitted','not_applicable','pending','error','hidden_by_owner','not_public');
create type metric_period       as enum ('lifetime','day');

create table post_metric_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null, post_id uuid not null,   -- FK (post_id, org) → posts, cascade
  metric_key text not null references metric_definitions,
  source_metric text not null,          -- exact platform name
  value numeric,                        -- set only when available; never negative
  availability metric_availability not null,
  data_source data_source not null,
  period metric_period not null default 'lifetime',
  metric_date date,                     -- required for 'day', null for 'lifetime'
  captured_at timestamptz not null,
  post_age_hours int not null,          -- set by trigger: captured_at − published_at
  sync_run_id uuid references sync_runs on delete set null,
  import_batch_id uuid,
  created_at timestamptz
);  -- unique (post_id, metric_key, period, metric_date, captured_at) nulls not distinct

create table account_metric_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null, social_account_id uuid not null,
  metric_key text not null references metric_definitions,
  source_metric text not null,
  value numeric, availability metric_availability not null,
  data_source data_source not null,
  period metric_period not null,        -- 'day' = value for metric_date; 'lifetime' = running total as of metric_date
  metric_date date not null,
  captured_at timestamptz not null,
  sync_run_id uuid, import_batch_id uuid, created_at timestamptz
);  -- unique (social_account_id, metric_key, period, metric_date, captured_at)
```

- **Narrow rows**: one metric per row, so a new metric needs no schema change.
- **Value and availability agree**: a check constraint requires `value is not null` exactly when `availability = 'available'`. A metric the platform didn't return is a row with a reason, never a zero.
- **Duplicate guard**: the unique indexes above make re-running a batch with the same `captured_at` a no-op (ingest uses `on conflict do nothing`).
- **Append-only**: users may insert (imports) but nobody may update or delete through the API.
- The guard trigger rejects derived metrics, post-only metrics on accounts (and vice versa), and snapshots captured before the post was published; it sets `post_age_hours`.

Why snapshots: post metrics keep growing for days after publishing. Capturing at fixed ages (1, 2, 3, 7, 14, 30, 90 days, see DATA_PIPELINE.md) lets us show "reach at 7 days" fairly across posts of different ages, and keeps history if a platform later changes or removes a metric.

### 5.5 Data source rules

Every post, snapshot and profile snapshot carries `data_source` (UI labels: `live_public` → **PUBLIC**, `live_connected` → **CONNECTED**, `imported` → **IMPORTED**, `estimated` → **ESTIMATED**, `demo` → **DEMO**). `check_fact_source()`, called from the post and snapshot triggers, enforces:

| Rule                                                                       | Error   |
| -------------------------------------------------------------------------- | ------- |
| `demo` only in organizations with `is_demo = true`                         | `42501` |
| A demo organization holds only `demo` or `imported` data                   | `42501` |
| `live_connected` only for accounts with a `connection_id`                  | `42501` |
| `live_public` only on a platform with `public_data_status = 'available'`   | `42501` |
| `imported` requires an `import_batch_id`                                   | `23514` |
| Users (not the service role) may write only `imported`                     | `42501` |
| Value present ⇔ `availability = 'available'` (check constraint, snapshots) | `23514` |

So signed-in users can never write PUBLIC or CONNECTED data; only the sync worker can. Nothing writes `estimated` yet. A post first stored from an import keeps its row when an API later returns it; the source rules are checked again when its `data_source` changes.

### 5.6 Comparability

Each mapped metric has a `comparability_class`. Two values may be compared or summed only if their classes match. Classes in use:

| Class                                                       | Includes                                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `audience_size`                                             | Instagram `followers_count` (insights and Business Discovery), Facebook Page `followers_count`                 |
| `posts_total`                                               | Instagram `media_count` (Business Discovery)                                                                   |
| `ig_public_reel_views`                                      | Instagram `view_count` (Business Discovery). Reels only, includes paid views; never compared with `meta_views` |
| `meta_reach`                                                | Instagram `reach`, Facebook `page_impressions_unique` / `post_impressions_unique`                              |
| `meta_views`                                                | Instagram `views` (account and post)                                                                           |
| `meta_interactions`                                         | Instagram `total_interactions`                                                                                 |
| `likes`, `comments`, `shares`                               | Instagram likes/comments/shares (insights and Business Discovery); Facebook comments/shares                    |
| Platform-specific (`ig_*`, `fb_*`, `meta_followers_gained`) | Comparable only within that platform                                                                           |

A metric with no mapping (e.g. imported LinkedIn numbers) gets the class `<platform>:<metric>`, so it is only comparable within its own platform (`comparabilityClass()` in `lib/metrics/registry.ts`). The analytics layer (`lib/analytics`) compares two values only when they share metric key, comparability class and data source; see [METRICS.md](METRICS.md).

### 5.7 Read models

Views (`security_invoker`, so RLS applies) over the snapshot tables. Each returns one row per data source and exposes `data_source`, so public and connected values never mix. At scale they become incrementally refreshed tables (§9).

| View                    | Returns                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `post_metrics_latest`   | Latest lifetime value of each metric per post and data source.                                                                                                               |
| `post_metrics_at_age`   | Value of each lifetime metric at post ages 1, 2, 3, 7, 14, 30, 90 days: the snapshot nearest the target age within ±15% (at least ±6 h). No snapshot in the window = no row. |
| `account_metrics_daily` | Latest captured value per account, metric, period, data source and date (platforms revise recent days).                                                                      |

### 5.8 Imports

```sql
create type import_kind   as enum ('account_metrics','posts');
create type import_status as enum ('processing','completed','completed_with_errors','failed');

create table import_batches (
  id uuid primary key, organization_id uuid not null,
  social_account_id uuid not null, platform_key text not null,   -- FK → social_accounts
  kind import_kind not null, file_name text not null,
  status import_status not null default 'processing',
  rows_total int, rows_imported int, rows_skipped int,
  errors jsonb not null default '[]',
  created_by uuid default auth.uid(), created_at timestamptz, completed_at timestamptz,
  unique (id, organization_id)
);
```

CSV import (`lib/imports/`) runs as the signed-in user (`accounts.manage`, ADMIN+): it creates a batch, writes rows through ingest as `imported`, then finishes the batch. A trigger stops users changing a batch's identity fields or a finished batch. Batches are never deleted.

## 6. Content, approvals, strategy (planned: Phases 5–7)

The taxonomy tables already exist in minimal form (§5.3); later phases extend them (e.g. pillar colour, campaign objective) and add `topics`.

```sql
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
  pillar_id uuid, content_format_id uuid, campaign_id uuid, audience_id uuid,
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

## 8. Sync, functions, and later-phase tables

### 8.1 Sync bookkeeping (implemented)

```sql
create type sync_job_type as enum ('account_daily','posts_incremental','post_metrics_refresh','backfill',
  'public_profile_daily','public_posts_refresh','public_backfill');
create type sync_status   as enum ('queued','running','succeeded','partial','failed','cancelled');
create type sync_trigger  as enum ('schedule','manual','retry');

create table sync_state (               -- one row per account and job type
  social_account_id uuid references social_accounts on delete cascade,
  organization_id uuid not null,
  job_type sync_job_type not null,
  cursor jsonb,                         -- e.g. backfill position {after} or {after, pages}
  last_success_at timestamptz, last_attempt_at timestamptz,
  next_run_after timestamptz,           -- backoff or rate-limit pause
  consecutive_failures int not null default 0,
  completed boolean not null default false,   -- backfill reached the end of history
  primary key (social_account_id, job_type)
);

create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  social_account_id uuid not null references social_accounts on delete cascade,
  platform_key text not null,
  job_type sync_job_type not null, trigger sync_trigger not null,
  status sync_status not null default 'queued',
  requested_by uuid, attempt int not null default 1,
  queued_at timestamptz, started_at timestamptz, completed_at timestamptz,
  records_processed int, records_failed int,
  error_code text, error_message text   -- never contains tokens (lib/platforms/http.ts redacts)
);  -- unique (social_account_id, job_type) where status in ('queued','running')

create table sync_run_events (id bigint identity pk, sync_run_id uuid, organization_id uuid,
  level text check (level in ('info','warning','error')), code text, message text, context jsonb, created_at timestamptz);
create table raw_payloads (id bigint identity pk, organization_id uuid, sync_run_id uuid,
  endpoint text, payload jsonb, captured_at timestamptz);   -- deleted after 30 days by the worker
```

Members can read `sync_state`, `sync_runs` and `sync_run_events`; only the service role writes them. `raw_payloads` is service-role only. The partial unique index means at most one queued or running job per account and job type, so scheduling twice adds nothing. How the jobs run is in [DATA_PIPELINE.md](DATA_PIPELINE.md).

### 8.2 Functions the app calls

`security definer`, permission-checked inside (`accounts.manage`), granted to `authenticated`:

| Function                                      | Does                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `link_connection_asset(asset_id, account_id)` | The only way an account becomes connected. Requires an active connection, matching platform, `business_role = owned`, and the asset not linked elsewhere. Sets `connection_id`, `external_id`, `connected` and `first_observed_at` (if not set yet).                                            |
| `unlink_social_account(account_id)`           | Unlinks the account, sets `not_connected`, cancels its queued runs. Synced data stays, labelled with its original source.                                                                                                                                                                       |
| `disconnect_platform_connection(target)`      | Deletes the connection's tokens, marks it `revoked`, unlinks its accounts and cancels their queued runs. The app revokes the grant at Meta first (best effort).                                                                                                                                 |
| `request_sync(account_id, job)`               | Queues a manual run for an active account; returns the existing run if one is already queued or running. Without `job`: `public_profile_daily` on a platform with public data, else `posts_incremental`. Public jobs need public data and a non-demo profile; connected jobs need a connection. |
| `set_public_data_viewer(asset_id)`            | Chooses the organization's viewer account. The asset must be an Instagram account on an active connection of the caller's organization. Replaces any earlier viewer.                                                                                                                            |
| `clear_public_data_viewer(platform, org)`     | Removes the viewer. Public jobs stop being queued for that organization.                                                                                                                                                                                                                        |
| `remove_profile_and_data(account_id)`         | Deletes a profile and everything stored about it: posts, post and account snapshots, profile snapshots, import batches, sync runs and their raw payloads. Unlinks any connection asset first. The activity log keeps only the fact that it was removed (Meta Platform Terms §3.d).              |

### 8.3 Planned tables

```sql
-- Phase 4: Cross-country benchmarking
create table benchmark_groups (id uuid pk, organization_id uuid, name text, description text, platform_key text null);
create table benchmark_group_members (group_id uuid, social_account_id uuid, primary key (group_id, social_account_id));

-- Phase 8: AI analyst + recommendations
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

-- Phase 9: Weekly intelligence reports
create table reports (id uuid pk, organization_id uuid, kind text, period_start date, period_end date,
  title text, status text, generation_id uuid, data_snapshot jsonb, created_by uuid, created_at timestamptz);
create table report_sections (id uuid pk, report_id uuid, organization_id uuid, position int,
  kind text, title text, body jsonb);

create table notifications (id uuid pk, organization_id uuid, user_id uuid, kind text, payload jsonb,
  read_at timestamptz, created_at timestamptz);
```

## 9. Indexing and scale plan

In place:

- `posts (organization_id, published_at desc)`, `(social_account_id, published_at desc)`, `(organization_id, country_code, published_at desc)`, `(organization_id, platform_key, published_at desc)`; partial indexes on `pillar_id` and `campaign_id`.
- Snapshots: the duplicate-guard unique indexes, `(organization_id, captured_at)` / `(organization_id, metric_date)`, and BRIN on `captured_at` (cheap, fits append-only). `raw_payloads` BRIN on `captured_at`.
- `sync_runs`: partial index on queued runs by `queued_at`, plus per account and per org.
- `social_accounts (organization_id, business_role)`; `posts` GIN on `hashtags`; `profile_snapshots (social_account_id, observed_at desc)`; `public_profile_lookups (organization_id, looked_up_at desc)`.
- Every RLS policy column (`organization_id`) indexed.

Later:

- Turn the read-model views (§5.7) into incrementally refreshed tables when they get slow, and add daily account rollups for the dashboard.
- Convert snapshot tables to monthly range partitions when > ~50M rows (no schema change needed).
- `content_items (organization_id, status, planned_publish_at)` for calendar and queue (Phase 5).

## 10. Seed data

`pnpm db:seed` (`scripts/seed-demo.ts`, local Supabase only unless `--allow-remote`) creates a demo user and team, an org "CANNA (DEMO)" with `is_demo = true`, fictional own accounts (`business_role = owned`) for six markets across Instagram, Facebook, LinkedIn, YouTube, TikTok and X, and five fictional public Instagram profiles: three competitors, an industry account and a creator. Accounts get `connection_status = 'demo'`, `access_type = 'demo'` (from the trigger) and names ending in "(DEMO)".

For every active profile, `lib/demo/generate.ts` produces deterministic DEMO posts and metrics, each post measured at 1, 7 and 30 days old. Own profiles get 60 days of daily account metrics and post insights. Public profiles get only what Business Discovery would give: one follower observation a day, likes (hidden on some profiles), comments and Reel views, plus `first_observed_at`, `last_observed_at`, `earliest_post_at` and two DEMO profile snapshots. Everything is written through the same ingest step as real data with `data_source = 'demo'`, which the database accepts only because the org is a demo org. Re-running updates instead of duplicating.
