-- Migration 0008: optional region/gender filters for the swipe queue (Premium).
-- SECURITY DEFINER can read private_profiles.gender for filtering WITHOUT returning
-- it (gender stays hidden). want_pref matches the public profiles.pref.
drop function if exists public.get_swipe_queue(int);
create or replace function public.get_swipe_queue(
  max_count int default 30,
  want_pref text default null,
  want_gender text default null
)
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id <> auth.uid()
    and (want_pref is null or want_pref = '' or p.pref = want_pref)
    and (want_gender is null or want_gender = '' or exists (
      select 1 from public.private_profiles pp where pp.id = p.id and pp.gender = want_gender
    ))
    and not exists (
      select 1 from public.likes l where l.liker = auth.uid() and l.likee = p.id
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(max_count, 100));
$$;
