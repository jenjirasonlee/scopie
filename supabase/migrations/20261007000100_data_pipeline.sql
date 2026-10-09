-- Scopie Phase 2: real social data pipeline.
-- Metric dictionary, posts, append-only metric facts, imports, platform connections and sync.
-- See docs/DATABASE.md §5 and docs/DATA_PIPELINE.md.

-- ---------------------------------------------------------------------------
-- 1. Data source vocabulary (architecture review §7)
-- ---------------------------------------------------------------------------

alter type public.data_source rename value 'live_api' to 'authenticated';
alter type public.data_source rename value 'public_api' to 'public';
alter type public.data_source rename value 'import' to 'imported';

-- ---------------------------------------------------------------------------
-- 2. Platform reference data
-- ---------------------------------------------------------------------------

-- The calendar each platform's daily numbers use, so "1 September" means the same everywhere.
alter table public.platforms add column reporting_timezone text;
update public.platforms set reporting_timezone = 'America/Los_Angeles' where key in ('instagram', 'facebook');
update public.platforms set reporting_timezone = 'America/Los_Angeles' where key = 'youtube';
-- Instagram and Facebook have a working connector now (lib/platforms/registry.ts).
-- tests/integration/pipeline.test.ts checks this list matches the code.
update public.platforms set connector_status = 'available' where key in ('instagram', 'facebook');

create table public.platform_account_types (
  platform_key text not null references public.platforms (key) on delete cascade,
  key text not null,
  label text not null,
  primary key (platform_key, key)
);

insert into public.platform_account_types (platform_key, key, label) values
  ('instagram', 'business', 'Business'),
  ('instagram', 'creator', 'Creator'),
  ('facebook', 'page', 'Page'),
  ('linkedin', 'company_page', 'Company page'),
  ('linkedin', 'personal', 'Personal profile'),
  ('youtube', 'channel', 'Channel'),
  ('tiktok', 'business', 'Business'),
  ('tiktok', 'creator', 'Creator'),
  ('tiktok', 'personal', 'Personal'),
  ('x', 'business', 'Business'),
  ('x', 'personal', 'Personal'),
  ('reddit', 'community', 'Subreddit'),
  ('reddit', 'personal', 'User account'),
  ('discord', 'community', 'Server');

alter table public.platform_account_types enable row level security;
create policy "platform account types are readable by signed-in users"
  on public.platform_account_types for select to authenticated using (true);
revoke all on public.platform_account_types from anon;
revoke insert, update, delete on public.platform_account_types from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Metric dictionary and platform metric map
--    lib/metrics/registry.ts mirrors these rows; tests/integration asserts they match.
-- ---------------------------------------------------------------------------

create type public.metric_unit as enum ('count', 'percent', 'seconds');
create type public.metric_aggregation as enum ('sum', 'last', 'recompute', 'not_additive');
create type public.metric_scope as enum ('account', 'post');

create table public.metric_definitions (
  key text primary key,
  label text not null,
  definition text not null,
  unit public.metric_unit not null,
  aggregation public.metric_aggregation not null,
  higher_is_better boolean not null,
  applies_to_accounts boolean not null,
  applies_to_posts boolean not null,
  is_derived boolean not null default false,
  formula text,
  inputs text[] not null default '{}',
  sort_order int not null,
  constraint metric_definitions_key_format check (key ~ '^[a-z][a-z0-9_]*$'),
  constraint metric_definitions_scope check (applies_to_accounts or applies_to_posts),
  constraint metric_definitions_derived_formula check (not is_derived or formula is not null)
);

insert into public.metric_definitions
  (key, label, definition, unit, aggregation, higher_is_better, applies_to_accounts, applies_to_posts, is_derived, formula, inputs, sort_order)
