-- Phase 6: review and approval.
--
-- Content moves through its stages only by the rules below. Moves that need a decision
-- (submit, withdraw, approve, request changes, reject, schedule, publish) go through
-- functions that check who is asking; direct updates can only make the simple moves
-- (idea and draft, archive and restore). Every stage change is recorded in
-- content_events, every decision in content_reviews, and neither can be edited.
-- Comments can mention members; mentions, review requests and decisions become in-app
-- notifications.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

create type public.review_decision as enum ('APPROVED', 'CHANGES_REQUESTED', 'REJECTED');

alter table public.content_versions
  add column submitted_by uuid references public.profiles (id) on delete set null;

alter table public.content_items
  add column published_post_id uuid,
  add foreign key (published_post_id, organization_id)
    references public.posts (id, organization_id) on delete set null (published_post_id);

-- Decisions. Append-only: nobody edits or deletes a decision.
create table public.content_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  content_version_id uuid not null references public.content_versions (id) on delete cascade,
  reviewer_id uuid references public.profiles (id) on delete set null,
  decision public.review_decision not null,
  comment text check (comment is null or char_length(comment) between 1 and 5000),
  created_at timestamptz not null default now(),
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);
create index content_reviews_item_idx on public.content_reviews (content_item_id, created_at);

-- Every stage change, written by the database.
create table public.content_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  content_version_id uuid references public.content_versions (id) on delete set null,
  from_status public.content_status,
  to_status public.content_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);
create index content_events_item_idx on public.content_events (content_item_id, created_at);

create table public.content_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  content_item_id uuid not null,
  content_version_id uuid references public.content_versions (id) on delete set null,
  parent_id uuid references public.content_comments (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);
create index content_comments_item_idx on public.content_comments (content_item_id, created_at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in
    ('review_requested', 'approved', 'changes_requested', 'rejected', 'mentioned', 'commented')),
  content_item_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  excerpt text check (excerpt is null or char_length(excerpt) <= 300),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index content_items_review_idx on public.content_items (organization_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- Sends one notification per recipient, never to the person who caused it.
create or replace function public.notify_members(
  org uuid, recipients uuid[], kind text, item_id uuid, excerpt text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (organization_id, user_id, kind, content_item_id, actor_id, excerpt)
  select org, r, kind, item_id, auth.uid(), left(excerpt, 300)
  from (select distinct unnest(recipients) r) recipients
  where r is not null
    and r is distinct from auth.uid()
    and exists (
      select 1 from public.organization_members m where m.organization_id = org and m.user_id = r
    );
$$;
revoke all on function public.notify_members(uuid, uuid[], text, uuid, text) from public, anon, authenticated;

-- Members who may decide on content (content.approve).
create or replace function public.content_reviewers(org uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.user_id), '{}')
  from public.organization_members m
  join public.role_permissions rp on rp.role = m.role and rp.permission_key = 'content.approve'
  where m.organization_id = org;
$$;
revoke all on function public.content_reviewers(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What people can change directly
-- ---------------------------------------------------------------------------

-- Replaces the Phase 5 guard. Adds: what a reviewer saw (title, platforms, country,
-- taxonomy) is locked from review onwards, and archiving approved content needs a reviewer.
create or replace function public.content_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  platform text;
begin
  foreach platform in array new.platform_keys loop
    if not exists (select 1 from public.platforms p where p.key = platform) then
      raise exception 'Unknown platform %', platform using errcode = '23514';
    end if;
  end loop;
  if cardinality(new.platform_keys) <> (select count(distinct k) from unnest(new.platform_keys) k) then
    raise exception 'A platform is listed twice' using errcode = '23514';
  end if;
  if new.owner_user_id is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.owner_user_id
  ) then
    raise exception 'The owner must be a member of the organization' using errcode = '23514';
  end if;

  if not public.is_end_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status not in ('IDEA', 'DRAFT') then
      raise exception 'New content starts as an idea or a draft' using errcode = '42501';
    end if;
    new.created_by := auth.uid();
    new.current_version_id := null;
    new.published_at := null;
    new.published_post_id := null;
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.current_version_id := old.current_version_id;
  new.published_at := old.published_at;
  new.published_post_id := old.published_post_id;
  if new.organization_id <> old.organization_id then
    raise exception 'Content cannot be moved between organizations' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'IDEA' and new.status in ('DRAFT', 'ARCHIVED'))
    or (old.status = 'DRAFT' and new.status in ('IDEA', 'ARCHIVED'))
    or (old.status in ('CHANGES_REQUESTED', 'REJECTED') and new.status = 'ARCHIVED')
    or (old.status in ('APPROVED', 'SCHEDULED') and new.status = 'ARCHIVED'
        and public.has_org_permission(old.organization_id, 'content.approve'))
    or (old.status = 'ARCHIVED' and new.status = 'DRAFT')
  ) then
    raise exception 'Content can''t move from % to % here', old.status, new.status
      using errcode = '42501';
  end if;

  if old.status in ('IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'ANALYSED', 'REJECTED') and (
    new.title is distinct from old.title
    or new.platform_keys is distinct from old.platform_keys
    or new.country_code is distinct from old.country_code
    or new.pillar_id is distinct from old.pillar_id
    or new.content_format_id is distinct from old.content_format_id
    or new.campaign_id is distinct from old.campaign_id
    or new.audience_id is distinct from old.audience_id
    or new.cta_type_id is distinct from old.cta_type_id
  ) then
    raise exception 'This content is % and its details are locked. Start a new version to change them.',
      lower(replace(old.status::text, '_', ' ')) using errcode = '42501';
  end if;
  if old.status in ('PUBLISHED', 'ANALYSED')
    and new.planned_publish_at is distinct from old.planned_publish_at then
    raise exception 'Published content keeps its date' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Versions keep who submitted them.
