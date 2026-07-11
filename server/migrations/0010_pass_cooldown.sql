-- =====================================================================
-- Migration 0010: ×（パス）の24時間クールダウン
-- ---------------------------------------------------------------------
-- 目的: ×スワイプした相手を「24時間だけ」スワイプ配信から除外し、
--       24時間後にまた表示されるようにする（少人数でも人が枯れにくくする）。
--       いいね(likes)は永久除外のまま。パス(passes)は時限除外。
--
-- 既存デプロイは Supabase の SQL Editor でこのファイルを1回実行する。
-- （schema.sql / policies.sql にも反映済み。新規構築ではそちらで入る。）
-- =====================================================================

-- ×スワイプの記録。(passer, passed) で一意。再パスは created_at を更新して
-- クールダウンを延長する（クライアントの upsert が created_at を now に上書き）。
create table if not exists public.passes (
  passer     uuid not null references auth.users(id) on delete cascade,
  passed     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (passer, passed),
  check (passer <> passed)
);
create index if not exists passes_passer_idx on public.passes(passer, created_at);

alter table public.passes enable row level security;

-- 自分が押したパスだけ 作成/更新/参照/削除できる
drop policy if exists passes_select on public.passes;
create policy passes_select on public.passes
  for select to authenticated using (passer = auth.uid());
drop policy if exists passes_insert on public.passes;
create policy passes_insert on public.passes
  for insert to authenticated with check (passer = auth.uid());
drop policy if exists passes_update on public.passes;
create policy passes_update on public.passes
  for update to authenticated using (passer = auth.uid()) with check (passer = auth.uid());
drop policy if exists passes_delete on public.passes;
create policy passes_delete on public.passes
  for delete to authenticated using (passer = auth.uid());

-- get_swipe_queue に「24時間以内にパスした相手を除外」を追加（他は 0009 と同じ）。
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
    and coalesce(p.hidden, false) = false
    and (want_pref is null or want_pref = '' or p.pref = want_pref)
    and (want_gender is null or want_gender = '' or exists (
      select 1 from public.private_profiles pp where pp.id = p.id and pp.gender = want_gender
    ))
    and not exists (
      select 1 from public.likes l where l.liker = auth.uid() and l.likee = p.id
    )
    and not exists (
      select 1 from public.passes pa
      where pa.passer = auth.uid() and pa.passed = p.id
        and pa.created_at > now() - interval '24 hours'
    )
    and not exists (
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(max_count, 100));
$$;
