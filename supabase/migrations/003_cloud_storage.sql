-- Preserve all historical originals. New records store only analysis.jpg.
alter table public.whiteboard_notes alter column original_image_path drop not null;
alter table public.whiteboard_notes add column if not exists image_ready boolean not null default true;
alter table public.whiteboard_notes add column if not exists analysis_attempt uuid;

-- Personal MVP: workspace membership does not grant access to another owner's notes.
drop policy if exists "Members can read notes" on public.whiteboard_notes;
drop policy if exists "Members can update notes" on public.whiteboard_notes;
drop policy if exists "Members can delete notes" on public.whiteboard_notes;
create policy "Owners can read notes" on public.whiteboard_notes for select using (owner_user_id = auth.uid());
-- Mutations go through the server so clients cannot bypass analysis locks or cleanup.
revoke insert, update, delete on public.whiteboard_notes from anon, authenticated;

-- Only service-role routes write objects. Authenticated photo delivery goes through
-- /api/notes/:id/image; existing original objects are retained.
drop policy if exists "Users can read own whiteboard images" on storage.objects;
drop policy if exists "Users can upload own whiteboard images" on storage.objects;
drop policy if exists "Users can update own whiteboard images" on storage.objects;
drop policy if exists "Users can delete own whiteboard images" on storage.objects;

create table public.note_analysis_requests (
  attempt uuid primary key,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.note_analysis_requests enable row level security;
create index on public.note_analysis_requests(owner_user_id, created_at);
revoke all on public.note_analysis_requests from anon, authenticated;

-- Durable per-owner rate gate and per-note claim, shared across server instances.
-- An uncertain/in-flight call is NEVER automatically reclaimed for another paid call.
create function public.claim_note_analysis(p_note uuid, p_owner uuid, p_attempt uuid, p_force boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare n public.whiteboard_notes;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text, 0));
  select * into n from public.whiteboard_notes where id = p_note and owner_user_id = p_owner for update;
  if not found then return 'not_found'; end if;
  if not n.image_ready then return 'image_pending'; end if;
  if n.analysis_attempt is not null and n.status = 'processing' then return 'busy'; end if;
  if n.status = 'completed' and not p_force then return 'completed'; end if;
  if n.status = 'failed' and not p_force then return 'retry_required'; end if;
  if (select count(*) from public.note_analysis_requests where owner_user_id = p_owner and created_at > now() - interval '1 hour') >= 10
     or (select count(*) from public.note_analysis_requests where owner_user_id = p_owner and created_at > now() - interval '1 day') >= 30 then
    return 'rate_limited';
  end if;
  insert into public.note_analysis_requests(attempt, owner_user_id) values(p_attempt, p_owner);
  update public.whiteboard_notes set analysis_attempt = p_attempt, status = 'processing', error_message = null, updated_at = now() where id = p_note;
  return 'claimed';
end $$;
revoke all on function public.claim_note_analysis(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_note_analysis(uuid, uuid, uuid, boolean) to service_role;

-- Persist cleanup work in the same transaction that deletes the note. A storage
-- failure or server interruption leaves an auditable, retryable private queue.
create table public.note_image_cleanup (
  note_id uuid primary key,
  owner_user_id uuid not null,
  paths text[] not null,
  created_at timestamptz not null default now()
);
alter table public.note_image_cleanup enable row level security;
revoke all on public.note_image_cleanup from anon, authenticated;
create function public.queue_note_image_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.note_image_cleanup(note_id, owner_user_id, paths)
  values(old.id, old.owner_user_id, array_remove(array[old.original_image_path, old.analysis_image_path], null))
  on conflict (note_id) do nothing;
  return old;
end $$;
revoke all on function public.queue_note_image_cleanup() from public, anon, authenticated;
create trigger queue_note_image_cleanup after delete on public.whiteboard_notes
for each row execute function public.queue_note_image_cleanup();
