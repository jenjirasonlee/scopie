-- Phase 5: content hub. Content items, their versions and assets, plus small taxonomy
-- additions for the taxonomy screens and the calendar. Review and approval (comments,
-- reviews, the full status machine) are Phase 6; until then people can only move items
-- between IDEA and DRAFT, and archive them.

-- ---------------------------------------------------------------------------
-- 1. Taxonomy additions
-- ---------------------------------------------------------------------------

-- A pillar colour, chosen from a fixed palette, so the calendar can show pillars at a glance.
alter table public.content_pillars
  add column color text,
  add constraint content_pillars_color check (
    color is null or color in ('green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'red', 'orange', 'amber', 'gray')
  );

-- ---------------------------------------------------------------------------
-- 2. Content items, versions and assets
-- ---------------------------------------------------------------------------

create type public.content_status as enum (
  'IDEA', 'DRAFT', 'IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED',
  'ANALYSED', 'REJECTED', 'ARCHIVED'
);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null,
  status public.content_status not null default 'IDEA',
  current_version_id uuid,
  owner_user_id uuid references public.profiles (id) on delete set null,
  country_code char(2) references public.countries (code),
  platform_keys text[] not null default '{}',
  pillar_id uuid,
  content_format_id uuid,
  campaign_id uuid,
  audience_id uuid,
  cta_type_id uuid,
  planned_publish_at timestamptz,
  published_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint content_items_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint content_items_platforms_count check (cardinality(platform_keys) <= 10),
  unique (id, organization_id),
  foreign key (pillar_id, organization_id) references public.content_pillars (id, organization_id),
  foreign key (content_format_id, organization_id) references public.content_formats (id, organization_id),
  foreign key (campaign_id, organization_id) references public.campaigns (id, organization_id),
  foreign key (audience_id, organization_id) references public.audiences (id, organization_id),
  foreign key (cta_type_id, organization_id) references public.cta_types (id, organization_id)
);

create index content_items_org_planned_idx on public.content_items (organization_id, planned_publish_at);
create index content_items_org_status_idx on public.content_items (organization_id, status);

create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_item_id uuid not null,
  version_number int not null,
  description text,
  caption text,
  cta text,
  hashtags text[] not null default '{}',
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Set when a version is submitted for review (Phase 6); the version is read-only after.
  submitted_at timestamptz,
  constraint content_versions_number check (version_number >= 1),
  constraint content_versions_description_length check (char_length(description) <= 5000),
  constraint content_versions_caption_length check (char_length(caption) <= 5000),
  constraint content_versions_cta_length check (char_length(cta) <= 200),
  constraint content_versions_notes_length check (char_length(notes) <= 5000),
  constraint content_versions_hashtags_count check (cardinality(hashtags) <= 60),
  unique (content_item_id, version_number),
  unique (id, organization_id),
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);

alter table public.content_items
  add constraint content_items_current_version_fk
  foreign key (current_version_id) references public.content_versions (id)
  deferrable initially deferred;

create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  content_item_id uuid not null,
  content_version_id uuid not null,
  -- Path inside the private asset store: org/{org}/content/{item}/{random}-{name}.
  -- Copies of an asset in later versions share the same path.
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  bytes bigint not null,
  width int,
  height int,
  position int not null default 0,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint content_assets_bytes check (bytes > 0 and bytes <= 52428800),
  constraint content_assets_file_name_length check (char_length(file_name) between 1 and 200),
  constraint content_assets_mime check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'application/pdf')
  ),
  constraint content_assets_path_in_org check (
    storage_path like 'org/' || organization_id::text || '/content/' || content_item_id::text || '/%'
  ),
  foreign key (content_version_id, organization_id)
    references public.content_versions (id, organization_id) on delete cascade,
  foreign key (content_item_id, organization_id)
    references public.content_items (id, organization_id) on delete cascade
);

create index content_assets_version_idx on public.content_assets (content_version_id, position);
create index content_assets_path_idx on public.content_assets (storage_path);

-- ---------------------------------------------------------------------------
-- 3. Rules
-- ---------------------------------------------------------------------------

-- Validates and protects content item fields. Status changes allowed before Phase 6:
-- IDEA <-> DRAFT, IDEA/DRAFT -> ARCHIVED, and ARCHIVED -> DRAFT (restore).
create or replace function public.content_items_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  platform text;
begin
  -- Platforms must be known, and listed once.
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
    return new;
  end if;

  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.current_version_id := old.current_version_id;
  new.published_at := old.published_at;
  if new.organization_id <> old.organization_id then
    raise exception 'Content cannot be moved between organizations' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'IDEA' and new.status in ('DRAFT', 'ARCHIVED'))
    or (old.status = 'DRAFT' and new.status in ('IDEA', 'ARCHIVED'))
    or (old.status = 'ARCHIVED' and new.status = 'DRAFT')
  ) then
    raise exception 'Content can''t move from % to % yet', old.status, new.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger content_items_guard
  before insert or update on public.content_items
  for each row execute function public.content_items_guard();