values
  ('followers', 'Followers', 'People following the account at the time of capture (YouTube: subscribers).', 'count', 'last', true, true, false, false, null, '{}', 10),
  ('followers_gained', 'Followers gained', 'New followers during the day, as reported by the platform.', 'count', 'sum', true, true, false, false, null, '{}', 20),
  ('followers_lost', 'Followers lost', 'Unfollows during the day, as reported by the platform.', 'count', 'sum', false, true, false, false, null, '{}', 30),
  ('follower_change', 'Net follower change', 'Followers gained minus followers lost in the period.', 'count', 'sum', true, true, false, true, 'followers(end) - followers(start), or followers_gained - followers_lost', '{followers,followers_gained,followers_lost}', 40),
  ('follower_growth_rate', 'Follower growth rate', 'Net follower change relative to followers at the start of the period.', 'percent', 'recompute', true, true, false, true, 'follower_change / followers(start) * 100', '{follower_change,followers}', 50),
  ('reach', 'Reach', 'Unique accounts that saw the content. Cannot be added across days, posts or accounts.', 'count', 'not_additive', true, true, true, false, null, '{}', 60),
  ('impressions', 'Impressions', 'Number of times content was shown.', 'count', 'sum', true, true, true, false, null, '{}', 70),
  ('views', 'Views', 'The platform''s own view or play count. Each platform defines a view differently.', 'count', 'sum', true, true, true, false, null, '{}', 80),
  ('profile_views', 'Profile views', 'Visits to the account profile.', 'count', 'sum', true, true, false, false, null, '{}', 90),
  ('likes', 'Likes', 'Likes on a post.', 'count', 'sum', true, false, true, false, null, '{}', 100),
  ('reactions', 'Reactions', 'All reaction types on a post (Facebook, LinkedIn).', 'count', 'sum', true, false, true, false, null, '{}', 110),
  ('comments', 'Comments', 'Comments on a post. Some platforms include replies.', 'count', 'sum', true, false, true, false, null, '{}', 120),
  ('shares', 'Shares', 'Shares, reposts or retweets.', 'count', 'sum', true, false, true, false, null, '{}', 130),
  ('saves', 'Saves', 'Saves or favourites.', 'count', 'sum', true, false, true, false, null, '{}', 140),
  ('link_clicks', 'Link clicks', 'Clicks on a link in the post.', 'count', 'sum', true, false, true, false, null, '{}', 150),
  ('interactions', 'Total interactions', 'Interactions as totalled by the platform (likes or reactions, comments, shares, saves).', 'count', 'sum', true, true, true, false, null, '{}', 160),
  ('watch_time', 'Watch time', 'Total time watched, in seconds.', 'seconds', 'sum', true, false, true, false, null, '{}', 170),
  ('avg_watch_duration', 'Average watch duration', 'Average time watched per view, in seconds.', 'seconds', 'recompute', true, false, true, false, null, '{}', 180),
  ('completion_rate', 'Completion rate', 'Share of views that reached the end, only as reported by the platform.', 'percent', 'not_additive', true, false, true, false, null, '{}', 190),
  ('posts_published', 'Posts published', 'Posts published in the period, counted by Scopie.', 'count', 'sum', true, true, false, true, 'count of posts', '{}', 200),
  ('engagement_rate_reach', 'Engagement rate (by reach)', 'Share of people reached who interacted. Never falls back to followers.', 'percent', 'recompute', true, false, true, true, 'interactions / reach * 100', '{interactions,reach}', 210),
  ('engagement_rate_views', 'Engagement rate (by views)', 'Interactions per view.', 'percent', 'recompute', true, false, true, true, 'interactions / views * 100', '{interactions,views}', 220),
  ('engagement_rate_followers', 'Engagement rate (by followers)', 'Interactions relative to followers on the publish date.', 'percent', 'recompute', true, false, true, true, 'interactions / followers(publish date) * 100', '{interactions,followers}', 230);

create table public.platform_metric_map (
  platform_key text not null references public.platforms (key) on delete cascade,
  scope public.metric_scope not null,
  source_metric text not null,
  metric_key text not null references public.metric_definitions (key),
  comparability_class text not null,
  api_version text,
  value_transform text,
  notes text,
  primary key (platform_key, scope, source_metric),
  constraint platform_metric_map_transform check (value_transform is null or value_transform in ('ms_to_seconds'))
);

insert into public.platform_metric_map
  (platform_key, scope, source_metric, metric_key, comparability_class, api_version, value_transform, notes)
values
  ('instagram', 'account', 'followers_count', 'followers', 'audience_size', 'graph', null, 'Profile field; current total only'),
  ('instagram', 'account', 'follower_count', 'followers_gained', 'meta_followers_gained', 'graph', null, 'Daily new followers, recent days only'),
  ('instagram', 'account', 'reach', 'reach', 'meta_reach', 'graph', null, null),
  ('instagram', 'account', 'views', 'views', 'meta_views', 'graph', null, 'Replaced impressions in 2025'),
  ('instagram', 'account', 'profile_views', 'profile_views', 'ig_profile_views', 'graph', null, null),
  ('instagram', 'account', 'total_interactions', 'interactions', 'meta_interactions', 'graph', null, null),
  ('instagram', 'post', 'reach', 'reach', 'meta_reach', 'graph', null, null),
  ('instagram', 'post', 'views', 'views', 'meta_views', 'graph', null, null),
  ('instagram', 'post', 'likes', 'likes', 'likes', 'graph', null, null),
  ('instagram', 'post', 'comments', 'comments', 'comments', 'graph', null, null),
  ('instagram', 'post', 'shares', 'shares', 'shares', 'graph', null, null),
  ('instagram', 'post', 'saved', 'saves', 'ig_saves', 'graph', null, null),
  ('instagram', 'post', 'total_interactions', 'interactions', 'meta_interactions', 'graph', null, null),
  ('instagram', 'post', 'ig_reels_video_view_total_time', 'watch_time', 'ig_reels_watch_time', 'graph', 'ms_to_seconds', 'Reels only'),
  ('instagram', 'post', 'ig_reels_avg_watch_time', 'avg_watch_duration', 'ig_reels_watch_time', 'graph', 'ms_to_seconds', 'Reels only'),
  ('facebook', 'account', 'followers_count', 'followers', 'audience_size', 'graph', null, 'Page field; current total only'),
  ('facebook', 'account', 'page_impressions_unique', 'reach', 'meta_reach', 'graph', null, 'Verify against current Page Insights metrics'),
  ('facebook', 'account', 'page_post_engagements', 'interactions', 'fb_page_engagements', 'graph', null, 'Verify against current Page Insights metrics'),
  ('facebook', 'post', 'post_impressions_unique', 'reach', 'meta_reach', 'graph', null, 'Verify against current Page Insights metrics'),
  ('facebook', 'post', 'post_impressions', 'impressions', 'fb_impressions', 'graph', null, 'Verify against current Page Insights metrics'),
  ('facebook', 'post', 'reactions.summary.total_count', 'reactions', 'fb_reactions', 'graph', null, 'Post field'),
  ('facebook', 'post', 'comments.summary.total_count', 'comments', 'comments', 'graph', null, 'Post field'),
  ('facebook', 'post', 'shares.count', 'shares', 'shares', 'graph', null, 'Post field'),
  ('facebook', 'post', 'post_clicks', 'link_clicks', 'fb_clicks', 'graph', null, 'Verify against current Page Insights metrics');