create or replace function public.content_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_end_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Use create_content_version() to add a version' using errcode = '42501';
  end if;
  if old.submitted_at is not null then
    raise exception 'A submitted version can''t be changed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.content_items i where i.id = old.content_item_id and i.current_version_id = old.id
  ) then
    raise exception 'Only the current version can be changed' using errcode = '42501';
  end if;
  new.id := old.id;
  new.organization_id := old.organization_id;
  new.content_item_id := old.content_item_id;
  new.version_number := old.version_number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.submitted_at := old.submitted_at;
  new.submitted_by := old.submitted_by;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Stage history
-- ---------------------------------------------------------------------------

create or replace function public.content_items_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;
  insert into public.content_events
    (organization_id, content_item_id, content_version_id, from_status, to_status, actor_id, note)
  values
    (new.organization_id, new.id, new.current_version_id,
     case when tg_op = 'UPDATE' then old.status end, new.status, auth.uid(),
     nullif(current_setting('scopie.event_note', true), ''));
  perform set_config('scopie.event_note', '', true);
  return new;
end;
$$;

create trigger content_items_record_event
  after insert or update of status on public.content_items
  for each row execute function public.content_items_record_event();

-- Earlier content gets a starting point in its history.
insert into public.content_events (organization_id, content_item_id, content_version_id, to_status, actor_id, note, created_at)
select organization_id, id, current_version_id, status, created_by, 'Created before stage history was kept', created_at
from public.content_items;

-- ---------------------------------------------------------------------------
-- 5. Moves that need a decision
-- ---------------------------------------------------------------------------

-- Loads an item for a move, checking permission. Locks the row so two people can't
-- decide at once.
create or replace function public.content_item_for_move(item_id uuid, permission text)
returns public.content_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items;
begin
  select * into item from public.content_items where id = item_id for update;
  if item.id is null or not public.is_org_member(item.organization_id) then
    raise exception 'Content not found' using errcode = '42501';
  end if;
  if not public.has_org_permission(item.organization_id, permission) then
    raise exception 'You don''t have permission to do this' using errcode = '42501';
  end if;
  return item;
