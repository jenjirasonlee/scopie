-- Scopie Phase 1: platforms, countries, social accounts, account groups, activity log.
-- See docs/DATABASE.md §4. Platform connections and encrypted credentials arrive in Phase 4.

-- ---------------------------------------------------------------------------
-- Global reference data
-- ---------------------------------------------------------------------------

create type public.platform_connector_status as enum ('available', 'planned', 'demo_only');

create table public.platforms (
  key text primary key,
  name text not null,
  connector_status public.platform_connector_status not null default 'planned',
  sort_order int not null default 100
);

-- No platform has a live connector yet (the Meta connector is Phase 4).
insert into public.platforms (key, name, connector_status, sort_order) values
  ('instagram', 'Instagram', 'planned', 10),
  ('facebook',  'Facebook',  'planned', 20),
  ('linkedin',  'LinkedIn',  'planned', 30),
  ('youtube',   'YouTube',   'planned', 40),
  ('tiktok',    'TikTok',    'planned', 50),
  ('x',         'X',         'planned', 60),
  ('reddit',    'Reddit',    'planned', 70),
  ('discord',   'Discord',   'planned', 80);

create table public.countries (
  code char(2) primary key,
  name text not null,
  constraint countries_code_upper check (code = upper(code))
);

-- ISO 3166-1 alpha-2. A practical subset for launch; extend via migration as needed.
insert into public.countries (code, name) values
  ('AR','Argentina'),('AT','Austria'),('AU','Australia'),('BE','Belgium'),('BG','Bulgaria'),
  ('BR','Brazil'),('CA','Canada'),('CH','Switzerland'),('CL','Chile'),('CN','China'),
  ('CO','Colombia'),('CY','Cyprus'),('CZ','Czechia'),('DE','Germany'),('DK','Denmark'),
  ('EE','Estonia'),('ES','Spain'),('FI','Finland'),('FR','France'),('GB','United Kingdom'),
  ('GR','Greece'),('HR','Croatia'),('HU','Hungary'),('IE','Ireland'),('IL','Israel'),
  ('IN','India'),('IS','Iceland'),('IT','Italy'),('JP','Japan'),('KR','South Korea'),
  ('LT','Lithuania'),('LU','Luxembourg'),('LV','Latvia'),('MA','Morocco'),('MT','Malta'),
  ('MX','Mexico'),('NL','Netherlands'),('NO','Norway'),('NZ','New Zealand'),('PE','Peru'),
  ('PL','Poland'),('PT','Portugal'),('RO','Romania'),('RS','Serbia'),('SE','Sweden'),
  ('SG','Singapore'),('SI','Slovenia'),('SK','Slovakia'),('TH','Thailand'),('TR','Türkiye'),
  ('UA','Ukraine'),('US','United States'),('UY','Uruguay'),('ZA','South Africa');

alter table public.platforms enable row level security;
alter table public.countries enable row level security;

create policy "platforms are readable by signed-in users"
  on public.platforms for select to authenticated using (true);
create policy "countries are readable by signed-in users"
  on public.countries for select to authenticated using (true);

revoke all on public.platforms, public.countries from anon;
revoke insert, update, delete on public.platforms, public.countries from authenticated;

-- ---------------------------------------------------------------------------
-- Social accounts
-- ---------------------------------------------------------------------------

create type public.account_connection_status as enum
  ('not_connected', 'connected', 'needs_reauth', 'error', 'demo');

create type public.data_source as enum
  ('live_api', 'public_api', 'manual', 'import', 'demo');

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  platform_key text not null references public.platforms (key),
  display_name text not null,
  handle text,
  external_id text,
  account_type text,
  country_code char(2) references public.countries (code),
  language text,
  timezone text,
  owner_user_id uuid references public.profiles (id) on delete set null,
  is_competitor boolean not null default false,
  is_active boolean not null default true,
  connection_status public.account_connection_status not null default 'not_connected',
  primary_data_source public.data_source not null default 'manual',
  last_successful_sync_at timestamptz,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_accounts_display_name_length check (char_length(display_name) between 1 and 120),
  constraint social_accounts_handle_length check (char_length(handle) <= 120),
  constraint social_accounts_language_format check (language is null or language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  constraint social_accounts_notes_length check (char_length(notes) <= 2000)
);

create index social_accounts_org_idx on public.social_accounts (organization_id);
create index social_accounts_org_country_idx on public.social_accounts (organization_id, country_code);
create index social_accounts_org_platform_idx on public.social_accounts (organization_id, platform_key);
create unique index social_accounts_unique_handle
  on public.social_accounts (organization_id, platform_key, lower(handle))
  where handle is not null;
create unique index social_accounts_unique_external_id
  on public.social_accounts (organization_id, platform_key, external_id)
  where external_id is not null;

create trigger social_accounts_set_updated_at
  before update on public.social_accounts
  for each row execute function public.set_updated_at();

