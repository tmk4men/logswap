-- =====================================================================
-- LogSwap バックエンド スキーマ（Supabase / PostgreSQL）
-- ---------------------------------------------------------------------
-- Supabase の SQL Editor にこのファイルの内容を貼って実行する。
-- 実行順は schema.sql → policies.sql。
--
-- 設計方針:
--  - 性別(gender)は「本人のみ参照可・他者非表示」なので、公開テーブル profiles
--    には入れず private_profiles に分離する（列単位のアクセス制御を避けるため）。
--  - 成立(matches)はクライアントに作らせず、like の相互成立をトリガーで作る。
--  - スワイプ配信は get_swipe_queue() が「自分・いいね済み・ブロック相手」を除外して返す。
-- =====================================================================

-- gen_random_uuid() 用（Supabase は既定で有効なことが多いが念のため）
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 公開プロフィール（他ユーザーからも見える情報だけ）
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  pref        text,                        -- 都道府県
  tags        text[] not null default '{}',
  image_path  text,                        -- R2 の公開URL（Cloudflare Worker が返す）
  video_path  text,                        -- 圧縮済み動画のR2公開URL（1人1本）
  video_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 非公開プロフィール（本人だけが読める。性別など）
-- ---------------------------------------------------------------------
create table if not exists public.private_profiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  gender  text                              -- female / male / other / na
);

-- ---------------------------------------------------------------------
-- いいね（交換したい）。相互成立でマッチが生まれる。
-- ---------------------------------------------------------------------
create table if not exists public.likes (
  liker      uuid not null references auth.users(id) on delete cascade,
  likee      uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (liker, likee),
  check (liker <> likee)
);
create index if not exists likes_likee_idx on public.likes(likee);

-- ---------------------------------------------------------------------
-- 成立（トリガーで作成。user_a < user_b で一意化）
-- ---------------------------------------------------------------------
create table if not exists public.matches (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references auth.users(id) on delete cascade,
  user_b     uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

-- ---------------------------------------------------------------------
-- ブロック・通報（安全機能）
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);

create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null references auth.users(id) on delete cascade,
  reported   uuid not null references auth.users(id) on delete cascade,
  reason     text not null,
  created_at timestamptz not null default now()
);
create index if not exists reports_reported_idx on public.reports(reported);

-- ---------------------------------------------------------------------
-- 成立後チャット（ログタブ）
-- ---------------------------------------------------------------------
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.matches(id) on delete cascade,
  sender     uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists messages_match_idx on public.messages(match_id, created_at);

-- =====================================================================
-- 相互いいね → 成立を自動作成するトリガー
-- =====================================================================
create or replace function public.on_like_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 相手が自分をすでにいいねしていれば成立させる
  if exists (select 1 from public.likes l
             where l.liker = new.likee and l.likee = new.liker) then
    insert into public.matches (user_a, user_b)
    values (least(new.liker, new.likee), greatest(new.liker, new.likee))
    on conflict (user_a, user_b) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_like_match on public.likes;
create trigger trg_like_match
  after insert on public.likes
  for each row execute function public.on_like_insert();

-- =====================================================================
-- スワイプ配信：自分・いいね済み・ブロック(双方向)を除いて返す
-- security invoker なので RLS と auth.uid() がそのまま効く
-- =====================================================================
create or replace function public.get_swipe_queue(max_count int default 30)
returns setof public.profiles
language sql
stable
security invoker
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
