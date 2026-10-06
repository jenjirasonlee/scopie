-- Scopie Phase 1: identity, tenancy, roles and permissions.
-- See docs/DATABASE.md §3 and §7.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- True when the current database role is an end user coming through the API
-- (as opposed to the service role, migrations or seed scripts).
create or replace function public.is_end_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon');
$$;

-- ---------------------------------------------------------------------------
-- Roles and permissions
-- ---------------------------------------------------------------------------

create type public.org_role as enum ('OWNER', 'ADMIN', 'MANAGER', 'EDITOR', 'VIEWER');

create table public.permissions (
  key text primary key,
  description text not null
);

create table public.role_permissions (
  role public.org_role not null,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role, permission_key)
);

-- The permission matrix (docs/DATABASE.md §7). This table is the single source
-- of truth; lib/auth/permissions.ts mirrors it and a test asserts they match.
insert into public.permissions (key, description) values
  ('org.update',        'Edit organization settings'),
  ('org.delete',        'Delete the organization'),
  ('members.manage',    'Change member roles and remove members'),
  ('accounts.manage',   'Add, edit, activate and deactivate social accounts'),
  ('content.edit',      'Create and edit content, comment (enforced from Phase 7)'),
  ('content.approve',   'Approve, reject or request changes (enforced from Phase 9)'),
  ('strategy.manage',   'Manage strategy, benchmarks and taxonomy (enforced from Phase 6/10)');

insert into public.role_permissions (role, permission_key) values
  ('OWNER', 'org.update'), ('OWNER', 'org.delete'), ('OWNER', 'members.manage'),
  ('OWNER', 'accounts.manage'), ('OWNER', 'content.edit'), ('OWNER', 'content.approve'),
  ('OWNER', 'strategy.manage'),
  ('ADMIN', 'org.update'), ('ADMIN', 'members.manage'), ('ADMIN', 'accounts.manage'),
  ('ADMIN', 'content.edit'), ('ADMIN', 'content.approve'), ('ADMIN', 'strategy.manage'),
  ('MANAGER', 'content.edit'), ('MANAGER', 'content.approve'), ('MANAGER', 'strategy.manage'),
  ('EDITOR', 'content.edit');
-- VIEWER: read-only, no permissions.

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (char_length(full_name) <= 120)
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may not change their own email via profiles; it mirrors auth.users.
create or replace function public.profiles_protect_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_end_user() and new.email is distinct from old.email then
    raise exception 'email is managed by authentication' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_email
  before update on public.profiles
  for each row execute function public.profiles_protect_email();

-- ---------------------------------------------------------------------------
-- Organizations and membership
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  default_timezone text not null default 'UTC',
  is_demo boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_length check (char_length(name) between 2 and 80),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$')
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.org_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_id_idx on public.organization_members (user_id);

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions (security definer so policies don't recurse)
-- ---------------------------------------------------------------------------

create or replace function public.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = auth.uid()
  );
$$;

create or replace function public.org_role_of(org uuid)
returns public.org_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.organization_members m
  where m.organization_id = org and m.user_id = auth.uid();
$$;

create or replace function public.has_org_permission(org uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members m
    join public.role_permissions rp on rp.role = m.role
    where m.organization_id = org
      and m.user_id = auth.uid()
      and rp.permission_key = permission
  );
$$;

-- Two users share an organization (used to let teammates see each other's profile).
create or replace function public.shares_org_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and theirs.user_id = other_user
  );
$$;

-- Never leave an organization without an owner.
create or replace function public.organization_members_keep_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  remaining int;
begin
  if old.role = 'OWNER' and (tg_op = 'DELETE' or new.role <> 'OWNER') then
    -- Skip when the whole organization is being deleted, or when the user's account
    -- itself is being deleted (cascade from auth.users -> profiles). In the latter case
    -- the organization is left without an owner; see docs/DATABASE.md.
    if not exists (select 1 from public.organizations o where o.id = old.organization_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then
      return coalesce(new, old);
    end if;
    select count(*) into remaining
    from public.organization_members
    where organization_id = old.organization_id and role = 'OWNER' and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'An organization must keep at least one owner' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_keep_owner
  before update or delete on public.organization_members
  for each row execute function public.organization_members_keep_owner();

-- Creating an organization and its first OWNER membership happens atomically here;
-- end users cannot insert into organizations directly.
create or replace function public.create_organization(org_name text, org_slug text, org_timezone text default 'UTC')
returns public.organizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  org public.organizations;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  insert into public.organizations (name, slug, default_timezone, created_by)
  values (trim(org_name), lower(trim(org_slug)), coalesce(nullif(org_timezone, ''), 'UTC'), uid)
  returning * into org;
  insert into public.organization_members (organization_id, user_id, role)
  values (org.id, uid, 'OWNER');
  return org;
end;
$$;

revoke execute on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;

create policy "permissions are readable by signed-in users"
  on public.permissions for select to authenticated using (true);

create policy "role permissions are readable by signed-in users"
  on public.role_permissions for select to authenticated using (true);

create policy "users read own profile and teammates"
  on public.profiles for select to authenticated
  using (id = auth.uid() or public.shares_org_with(id));

create policy "users update own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members read their organizations"
  on public.organizations for select to authenticated
  using (public.is_org_member(id));

create policy "admins update organizations"
  on public.organizations for update to authenticated
  using (public.has_org_permission(id, 'org.update'))
  with check (public.has_org_permission(id, 'org.update'));

create policy "owners delete organizations"
  on public.organizations for delete to authenticated
  using (public.has_org_permission(id, 'org.delete'));

create policy "members read memberships of their organizations"
  on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

-- Only OWNERs may grant, change or remove the OWNER role.
create policy "managers of members add members"
  on public.organization_members for insert to authenticated
  with check (
    public.has_org_permission(organization_id, 'members.manage')
    and (role <> 'OWNER' or public.org_role_of(organization_id) = 'OWNER')
  );

create policy "managers of members change roles"
  on public.organization_members for update to authenticated
  using (
    public.has_org_permission(organization_id, 'members.manage')
    and (role <> 'OWNER' or public.org_role_of(organization_id) = 'OWNER')
  )
  with check (
    public.has_org_permission(organization_id, 'members.manage')
    and (role <> 'OWNER' or public.org_role_of(organization_id) = 'OWNER')
  );

create policy "managers of members remove members, anyone can leave"
  on public.organization_members for delete to authenticated
  using (
    user_id = auth.uid()
    or (
      public.has_org_permission(organization_id, 'members.manage')
      and (role <> 'OWNER' or public.org_role_of(organization_id) = 'OWNER')
    )
  );

-- Membership rows are not changed via organization_id/user_id rewrites.
create or replace function public.organization_members_immutable_keys()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id or new.user_id <> old.user_id then
    raise exception 'Membership keys cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger organization_members_immutable_keys
  before update on public.organization_members
  for each row execute function public.organization_members_immutable_keys();

-- Table privileges (Supabase grants broad defaults; be explicit about intent).
revoke insert, delete on public.organizations from anon, authenticated;
grant delete on public.organizations to authenticated;
revoke all on public.permissions, public.role_permissions from anon;
revoke insert, update, delete on public.permissions, public.role_permissions from authenticated;
revoke all on public.profiles, public.organizations, public.organization_members from anon;