alter table public.metric_definitions enable row level security;
alter table public.platform_metric_map enable row level security;
create policy "metric definitions are readable by signed-in users"
  on public.metric_definitions for select to authenticated using (true);
create policy "platform metric map is readable by signed-in users"
  on public.platform_metric_map for select to authenticated using (true);
revoke all on public.metric_definitions, public.platform_metric_map from anon;
revoke insert, update, delete on public.metric_definitions, public.platform_metric_map from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Platform connections (OAuth). Tokens live encrypted in connection_credentials,
--    which no signed-in user can read or write. Only server code with the
--    service role (OAuth callback, sync worker) touches it.
-- ---------------------------------------------------------------------------

create type public.connection_status as enum ('active', 'needs_reauth', 'revoked', 'error');

create table public.platform_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  external_user_id text not null,
  display_name text,
  status public.connection_status not null default 'active',
  scopes text[] not null default '{}',
  token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  last_error text,
  connected_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_connections_provider check (provider in ('meta', 'google', 'linkedin', 'tiktok', 'x', 'reddit', 'discord')),
  unique (organization_id, provider, external_user_id),
  unique (id, organization_id)
);

create trigger platform_connections_set_updated_at
  before update on public.platform_connections
  for each row execute function public.set_updated_at();

create table public.connection_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null,
  organization_id uuid not null,
  -- null = the connection's user token; otherwise the asset (e.g. Facebook Page) the token belongs to
  asset_external_id text,
  ciphertext text not null,          -- AES-256-GCM, see lib/crypto/tokens.ts
  key_version int not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.platform_connections (id, organization_id) on delete cascade
);
create unique index connection_credentials_unique
  on public.connection_credentials (connection_id, asset_external_id) nulls not distinct;

-- Accounts the connection can see (Facebook Pages, Instagram accounts, ...).
create table public.connection_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  platform_key text not null references public.platforms (key),
  external_id text not null,
  name text,
  handle text,
  account_type text,
  parent_external_id text,           -- e.g. the Facebook Page an Instagram account is linked to
  linked_account_id uuid references public.social_accounts (id) on delete set null,
  discovered_at timestamptz not null default now(),
  foreign key (connection_id, organization_id)
    references public.platform_connections (id, organization_id) on delete cascade,
  unique (connection_id, platform_key, external_id)
);
create index connection_assets_org_idx on public.connection_assets (organization_id);

alter table public.platform_connections enable row level security;
alter table public.connection_credentials enable row level security;
alter table public.connection_assets enable row level security;

create policy "members read platform connections"
  on public.platform_connections for select to authenticated
  using (public.is_org_member(organization_id));
create policy "members read connection assets"
  on public.connection_assets for select to authenticated
  using (public.is_org_member(organization_id));
-- connection_credentials: no policies at all. Signed-in users can never read tokens.

revoke all on public.platform_connections, public.connection_assets, public.connection_credentials from anon;
revoke insert, update, delete on public.platform_connections, public.connection_assets from authenticated;
revoke all on public.connection_credentials from authenticated;

-- ---------------------------------------------------------------------------
-- 5. Social accounts: analytics fields, platform account types, connection link
-- ---------------------------------------------------------------------------

alter table public.social_accounts
  add column tracking_started_at timestamptz,
  add column history_available_from date,
  add column connection_id uuid references public.platform_connections (id) on delete set null,
  add constraint social_accounts_id_org_platform unique (id, organization_id, platform_key),
  add constraint social_accounts_id_org unique (id, organization_id),
  add constraint social_accounts_account_type_fk
    foreign key (platform_key, account_type) references public.platform_account_types (platform_key, key);

create or replace function public.social_accounts_protect_connection_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_end_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.connection_status := 'not_connected';
    new.primary_data_source := 'manual';
    new.last_successful_sync_at := null;
    new.tracking_started_at := null;
    new.history_available_from := null;
    new.connection_id := null;
    new.created_by := auth.uid();
  else
    new.connection_status := old.connection_status;
    new.primary_data_source := old.primary_data_source;
    new.last_successful_sync_at := old.last_successful_sync_at;
    new.tracking_started_at := old.tracking_started_at;
    new.history_available_from := old.history_available_from;
    new.connection_id := old.connection_id;
    new.created_by := old.created_by;
    if new.organization_id <> old.organization_id then
      raise exception 'Accounts cannot be moved between organizations' using errcode = '42501';
    end if;
    -- A connected account's identity comes from the platform, not from the form.
    if old.connection_id is not null then
      new.external_id := old.external_id;
      new.platform_key := old.platform_key;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Minimal content taxonomy so posts can be tagged (full content hub is a later phase)
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['content_pillars', 'campaigns', 'audiences', 'cta_types', 'content_formats'] loop
    execute format($f$
      create table public.%1$I (
        id uuid primary key default gen_random_uuid(),
        organization_id uuid not null references public.organizations (id) on delete cascade,
        name text not null,
        description text,
        is_active boolean not null default true,
        created_at timestamptz not null default now(),
        constraint %1$s_name_length check (char_length(name) between 1 and 80),
        constraint %1$s_description_length check (char_length(description) <= 500),
        unique (id, organization_id)
      );
      create unique index %1$s_unique_name on public.%1$I (organization_id, lower(name));
      alter table public.%1$I enable row level security;
      create policy "members read %1$s" on public.%1$I for select to authenticated
        using (public.is_org_member(organization_id));
      create policy "strategy managers write %1$s" on public.%1$I for all to authenticated
        using (public.has_org_permission(organization_id, 'strategy.manage'))
        with check (public.has_org_permission(organization_id, 'strategy.manage'));
      revoke all on public.%1$I from anon;
      revoke delete on public.%1$I from authenticated;
    $f$, t);
  end loop;
