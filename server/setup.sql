-- =====================================================================
-- LogSwap セットアップ（貼るだけ版・自動生成）
-- Supabase の SQL Editor に全部貼って「Run」1回でOK。
-- schema.sql + policies.sql を結合（R2構成では不要なストレージ節は除外）。
-- ※ ライブDBは server/migrations/*.sql を随時適用済み。これは新規構築用。
-- =====================================================================


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
  bio         text check (bio is null or char_length(bio) <= 60),
  handle      text check (handle is null or handle ~ '^@[A-Za-z0-9_]{1,30}$'),
  pref        text,                        -- 都道府県
  tags        text[] not null default '{}',
  image_path  text,                        -- R2 の公開URL（Cloudflare Worker が返す）
  image2_path text,                        -- サブ画像のR2公開URL
  video_path  text,                        -- 圧縮済み動画のR2公開URL（1人1本）
  video_name  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists profiles_handle_lower_key
  on public.profiles (lower(handle)) where handle is not null;

-- ---------------------------------------------------------------------
-- 非公開プロフィール（本人だけが読める。性別など）
-- ---------------------------------------------------------------------
create table if not exists public.private_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  gender      text,                              -- female / male / other / na
  invite_ids  jsonb not null default '[]'::jsonb -- [{code, used_with}] 本人のみ
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
  kind       text not null default 'text' check (kind in ('text', 'stamp')),
  created_at timestamptz not null default now()
);
create index if not exists messages_match_idx on public.messages(match_id, created_at);

-- ---------------------------------------------------------------------
-- ID交換の公開（giver が1成立で招待コードを1つだけ公開＝使い切り）
-- ---------------------------------------------------------------------
create table if not exists public.exchanges (
  match_id    uuid not null references public.matches(id) on delete cascade,
  giver       uuid not null references auth.users(id) on delete cascade,
  invite_code text not null,
  created_at  timestamptz not null default now(),
  primary key (match_id, giver)
);

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
-- security definer：blocks の RLS(blocker=自分のみ可視)に阻まれず「相手が自分を
-- ブロックした行」も見て双方向除外するため。返すのは公開 profiles のみ、絞り込みは
-- auth.uid() 基準なので情報漏れはない。set search_path で definer の安全性を担保。
-- =====================================================================
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


-- =====================================================================
-- RLS policies (policies.sql / storage section excluded)
-- =====================================================================

alter table public.profiles          enable row level security;
alter table public.private_profiles  enable row level security;
alter table public.likes             enable row level security;
alter table public.matches           enable row level security;
alter table public.blocks            enable row level security;
alter table public.reports           enable row level security;
alter table public.messages          enable row level security;
alter table public.exchanges         enable row level security;

-- ---------------- profiles（公開情報） ----------------
-- 読み取り: ログイン済みなら誰でも（スワイプに出すため）
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

-- 追加・更新・削除は自分の行だけ
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated using (id = auth.uid());

-- ---------------- private_profiles（本人のみ） ----------------
drop policy if exists private_all on public.private_profiles;
create policy private_all on public.private_profiles
  for all to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------- likes ----------------
-- 自分が押したいいねだけ作成/削除。読み取りは「自分が関わる行」。
drop policy if exists likes_select on public.likes;
create policy likes_select on public.likes
  for select to authenticated using (liker = auth.uid() or likee = auth.uid());

drop policy if exists likes_insert on public.likes;
create policy likes_insert on public.likes
  for insert to authenticated with check (liker = auth.uid());

drop policy if exists likes_delete on public.likes;
create policy likes_delete on public.likes
  for delete to authenticated using (liker = auth.uid());

-- ---------------- matches（読み取り＋当事者による解除。作成はトリガー） ----------------
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- 解除（削除）は当事者のみ。messages/exchanges は cascade で消える。
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches
  for delete to authenticated using (user_a = auth.uid() or user_b = auth.uid());

-- ---------------- blocks ----------------
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks
  for select to authenticated using (blocker = auth.uid());

drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks
  for insert to authenticated with check (blocker = auth.uid());

drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks
  for delete to authenticated using (blocker = auth.uid());

-- ---------------- reports（作成のみ。閲覧は運営＝サービスロール） ----------------
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert to authenticated with check (reporter = auth.uid());
-- 通報一覧の閲覧は service_role（管理画面/サーバー）からのみ。RLS を通さないので追加ポリシー不要。

-- ---------------- messages（成立した相手とだけ） ----------------
-- 自分が参加している match のメッセージだけ読める
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- 送信は「自分が参加している match」かつ「sender = 自分」
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated with check (
    sender = auth.uid()
    and exists (
      select 1 from public.matches m
      where m.id = messages.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- ---------------- exchanges（成立相手だけが公開コードを読める） ----------------
-- 読み: その成立の当事者2人だけ
drop policy if exists exchanges_select on public.exchanges;
create policy exchanges_select on public.exchanges
  for select to authenticated using (
    exists (
      select 1 from public.matches m
      where m.id = exchanges.match_id
        and (m.user_a = auth.uid() or m.user_b = auth.uid())
    )
  );

-- 書き: giver 本人が、自分が参加する成立にだけ（使い切りは PK で担保）
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
