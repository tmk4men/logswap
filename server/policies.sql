-- =====================================================================
-- LogSwap RLS ポリシー（schema.sql の後に実行する）
-- ---------------------------------------------------------------------
-- 方針: 既定は全部拒否。ログイン済みユーザーだけが、自分の行を書け、
--       公開情報は読める。性別など非公開は本人だけ。
-- =====================================================================

alter table public.profiles          enable row level security;
alter table public.private_profiles  enable row level security;
alter table public.likes             enable row level security;
alter table public.matches           enable row level security;
alter table public.blocks            enable row level security;
alter table public.reports           enable row level security;
alter table public.messages          enable row level security;

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

-- ---------------- matches（読み取りのみ。作成はトリガー） ----------------
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches
  for select to authenticated using (user_a = auth.uid() or user_b = auth.uid());

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

-- =====================================================================
-- ストレージ（画像・動画）: media バケット
-- ---------------------------------------------------------------------
-- 事前に Storage で「media」バケットを Public で作成しておくこと
-- （Dashboard → Storage → New bucket → name=media, Public=ON）。
-- 各ユーザーは自分の user-id フォルダ配下にだけ書き込める。読みは公開。
-- =====================================================================
drop policy if exists media_read on storage.objects;
create policy media_read on storage.objects
  for select to public using (bucket_id = 'media');

drop policy if exists media_write on storage.objects;
create policy media_write on storage.objects
  for insert to authenticated with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists media_update on storage.objects;
create policy media_update on storage.objects
  for update to authenticated using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists media_delete on storage.objects;
create policy media_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