create trigger content_items_updated_at
  before update on public.content_items
  for each row execute function public.set_updated_at();

-- Every item gets version 1 as soon as it exists, so it always has a current version.
create or replace function public.content_items_first_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  version_id uuid;
begin
  insert into public.content_versions (organization_id, content_item_id, version_number, created_by)
  values (new.organization_id, new.id, 1, auth.uid())
  returning id into version_id;
  update public.content_items set current_version_id = version_id where id = new.id;
  return new;
end;
$$;

create trigger content_items_first_version
  after insert on public.content_items
  for each row execute function public.content_items_first_version();

-- Only the current, unsubmitted version can be edited. Versions are created by the
-- database (first version) or by create_content_version(), never directly.
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
  return new;
end;
$$;

create trigger content_versions_guard
  before insert or update on public.content_versions
  for each row execute function public.content_versions_guard();
create trigger content_versions_updated_at
  before update on public.content_versions
  for each row execute function public.set_updated_at();

-- Assets can be added to or removed from the current, unsubmitted version only.
create or replace function public.content_assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rec public.content_assets := coalesce(new, old);
begin
  if not public.is_end_user() then
    return coalesce(new, old);
  end if;
  -- Deleting an organization removes its content and assets with it.
  if tg_op = 'DELETE' and not exists (select 1 from public.content_items i where i.id = old.content_item_id) then
    return old;
  end if;
  if not exists (
    select 1
    from public.content_items i
    join public.content_versions v on v.id = i.current_version_id
    where i.id = rec.content_item_id and v.id = rec.content_version_id and v.submitted_at is null
  ) then
    raise exception 'Assets can only change on the current version' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    if new.storage_path <> old.storage_path or new.content_version_id <> old.content_version_id
      or new.mime_type <> old.mime_type or new.bytes <> old.bytes then
      raise exception 'Only an asset''s name and position can change' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger content_assets_guard
  before insert or update or delete on public.content_assets
  for each row execute function public.content_assets_guard();

-- Starts a new version from the current one: copies its text and assets, then makes it
-- current. Earlier versions stay as they were. Runs with the caller's rights checked first.
create or replace function public.create_content_version(item_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.content_items;
  current public.content_versions;
  new_id uuid;
begin
  select * into item from public.content_items where id = item_id;
  if item.id is null or not public.has_org_permission(item.organization_id, 'content.edit') then
    raise exception 'Content not found' using errcode = '42501';
  end if;
  if item.status not in ('IDEA', 'DRAFT') then
    raise exception 'Only ideas and drafts get new versions for now' using errcode = '42501';
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

  update public.content_items set current_version_id = new_id, updated_at = now() where id = item.id;
  return new_id;
end;
$$;

revoke all on function public.create_content_version(uuid) from public, anon;
grant execute on function public.create_content_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Access
-- ---------------------------------------------------------------------------

alter table public.content_items enable row level security;
alter table public.content_versions enable row level security;
alter table public.content_assets enable row level security;

create policy "members read content items" on public.content_items for select to authenticated
  using (public.is_org_member(organization_id));
create policy "editors create content items" on public.content_items for insert to authenticated
  with check (public.has_org_permission(organization_id, 'content.edit'));
create policy "editors update content items" on public.content_items for update to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));

create policy "members read content versions" on public.content_versions for select to authenticated
  using (public.is_org_member(organization_id));
create policy "editors update content versions" on public.content_versions for update to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));

create policy "members read content assets" on public.content_assets for select to authenticated
  using (public.is_org_member(organization_id));
create policy "editors add content assets" on public.content_assets for insert to authenticated
  with check (public.has_org_permission(organization_id, 'content.edit'));
create policy "editors update content assets" on public.content_assets for update to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'))
  with check (public.has_org_permission(organization_id, 'content.edit'));
create policy "editors remove content assets" on public.content_assets for delete to authenticated
  using (public.has_org_permission(organization_id, 'content.edit'));

revoke all on public.content_items, public.content_versions, public.content_assets from anon;
-- Content is archived, never deleted, so its history stays.
revoke delete on public.content_items, public.content_versions from authenticated;
revoke insert on public.content_versions from authenticated;

create trigger content_items_log
  after insert or update on public.content_items
  for each row execute function public.log_activity();
create trigger content_assets_log
  after insert or delete on public.content_assets
  for each row execute function public.log_activity();
