/**
 * LogSwap 通報レビュー CLI（運営用）
 * ---------------------------------------------------------------
 * reports テーブルは RLS で本人も他人も読めない（運営=service_role/DB直結のみ）。
 * このツールは Supabase の DB 接続文字列（Session pooler）で直接読む。
 *
 * 使い方（DATABASE_URL に Session pooler の接続文字列を入れて実行）:
 *   DATABASE_URL="postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres"
 *
 *   node server/admin/moderation.mjs                 # 直近の通報＋繰り返し違反者の集計
 *   node server/admin/moderation.mjs user <id>       # 対象ユーザーの詳細（プロフィール・通報・成立数）
 *   node server/admin/moderation.mjs hide <id>       # スワイプから隔離（非表示）。削除ではない
 *   node server/admin/moderation.mjs unhide <id>     # 隔離を解除（誤検知の復帰）
 *   node server/admin/moderation.mjs suspend <id>    # アカウント停止（本人に「削除されました」表示・記録は残す）
 *   node server/admin/moderation.mjs unsuspend <id>  # 停止を解除
 *   node server/admin/moderation.mjs clearmedia <id> # 画像・動画のDB参照を消す（露出停止）
 *   node server/admin/moderation.mjs notice <id> "本文"  # 本人にだけ届く運営からの注意を送る
 *   node server/admin/moderation.mjs ban <id> --confirm  # 対象を完全削除（全データ cascade）
 *
 * ※ 通報が入ると DB トリガーで自動隔離される（わいせつ等は1件、他は3通報）。
 *    このツールは確認後の「解除(unhide) / メディア削除(clearmedia) / 警告(notice) / BAN」に使う。
 *
 * 依存: pg（`npm install` で入る）。SSL 必須。
 */
import pg from "pg";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL が未設定です。Supabase の Session pooler 接続文字列を入れてください。");
  process.exit(2);
}
const [, , cmd, arg, flag] = process.argv;
const noticeMsg = process.argv.slice(4).join(" "); // notice <id> の後ろを本文として結合
const db = new pg.Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
const short = (id) => (id ? String(id).slice(0, 8) : "-");
const jp = (t) => new Date(t).toLocaleString("ja-JP");