end;
$$;

alter table public.campaigns
  add column starts_on date,
  add column ends_on date,
  add constraint campaigns_dates check (ends_on is null or starts_on is null or ends_on >= starts_on);

-- ---------------------------------------------------------------------------
-- 7. Imports
-- ---------------------------------------------------------------------------

create type public.import_kind as enum ('account_metrics', 'posts');
create type public.import_status as enum ('processing', 'completed', 'completed_with_errors', 'failed');

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  social_account_id uuid not null,
  platform_key text not null,
  kind public.import_kind not null,
  file_name text not null,
  status public.import_status not null default 'processing',
  rows_total int not null default 0,
  rows_imported int not null default 0,
  rows_skipped int not null default 0,
  errors jsonb not null default '[]',
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint import_batches_file_name_length check (char_length(file_name) between 1 and 255),
  foreign key (social_account_id, organization_id, platform_key)
    references public.social_accounts (id, organization_id, platform_key),
  unique (id, organization_id)
);
create index import_batches_org_created_idx on public.import_batches (organization_id, created_at desc);

create or replace function public.import_batches_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_end_user() then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.status := 'processing';
      new.completed_at := null;
    else
      new.organization_id := old.organization_id;
      new.social_account_id := old.social_account_id;
      new.platform_key := old.platform_key;
      new.kind := old.kind;
      new.file_name := old.file_name;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
      if old.status <> 'processing' then
        raise exception 'A finished import cannot be changed' using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger import_batches_guard
  before insert or update on public.import_batches
  for each row execute function public.import_batches_guard();

alter table public.import_batches enable row level security;
create policy "members read imports"
  on public.import_batches for select to authenticated
  using (public.is_org_member(organization_id));
create policy "account managers create imports"
  on public.import_batches for insert to authenticated
  with check (public.has_org_permission(organization_id, 'accounts.manage'));
create policy "account managers finish imports"
  on public.import_batches for update to authenticated
  using (public.has_org_permission(organization_id, 'accounts.manage'))
  with check (public.has_org_permission(organization_id, 'accounts.manage'));
revoke all on public.import_batches from anon;
revoke delete on public.import_batches from authenticated;

-- ---------------------------------------------------------------------------
-- 8. Sync engine bookkeeping
-- ---------------------------------------------------------------------------

create type public.sync_job_type as enum ('account_daily', 'posts_incremental', 'post_metrics_refresh', 'backfill');
create type public.sync_status as enum ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled');
create type public.sync_trigger as enum ('schedule', 'manual', 'retry');

create table public.sync_state (
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_type public.sync_job_type not null,
  cursor jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  next_run_after timestamptz,
  consecutive_failures int not null default 0,
  completed boolean not null default false,   -- backfill reached the platform's history limit
  primary key (social_account_id, job_type)
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  platform_key text not null,
  job_type public.sync_job_type not null,
  trigger public.sync_trigger not null,
  status public.sync_status not null default 'queued',
  requested_by uuid references public.profiles (id) on delete set null,
  attempt int not null default 1,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  records_processed int not null default 0,
  records_failed int not null default 0,
  error_code text,
  error_message text      -- never contains tokens (lib/platforms/http.ts redacts)
);
create unique index sync_runs_one_active
  on public.sync_runs (social_account_id, job_type) where status in ('queued', 'running');
create index sync_runs_queue_idx on public.sync_runs (queued_at) where status = 'queued';
create index sync_runs_account_idx on public.sync_runs (social_account_id, queued_at desc);
create index sync_runs_org_idx on public.sync_runs (organization_id, queued_at desc);

