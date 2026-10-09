-- Phase 11: Scopie AI chat and the content assistant.
--
-- Chat answers are computed by the app from read-only analytics tools that run as the
-- signed-in user (RLS applies). A conversation belongs to one person: nobody else in the
-- organization, not even its owner, can read it. Messages are never edited; people can clear
-- their own conversation.
--
-- Model calls of the chat and the content assistant are logged in ai_generations like the
-- analysis (Phase 8), now with the person who asked, which also drives the per-person limit.

-- ---------------------------------------------------------------------------
-- 1. Model call audit: new purposes and who asked
-- ---------------------------------------------------------------------------

alter table public.ai_generations drop constraint ai_generations_purpose_check;
alter table public.ai_generations
  add constraint ai_generations_purpose_check check (purpose in ('insights', 'chat', 'assistant')),
  add column user_id uuid references public.profiles (id) on delete set null;
create index ai_generations_user_idx on public.ai_generations (user_id, created_at desc)
  where user_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Chat messages
-- ---------------------------------------------------------------------------

create table public.ai_chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  -- Who wrote an answer: Scopie's own rules or a model (with its name). Null for questions.
  writer text check (writer in ('rules', 'model')),
  model text check (model is null or char_length(model) <= 100),
  -- The "Data used" panel: tools called, period, profiles, data source, notes.
  data_used jsonb,
  created_at timestamptz not null default now(),
  check ((role = 'user') = (writer is null)),
  check (writer = 'model' or model is null)
);
create index ai_chat_messages_user_idx
  on public.ai_chat_messages (organization_id, user_id, created_at desc);

alter table public.ai_chat_messages enable row level security;

create policy "people read their chat" on public.ai_chat_messages for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "people add to their chat" on public.ai_chat_messages for insert to authenticated
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "people clear their chat" on public.ai_chat_messages for delete to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));

revoke all on public.ai_chat_messages from anon;
revoke update on public.ai_chat_messages from authenticated;
