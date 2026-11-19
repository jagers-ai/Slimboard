-- Preserve ownership, per-note claims, and attempt logging while allowing
-- accounts to dispatch analyses without hourly or daily caps.
create or replace function public.claim_note_analysis(p_note uuid, p_owner uuid, p_attempt uuid, p_force boolean default false)
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
  insert into public.note_analysis_requests(attempt, owner_user_id) values(p_attempt, p_owner);
  update public.whiteboard_notes set analysis_attempt = p_attempt, status = 'processing', error_message = null, updated_at = now() where id = p_note;
  return 'claimed';
end $$;
