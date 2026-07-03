-- Migration 0007: fix account deletion, likes leak, and enable realtime on matches.

-- (1) Full account deletion. Deleting a profiles row cascades to NOTHING because
-- every table FKs auth.users(id), not profiles(id). Provide a SECURITY DEFINER
-- function that deletes the caller's auth.users row -> cascades ALL user data.
create or replace function public.delete_me()
returns void
language sql
security definer
set search_path = public, auth
as $$
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_me() from public;
grant execute on function public.delete_me() to authenticated;

-- (2) Don't leak "who liked you" before a mutual match. Only your own likes are
-- readable. get_swipe_queue (SECURITY DEFINER) and the match trigger still work.
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes
  for select to authenticated using (liker = auth.uid());

-- (3) Realtime on matches so a new match appears live for BOTH users (the first
-- liker otherwise never sees it until restart). RLS still gates to participants.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table public.matches;
  end if;
end $$;

-- Realtime postgres_changes needs full row images to evaluate RLS on the pushed
-- event; without this the RLS-gated match INSERT never reaches the subscriber.
alter table public.messages replica identity full;
alter table public.matches  replica identity full;