create table public.sync_run_events (
  id bigint generated always as identity primary key,
  sync_run_id uuid not null references public.sync_runs (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  level text not null,
  code text not null,
  message text not null,
  context jsonb,
  created_at timestamptz not null default now(),
  constraint sync_run_events_level check (level in ('info', 'warning', 'error'))
);
create index sync_run_events_run_idx on public.sync_run_events (sync_run_id, id);

-- Raw platform responses for debugging, deleted after 30 days (pruneRawPayloads in lib/sync/scheduler.ts).
create table public.raw_payloads (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sync_run_id uuid references public.sync_runs (id) on delete cascade,
  endpoint text not null,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);
create index raw_payloads_captured_idx on public.raw_payloads using brin (captured_at);

alter table public.sync_state enable row level security;
alter table public.sync_runs enable row level security;
alter table public.sync_run_events enable row level security;
alter table public.raw_payloads enable row level security;

create policy "members read sync state"
  on public.sync_state for select to authenticated using (public.is_org_member(organization_id));
create policy "members read sync runs"
  on public.sync_runs for select to authenticated using (public.is_org_member(organization_id));
create policy "members read sync run events"
  on public.sync_run_events for select to authenticated using (public.is_org_member(organization_id));
-- raw_payloads: server only.

revoke all on public.sync_state, public.sync_runs, public.sync_run_events, public.raw_payloads from anon;
revoke insert, update, delete on public.sync_state, public.sync_runs, public.sync_run_events from authenticated;
revoke all on public.raw_payloads from authenticated;

-- ---------------------------------------------------------------------------
-- 9. Posts
-- ---------------------------------------------------------------------------

create type public.media_format as enum
  ('image', 'carousel', 'short_video', 'long_video', 'video', 'text', 'link', 'story', 'live', 'other');
create type public.tag_source as enum ('content_item', 'manual', 'imported', 'ai_suggested', 'ai_confirmed');
create type public.language_source as enum ('declared', 'account_default', 'detected');

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  social_account_id uuid not null,
  platform_key text not null,
  external_id text not null,
  permalink text,
  published_at timestamptz not null,
  published_local_date date not null,          -- set by trigger from the account's timezone
  media_format public.media_format not null default 'other',
  native_type text,
  caption text,
  caption_updated_at timestamptz,
  language text,
  language_source public.language_source,
  country_code char(2) references public.countries (code),
  content_format_id uuid,
  content_format_source public.tag_source,
  pillar_id uuid,
  pillar_source public.tag_source,
  campaign_id uuid,
  campaign_source public.tag_source,
  cta_type_id uuid,
  cta_text text,
  cta_source public.tag_source,
  is_paid boolean,                              -- null = unknown
  is_shared_post boolean not null default false, -- e.g. Instagram collab post on two accounts
  removed_at timestamptz,
  data_source public.data_source not null,
  import_batch_id uuid,
  first_fetched_at timestamptz not null default now(),
  last_fetched_at timestamptz not null default now(),
  last_metrics_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_external_id_length check (char_length(external_id) between 1 and 200),
  constraint posts_caption_length check (char_length(caption) <= 10000),
  constraint posts_cta_text_length check (char_length(cta_text) <= 200),
  unique (social_account_id, external_id),
  unique (id, organization_id),
  foreign key (social_account_id, organization_id, platform_key)
    references public.social_accounts (id, organization_id, platform_key),
  foreign key (import_batch_id, organization_id) references public.import_batches (id, organization_id),
  foreign key (content_format_id, organization_id) references public.content_formats (id, organization_id),
  foreign key (pillar_id, organization_id) references public.content_pillars (id, organization_id),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id),
  foreign key (cta_type_id, organization_id) references public.cta_types (id, organization_id)
);

create index posts_org_published_idx on public.posts (organization_id, published_at desc);
create index posts_account_published_idx on public.posts (social_account_id, published_at desc);
create index posts_org_country_published_idx on public.posts (organization_id, country_code, published_at desc);
create index posts_org_platform_published_idx on public.posts (organization_id, platform_key, published_at desc);
create index posts_org_pillar_idx on public.posts (organization_id, pillar_id) where pillar_id is not null;
create index posts_org_campaign_idx on public.posts (organization_id, campaign_id) where campaign_id is not null;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

