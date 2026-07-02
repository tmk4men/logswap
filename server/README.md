# LogSwap バックエンド（Supabase + Cloudflare R2 ハイブリッド）

「できるだけ安く・動画は少し低画質で・将来スワイプ内広告」を満たす構成です。
費用の大半を占める**動画の配信転送量(egress)**を、転送無料の **Cloudflare R2** に逃がします。
認証・DB・チャットは **Supabase**。この2つの役割分担が、動画アプリを一番安く運用する形です。

```
             ┌──────────── Supabase ────────────┐
 ブラウザ ──▶│ 認証(匿名) / Postgres+RLS / Realtime │  ← プロフィール・いいね・成立・チャット
   │         └──────────────────────────────────┘
   │  動画/画像の実体だけ
   └────────▶ Cloudflare Worker ──▶ R2バケット ──▶ 公開URL(転送無料)で配信
              (Supabase JWTで本人確認)
```

このフォルダの中身:
- `schema.sql` / `policies.sql` … Supabase の DB とアクセス制御
- `worker/` … R2 にメディアを保存する Cloudflare Worker（`src/index.js` / `wrangler.toml`）
- `worker/client-upload.example.js` … クライアントからのアップロード雛形

---

## 何をやってくれるか

| 機能 | 実装 |
| --- | --- |
| 本人識別（匿名ログイン） | Supabase Auth（Anonymous） |
| プロフィール保存 | `profiles` / `private_profiles`（性別は本人のみ参照） |
| **画像・動画の実体保存＆配信** | **Cloudflare R2（Worker経由でアップ、公開URLで配信・転送無料）** |
| スワイプ配信 | `get_swipe_queue()`（自分・いいね済み・ブロック相手を除外） |
| いいね／相互成立 | `likes` + トリガーで `matches` を自動生成 |
| 成立後チャット | `messages` + Realtime |
| 通報・ブロック | `reports` / `blocks` |
| 退会（アカウント削除） | Supabaseユーザー削除で cascade ＋ Worker `DELETE /media` |

---

## デプロイ手順

### A. Supabase（認証・DB）

1. **プロジェクト作成** … <https://supabase.com> で New project（Region=Tokyo 推奨）。
2. **SQL 実行** … SQL Editor で `schema.sql` → `policies.sql` の順。
3. **匿名ログインを有効化** … Authentication → Providers → **Anonymous** を ON。
4. **キーを控える** … Project Settings → API から `Project URL` と `anon public` key。
   さらに JWT Settings の **JWT Secret**（Worker が使う）も控える。

> メディアは R2 に置くので、**Supabase Storage のバケットは作らなくてよい**。
> （`policies.sql` の末尾にある storage ポリシーは、R2 を使わず Supabase Storage で
> 済ませたい場合のためだけのもの。R2 構成では実行不要・使いません。）

### B. Cloudflare R2 + Worker（メディア）

1. **R2 バケット作成** … Cloudflare ダッシュボード → R2 → Create bucket（例 `logswap-media`）。
2. **公開アクセス** … バケットに **Public 開発URL(r2.dev)** を有効化するか、**カスタムドメイン**を割り当てる
   （本番はカスタムドメイン推奨）。この公開URLが読み取り配信元になる。
3. **Worker 設定** … `server/worker/wrangler.toml` を編集:
   - `bucket_name` を作ったバケット名に
   - `PUBLIC_BASE` を上の公開URLに（例 `https://media.example.com`）
   - `ALLOWED_ORIGIN` を本番はアプリのオリジンに（開発中は `*`）
4. **JWT シークレット登録** … `server/worker/` で
   `npx wrangler secret put SUPABASE_JWT_SECRET`（値は A-4 の JWT Secret）。
5. **デプロイ** … `npx wrangler deploy`。表示される `https://logswap-media.<account>.workers.dev` を控える。

### C. クライアント設定

`app.html` に supabase-js を読み込み、`js/config.js` を作る:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/config.js"></script>
```

```js
// js/config.js（Git に上げてよい。anon key と Worker URL は公開前提）
window.LOGSWAP_CONFIG = {
  BACKEND: true,
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
  WORKER_URL: "https://logswap-media.xxxx.workers.dev",  // R2アップロード先
  ADS_ENABLED: false
};
```

---

## クライアントの接続（app.js の差し替えポイント）

`app.js` を `window.MOCK_USERS` から Supabase＋Worker 呼び出しに置き換えます。差し替え点:

- **起動時** … `await sb.auth.signInAnonymously()`
- **スワイプ配信** … `const { data } = await sb.rpc("get_swipe_queue", { max_count: 30 })`
  （`video_path` はR2の公開URL。`buildCard` の `<video src>` にそのまま使える）
- **交換したい** … `await sb.from("likes").insert({ liker: me, likee: id })`（成立はトリガー任せ）
- **プロフィール保存** … 画像/動画を Worker にアップ → 返ったURLを `profiles` に upsert
  （`worker/client-upload.example.js` の `uploadMedia()` を利用。動画は `pendingVideoBlob` を渡す）
- **通報・ブロック** … `reports` / `blocks` に insert
- **アカウント削除** … Worker `DELETE /media` → `profiles` を delete（cascade）→ `sb.auth` サインアウト

動画は**アップロード前にブラウザで圧縮済み**（`app.js` の `compressVideo`、640px上限・約0.9Mbps）。
3秒動画なら1本数百KB。R2は転送無料なので、これをスワイプで配っても配信費はかからない。

---

## スワイプ内広告（将来）

- **アプリ（Capacitor/Android）**: AdMob ネイティブ広告を、デッキに N枚おきに「広告カード」として差し込む。
  `ADS_ENABLED` と表示間隔を config で管理。
- **Web**: AdSense/AdMob。同意管理（UMP）が必要。
- サーバー側の変更はほぼ不要（広告カードはクライアントが挿入するだけ）。

---

## コストの目安

- **Supabase 無料枠**: DB 0.5GB / 認証・Realtime 込み → 小規模は 0円。伸びたら Pro $25/月。
- **Cloudflare R2**: 保存 約$0.015/GB・月、**転送(egress)は常に無料**。無料枠に 10GB保存/月＋操作枠あり。
- 圧縮後の動画が1本約500KBなら、1万本でも保存 約5GB＝ごくわずか。**動画をどれだけ配っても転送費は増えない**のが R2併用の肝。
- **転送量アラート**（Supabase側）は一応設定。想定外課金の守り。

---

## リリース前に直すもの

- **プライバシーポリシー**の「端末内にのみ保存」の記述を、バックエンド保存（Supabase＋R2）に合わせて更新
  （`app.html` の policyOverlay）。保存先・第三者提供・保存期間・削除方法を実態に。
- 通報の**対応先と対応フロー**（管理画面 or 通知）。`reports` は service_role で閲覧。
- `ALLOWED_ORIGIN` を本番オリジンに絞る（`*` のままにしない）。
- 未成年保護（アプリ内 13歳以上ゲートは実装済み。ストアの対象年齢設定も合わせる）。
