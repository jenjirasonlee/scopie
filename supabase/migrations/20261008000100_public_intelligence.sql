-- Scopie Phase 3: public profile intelligence.
-- Public profiles (competitors, industry, creators, CANNA's own) are observed through
-- official public APIs without the owner's authorization; OAuth connections are optional
-- enrichment. See docs/PHASE_3_PLAN.md §4–5 and docs/DATA_PIPELINE.md.

-- ---------------------------------------------------------------------------
-- 1. Provenance: every stored value says where it came from
--    authenticated → live_connected, public → live_public, manual → imported (no
--    screen ever wrote manual data), plus estimated (reserved: nothing produces it yet).
-- ---------------------------------------------------------------------------

drop view public.post_metrics_latest;
drop view public.post_metrics_at_age;
drop view public.account_metrics_daily;
drop function public.check_fact_source(uuid, uuid, public.data_source, uuid);

alter table public.social_accounts drop column primary_data_source;

create type public.data_source_v2 as enum ('live_public', 'live_connected', 'imported', 'estimated', 'demo');

do $$
declare
  t text;
begin
  foreach t in array array['posts', 'post_metric_snapshots', 'account_metric_snapshots'] loop
    execute format($f$
      alter table public.%1$I alter column data_source type public.data_source_v2 using (
        case data_source::text
          when 'authenticated' then 'live_connected'
          when 'public' then 'live_public'
          when 'manual' then 'imported'
          else data_source::text
        end
      )::public.data_source_v2
    $f$, t);
  end loop;
end;
$$;

drop type public.data_source;
alter type public.data_source_v2 rename to data_source;

-- Two more reasons a number can be missing. Never stored as zero.
alter type public.metric_availability add value 'hidden_by_owner';  -- e.g. Instagram likes hidden
alter type public.metric_availability add value 'not_public';       -- only the account owner can see it

alter type public.sync_job_type add value 'public_profile_daily';
alter type public.sync_job_type add value 'public_posts_refresh';
alter type public.sync_job_type add value 'public_backfill';

-- ---------------------------------------------------------------------------
-- 2. What each platform offers: public data (no owner authorization) and private
--    data (OAuth). lib/platforms/registry.ts mirrors this; an integration test checks.
-- ---------------------------------------------------------------------------

create type public.platform_data_status as enum ('available', 'planned', 'not_available');

alter table public.platforms
  add column public_data_status public.platform_data_status not null default 'planned',
  add column private_data_status public.platform_data_status not null default 'planned';

update public.platforms set public_data_status = 'available', private_data_status = 'available'
  where key = 'instagram';
update public.platforms set public_data_status = 'planned', private_data_status = 'available'
  where key = 'facebook';
update public.platforms set public_data_status = 'planned', private_data_status = 'planned'
  where key = 'youtube';
update public.platforms set public_data_status = 'not_available'
  where key in ('linkedin', 'tiktok', 'x', 'discord');

alter table public.platforms drop column connector_status;
drop type public.platform_connector_status;

-- ---------------------------------------------------------------------------
-- 3. Profiles: business role (why CANNA tracks it) and access type (how Scopie
--    gets its data) are separate. Observation dates say exactly what history exists.
-- ---------------------------------------------------------------------------

create type public.business_role as enum ('owned', 'competitor', 'industry', 'influencer', 'other');
create type public.profile_access_type as enum ('public', 'connected', 'imported', 'demo');

alter table public.social_accounts
  add column business_role public.business_role,
  add column access_type public.profile_access_type not null default 'imported',
  add column last_observed_at timestamptz,
  add column earliest_post_at timestamptz,
  add column last_sync_attempt_at timestamptz;

update public.social_accounts set business_role = case when is_competitor then 'competitor' else 'owned' end::public.business_role;
alter table public.social_accounts alter column business_role set not null;
alter table public.social_accounts alter column business_role set default 'owned';
alter table public.social_accounts drop column is_competitor;
alter table public.social_accounts rename column tracking_started_at to first_observed_at;

create index social_accounts_org_role_idx on public.social_accounts (organization_id, business_role);

-- Access type is always derived, never typed in: demo organization → demo; a linked
-- connection → connected; a platform with public data → public; otherwise imported.
create or replace function public.social_accounts_derive_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  org_is_demo boolean;
  public_status public.platform_data_status;
begin
  select o.is_demo into org_is_demo from public.organizations o where o.id = new.organization_id;
  select p.public_data_status into public_status from public.platforms p where p.key = new.platform_key;
  new.access_type := case
    when coalesce(org_is_demo, false) then 'demo'
    when new.connection_id is not null then 'connected'
    when public_status = 'available' then 'public'
    else 'imported'
  end;
  return new;
end;
$$;

create trigger social_accounts_derive_access
  before insert or update on public.social_accounts
  for each row execute function public.social_accounts_derive_access();

-- Replaces the Phase 2 version: same rules, new field names.
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
    new.last_successful_sync_at := null;
    new.last_sync_attempt_at := null;
    new.first_observed_at := null;
    new.last_observed_at := null;
    new.earliest_post_at := null;
    new.history_available_from := null;
    new.connection_id := null;
    new.created_by := auth.uid();
  else
    new.connection_status := old.connection_status;
    new.last_successful_sync_at := old.last_successful_sync_at;
    new.last_sync_attempt_at := old.last_sync_attempt_at;
    new.first_observed_at := old.first_observed_at;
    new.last_observed_at := old.last_observed_at;
    new.earliest_post_at := old.earliest_post_at;
    new.history_available_from := old.history_available_from;
    new.connection_id := old.connection_id;
    new.created_by := old.created_by;
    if new.organization_id <> old.organization_id then
      raise exception 'Accounts cannot be moved between organizations' using errcode = '42501';
    end if;
    -- Identity comes from the platform once observed or connected, not from the form.
    if old.connection_id is not null or old.first_observed_at is not null then
      new.external_id := old.external_id;
      new.platform_key := old.platform_key;
    end if;
    if old.first_observed_at is not null then
      new.handle := old.handle;
    end if;
  end if;
  return new;
end;
$$;

update public.social_accounts set updated_at = updated_at; -- derive access_type for existing rows

-- Public profile fields (name, bio, website, picture) as observed. A new row only when
-- something changed, so the table stays small and shows when a profile was edited.
create table public.profile_snapshots (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  social_account_id uuid not null,
  observed_at timestamptz not null,
  data_source public.data_source not null,
  username text,
  display_name text,
  biography text,
  website text,
  profile_picture_url text,
  account_type text,
  sync_run_id uuid references public.sync_runs (id) on delete set null,
  foreign key (social_account_id, organization_id)
    references public.social_accounts (id, organization_id) on delete cascade,
  constraint profile_snapshots_lengths check (
    char_length(username) <= 120 and char_length(display_name) <= 200
    and char_length(biography) <= 2000 and char_length(website) <= 500
    and char_length(profile_picture_url) <= 2000
  )
);
create index profile_snapshots_account_idx on public.profile_snapshots (social_account_id, observed_at desc);

alter table public.profile_snapshots enable row level security;
create policy "members read profile snapshots"
  on public.profile_snapshots for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.profile_snapshots from anon;
revoke insert, update, delete on public.profile_snapshots from authenticated;

-- ---------------------------------------------------------------------------
-- 4. The viewer account: the professional account through which public data is
--    requested (Instagram Business Discovery). One per organization and platform.
-- ---------------------------------------------------------------------------

create table public.public_data_viewers (
  id uuid primary key default gen_random_uuid(),  -- for the activity log
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform_key text not null references public.platforms (key),
  connection_asset_id uuid not null references public.connection_assets (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, platform_key)
);

alter table public.public_data_viewers enable row level security;
create policy "members read public data viewers"
  on public.public_data_viewers for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.public_data_viewers from anon;
revoke insert, update, delete on public.public_data_viewers from authenticated;

create trigger public_data_viewers_log
  after insert or update on public.public_data_viewers
  for each row execute function public.log_activity();

create or replace function public.set_public_data_viewer(asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset public.connection_assets;
  conn public.platform_connections;
begin
  select * into asset from public.connection_assets where id = asset_id;
  if asset.id is null or not public.has_org_permission(asset.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into conn from public.platform_connections where id = asset.connection_id;
  if conn.status <> 'active' then
    raise exception 'The connection is not active' using errcode = '23514';
  end if;
  if asset.platform_key <> 'instagram' then
    raise exception 'Only an Instagram professional account can be the viewer' using errcode = '23514';
  end if;
  insert into public.public_data_viewers (organization_id, platform_key, connection_asset_id, created_by)
  values (asset.organization_id, asset.platform_key, asset.id, auth.uid())
  on conflict (organization_id, platform_key)
  do update set connection_asset_id = excluded.connection_asset_id, created_by = excluded.created_by, created_at = now();
end;
$$;

create or replace function public.clear_public_data_viewer(platform text, org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_permission(org, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.public_data_viewers where organization_id = org and platform_key = platform;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Source rules for every fact (replaces the Phase 2 version)
-- ---------------------------------------------------------------------------

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
  acct record;
begin
  select o.is_demo into org_is_demo from public.organizations o where o.id = org;
  select a.connection_id, p.public_data_status into acct
  from public.social_accounts a join public.platforms p on p.key = a.platform_key
  where a.id = account;

  if source = 'demo' and not coalesce(org_is_demo, false) then
    raise exception 'DEMO data can only be stored in a demo organization' using errcode = '42501';
  end if;
  if source <> 'demo' and coalesce(org_is_demo, false) and source <> 'imported' then
    raise exception 'A demo organization holds only DEMO or imported data' using errcode = '42501';
  end if;
  if source = 'live_connected' and acct.connection_id is null then
    raise exception 'Connected data requires a connected account' using errcode = '42501';
  end if;
  if source = 'live_public' and acct.public_data_status is distinct from 'available' then
    raise exception 'This platform has no public data collector' using errcode = '42501';
  end if;
  if source = 'imported' and batch is null then
    raise exception 'Imported data must belong to an import batch' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.check_fact_source(uuid, uuid, public.data_source, uuid) from public, anon;

-- Users may only add imported data; everything else is written by the sync worker.
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
    if end_user and new.data_source <> 'imported' then
      raise exception 'Only imported data can be added by users' using errcode = '42501';
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
      new.hashtags := old.hashtags;
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
        -- A post first seen in an import keeps its row when an API later returns it.
        perform public.check_fact_source(new.organization_id, new.social_account_id, new.data_source, new.import_batch_id);
      end if;
    end if;
  end if;

  -- Hashtags come from the caption, so they always match it.
  if tg_op = 'INSERT' or new.caption is distinct from old.caption then
    new.hashtags := public.extract_hashtags(new.caption);
  end if;

  new.published_local_date :=
    (new.published_at at time zone coalesce(acct.timezone, acct.default_timezone, 'UTC'))::date;
  return new;
end;
$$;

create or replace function public.extract_hashtags(caption text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct tag order by tag), '{}')
  from (
    select lower(m[1]) as tag
    from regexp_matches(coalesce(caption, ''), '#([[:alnum:]_]+)', 'g') as m
  ) tags
  where char_length(tag) between 1 and 100;
$$;

alter table public.posts add column hashtags text[] not null default '{}';
create index posts_hashtags_idx on public.posts using gin (hashtags);
update public.posts set hashtags = public.extract_hashtags(caption) where caption is not null;

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

  if public.is_end_user() and new.data_source <> 'imported' then
    raise exception 'Only imported data can be added by users' using errcode = '42501';
  end if;
  if public.is_end_user() then
    new.sync_run_id := null;
  end if;
  perform public.check_fact_source(new.organization_id, account, new.data_source, new.import_batch_id);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Metric dictionary additions (mirrored in lib/metrics/registry.ts)
-- ---------------------------------------------------------------------------

insert into public.metric_definitions
  (key, label, definition, unit, aggregation, higher_is_better, applies_to_accounts, applies_to_posts, is_derived, formula, inputs, sort_order)
values
  ('following', 'Following', 'Accounts this profile follows at the time of capture.', 'count', 'last', false, true, false, false, null, '{}', 15),
  ('posts_total', 'Posts on profile', 'Total posts on the profile at the time of capture, as reported by the platform.', 'count', 'last', true, true, false, false, null, '{}', 16),
  ('public_engagement', 'Public engagement', 'Likes plus comments, the engagement anyone can see. Computed by Scopie; not the platform''s own engagement figure.', 'count', 'sum', true, false, true, true, 'likes + comments', '{likes,comments}', 240);

insert into public.platform_metric_map
  (platform_key, scope, source_metric, metric_key, comparability_class, api_version, value_transform, notes)
values
  ('instagram', 'account', 'business_discovery.followers_count', 'followers', 'audience_size', 'graph', null, 'Public, any business or creator account'),
  ('instagram', 'account', 'business_discovery.media_count', 'posts_total', 'posts_total', 'graph', null, 'Public'),
  ('instagram', 'post', 'business_discovery.like_count', 'likes', 'likes', 'graph', null, 'Public; missing when the owner hides likes'),
  ('instagram', 'post', 'business_discovery.comments_count', 'comments', 'comments', 'graph', null, 'Public; excludes comments on carousel children'),
  ('instagram', 'post', 'business_discovery.view_count', 'views', 'ig_public_reel_views', 'graph', null, 'Public; Reels only; includes paid views, so never compared with insights views');

-- ---------------------------------------------------------------------------
-- 7. Read models: one row per provenance, so public and connected values never mix
-- ---------------------------------------------------------------------------

create view public.post_metrics_latest with (security_invoker = true) as
select distinct on (s.post_id, s.metric_key, s.data_source)
  s.organization_id, s.post_id, s.metric_key, s.value, s.availability, s.data_source,
  s.captured_at, s.post_age_hours
from public.post_metric_snapshots s
where s.period = 'lifetime'
order by s.post_id, s.metric_key, s.data_source, s.captured_at desc;

-- Value of each lifetime metric at fixed post ages, from the snapshot nearest the target age
-- within ±15% (at least ±6 hours). No snapshot in the window = no row ("no 7-day value").
create view public.post_metrics_at_age with (security_invoker = true) as
select distinct on (s.post_id, s.metric_key, s.data_source, a.age_days)
  s.organization_id, s.post_id, s.metric_key, a.age_days, s.value, s.availability,
  s.data_source, s.captured_at, s.post_age_hours
from public.post_metric_snapshots s
cross join (values (1), (2), (3), (7), (14), (30), (90)) as a (age_days)
where s.period = 'lifetime'
  and abs(s.post_age_hours - a.age_days * 24) <= greatest(6, a.age_days * 24 * 0.15)
order by s.post_id, s.metric_key, s.data_source, a.age_days, abs(s.post_age_hours - a.age_days * 24), s.captured_at desc;

create view public.account_metrics_daily with (security_invoker = true) as
select distinct on (s.social_account_id, s.metric_key, s.period, s.data_source, s.metric_date)
  s.organization_id, s.social_account_id, s.metric_key, s.period, s.metric_date, s.value,
  s.availability, s.data_source, s.captured_at
from public.account_metric_snapshots s
order by s.social_account_id, s.metric_key, s.period, s.data_source, s.metric_date, s.captured_at desc;

grant select on public.post_metrics_latest, public.post_metrics_at_age, public.account_metrics_daily to authenticated;
revoke all on public.post_metrics_latest, public.post_metrics_at_age, public.account_metrics_daily from anon;

-- ---------------------------------------------------------------------------
-- 8. Functions people call through the app
-- ---------------------------------------------------------------------------

-- Only CANNA's own profiles can be connected (replaces the Phase 2 version).
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
  if account.business_role <> 'owned' then
    raise exception 'Only your own profiles can be connected' using errcode = '23514';
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
    first_observed_at = coalesce(account.first_observed_at, now())
  where id = account.id;
end;
$$;

-- Queue a manual sync. Public profiles refresh their public observation; connected
-- profiles their connected posts. One queued or running job per account and job type.
drop function public.request_sync(uuid, public.sync_job_type);
create or replace function public.request_sync(account_id uuid, job public.sync_job_type default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account public.social_accounts;
  public_status public.platform_data_status;
  chosen public.sync_job_type;
  run_id uuid;
begin
  select * into account from public.social_accounts where id = account_id;
  if account.id is null or not public.has_org_permission(account.organization_id, 'accounts.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not account.is_active then
    raise exception 'Only active profiles can be synced' using errcode = '23514';
  end if;
  select p.public_data_status into public_status from public.platforms p where p.key = account.platform_key;
  chosen := coalesce(job, case when public_status = 'available' then 'public_profile_daily' else 'posts_incremental' end::public.sync_job_type);
  if chosen::text like 'public_%' then
    if public_status <> 'available' or account.access_type = 'demo' then
      raise exception 'This profile has no public data collector' using errcode = '23514';
    end if;
  elsif account.connection_id is null then
    raise exception 'Only connected profiles can sync connected data' using errcode = '23514';
  end if;
  insert into public.sync_runs (organization_id, social_account_id, platform_key, job_type, trigger, requested_by)
  values (account.organization_id, account.id, account.platform_key, chosen, 'manual', auth.uid())
  on conflict (social_account_id, job_type) where status in ('queued', 'running') do nothing
  returning id into run_id;
  if run_id is null then
    select id into run_id from public.sync_runs
    where social_account_id = account.id and job_type = chosen and status in ('queued', 'running');
  end if;
  return run_id;
end;
$$;

-- Delete a profile and everything Scopie stored about it (Meta Platform Terms §3.d).
-- The activity log keeps a record that it was removed, not the data.
create or replace function public.remove_profile_and_data(account_id uuid)
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
  delete from public.post_metric_snapshots s using public.posts p
    where s.post_id = p.id and p.social_account_id = account.id;
  delete from public.posts where social_account_id = account.id;
  delete from public.account_metric_snapshots where social_account_id = account.id;
  delete from public.import_batches where social_account_id = account.id;
  delete from public.raw_payloads r using public.sync_runs sr
    where r.sync_run_id = sr.id and sr.social_account_id = account.id;
  delete from public.social_accounts where id = account.id;  -- cascades sync state, runs, profile snapshots
end;
$$;

revoke all on function public.link_connection_asset(uuid, uuid) from public, anon;
revoke all on function public.request_sync(uuid, public.sync_job_type) from public, anon;
revoke all on function public.set_public_data_viewer(uuid) from public, anon;
revoke all on function public.clear_public_data_viewer(text, uuid) from public, anon;
revoke all on function public.remove_profile_and_data(uuid) from public, anon;
grant execute on function public.link_connection_asset(uuid, uuid) to authenticated;
grant execute on function public.request_sync(uuid, public.sync_job_type) to authenticated;
grant execute on function public.set_public_data_viewer(uuid) to authenticated;
grant execute on function public.clear_public_data_viewer(text, uuid) to authenticated;
grant execute on function public.remove_profile_and_data(uuid) to authenticated;