end;
$$;
revoke all on function public.content_item_for_move(uuid, text) from public, anon, authenticated;

create or replace function public.submit_content_for_review(item_id uuid, note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.edit');
  version public.content_versions;
begin
  if item.status not in ('IDEA', 'DRAFT', 'CHANGES_REQUESTED') then
    raise exception 'Only ideas, drafts and content with requested changes can be submitted'
      using errcode = '42501';
  end if;
  select * into version from public.content_versions where id = item.current_version_id;
  if version.submitted_at is not null then
    raise exception 'This version was already reviewed. Start a new version with the changes first.'
      using errcode = '42501';
  end if;
  if cardinality(item.platform_keys) = 0 then
    raise exception 'Choose at least one platform before submitting' using errcode = '23514';
  end if;
  if coalesce(btrim(version.caption), '') = '' and coalesce(btrim(version.description), '') = ''
    and not exists (select 1 from public.content_assets a where a.content_version_id = version.id) then
    raise exception 'Add a caption, a brief or a file before submitting' using errcode = '23514';
  end if;

  update public.content_versions set submitted_at = now(), submitted_by = auth.uid()
  where id = version.id;
  perform set_config('scopie.event_note', coalesce(left(btrim(note), 1000), ''), true);
  update public.content_items set status = 'IN_REVIEW', updated_at = now() where id = item.id;
  perform public.notify_members(item.organization_id, public.content_reviewers(item.organization_id),
    'review_requested', item.id, nullif(btrim(note), ''));
end;
$$;

-- Takes content back out of review before anyone decides; the version can be edited again.
create or replace function public.withdraw_content_from_review(item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.edit');
begin
  if item.status <> 'IN_REVIEW' then
    raise exception 'This content isn''t in review' using errcode = '42501';
  end if;
  update public.content_versions set submitted_at = null, submitted_by = null
  where id = item.current_version_id;
  perform set_config('scopie.event_note', 'Withdrawn from review', true);
  update public.content_items set status = 'DRAFT', updated_at = now() where id = item.id;
end;
$$;

-- Approve, request changes or reject. Managers can't decide on a version they submitted
-- themselves; admins and owners can.
create or replace function public.review_content(
  item_id uuid, decision public.review_decision, comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.approve');
  version public.content_versions;
  clean text := nullif(btrim(comment), '');
begin
  if item.status <> 'IN_REVIEW' then
    raise exception 'This content isn''t waiting for review' using errcode = '42501';
  end if;
  if decision in ('CHANGES_REQUESTED', 'REJECTED') and clean is null then
    raise exception 'Say what needs to change, or why it''s rejected' using errcode = '23514';
  end if;
  select * into version from public.content_versions where id = item.current_version_id;
  if version.submitted_by = auth.uid()
    and public.org_role_of(item.organization_id) not in ('OWNER', 'ADMIN') then
    raise exception 'You submitted this version, so someone else has to review it'
      using errcode = '42501';
  end if;

  insert into public.content_reviews
    (organization_id, content_item_id, content_version_id, reviewer_id, decision, comment)
  values (item.organization_id, item.id, version.id, auth.uid(), decision, clean);
  perform set_config('scopie.event_note', coalesce(clean, ''), true);
  update public.content_items set status = decision::text::public.content_status, updated_at = now()
  where id = item.id;
  perform public.notify_members(item.organization_id,
    array[item.owner_user_id, version.submitted_by, item.created_by],
    lower(decision::text), item.id, clean);
end;
$$;

-- Approved content is marked scheduled once it's queued in the publishing tool. Scopie
-- doesn't publish by itself.
create or replace function public.set_content_scheduled(item_id uuid, scheduled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.edit');
begin
  if scheduled then
    if item.status <> 'APPROVED' then
      raise exception 'Only approved content can be scheduled' using errcode = '42501';
    end if;
    if item.planned_publish_at is null then
      raise exception 'Give it a publish date first' using errcode = '23514';
    end if;
    update public.content_items set status = 'SCHEDULED', updated_at = now() where id = item.id;
  else
    if item.status <> 'SCHEDULED' then
      raise exception 'This content isn''t scheduled' using errcode = '42501';
    end if;
    update public.content_items set status = 'APPROVED', updated_at = now() where id = item.id;
  end if;
end;
$$;

-- Marks approved or scheduled content as published, optionally linking the post it became.
create or replace function public.mark_content_published(
  item_id uuid, published timestamptz default null, post_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.edit');
  post_time timestamptz;
begin
  if item.status not in ('APPROVED', 'SCHEDULED') then
    raise exception 'Only approved content can be marked as published' using errcode = '42501';
  end if;
  if post_id is not null then
    select p.published_at into post_time from public.posts p
    where p.id = post_id and p.organization_id = item.organization_id;
    if not found then
      raise exception 'Post not found' using errcode = '23514';
    end if;
  end if;
  if coalesce(published, post_time, now()) > now() + interval '5 minutes' then
    raise exception 'A publish time can''t be in the future' using errcode = '23514';
  end if;
  update public.content_items
  set status = 'PUBLISHED', published_at = coalesce(published, post_time, now()),
      published_post_id = post_id, updated_at = now()
  where id = item.id;
end;
$$;

-- New versions: approved or scheduled content goes back to draft, because what was
-- approved is changing. Content with requested changes stays there until resubmitted.
create or replace function public.create_content_version(item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items := public.content_item_for_move(item_id, 'content.edit');
  current public.content_versions;
  new_id uuid;
begin
  if item.status not in ('IDEA', 'DRAFT', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'REJECTED') then
    raise exception 'Content that is % can''t get a new version',
      lower(replace(item.status::text, '_', ' ')) using errcode = '42501';
  end if;
  select * into current from public.content_versions where id = item.current_version_id;

  insert into public.content_versions
    (organization_id, content_item_id, version_number, description, caption, cta, hashtags, notes, created_by)
  values
    (item.organization_id, item.id, current.version_number + 1, current.description, current.caption,
     current.cta, current.hashtags, current.notes, auth.uid())
  returning id into new_id;

  insert into public.content_assets
    (organization_id, content_item_id, content_version_id, storage_path, file_name, mime_type, bytes,
     width, height, position, created_by)
  select organization_id, content_item_id, new_id, storage_path, file_name, mime_type, bytes,
         width, height, position, created_by
  from public.content_assets where content_version_id = current.id;

  if item.status in ('APPROVED', 'SCHEDULED', 'REJECTED') then
    perform set_config('scopie.event_note',
      case when item.status = 'REJECTED' then 'Reworked as a new version'
           else 'Approval no longer applies: a new version was started' end, true);
    update public.content_items set current_version_id = new_id, status = 'DRAFT', updated_at = now()
    where id = item.id;
  else
    update public.content_items set current_version_id = new_id, updated_at = now() where id = item.id;
  end if;
  return new_id;
end;
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'submit_content_for_review(uuid, text)', 'withdraw_content_from_review(uuid)',
    'review_content(uuid, public.review_decision, text)', 'set_content_scheduled(uuid, boolean)',
    'mark_content_published(uuid, timestamptz, uuid)', 'create_content_version(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Comments
-- ---------------------------------------------------------------------------

create or replace function public.content_comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mention uuid;
begin
  if not public.is_end_user() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.created_at := now();
    new.edited_at := null;
    new.resolved_at := null;
    new.resolved_by := null;
    select current_version_id into new.content_version_id
    from public.content_items where id = new.content_item_id;
    if new.parent_id is not null and not exists (
      select 1 from public.content_comments c
      where c.id = new.parent_id and c.content_item_id = new.content_item_id and c.parent_id is null
    ) then
      raise exception 'Replies go under a comment on the same content' using errcode = '23514';
    end if;
  else
    new.id := old.id;
    new.organization_id := old.organization_id;
    new.content_item_id := old.content_item_id;
    new.content_version_id := old.content_version_id;
    new.parent_id := old.parent_id;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    if new.body is distinct from old.body or new.mentions is distinct from old.mentions then
      if old.author_id is distinct from auth.uid() then
        raise exception 'Only the author can edit a comment' using errcode = '42501';
      end if;
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
    if new.resolved_at is distinct from old.resolved_at then
      new.resolved_at := case when new.resolved_at is null then null else now() end;
      new.resolved_by := case when new.resolved_at is null then null else auth.uid() end;
    else
      new.resolved_by := old.resolved_by;
    end if;
  end if;

  new.mentions := array(select distinct m from unnest(new.mentions) m);
  foreach mention in array new.mentions loop
    if not exists (
      select 1 from public.organization_members m
      where m.organization_id = new.organization_id and m.user_id = mention
    ) then
      raise exception 'You can only mention members of this organization' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;

create trigger content_comments_guard
  before insert or update on public.content_comments
  for each row execute function public.content_comments_guard();

-- Mentioned members are notified; the content's owner hears about other comments.
create or replace function public.content_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items;
  new_mentions uuid[];
begin
  select * into item from public.content_items where id = new.content_item_id;
  new_mentions := case when tg_op = 'INSERT' then new.mentions
    else array(select m from unnest(new.mentions) m where not m = any(old.mentions)) end;
  perform public.notify_members(new.organization_id, new_mentions, 'mentioned', new.content_item_id, new.body);
  if tg_op = 'INSERT' and item.owner_user_id is not null and not item.owner_user_id = any(new.mentions) then
    perform public.notify_members(new.organization_id, array[item.owner_user_id], 'commented',
      new.content_item_id, new.body);
  end if;
  return new;
end;
$$;

create trigger content_comments_notify
  after insert or update of mentions on public.content_comments
  for each row execute function public.content_comments_notify();

-- ---------------------------------------------------------------------------
-- 7. Notifications
-- ---------------------------------------------------------------------------

-- People can only mark their own notifications read or unread.
create or replace function public.notifications_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_end_user() and (
    new.id <> old.id or new.organization_id <> old.organization_id or new.user_id <> old.user_id
    or new.kind <> old.kind or new.content_item_id is distinct from old.content_item_id
    or new.actor_id is distinct from old.actor_id or new.excerpt is distinct from old.excerpt
    or new.created_at <> old.created_at
  ) then
    raise exception 'Only read status can change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard
  before update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------------
-- 8. Access
-- ---------------------------------------------------------------------------

alter table public.content_reviews enable row level security;
alter table public.content_events enable row level security;
alter table public.content_comments enable row level security;
alter table public.notifications enable row level security;

create policy "members read content reviews" on public.content_reviews for select to authenticated
  using (public.is_org_member(organization_id));
create policy "members read content events" on public.content_events for select to authenticated
  using (public.is_org_member(organization_id));

create policy "members read content comments" on public.content_comments for select to authenticated
  using (public.is_org_member(organization_id));
create policy "editors comment" on public.content_comments for insert to authenticated
  with check (public.has_org_permission(organization_id, 'content.edit'));
create policy "editors edit or resolve comments" on public.content_comments for update to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));
create policy "authors delete their comments" on public.content_comments for delete to authenticated
  using (author_id = auth.uid() and public.is_org_member(organization_id));

create policy "people read their notifications" on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id));
create policy "people mark their notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.content_reviews, public.content_events, public.content_comments, public.notifications from anon;
revoke insert, update, delete on public.content_reviews, public.content_events from authenticated;
revoke insert, delete on public.notifications from authenticated;

create trigger content_comments_log
  after insert or update or delete on public.content_comments
  for each row execute function public.log_activity();
