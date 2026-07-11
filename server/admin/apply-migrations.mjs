/**
 * LogSwap マイグレーション適用ツール（運営用）
 * ---------------------------------------------------------------
 * server/migrations/ の .sql を、DB接続文字列で直接流し込む。
 * moderation.mjs と同じく Session pooler の接続文字列を使う。
 *
 * 使い方（DATABASE_URL に Session pooler の接続文字列を入れて実行）:
 *   DATABASE_URL="postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
 *     node server/admin/apply-migrations.mjs 0009 0010
 *
 * 引数は migrations/ 内のファイル名の先頭一致（例 "0009"）。省略時は全 .sql を番号順。
 * 各 .sql は idempotent（if not exists / create or replace）なので再実行しても安全。
 *
 * 依存: pg（`npm install` で入る）。SSL 必須。
 */
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const URL = process.env.DATABASE_URL;
if (!URL) {
  console.error("DATABASE_URL が未設定です。Supabase の Session pooler 接続文字列を入れてください。");
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const migDir = join(here, "..", "migrations");
const all = readdirSync(migDir).filter((f) => f.endsWith(".sql")).sort();

const picks = process.argv.slice(2);
const files = picks.length
  ? picks.map((p) => {
      const hit = all.find((f) => f.startsWith(p));
      if (!hit) throw new Error(`migrations/ に "${p}*" が見つかりません`);
      return hit;
    })
  : all;

const db = new pg.Client({ connectionString: URL, ssl: { rejectUnauthorized: false } });
await db.connect();
try {
  for (const f of files) {
    const sql = readFileSync(join(migDir, f), "utf8");
    process.stdout.write(`\n▶ ${f} を適用中... `);
    await db.query(sql);
    console.log("OK");
  }
  console.log(`\n完了：${files.length}ファイルを適用しました。`);
} catch (e) {
  console.error("\nエラー:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
