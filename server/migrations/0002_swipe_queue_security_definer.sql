-- Migration 0002: fix get_swipe_queue block filtering
-- Bug: with SECURITY INVOKER, the blocks RLS (blocker = auth.uid()) hides
-- "someone blocked me" rows, so users who blocked you still appeared in your
-- swipe queue. Switch to SECURITY DEFINER so the function can see all blocks
-- for both-direction exclusion. Returns only public profiles; filtering is by
-- auth.uid(), so no data leak. search_path is pinned for definer safety.
create or replace function public.get_swipe_queue(max_count int default 30)
returns setof public.profiles
language sql
stable
security definer
set search_path = public
as $$
  select p.*
  from public.profiles p
  where p.id <> auth.uid()
    and not exists (
      select 1 from public.likes l
      where l.liker = auth.uid() and l.likee = p.id
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(max_count, 100));
$$;
