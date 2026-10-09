-- Phase 9: weekly intelligence reports.
--
-- One report per organization per week (Monday to Sunday in the organization's time zone),
-- made automatically on Monday or on request by a manager. The report is a snapshot: every
-- number and sentence is stored at the moment it is made and never recomputed, so it reads
-- the same later. Reports are written only by the server (service role), after a
-- permission check for manual ones; members read them.

create type public.report_trigger as enum ('schedule', 'manual');

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null default 'weekly' check (kind in ('weekly')),
  -- Monday and Sunday of the week, in time_zone.
  period_start date not null,
  period_end date not null,
  time_zone text not null,
  title text not null check (char_length(title) between 1 and 200),
  data_source public.data_source not null,
  snapshot jsonb not null,
  -- The analysis whose insights and recommendations the report quotes.
  analysis_run_id uuid,
  made_by public.report_trigger not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, kind, period_start),
  check (period_end = period_start + 6),
  check (extract(isodow from period_start) = 1),
  foreign key (analysis_run_id, organization_id)
    references public.analysis_runs (id, organization_id) on delete set null (analysis_run_id)
);
create index reports_org_idx on public.reports (organization_id, period_start desc);

alter table public.reports enable row level security;
create policy "members read reports" on public.reports
  for select to authenticated using (public.is_org_member(organization_id));
revoke all on public.reports from anon;
revoke insert, update, delete on public.reports from authenticated;

-- Members hear about a new report in the app.
alter table public.notifications
  add column report_id uuid,
  add foreign key (report_id, organization_id)
    references public.reports (id, organization_id) on delete cascade;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (kind in
  ('review_requested', 'approved', 'changes_requested', 'rejected', 'mentioned', 'commented', 'report_ready'));
alter table public.notifications add constraint notifications_report_kind check (
  (kind = 'report_ready') = (report_id is not null)
);