await db.connect();
try {
  if (!cmd || cmd === "list") {
    const rep = await db.query(
      `select r.created_at, r.reason, r.reporter, r.reported,
              rp.name reporter_name, tp.name reported_name, tp.handle reported_handle
       from public.reports r
       left join public.profiles rp on rp.id = r.reporter
       left join public.profiles tp on tp.id = r.reported
       order by r.created_at desc limit 50`);
    console.log(`\n=== 直近の通報（最新50件・全${(await db.query("select count(*)::int c from public.reports")).rows[0].c}件） ===`);
    if (!rep.rows.length) console.log("（通報はありません）");
    for (const r of rep.rows) {
      console.log(`[${jp(r.created_at)}] 理由: ${r.reason}`);
      console.log(`   通報した人: ${r.reporter_name || "(削除済)"} (${short(r.reporter)})`);
      console.log(`   通報された人: ${r.reported_name || "(削除済)"} ${r.reported_handle || ""} (${short(r.reported)})  ← id: ${r.reported}`);
    }
    const agg = await db.query(
      `select r.reported, tp.name, tp.handle, tp.hidden, count(*)::int n, max(r.created_at) last
       from public.reports r left join public.profiles tp on tp.id = r.reported
       group by r.reported, tp.name, tp.handle, tp.hidden
       having count(*) >= 1
       order by n desc, last desc limit 30`);
    console.log(`\n=== 通報された回数ランキング（多い順・要対応） ===`);
    if (!agg.rows.length) console.log("（なし）");
    for (const a of agg.rows) {
      const badge = a.hidden ? "🔒隔離中" : "⚠️公開中";
      console.log(`  ${badge}  ${a.n}件  ${a.name || "(削除済)"} ${a.handle || ""}  最終 ${jp(a.last)}  id: ${a.reported}`);
    }
    console.log(`\nヒント: 詳細は  node server/admin/moderation.mjs user <id>  /  削除は  ... ban <id> --confirm`);
  } else if (cmd === "user") {
    if (!arg) throw new Error("user <id> の id を指定してください");
    const p = (await db.query("select * from public.profiles where id=$1", [arg])).rows[0];
    const priv = (await db.query("select gender from public.private_profiles where id=$1", [arg])).rows[0];
    const got = (await db.query("select count(*)::int c from public.reports where reported=$1", [arg])).rows[0].c;
    const made = (await db.query("select count(*)::int c from public.reports where reporter=$1", [arg])).rows[0].c;
    const mt = (await db.query("select count(*)::int c from public.matches where user_a=$1 or user_b=$1", [arg])).rows[0].c;
    console.log("\n=== ユーザー詳細 ===");
    if (!p) { console.log("プロフィールが見つかりません（削除済み or 不正なid）"); }
    else {
      console.log(`名前: ${p.name}   ハンドル: ${p.handle || "-"}   地域: ${p.pref || "-"}`);
      console.log(`自己紹介: ${p.bio || "-"}`);
      console.log(`性別(非公開): ${priv?.gender || "-"}`);
      console.log(`画像: ${p.image_path || "なし"}`);
      console.log(`動画: ${p.video_path || "なし"}`);
      console.log(`隔離(hidden): ${p.hidden ? "★ 隔離中（スワイプ非表示）" : "いいえ"}`);
      console.log(`停止(banned): ${p.banned ? "🚫 停止中（本人はアプリ利用不可）" : "いいえ"}`);
      console.log(`作成: ${jp(p.created_at)}`);
    }
    const rs = (await db.query(
      "select reason, created_at from public.reports where reported=$1 order by created_at desc limit 20", [arg])).rows;
    if (rs.length) {
      console.log(`\n--- この人への通報（最新${rs.length}件） ---`);
      for (const r of rs) console.log(`  [${jp(r.created_at)}] ${r.reason}`);
    }
    const nt = (await db.query(
      "select body, created_at, ack_at from public.notices where user_id=$1 order by created_at desc limit 10", [arg])).rows;
    if (nt.length) {
      console.log(`\n--- 送った注意（最新${nt.length}件） ---`);
      for (const n of nt) console.log(`  [${jp(n.created_at)}] ${n.ack_at ? "（確認済）" : "（未読）"} ${n.body}`);
    }
    console.log(`通報された回数: ${got}   通報した回数: ${made}   成立数: ${mt}`);
    console.log(`\n対応:  hide ${arg} / unhide ${arg} / suspend ${arg} / unsuspend ${arg} / clearmedia ${arg} / notice ${arg} "本文" / ban ${arg} --confirm`);
  } else if (cmd === "hide" || cmd === "unhide") {
    if (!arg) throw new Error(`${cmd} <id> の id を指定してください`);
    const val = cmd === "hide";
    const r = await db.query("update public.profiles set hidden=$2 where id=$1", [arg, val]);
    if (!r.rowCount) console.log("該当プロフィールが見つかりませんでした（削除済み or 不正なid）。");
    else console.log(val ? "隔離しました（スワイプ非表示）。誤検知なら unhide で戻せます。"
                         : "隔離を解除しました（またスワイプに出ます）。");
  } else if (cmd === "suspend" || cmd === "unsuspend") {
    if (!arg) throw new Error(`${cmd} <id> の id を指定してください`);
    const val = cmd === "suspend";
    // 停止時はスワイプ非表示(hidden)も同時にON。解除時は banned だけ戻す（hidden は運営判断）。
    const r = val
      ? await db.query("update public.profiles set banned=true, hidden=true where id=$1", [arg])
      : await db.query("update public.profiles set banned=false where id=$1", [arg]);
    if (!r.rowCount) console.log("該当プロフィールが見つかりませんでした（削除済み or 不正なid）。");
    else if (val) console.log("アカウントを停止しました。本人がアプリを開くと『規約に違反したため削除されました』と表示され、利用できなくなります（※停止画面が入ったアプリ更新の公開後に有効）。記録は残ります。");
    else console.log("停止を解除しました（本人はまた利用できます）。hidden は必要なら unhide で。");
  } else if (cmd === "clearmedia") {
    if (!arg) throw new Error("clearmedia <id> の id を指定してください");
    const r = await db.query(
      "update public.profiles set image_path=null, image2_path=null, video_path=null, video_name=null where id=$1", [arg]);
    if (!r.rowCount) console.log("該当プロフィールが見つかりませんでした。");
    else {
      console.log("画像・動画のDB参照を削除しました（他ユーザーに表示されなくなります）。");
      console.log("※ R2 上の実体ファイルはここでは消えません。必要なら R2 側でも削除してください。");
    }
  } else if (cmd === "notice") {
    if (!arg) throw new Error('notice <id> "本文" の形式で指定してください');
    if (!noticeMsg) throw new Error('本文が空です。例:  notice <id> "わいせつな内容が確認されました。削除してください。"');
    const r = await db.query(
      "insert into public.notices (user_id, body) values ($1,$2) returning id", [arg, noticeMsg]);
    console.log(`注意を送りました（次回アプリ起動時に本人へポップアップ表示）。notice id: ${short(r.rows[0].id)}`);
    console.log(`本文: ${noticeMsg}`);
  } else if (cmd === "ban") {
    if (!arg) throw new Error("ban <id> の id を指定してください");
    if (flag !== "--confirm") {
      const p = (await db.query("select name, handle from public.profiles where id=$1", [arg])).rows[0];
      console.log(`\n対象: ${p ? p.name + " " + (p.handle || "") : "(プロフィール無し)"}  id: ${arg}`);
      console.log("これは取り消せません。全データ（プロフィール・画像/動画のDB参照・トーク・成立・いいね・通報など）が削除されます。");
      console.log("実行するには末尾に --confirm を付けてください:");
      console.log(`  node server/admin/moderation.mjs ban ${arg} --confirm`);
    } else {
      const r = await db.query("delete from auth.users where id=$1", [arg]);
      console.log(r.rowCount ? `削除しました（auth ユーザー1件＋関連データを cascade 削除）。` : "該当ユーザーが見つかりませんでした。");
      console.log("※ R2 の画像/動画の実体はここでは消えません（退会フローの Worker DELETE /media で消える分）。必要なら別途 R2 側で削除してください。");
    }
  } else {
    console.log("使い方: moderation.mjs [list | user <id> | hide <id> | unhide <id> | suspend <id> | unsuspend <id> | clearmedia <id> | notice <id> \"本文\" | ban <id> --confirm]");
  }
} catch (e) {
  console.error("エラー:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