-- Shared rule for every fact (posts and metric snapshots): which data source is allowed where.
-- Security definer so it can read the organization and account regardless of the caller.
-- The "users may only write imported or manual data" rule lives in the calling triggers,
-- because inside a security definer function current_user is the owner, not the caller.
create or replace function public.check_fact_source(
  org uuid,
  account uuid,
  source public.data_source,
  batch uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org_is_demo boolean;
  account_connection uuid;
begin
  select o.is_demo into org_is_demo from public.organizations o where o.id = org;
  select a.connection_id into account_connection from public.social_accounts a where a.id = account;

  if source = 'demo' and not coalesce(org_is_demo, false) then
    raise exception 'DEMO data can only be stored in a demo organization' using errcode = '42501';
  end if;
  if source = 'authenticated' and account_connection is null then
    raise exception 'Authenticated data requires a connected account' using errcode = '42501';
  end if;
  if source = 'imported' and batch is null then
    raise exception 'Imported data must belong to an import batch' using errcode = '23514';
  end if;
end;
$$;

create or replace function public.posts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  acct record;
  end_user boolean := public.is_end_user();
begin
  select a.timezone, a.country_code, a.language, o.default_timezone
    into acct
  from public.social_accounts a
  join public.organizations o on o.id = a.organization_id
  where a.id = new.social_account_id;

  if tg_op = 'INSERT' then
    if end_user and new.data_source not in ('imported', 'manual') then
      raise exception 'Only imported or manual data can be added by users' using errcode = '42501';
    end if;
    perform public.check_fact_source(new.organization_id, new.social_account_id, new.data_source, new.import_batch_id);
    if new.country_code is null then
      new.country_code := acct.country_code;
    end if;
    if new.language is null and acct.language is not null then
      new.language := acct.language;
      new.language_source := 'account_default';
    end if;
    if end_user then
      new.first_fetched_at := now();
      new.last_fetched_at := now();
      new.last_metrics_at := null;
    end if;
  else
    if new.organization_id <> old.organization_id or new.social_account_id <> old.social_account_id then
      raise exception 'Posts cannot be moved' using errcode = '42501';
    end if;
    if end_user then
      -- People may only tag posts; everything else comes from the platform or import.
      new.external_id := old.external_id;
      new.platform_key := old.platform_key;
      new.permalink := old.permalink;
      new.published_at := old.published_at;
      new.media_format := old.media_format;
      new.native_type := old.native_type;
      new.caption := old.caption;
      new.caption_updated_at := old.caption_updated_at;
      new.is_shared_post := old.is_shared_post;
      new.removed_at := old.removed_at;
      new.data_source := old.data_source;
      new.import_batch_id := old.import_batch_id;
      new.first_fetched_at := old.first_fetched_at;
      new.last_fetched_at := old.last_fetched_at;
      new.last_metrics_at := old.last_metrics_at;
      if new.pillar_id is distinct from old.pillar_id then new.pillar_source := 'manual'; end if;
      if new.campaign_id is distinct from old.campaign_id then new.campaign_source := 'manual'; end if;
      if new.cta_type_id is distinct from old.cta_type_id or new.cta_text is distinct from old.cta_text then
        new.cta_source := 'manual';
      end if;
      if new.content_format_id is distinct from old.content_format_id then new.content_format_source := 'manual'; end if;
      if new.language is distinct from old.language then new.language_source := 'declared'; end if;
    else
      if new.caption is distinct from old.caption then
        new.caption_updated_at := now();
      end if;
      new.first_fetched_at := old.first_fetched_at;
      if new.data_source is distinct from old.data_source then
        -- A post first seen in an import keeps its row when the API later returns it.
        perform public.check_fact_source(new.organization_id, new.social_account_id, new.data_source, new.import_batch_id);
      end if;
    end if;
  end if;

  new.published_local_date :=
    (new.published_at at time zone coalesce(acct.timezone, acct.default_timezone, 'UTC'))::date;
  return new;
end;
$$;

create trigger posts_guard
  before insert or update on public.posts
  for each row execute function public.posts_guard();

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  post_id uuid not null,
  position int not null,
  media_type text not null,
  external_id text,
  duration_seconds numeric,
  width int,
  height int,
  foreign key (post_id, organization_id) references public.posts (id, organization_id) on delete cascade,
  unique (post_id, position),
  constraint post_media_position check (position >= 0)
);

create table public.post_audiences (
  post_id uuid not null,
  audience_id uuid not null,
  organization_id uuid not null,
  source public.tag_source not null default 'manual',
  primary key (post_id, audience_id),
  foreign key (post_id, organization_id) references public.posts (id, organization_id) on delete cascade,
  foreign key (audience_id, organization_id) references public.audiences (id, organization_id) on delete cascade
);

alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_audiences enable row level security;

create policy "members read posts"
  on public.posts for select to authenticated using (public.is_org_member(organization_id));
create policy "account managers import posts"
  on public.posts for insert to authenticated
  with check (public.has_org_permission(organization_id, 'accounts.manage'));
create policy "editors tag posts"
  on public.posts for update to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));

create policy "members read post media"
  on public.post_media for select to authenticated using (public.is_org_member(organization_id));

create policy "members read post audiences"
  on public.post_audiences for select to authenticated using (public.is_org_member(organization_id));
create policy "editors tag post audiences"
  on public.post_audiences for all to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));

revoke all on public.posts, public.post_media, public.post_audiences from anon;
revoke delete on public.posts from authenticated;
revoke insert, update, delete on public.post_media from authenticated;

-- ---------------------------------------------------------------------------
-- 10. Metric facts (append-only). A missing metric is a missing row or a row
--     with a reason; never a zero.
-- ---------------------------------------------------------------------------

create type public.metric_availability as enum ('available', 'not_permitted', 'not_applicable', 'pending', 'error');
create type public.metric_period as enum ('lifetime', 'day');

create table public.post_metric_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  post_id uuid not null,
  metric_key text not null references public.metric_definitions (key),
  source_metric text not null,
  value numeric,
  availability public.metric_availability not null,
  data_source public.data_source not null,
  period public.metric_period not null default 'lifetime',
  metric_date date,
  captured_at timestamptz not null,
  post_age_hours int not null,                 -- set by trigger
  sync_run_id uuid references public.sync_runs (id) on delete set null,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  foreign key (post_id, organization_id) references public.posts (id, organization_id) on delete cascade,
  foreign key (import_batch_id, organization_id) references public.import_batches (id, organization_id),
  constraint post_metric_value_matches_availability check ((availability = 'available') = (value is not null)),
  constraint post_metric_value_non_negative check (value is null or value >= 0),
  constraint post_metric_period_date check ((period = 'day') = (metric_date is not null))
);
create unique index post_metric_snapshots_unique
  on public.post_metric_snapshots (post_id, metric_key, period, metric_date, captured_at) nulls not distinct;
create index post_metric_snapshots_org_captured_idx on public.post_metric_snapshots (organization_id, captured_at);
create index post_metric_snapshots_captured_brin on public.post_metric_snapshots using brin (captured_at);