-- Connection fields can only be written by trusted server code (the sync engine,
-- seed scripts). End users can never mark an account as connected or live.
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
    new.created_by := auth.uid();
  else
    new.connection_status := old.connection_status;
    new.primary_data_source := old.primary_data_source;
    new.last_successful_sync_at := old.last_successful_sync_at;
    new.created_by := old.created_by;
    if new.organization_id <> old.organization_id then
      raise exception 'Accounts cannot be moved between organizations' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger social_accounts_protect_connection_fields
  before insert or update on public.social_accounts
  for each row execute function public.social_accounts_protect_connection_fields();

-- An account owner must be a member of the account's organization.
create or replace function public.social_accounts_check_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_user_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.owner_user_id
  ) then
    raise exception 'Account owner must be a member of the organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger social_accounts_check_owner
  before insert or update of owner_user_id, organization_id on public.social_accounts
  for each row execute function public.social_accounts_check_owner();

alter table public.social_accounts enable row level security;

create policy "members read social accounts"
  on public.social_accounts for select to authenticated
  using (public.is_org_member(organization_id));

create policy "account managers add social accounts"
  on public.social_accounts for insert to authenticated
  with check (public.has_org_permission(organization_id, 'accounts.manage'));

create policy "account managers edit social accounts"
  on public.social_accounts for update to authenticated
  using (public.has_org_permission(organization_id, 'accounts.manage'))
  with check (public.has_org_permission(organization_id, 'accounts.manage'));

-- No delete policy: accounts are deactivated, not deleted, so history survives.
revoke all on public.social_accounts from anon;
revoke delete on public.social_accounts from authenticated;

-- ---------------------------------------------------------------------------
-- Account groups (regions, custom sets). UI arrives in Phase 2; country grouping
-- uses social_accounts.country_code directly.
-- ---------------------------------------------------------------------------

create table public.account_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  kind text not null default 'custom',
  created_at timestamptz not null default now(),
  constraint account_groups_kind check (kind in ('region', 'custom')),
  constraint account_groups_name_length check (char_length(name) between 1 and 80),
  unique (organization_id, name)
);

create table public.account_group_members (
  group_id uuid not null references public.account_groups (id) on delete cascade,
  social_account_id uuid not null references public.social_accounts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  primary key (group_id, social_account_id)
);

create index account_group_members_org_idx on public.account_group_members (organization_id);

-- Group and account must belong to the same organization as the membership row.
create or replace function public.account_group_members_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.account_groups g where g.id = new.group_id and g.organization_id = new.organization_id)
     or not exists (select 1 from public.social_accounts a where a.id = new.social_account_id and a.organization_id = new.organization_id) then
    raise exception 'Group and account must belong to the same organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger account_group_members_same_org
  before insert or update on public.account_group_members
  for each row execute function public.account_group_members_same_org();

alter table public.account_groups enable row level security;
alter table public.account_group_members enable row level security;

create policy "members read account groups"
  on public.account_groups for select to authenticated
  using (public.is_org_member(organization_id));
create policy "account managers write account groups"
  on public.account_groups for all to authenticated
  using (public.has_org_permission(organization_id, 'accounts.manage'))
  with check (public.has_org_permission(organization_id, 'accounts.manage'));

create policy "members read account group membership"
  on public.account_group_members for select to authenticated
  using (public.is_org_member(organization_id));
create policy "account managers write account group membership"
  on public.account_group_members for all to authenticated
  using (public.has_org_permission(organization_id, 'accounts.manage'))
  with check (public.has_org_permission(organization_id, 'accounts.manage'));

revoke all on public.account_groups, public.account_group_members from anon;

-- ---------------------------------------------------------------------------
-- Activity log (audit). Written only by triggers.
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  changes jsonb,
  created_at timestamptz not null default now()
);

create index activity_log_org_created_idx on public.activity_log (organization_id, created_at desc);

create or replace function public.log_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
  prev jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else null end;
  diff jsonb;
  org uuid;
  entity text;
begin
  org := case when tg_table_name = 'organizations' then (rec ->> 'id')::uuid
              else (rec ->> 'organization_id')::uuid end;
  entity := coalesce(rec ->> 'id', rec ->> 'user_id');
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(k, jsonb_build_object('from', prev -> k, 'to', rec -> k))
      into diff
    from jsonb_object_keys(rec) k
    where k not in ('updated_at') and rec -> k is distinct from prev -> k;
    if diff is null then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    diff := rec;
  end if;
  -- Skip logging deletes cascading from an organization delete.
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = org) then
    return old;
  end if;
  insert into public.activity_log (organization_id, actor_id, action, entity_type, entity_id, changes)
  values (org, auth.uid(), lower(tg_op), tg_table_name, entity, diff);
  return coalesce(new, old);
end;
$$;

create trigger social_accounts_log
  after insert or update on public.social_accounts
  for each row execute function public.log_activity();
create trigger organization_members_log
  after insert or update or delete on public.organization_members
  for each row execute function public.log_activity();
create trigger organizations_log
  after update on public.organizations
  for each row execute function public.log_activity();

alter table public.activity_log enable row level security;

create policy "members read activity of their organizations"
  on public.activity_log for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.activity_log from anon;
revoke insert, update, delete on public.activity_log from authenticated;
