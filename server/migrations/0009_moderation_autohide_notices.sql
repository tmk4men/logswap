-- =====================================================================
-- Migration 0009: モデレーション強化（自動隔離 + 個別警告）
-- ---------------------------------------------------------------------
-- 目的:
--  (A) 通報されたユーザーを「運営が確認するまで待たず」自動でスワイプから
--      隔離する（不適切コンテンツが他ユーザーに露出し続けるのを防ぐ）。
--  (B) 運営が特定ユーザーにだけ「注意（警告）」を送れるようにする（notices）。
--
-- 既存デプロイに対して Supabase の SQL Editor で1回実行する。
-- （schema.sql / policies.sql には反映済み。新規構築ではそちらで入る。）
-- =====================================================================

-- ---------------------------------------------------------------------
-- (A-1) 隔離フラグ。true のユーザーはスワイプ配信に出さない（＝発見不能）。
--       削除ではないので運営があとで unhide して元に戻せる。
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists hidden boolean not null default false;

-- ---------------------------------------------------------------------
-- (A-2) 本人が API 経由で自分の hidden を書き換えるのを禁止する保護トリガー。
--       運営の直DB接続（DATABASE_URL / service_role）は auth.uid() が null な
--       ので変更できる。自動隔離トリガーは「別人(reporter)」の実行なので
--       auth.uid() <> old.id となり、これも許可される。
-- ---------------------------------------------------------------------
create or replace function public.profiles_protect_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and auth.uid() = old.id then
    new.hidden := old.hidden;   -- 本人のセルフ更新では hidden を据え置き
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_hidden on public.profiles;
create trigger trg_profiles_protect_hidden
  before update on public.profiles
  for each row execute function public.profiles_protect_hidden();

-- ---------------------------------------------------------------------
-- (A-3) 通報が入ったら自動隔離するトリガー。
--       ・わいせつ/不適切/暴力/違法 系の通報 … 1件で即隔離
--       ・それ以外の理由            … 異なる通報者が3人以上で隔離
--       hidden は運営が unhide するまで維持。誤検知でも露出よりは安全側。
-- ---------------------------------------------------------------------
create or replace function public.reports_auto_hide()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  distinct_reporters int;
  severe boolean;
begin
  severe := (new.reason like '%わいせつ%')
         or (new.reason like '%不適切%')
         or (new.reason like '%暴力%')
         or (new.reason like '%違法%');

  select count(distinct reporter) into distinct_reporters
  from public.reports where reported = new.reported;

  if severe or distinct_reporters >= 3 then
    update public.profiles
       set hidden = true
     where id = new.reported and hidden = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reports_auto_hide on public.reports;
create trigger trg_reports_auto_hide
  after insert on public.reports
  for each row execute function public.reports_auto_hide();

-- ---------------------------------------------------------------------
-- (A-4) get_swipe_queue を hidden 除外に更新（それ以外は 0008 と同じ）。
-- ---------------------------------------------------------------------
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
      select 1 from public.blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid())
    )
  order by p.created_at desc
  limit greatest(1, least(max_count, 100));
$$;

-- ---------------------------------------------------------------------
-- (B-1) notices: 運営が特定ユーザーに送る「注意（警告）」。
--       本人だけが自分宛てを読める。作成・削除は運営（直DB / service_role）のみ。
-- ---------------------------------------------------------------------
create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now(),
  ack_at     timestamptz
);
create index if not exists notices_user_unack_idx
  on public.notices(user_id) where ack_at is null;

alter table public.notices enable row level security;

-- 読み: 本人宛てだけ
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices
  for select to authenticated using (user_id = auth.uid());
-- 作成・更新・削除のポリシーは作らない＝RLSで既定拒否（運営の直DB/service_roleのみ）。

-- ---------------------------------------------------------------------
-- (B-2) 本人が「確認した」を記録する RPC。body は書き換えられない（ack のみ）。
-- ---------------------------------------------------------------------
create or replace function public.ack_notice(nid uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notices set ack_at = now()
   where id = nid and user_id = auth.uid() and ack_at is null;
$$;
revoke all on function public.ack_notice(uuid) from public;
grant execute on function public.ack_notice(uuid) to authenticated;