create table public.account_metric_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  social_account_id uuid not null,
  metric_key text not null references public.metric_definitions (key),
  source_metric text not null,
  value numeric,
  availability public.metric_availability not null,
  data_source public.data_source not null,
  -- 'day': the value for metric_date. 'lifetime': a running total (e.g. followers) as of metric_date.
  period public.metric_period not null,
  metric_date date not null,
  captured_at timestamptz not null,
  sync_run_id uuid references public.sync_runs (id) on delete set null,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  foreign key (social_account_id, organization_id) references public.social_accounts (id, organization_id),
  foreign key (import_batch_id, organization_id) references public.import_batches (id, organization_id),
  constraint account_metric_value_matches_availability check ((availability = 'available') = (value is not null)),
  constraint account_metric_value_non_negative check (value is null or value >= 0)
);
create unique index account_metric_snapshots_unique
  on public.account_metric_snapshots (social_account_id, metric_key, period, metric_date, captured_at);
create index account_metric_snapshots_org_date_idx on public.account_metric_snapshots (organization_id, metric_date);
create index account_metric_snapshots_captured_brin on public.account_metric_snapshots using brin (captured_at);

create or replace function public.metric_snapshots_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  def record;
  account uuid;
  published timestamptz;
begin
  select d.is_derived, d.applies_to_accounts, d.applies_to_posts into def
  from public.metric_definitions d where d.key = new.metric_key;
  if def.is_derived then
    raise exception 'Derived metric % is computed by Scopie and cannot be stored', new.metric_key
      using errcode = '23514';
  end if;

  if tg_table_name = 'post_metric_snapshots' then
    if not def.applies_to_posts then
      raise exception 'Metric % is not a post metric', new.metric_key using errcode = '23514';
    end if;
    select p.social_account_id, p.published_at into account, published
    from public.posts p where p.id = new.post_id;
    if new.captured_at < published then
      raise exception 'A snapshot cannot be captured before the post was published' using errcode = '23514';
    end if;
    new.post_age_hours := floor(extract(epoch from (new.captured_at - published)) / 3600);
  else
    if not def.applies_to_accounts then
      raise exception 'Metric % is not an account metric', new.metric_key using errcode = '23514';
    end if;
    account := new.social_account_id;
  end if;

  if public.is_end_user() and new.data_source not in ('imported', 'manual') then
    raise exception 'Only imported or manual data can be added by users' using errcode = '42501';
  end if;
  if public.is_end_user() then
    new.sync_run_id := null;
  end if;
  perform public.check_fact_source(new.organization_id, account, new.data_source, new.import_batch_id);
  return new;
end;
$$;

create trigger post_metric_snapshots_guard
  before insert on public.post_metric_snapshots
  for each row execute function public.metric_snapshots_guard();
create trigger account_metric_snapshots_guard
  before insert on public.account_metric_snapshots
  for each row execute function public.metric_snapshots_guard();

alter table public.post_metric_snapshots enable row level security;
alter table public.account_metric_snapshots enable row level security;

create policy "members read post metrics"
  on public.post_metric_snapshots for select to authenticated using (public.is_org_member(organization_id));
create policy "account managers import post metrics"
  on public.post_metric_snapshots for insert to authenticated
  with check (public.has_org_permission(organization_id, 'accounts.manage'));
create policy "members read account metrics"
  on public.account_metric_snapshots for select to authenticated using (public.is_org_member(organization_id));
create policy "account managers import account metrics"
  on public.account_metric_snapshots for insert to authenticated
  with check (public.has_org_permission(organization_id, 'accounts.manage'));

revoke all on public.post_metric_snapshots, public.account_metric_snapshots from anon;
revoke update, delete on public.post_metric_snapshots, public.account_metric_snapshots from authenticated;

-- ---------------------------------------------------------------------------
-- 11. Read models. Views now; they become incrementally refreshed tables at scale
--     (docs/DATABASE.md §9). security_invoker keeps RLS in force.
-- ---------------------------------------------------------------------------

create view public.post_metrics_latest with (security_invoker = true) as
select distinct on (s.post_id, s.metric_key)
  s.organization_id, s.post_id, s.metric_key, s.value, s.availability, s.data_source,
  s.captured_at, s.post_age_hours
from public.post_metric_snapshots s
where s.period = 'lifetime'
order by s.post_id, s.metric_key, s.captured_at desc;

-- Value of each lifetime metric at fixed post ages, from the snapshot nearest the target age
-- within ±15% (at least ±6 hours). No snapshot in the window = no row ("no 7-day value").
create view public.post_metrics_at_age with (security_invoker = true) as
select distinct on (s.post_id, s.metric_key, a.age_days)
  s.organization_id, s.post_id, s.metric_key, a.age_days, s.value, s.availability,
  s.data_source, s.captured_at, s.post_age_hours
from public.post_metric_snapshots s
cross join (values (1), (2), (3), (7), (14), (30), (90)) as a (age_days)
where s.period = 'lifetime'
  and abs(s.post_age_hours - a.age_days * 24) <= greatest(6, a.age_days * 24 * 0.15)
order by s.post_id, s.metric_key, a.age_days, abs(s.post_age_hours - a.age_days * 24), s.captured_at desc;

create view public.account_metrics_daily with (security_invoker = true) as
select distinct on (s.social_account_id, s.metric_key, s.period, s.metric_date)
  s.organization_id, s.social_account_id, s.metric_key, s.period, s.metric_date, s.value,
  s.availability, s.data_source, s.captured_at
from public.account_metric_snapshots s
order by s.social_account_id, s.metric_key, s.period, s.metric_date, s.captured_at desc;

grant select on public.post_metrics_latest, public.post_metrics_at_age, public.account_metrics_daily to authenticated;
revoke all on public.post_metrics_latest, public.post_metrics_at_age, public.account_metrics_daily from anon;

