-- Phase 8: AI analyst + recommendations.
--
-- An analysis run turns stored data into insights and recommendations. The numbers are
-- computed by the app (lib/ai/signals) and saved with the run as evidence; the words come
-- either from Scopie's own rules or, when a model is configured on the server, from that
-- model, checked against the evidence before anything is saved. Runs, insights and
-- recommendations are written only by the server (service role) after a permission check,
-- so nobody can save an insight that the analysis didn't produce.

create type public.analysis_writer as enum ('rules', 'model');
create type public.analysis_run_status as enum ('succeeded', 'failed');
create type public.insight_severity as enum ('info', 'notable', 'important');
create type public.recommendation_confidence as enum ('low', 'medium', 'high');
create type public.recommendation_status as enum ('open', 'accepted', 'dismissed', 'done');

create table public.analysis_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- The data source every number was read from ('demo' in the demo organization).
  data_source public.data_source not null,
  writer public.analysis_writer not null,
  -- Set when writer = 'model'.
  provider text,
  model text,
  prompt_version text,
  status public.analysis_run_status not null,
  -- Every signal the analysis found, with its evidence. Insights cite these by id.
  signals jsonb not null default '[]'::jsonb,
  -- What the model wrote that failed the checks, and why (shown to managers).
  rejected jsonb not null default '[]'::jsonb,
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  check (period_end > period_start),
  check (writer = 'rules' or (provider is not null and model is not null))
);
create index analysis_runs_org_idx on public.analysis_runs (organization_id, created_at desc);

-- Audit of every model call (AI_ARCHITECTURE.md §1.5). Only what was sent and received;
-- never keys or tokens.
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid,
  purpose text not null check (purpose in ('insights')),
  provider text not null,
  model text not null,
  prompt_version text not null,
  input jsonb not null,
  output jsonb,
  error text,
  input_tokens int,
  output_tokens int,
  duration_ms int,
  created_at timestamptz not null default now(),
  foreign key (run_id, organization_id)
    references public.analysis_runs (id, organization_id) on delete cascade
);
create index ai_generations_org_idx on public.ai_generations (organization_id, created_at desc);

create table public.ai_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  kind text not null check (char_length(kind) between 1 and 40),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 1200),
  severity public.insight_severity not null default 'info',
  -- Ids of the run's signals this insight rests on, and a copy of their evidence.
  signal_ids text[] not null check (cardinality(signal_ids) >= 1),
  evidence jsonb not null,
  account_ids uuid[] not null default '{}',
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (run_id, organization_id)
    references public.analysis_runs (id, organization_id) on delete cascade
);
create index ai_insights_run_idx on public.ai_insights (run_id, position);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  insight_id uuid,
  title text not null check (char_length(title) between 1 and 160),
  observation text not null check (char_length(observation) between 1 and 1200),
  recommendation text not null check (char_length(recommendation) between 1 and 1200),
  expected_impact text not null check (char_length(expected_impact) between 1 and 600),
  -- Computed by lib/ai/confidence from sample size, effect size and consistency.
  confidence public.recommendation_confidence not null,
  confidence_basis text not null,
  signal_ids text[] not null check (cardinality(signal_ids) >= 1),
  evidence jsonb not null,
  account_ids uuid[] not null default '{}',
  experiment jsonb,
  position int not null default 0,
  status public.recommendation_status not null default 'open',
  status_note text check (status_note is null or char_length(status_note) <= 500),
  status_changed_by uuid references public.profiles (id) on delete set null,
  status_changed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (run_id, organization_id)
    references public.analysis_runs (id, organization_id) on delete cascade,
  foreign key (insight_id, organization_id)
    references public.ai_insights (id, organization_id) on delete set null (insight_id)
);
create index ai_recommendations_org_idx on public.ai_recommendations (organization_id, status, created_at desc);

-- Content ideas created from a recommendation keep the link.
alter table public.content_items
  add column source_recommendation_id uuid,
  add foreign key (source_recommendation_id, organization_id)
    references public.ai_recommendations (id, organization_id) on delete set null (source_recommendation_id);
create index content_items_recommendation_idx on public.content_items (source_recommendation_id)
  where source_recommendation_id is not null;

-- The link is set when the item is created and can't be changed by users afterwards.
create or replace function public.content_items_keep_recommendation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_end_user() then
    new.source_recommendation_id := old.source_recommendation_id;
  end if;
  return new;
end;
$$;

create trigger content_items_keep_recommendation
  before update on public.content_items
  for each row execute function public.content_items_keep_recommendation();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.analysis_runs enable row level security;
alter table public.ai_generations enable row level security;
alter table public.ai_insights enable row level security;
alter table public.ai_recommendations enable row level security;

create policy "members read analysis runs" on public.analysis_runs
  for select to authenticated using (public.is_org_member(organization_id));
create policy "members read insights" on public.ai_insights
  for select to authenticated using (public.is_org_member(organization_id));
create policy "members read recommendations" on public.ai_recommendations
  for select to authenticated using (public.is_org_member(organization_id));
-- The model audit is for the people who run analyses.
create policy "managers read model calls" on public.ai_generations
  for select to authenticated using (public.has_org_permission(organization_id, 'strategy.manage'));

revoke all on public.analysis_runs, public.ai_generations, public.ai_insights, public.ai_recommendations from anon;
revoke insert, update, delete on public.analysis_runs, public.ai_generations, public.ai_insights, public.ai_recommendations from authenticated;

-- Editors and up decide what happens to a recommendation. Only its status and note change.
create or replace function public.set_recommendation_status(
  recommendation_id uuid,
  new_status public.recommendation_status,
  note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.ai_recommendations;
begin
  select * into rec from public.ai_recommendations where id = recommendation_id for update;
  if rec.id is null or not public.has_org_permission(rec.organization_id, 'content.edit') then
    raise exception 'Recommendation not found' using errcode = '42501';
  end if;
  if note is not null and char_length(btrim(note)) > 500 then
    raise exception 'Keep the note under 500 characters' using errcode = '23514';
  end if;
  update public.ai_recommendations
  set status = new_status,
      status_note = nullif(btrim(coalesce(note, '')), ''),
      status_changed_by = auth.uid(),
      status_changed_at = now()
  where id = recommendation_id;
end;
$$;

revoke all on function public.set_recommendation_status(uuid, public.recommendation_status, text) from public, anon;
grant execute on function public.set_recommendation_status(uuid, public.recommendation_status, text) to authenticated;

create trigger ai_recommendations_log
  after update on public.ai_recommendations
  for each row execute function public.log_activity();
