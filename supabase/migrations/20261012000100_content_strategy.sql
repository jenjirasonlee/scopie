-- Phase 7: content strategy.
--
-- A strategy covers a period and a scope (markets and platforms; empty means all). It has
-- objectives with a KPI and a target, target shares per content pillar, audiences, tone of
-- voice, priorities and the competitors it watches. Content items can link to one objective.
-- Coverage and KPI progress are computed by the app from stored content and observations,
-- never stored here, so a strategy can't claim results nobody measured.

create type public.strategy_status as enum ('draft', 'active', 'archived');

-- How an objective is measured.
--   published_content: content items marked published in scope during the period (Scopie data)
--   posts_per_week:    observed posts of the organization's own profiles in scope, per week
--   follower_growth:   observed follower growth of own profiles in scope over the period
--   manual:            tracked outside Scopie; the strategy shows the target only
create type public.strategy_kpi as enum ('published_content', 'posts_per_week', 'follower_growth', 'manual');

create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  summary text check (summary is null or char_length(summary) <= 2000),
  status public.strategy_status not null default 'draft',
  period_start date not null,
  period_end date not null,
  country_codes text[] not null default '{}' check (cardinality(country_codes) <= 60),
  platform_keys text[] not null default '{}' check (cardinality(platform_keys) <= 10),
  tone_of_voice text check (tone_of_voice is null or char_length(tone_of_voice) <= 2000),
  priorities text[] not null default '{}' check (cardinality(priorities) <= 10),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  check (period_end >= period_start),
  check (period_end - period_start <= 731)
);
create index strategies_org_idx on public.strategies (organization_id, status, period_start desc);

create table public.strategy_objectives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  strategy_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  kpi public.strategy_kpi not null default 'manual',
  target_value numeric check (target_value is null or target_value >= 0),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (strategy_id, organization_id)
    references public.strategies (id, organization_id) on delete cascade,
  check (kpi = 'manual' or target_value is not null)
);
create index strategy_objectives_strategy_idx on public.strategy_objectives (strategy_id, position);

create table public.strategy_pillars (
  organization_id uuid not null,
  strategy_id uuid not null,
  pillar_id uuid not null,
  target_share numeric not null check (target_share > 0 and target_share <= 100),
  primary key (strategy_id, pillar_id),
  foreign key (strategy_id, organization_id)
    references public.strategies (id, organization_id) on delete cascade,
  foreign key (pillar_id, organization_id)
    references public.content_pillars (id, organization_id) on delete cascade
);

create table public.strategy_audiences (
  organization_id uuid not null,
  strategy_id uuid not null,
  audience_id uuid not null,
  primary key (strategy_id, audience_id),
  foreign key (strategy_id, organization_id)
    references public.strategies (id, organization_id) on delete cascade,
  foreign key (audience_id, organization_id)
    references public.audiences (id, organization_id) on delete cascade
);

alter table public.social_accounts add unique (id, organization_id);

create table public.strategy_competitors (
  organization_id uuid not null,
  strategy_id uuid not null,
  social_account_id uuid not null,
  primary key (strategy_id, social_account_id),
  foreign key (strategy_id, organization_id)
    references public.strategies (id, organization_id) on delete cascade,
  foreign key (social_account_id, organization_id)
    references public.social_accounts (id, organization_id) on delete cascade
);

-- Content can serve one objective of a strategy in the same organization.
alter table public.content_items
  add column strategy_objective_id uuid,
  add foreign key (strategy_objective_id, organization_id)
    references public.strategy_objectives (id, organization_id) on delete set null (strategy_objective_id);
create index content_items_objective_idx on public.content_items (strategy_objective_id)
  where strategy_objective_id is not null;

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

create or replace function public.strategies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  entry text;
begin
  new.name := btrim(new.name);
  new.country_codes := array(select distinct upper(c) from unnest(new.country_codes) c order by 1);
  new.platform_keys := array(select distinct p from unnest(new.platform_keys) p order by 1);
  new.priorities := array(
    select btrim(p) from unnest(new.priorities) with ordinality as t(p, n)
    where btrim(p) <> '' order by n
  );
  foreach entry in array new.country_codes loop
    if not exists (select 1 from public.countries c where c.code = entry) then
      raise exception 'Unknown country %', entry using errcode = '23514';
    end if;
  end loop;
  foreach entry in array new.platform_keys loop
    if not exists (select 1 from public.platforms p where p.key = entry) then
      raise exception 'Unknown platform %', entry using errcode = '23514';
    end if;
  end loop;
  if exists (select 1 from unnest(new.priorities) p where char_length(p) > 200) then
    raise exception 'Keep each priority under 200 characters' using errcode = '23514';
  end if;

  if not public.is_end_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.id := old.id;
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger strategies_guard
  before insert or update on public.strategies
  for each row execute function public.strategies_guard();
create trigger strategies_updated_at
  before update on public.strategies
  for each row execute function public.set_updated_at();

-- Pillar targets add up to at most 100% per strategy.
create or replace function public.strategy_pillars_check_total()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select coalesce(sum(target_share), 0) from public.strategy_pillars where strategy_id = new.strategy_id) > 100 then
    raise exception 'Pillar targets add up to more than 100%%' using errcode = '23514';
  end if;
  return null;
end;
$$;

create constraint trigger strategy_pillars_check_total
  after insert or update on public.strategy_pillars
  deferrable initially deferred
  for each row execute function public.strategy_pillars_check_total();

-- Competitors are profiles the organization tracks as competitors.
create or replace function public.strategy_competitors_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.social_accounts a
    where a.id = new.social_account_id and a.business_role = 'competitor'
  ) then
    raise exception 'Only profiles marked as competitors can be added' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger strategy_competitors_guard
  before insert or update on public.strategy_competitors
  for each row execute function public.strategy_competitors_guard();

-- Objectives keep their strategy and organization.
create or replace function public.strategy_objectives_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.organization_id := old.organization_id;
    new.strategy_id := old.strategy_id;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger strategy_objectives_guard
  before insert or update on public.strategy_objectives
  for each row execute function public.strategy_objectives_guard();

-- ---------------------------------------------------------------------------
-- Access: members read; managers, admins and owners write (strategy.manage).
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['strategies', 'strategy_objectives', 'strategy_pillars', 'strategy_audiences', 'strategy_competitors'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "members read %1$s" on public.%1$I for select to authenticated using (public.is_org_member(organization_id))', t);
    execute format(
      'create policy "managers add %1$s" on public.%1$I for insert to authenticated with check (public.has_org_permission(organization_id, ''strategy.manage''))', t);
    execute format(
      'create policy "managers change %1$s" on public.%1$I for update to authenticated using (public.has_org_permission(organization_id, ''strategy.manage'')) with check (public.has_org_permission(organization_id, ''strategy.manage''))', t);
    execute format(
      'create policy "managers remove %1$s" on public.%1$I for delete to authenticated using (public.has_org_permission(organization_id, ''strategy.manage''))', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end;
$$;

create trigger strategies_log
  after insert or update or delete on public.strategies
  for each row execute function public.log_activity();
create trigger strategy_objectives_log
  after insert or update or delete on public.strategy_objectives
  for each row execute function public.log_activity();
