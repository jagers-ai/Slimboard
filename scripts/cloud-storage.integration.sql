-- Run against the migrated project as postgres. All fixture rows roll back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); n uuid := gen_random_uuid();
  attempt uuid := gen_random_uuid(); result text; visible integer;
begin
  insert into auth.users(id) values(a),(b);
  insert into public.workspaces(id,name,owner_user_id) values(w,'Rollback-only integration fixture',a);
  insert into public.workspace_members(workspace_id,user_id) values(w,a),(w,b);
  insert into public.whiteboard_notes(id,workspace_id,owner_user_id,analysis_image_path,image_ready)
    values(n,w,a,a::text || '/' || n::text || '/analysis.jpg',false);
  if public.claim_note_analysis(n,a,attempt) <> 'image_pending' then raise exception 'Missing upload gate'; end if;
  update public.whiteboard_notes set image_ready = true where id = n;
  if public.claim_note_analysis(n,b,gen_random_uuid()) <> 'not_found' then raise exception 'Owner gate failed'; end if;
  if public.claim_note_analysis(n,a,attempt) <> 'claimed' then raise exception 'First claim failed'; end if;
  if public.claim_note_analysis(n,a,gen_random_uuid(),true) <> 'busy' then raise exception 'Duplicate analysis allowed'; end if;
  update public.whiteboard_notes set status = 'completed' where id = n;
  if public.claim_note_analysis(n,a,gen_random_uuid()) <> 'completed' then raise exception 'Completed retry not idempotent'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true);
  execute 'set local role authenticated';
  select count(*) into visible from public.whiteboard_notes where id = n;
  execute 'reset role';
  if visible <> 0 then raise exception 'Workspace member saw another owner note'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  execute 'set local role authenticated';
  select count(*) into visible from public.whiteboard_notes where id = n;
  execute 'reset role';
  if visible <> 1 then raise exception 'Owner cannot read note'; end if;
  if has_table_privilege('authenticated','public.whiteboard_notes','UPDATE') then raise exception 'Client can bypass server mutations'; end if;
  if has_function_privilege('authenticated','public.claim_note_analysis(uuid,uuid,uuid,boolean)','EXECUTE') then raise exception 'Client can bypass analysis rate limit'; end if;
  insert into public.note_analysis_requests(attempt, owner_user_id) select gen_random_uuid(),a from generate_series(1,9);
  if public.claim_note_analysis(n,a,gen_random_uuid(),true) <> 'rate_limited' then raise exception 'Hourly rate gate failed'; end if;
  delete from public.whiteboard_notes where id=n;
  if (select cardinality(paths) from public.note_image_cleanup where note_id=n) <> 1 then raise exception 'Single-image cleanup queue failed'; end if;
  insert into public.whiteboard_notes(id,workspace_id,owner_user_id,original_image_path,analysis_image_path)
    values(n,w,a,a::text || '/legacy.jpg',a::text || '/analysis.jpg');
  delete from public.note_image_cleanup where note_id=n;
  delete from public.whiteboard_notes where id=n;
  if (select cardinality(paths) from public.note_image_cleanup where note_id=n) <> 2 then raise exception 'Legacy cleanup queue failed'; end if;
end $$;
rollback;