-- ---------------------------------------------------------------------------
-- 12. Functions people call through the app (permission-checked, security definer)
-- ---------------------------------------------------------------------------

-- Link a discovered platform asset (e.g. an Instagram account the Meta login can see)
-- to a Scopie account. This is the only way an account becomes "connected".
create or replace function public.link_connection_asset(asset_id uuid, account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset public.connection_assets;
  account public.social_accounts;
  conn public.platform_connections;
begin
  select * into asset from public.connection_assets where id = asset_id;
  select * into account from public.social_accounts where id = account_id;
  if asset.id is null or account.id is null
     or asset.organization_id <> account.organization_id
     or not public.has_org_permission(asset.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into conn from public.platform_connections where id = asset.connection_id;
  if conn.status <> 'active' then
    raise exception 'The connection is not active' using errcode = '23514';
  end if;
  if asset.platform_key <> account.platform_key then
    raise exception 'Platform does not match' using errcode = '23514';
  end if;
  if account.is_competitor then
    raise exception 'Competitor accounts cannot be connected' using errcode = '23514';
  end if;
  if asset.linked_account_id is not null and asset.linked_account_id <> account.id then
    raise exception 'This platform account is already linked to another Scopie account' using errcode = '23505';
  end if;

  update public.connection_assets set linked_account_id = null
    where linked_account_id = account.id and id <> asset.id;
  update public.connection_assets set linked_account_id = account.id where id = asset.id;
  update public.social_accounts set
    connection_id = asset.connection_id,
    external_id = asset.external_id,
    connection_status = 'connected',
    primary_data_source = 'authenticated',
    tracking_started_at = coalesce(tracking_started_at, now())
  where id = account.id;
end;
$$;

create or replace function public.unlink_social_account(account_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.social_accounts;
begin
  select * into account from public.social_accounts where id = account_id;
  if account.id is null or not public.has_org_permission(account.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.connection_assets set linked_account_id = null where linked_account_id = account.id;
  -- Data already synced stays, still labelled with its original source.
  update public.social_accounts set connection_id = null, connection_status = 'not_connected'
  where id = account.id;
  update public.sync_runs set status = 'cancelled', completed_at = now()
  where social_account_id = account.id and status = 'queued';
end;
$$;

-- Mark a connection revoked, delete its tokens and unlink its accounts.
-- The app revokes the grant at the platform first (best effort).
create or replace function public.disconnect_platform_connection(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  conn public.platform_connections;
begin
  select * into conn from public.platform_connections where id = target;
  if conn.id is null or not public.has_org_permission(conn.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.connection_credentials where connection_id = conn.id;
  update public.platform_connections set status = 'revoked' where id = conn.id;
  update public.connection_assets set linked_account_id = null where connection_id = conn.id;
  update public.sync_runs set status = 'cancelled', completed_at = now()
  where status = 'queued' and social_account_id in
    (select id from public.social_accounts where connection_id = conn.id);
  update public.social_accounts set connection_id = null, connection_status = 'not_connected'
  where connection_id = conn.id;
end;
$$;

-- Queue a manual sync. One queued or running job per account and job type.
create or replace function public.request_sync(account_id uuid, job public.sync_job_type default 'posts_incremental')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.social_accounts;
  run_id uuid;
begin
  select * into account from public.social_accounts where id = account_id;
  if account.id is null or not public.has_org_permission(account.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if account.connection_id is null or not account.is_active then
    raise exception 'Only active, connected accounts can be synced' using errcode = '23514';
  end if;
  insert into public.sync_runs (organization_id, social_account_id, platform_key, job_type, trigger, requested_by)
  values (account.organization_id, account.id, account.platform_key, job, 'manual', auth.uid())
  on conflict (social_account_id, job_type) where status in ('queued', 'running') do nothing
  returning id into run_id;
  if run_id is null then
    select id into run_id from public.sync_runs
    where social_account_id = account.id and job_type = job and status in ('queued', 'running');
  end if;
  return run_id;
end;
$$;

revoke all on function public.link_connection_asset(uuid, uuid) from public, anon;
revoke all on function public.unlink_social_account(uuid) from public, anon;
revoke all on function public.disconnect_platform_connection(uuid) from public, anon;
revoke all on function public.request_sync(uuid, public.sync_job_type) from public, anon;
revoke all on function public.check_fact_source(uuid, uuid, public.data_source, uuid) from public, anon;
grant execute on function public.link_connection_asset(uuid, uuid) to authenticated;
grant execute on function public.unlink_social_account(uuid) to authenticated;
grant execute on function public.disconnect_platform_connection(uuid) to authenticated;
grant execute on function public.request_sync(uuid, public.sync_job_type) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Audit log for the human-facing parts (never on fact tables: far too many rows)
-- ---------------------------------------------------------------------------

create trigger platform_connections_log
  after insert or update on public.platform_connections
  for each row execute function public.log_activity();
create trigger import_batches_log
  after insert on public.import_batches
  for each row execute function public.log_activity();

-- Permission descriptions follow the 2026-10-07 roadmap numbering.
update public.permissions set description = 'Create and edit content, comment (enforced from Phase 5)' where key = 'content.edit';
update public.permissions set description = 'Approve, reject or request changes (enforced from Phase 6)' where key = 'content.approve';
update public.permissions set description = 'Manage strategy, benchmarks and taxonomy' where key = 'strategy.manage';
