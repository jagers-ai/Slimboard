create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'whiteboard-images',
  'whiteboard-images',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'personal' check (kind in ('personal', 'team')),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.whiteboard_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled whiteboard',
  raw_text text not null default '',
  summary text not null default '',
  keywords text[] not null default '{}',
  visual_context text not null default '',
  detected_languages text[] not null default '{}',
  warnings text[] not null default '{}',
  original_image_path text not null,
  analysis_image_path text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  model text,
  fallback_model text,
  prompt_version text not null default 'whiteboard-v1',
  analysis_version text not null default '1',
  search_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workspaces_owner_idx on public.workspaces(owner_user_id);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create index if not exists notes_workspace_created_idx on public.whiteboard_notes(workspace_id, created_at desc);
create index if not exists notes_owner_created_idx on public.whiteboard_notes(owner_user_id, created_at desc);
create index if not exists notes_status_idx on public.whiteboard_notes(status);
create index if not exists notes_search_trgm_idx on public.whiteboard_notes using gin (search_text gin_trgm_ops);

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.whiteboard_notes enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
create policy "Profiles are readable by owner"
on public.profiles for select
using (id = auth.uid());

drop policy if exists "Profiles are editable by owner" on public.profiles;
create policy "Profiles are editable by owner"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Workspace members can read workspaces" on public.workspaces;
create policy "Workspace members can read workspaces"
on public.workspaces for select
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = workspaces.id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Workspace owners can update workspaces" on public.workspaces;
create policy "Workspace owners can update workspaces"
on public.workspaces for update
using (owner_user_id = auth.uid())
with check (owner_user_id = auth.uid());

drop policy if exists "Workspace members can read members" on public.workspace_members;
create policy "Workspace members can read members"
on public.workspace_members for select
using (
  exists (
    select 1
    from public.workspace_members viewer
    where viewer.workspace_id = workspace_members.workspace_id
      and viewer.user_id = auth.uid()
  )
);

drop policy if exists "Members can read notes" on public.whiteboard_notes;
create policy "Members can read notes"
on public.whiteboard_notes for select
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = whiteboard_notes.workspace_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Members can update notes" on public.whiteboard_notes;
create policy "Members can update notes"
on public.whiteboard_notes for update
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = whiteboard_notes.workspace_id
      and members.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = whiteboard_notes.workspace_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Members can delete notes" on public.whiteboard_notes;
create policy "Members can delete notes"
on public.whiteboard_notes for delete
using (
  exists (
    select 1
    from public.workspace_members members
    where members.workspace_id = whiteboard_notes.workspace_id
      and members.user_id = auth.uid()
  )
);

drop policy if exists "Users can read own whiteboard images" on storage.objects;
create policy "Users can read own whiteboard images"
on storage.objects for select
using (
  bucket_id = 'whiteboard-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can upload own whiteboard images" on storage.objects;
create policy "Users can upload own whiteboard images"
on storage.objects for insert
with check (
  bucket_id = 'whiteboard-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own whiteboard images" on storage.objects;
create policy "Users can update own whiteboard images"
on storage.objects for update
using (
  bucket_id = 'whiteboard-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'whiteboard-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete own whiteboard images" on storage.objects;
create policy "Users can delete own whiteboard images"
on storage.objects for delete
using (
  bucket_id = 'whiteboard-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
