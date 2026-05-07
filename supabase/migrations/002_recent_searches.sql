create table if not exists public.user_recent_searches (
  user_id uuid not null references auth.users(id) on delete cascade,
  query text not null check (length(trim(query)) > 0),
  normalized_query text not null check (length(trim(normalized_query)) > 0),
  last_searched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, normalized_query)
);

create index if not exists recent_searches_user_last_idx
on public.user_recent_searches(user_id, last_searched_at desc);

alter table public.user_recent_searches enable row level security;

drop policy if exists "Users can read own recent searches" on public.user_recent_searches;
create policy "Users can read own recent searches"
on public.user_recent_searches for select
using (user_id = auth.uid());

drop policy if exists "Users can create own recent searches" on public.user_recent_searches;
create policy "Users can create own recent searches"
on public.user_recent_searches for insert
with check (user_id = auth.uid());

drop policy if exists "Users can update own recent searches" on public.user_recent_searches;
create policy "Users can update own recent searches"
on public.user_recent_searches for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "Users can delete own recent searches" on public.user_recent_searches;
create policy "Users can delete own recent searches"
on public.user_recent_searches for delete
using (user_id = auth.uid());
