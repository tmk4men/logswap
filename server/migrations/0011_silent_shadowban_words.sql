-- =====================================================================
-- Migration 0011: 禁止ワード／未成年の「サイレント隔離（シャドウバン）」
-- ---------------------------------------------------------------------
-- 方針: 本人にはエラーを出さず（＝黙って保存させ）、名前・自己紹介に
--   未成年を示す語・年齢(0〜17歳)・禁止ワードが含まれていたら hidden=true に
--   して、他ユーザーのスワイプから外す。本人にばれない＝抜け穴を探させない。
--   判定はサーバー側なのでクライアント改ざんで回避できない。
--
-- 既存デプロイは Supabase の SQL Editor でこのファイルを1回実行する。
-- =====================================================================

-- 名前＋自己紹介を見て「隠すべきか」を判定する純関数（テーブル非依存＝immutable）。
create or replace function public.profile_should_hide(pname text, pbio text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  txt   text;
  w     text;
  m     text[];
  words text[] := array[
    -- 連絡先・SNS 誘導
    'line','ライン','らいん','カカオ','kakao','telegram','テレグラム','discord','ディスコ','ディスコード',
    'インスタ','instagram','insta','twitter','ツイッター','tiktok','ティックトック','snapchat','スナチャ',
    'wechat','kik','skype','スカイプ','signal','メアド','メールアドレス','gmail','yahoo','icloud','hotmail',
    '電話番号','090','080','070','連絡先','直接連絡','dm','ディーエム',
    -- 性的・わいせつ
    'セックス','sex','エッチ','えっち','えち','エチ','ワンナイト','パパ活','ママ活','援交','援助交際',
    '裏垢','avトーク','av女優','セフレ','やりもく','ヤリモク','ヤリ目','おっぱい','ちんこ','ちんちん',
    'まんこ','出会い','ヤりたい','やりたい','フェラ','オナニー','射精','中出し','挿入','ヌード','全裸',
    '性行為','性的','ペニス','わいせつ','ワイセツ','下着','パンチラ','ロリ','ショタ','近親','レイプ',
    '買春','売春','デリヘル','風俗','円光','18禁','アダルト','エロ','えろ','変態','巨乳','陰部','股間','勃起','裸体',
    -- 未成年を示す語
    '中学','小学','未成年','jk','jc','中坊','厨房','児童'
  ];
begin
  txt := lower(coalesce(pname,'') || ' ' || coalesce(pbio,''));
  txt := translate(txt, '０１２３４５６７８９', '0123456789');  -- 全角数字を半角化
  txt := replace(txt, ' ', '');                                  -- 空白除去（回避対策）

  foreach w in array words loop
    if position(w in txt) > 0 then
      return true;
    end if;
  end loop;

  -- 年齢: 「◯歳 / ◯さい」の数字を丸ごと取り、18未満なら隠す（18歳以上は許可）
  for m in select regexp_matches(txt, '([0-9]{1,3})(歳|さい)', 'g') loop
    if (m[1])::int < 18 then
      return true;
    end if;
  end loop;

  return false;
end;
$$;

-- profiles の保護トリガーを更新：
--  (1) 本人がAPI経由で自分の hidden を勝手に解除するのを禁止（UPDATE時）
--  (2) 名前/自己紹介に不適切語が含まれれば黙って hidden=true（本人に通知しない）
--  INSERT でも作動させる（新規登録時に即シャドウバン）。
create or replace function public.profiles_protect_hidden()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and auth.uid() = old.id then
    new.hidden := old.hidden;  -- 本人のセルフ更新では hidden を据え置き
  end if;
  if public.profile_should_hide(new.name, new.bio) then
    new.hidden := true;        -- 不適切語を含むなら黙って隔離
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_hidden on public.profiles;
create trigger trg_profiles_protect_hidden
  before insert or update on public.profiles
  for each row execute function public.profiles_protect_hidden();

-- 既存プロフィールも遡ってシャドウバン（該当する既存ユーザーを今すぐ他者から隠す）。
update public.profiles
   set hidden = true
 where hidden = false
   and public.profile_should_hide(name, bio);
