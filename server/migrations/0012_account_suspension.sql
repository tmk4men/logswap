-- =====================================================================
-- Migration 0012: アカウント停止（ソフトBAN）
-- ---------------------------------------------------------------------
-- 目的: ハード削除せず記録を残したまま、対象ユーザーがアプリを開くと
--   「あなたのアカウントは規約に違反したため削除されました。」と表示して
--   利用を止める。banned=true のユーザーはスワイプにも出ない。
--   本人は banned を自分で解除できない（保護トリガー）。運営の直DB接続のみ変更可。
--
-- 既存デプロイは Supabase の SQL Editor でこのファイルを1回実行する。
-- =====================================================================

alter table public.profiles
  add column if not exists banned boolean not null default false;

-- 本人がAPI経由で hidden / banned を勝手に解除するのを禁止（+不適切語のサイレント隔離）。
-- 0009/0011 の profiles_protect_hidden を banned 保護込みで置き換える。
create or replace function public.profiles_protect_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() = old.id then
    new.hidden := old.hidden;   -- 本人のセルフ更新では hidden を据え置き
    new.banned := old.banned;   -- banned も本人は変えられない
  end if;
  if public.profile_should_hide(new.name, new.bio) then
    new.hidden := true;         -- 不適切語を含むなら黙って隔離
  end if;
  return new;
end;
$$;
drop trigger if exists trg_profiles_protect_hidden on public.profiles;
create trigger trg_profiles_protect_hidden
  before insert or update on public.profiles
  for each row execute function public.profiles_protect_hidden();

-- get_swipe_queue を banned 除外に更新（他は 0010 と同じ）。
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
    and coalesce(p.banned, false) = false
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
