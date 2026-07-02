# LogSwap バックエンド（Supabase）

「できるだけ安く・動画は少し低画質で・将来スワイプ内広告」を満たす最小構成のサーバーです。
Supabase 1 プロジェクトで **認証・DB・ストレージ・チャット用リアルタイム** が揃います。
契約が要る部分（プロジェクト作成・キー発行）以外はこのフォルダのコードで完結します。

---

## 何をやってくれるか

| 機能 | 実装 |
| --- | --- |
| 本人識別（匿名ログイン） | Supabase Auth（Anonymous） |
| プロフィール保存 | `profiles` / `private_profiles`（性別は本人のみ参照） |
| 画像・動画の実体保存 | Storage `media` バケット（アップロード前にブラウザで圧縮済み） |
| スワイプ配信 | `get_swipe_queue()`（自分・いいね済み・ブロック相手を除外） |
| いいね／相互成立 | `likes` + トリガーで `matches` を自動生成 |
| 成立後チャット | `messages` + Realtime |
| 通報・ブロック | `reports` / `blocks` |
| 退会（アカウント削除） | ユーザー削除で全データ cascade 削除 |

---

## デプロイ手順（15分ほど）

1. **プロジェクト作成** … <https://supabase.com> で New project（Region は Tokyo(ap-northeast-1) 推奨）。
2. **SQL 実行** … Dashboard → SQL Editor に、この順で貼って実行:
   1. `schema.sql`
   2. `policies.sql`
3. **匿名ログインを有効化** … Authentication → Providers → **Anonymous** を ON。
4. **ストレージ作成** … Storage → New bucket → name=`media`、**Public=ON** で作成
   （`policies.sql` の storage ポリシーは作成後に効きます）。
5. **キーを控える** … Project Settings → API から
   - `Project URL`
   - `anon public` key
   の2つをコピー（後述のクライアント設定に貼る）。

これで「出せる状態」のサーバーが立ちます。

> 退会を “Auth ユーザーごと” 消すには、アプリから Edge Function（service_role で `auth.admin.deleteUser`）を
> 呼ぶのが確実です。まずは `profiles` 行削除＋Storage削除でも実質的な退会になります（`policies.sql` の
> delete ポリシーで自分の行・自分のファイルは消せます）。

---

## クライアント側の接続（次の一手）

現状のアプリは localStorage で動くデモです。以下を足すと本番に切り替わります。
`app.html` の `<head>` に supabase-js を読み込み、`js/config.js` を作ってキーを入れます。

```html
<!-- app.html の <head> に追加 -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="js/config.js"></script>
```

```js
// js/config.js（Git に上げてよい。anon key は公開前提のキー）
window.LOGSWAP_CONFIG = {
  BACKEND: true,                       // false ならローカルデモのまま
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",  // anon public key
  ADS_ENABLED: false                   // スワイプ内広告のON/OFF（下記）
};
```

`app.js` はこの後、`window.MOCK_USERS` の代わりに次のような呼び出しへ置き換えます
（差し替えポイントは `init()` / `commit()` / プロフィール保存 / 通報・ブロック）:

```js
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
await sb.auth.signInAnonymously();                     // 起動時に匿名ログイン
const { data: queue } = await sb.rpc("get_swipe_queue", { max_count: 30 });
await sb.from("likes").insert({ liker: me, likee: id });   // 交換したい
await sb.from("blocks").insert({ blocker: me, blocked: id });
await sb.from("reports").insert({ reporter: me, reported: id, reason });
// 動画アップロード（app.js の pendingVideoBlob をそのまま使える）
await sb.storage.from("media").upload(`${me}/video.webm`, pendingVideoBlob, { upsert: true });
```

動画は **アップロード前にブラウザで圧縮済み**（`app.js` の `compressVideo`、640px上限・約0.9Mbps）。
3秒動画なら1本あたり数百KB程度に収まり、保存料と転送量の両方を抑えます。

---

## スワイプ内広告（将来）

- **アプリ（Capacitor/Android）**: AdMob のネイティブ広告を、スワイプのデッキに N枚おきに
  「広告カード」として差し込む。`ADS_ENABLED` と表示間隔を config で管理。
- **Web**: AdSense/AdMob。同意管理（UMP）が必要。
- サーバー側の変更はほぼ不要（広告カードはクライアントが挿入するだけ）。

---

## コストの目安（安く運用するために）

- Supabase **無料枠**: DB 0.5GB / Storage 1GB / 転送 5GB/月 → 検証〜小規模ローンチは 0円。
- 有料 **Pro $25/月**: Storage 100GB / 転送 250GB。
- 一番効くのは **動画の転送量**。伸びてきたら:
  1. 動画の実体だけ **Cloudflare R2（転送無料）** に逃がし、認証/DBは Supabase のまま、が定石。
  2. `compressVideo` のビットレートをさらに下げる（画質と相談）。
- **転送量アラート**を必ず設定（想定外の課金を防ぐ守り）。

---

## リリース前に直すもの

- **プライバシーポリシー**の「端末内にのみ保存」の記述を、バックエンド保存に合わせて更新
  （`app.html` の policyOverlay）。保存先・第三者提供・保存期間・削除方法を実態に合わせる。
- 通報の**対応先と対応フロー**（管理画面 or 通知）。`reports` は service_role で閲覧。
- 未成年保護（アプリ内の 13歳以上ゲートは実装済み。ストアの対象年齢設定も合わせる）。
