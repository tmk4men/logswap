-- Migration 0004: trade flow (stamps, invite-id pool, id-exchange reveal)

-- messages: distinguish preset text vs stamp
alter table public.messages
  add column if not exists kind text not null default 'text'
  check (kind in ('text', 'stamp'));

-- invite id pool lives in PRIVATE profile (owner-only). Never in public profiles,
-- otherwise the Setlog invite codes would be readable by everyone.
-- shape: [{ "code": "grp-xxxx", "used_with": "<uuid|null>" }]
alter table public.private_profiles
  add column if not exists invite_ids jsonb not null default '[]'::jsonb;

-- exchanges: records that `giver` revealed ONE invite code inside a match.
-- use-once = at most one row per (match, giver). The partner reads it to see
-- the revealed code; the pool itself stays private.
create table if not exists public.exchanges (
  match_id    uuid not null references public.matches(id) on delete cascade,
  giver       uuid not null references auth.users(id) on delete cascade,
  invite_code text not null,
  created_at  timestamptz not null default now(),
  primary key (match_id, giver)
);

alter table public.exchanges enable row level security;

-- read: only the two participants of the match can see reveals
drop policy if exists exchanges_select on public.exchanges;
create policy exchanges_select on public.exchanges
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = exchanges.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- insert: only the giver, only into a match they belong to
drop policy if exists exchanges_insert on public.exchanges;
create policy exchanges_insert on public.exchanges
  for insert to authenticated with check (
    giver = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = exchanges.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );
