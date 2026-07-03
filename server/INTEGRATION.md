# 本番化ガイド（課金 / 広告 / バックエンド）

このアプリは既定で **デモ（no-cloud・no-store）** として完全に動きます。
下記を埋めると、実際の課金・広告・サーバー接続に切り替わります。実装の差込口は
すべて `js/config.js` のフラグと、薄い抽象化レイヤ（`js/ads.js` / `js/purchases.js`）に
集約してあります。

---

## 1. 課金（IAP：サブスク＋単発）

**価格（確定）**：プレミアム 月¥600 / 年¥4,800、単発 ブースト¥250・トーク枠¥120・スワイプ¥120。

### やること
1. **プラグイン導入**（Capacitor）
   ```
   npm i @capacitor-community/in-app-purchase   # 例。RevenueCat等でも可
   npx cap sync
   ```
2. **ストアに商品を作成**し、`js/config.js` の `IAP_PRODUCTS` の productId と一致させる：
   - `logswap_premium_month`（自動更新サブスク・月）
   - `logswap_premium_year`（自動更新サブスク・年）
   - `logswap_boost_30m`（消耗型）
   - `logswap_talkslots_3`（消耗型）
   - `logswap_swipe_5`（消耗型）
   - App Store Connect：サブスクグループ作成／消耗型は「消耗型」で登録。
   - Google Play：定期購入＋アプリ内アイテム（消費型）で登録。
3. **`IAP_ENABLED: true`** に。
4. `js/purchases.js` の `buy()` 内 TODO を実装：**購入後のレシートを必ずサーバーで検証**
   （Supabase Edge Function か Cloudflare Worker）。検証OKで課金状態を確定・保存。
5. アプリ側は変更不要（プレミアム加入・ブースト・上限課金・**購入の復元**ボタンは
   すべて `LogSwapPurchases` 経由で結線済み）。

> クライアントの状態は現状 localStorage。**不正防止のため課金状態はサーバー管理へ**移すこと。

---

## 2. 広告（AdMob：リワード動画＋スワイプ内枠）

### やること
1. **プラグイン導入**
   ```
   npm i @capacitor-community/admob
   npx cap sync
   ```
2. `js/config.js` の `ADMOB.appId` / `ADMOB.rewarded` / `ADMOB.banner` を**自分のIDへ**
   （既定はGoogleのテストID）。AndroidManifest／Info.plist にアプリIDを設定。
3. リワード動画：**`AD_REWARDED_ENABLED: true`**。上限案内の「動画広告を見る」は
   `LogSwapAds.showRewarded()` 経由で結線済み。`js/ads.js` の実装は
   `prepareRewardVideoAd → showRewardVideoAd` で用意済み（プラグインのAPI名は要確認）。
4. スワイプ内の広告枠：**`ADS_ENABLED: true`** で `AD_INTERVAL` 枚ごとにカードを挿入。
   実バナー描画は `buildCard` の `.ad-media[data-ad-slot="swipe"]` が差込口（バナー実描画は未実装）。

---

## 3. バックエンド（Supabase＋Cloudflare R2）

`server/`（`schema.sql` / `policies.sql` / `worker/`）とセットアップ手順は `server/README.md` 参照。
現状 `js/app.js` は `MOCK_USERS` で動作。**実接続（init/スワイプ取得/成立/プロフ保存/通報ブロック/
メッセージの Supabase 差し替え）は実プロジェクトが無いと検証不能**なので、基盤を作ってから一緒に行う。

差し替えの主な点：
- スワイプ候補＝`get_swipe_queue()` RPC、成立＝`likes` insert（相互で `matches` トリガー）。
- **トーク**＝定型文/スタンプを `messages` テーブル＋Realtimeで同期。ID交換の
  「両者合意」は現在デモ（相手自動同意）なので、**両者の同意フラグ**をサーバーで持つ。
- 画像/動画の実体＝R2（`server/worker/client-upload.example.js` の `uploadMedia()`）。
- 課金状態＝サーバー保持（上記1-4）。

---

## 切り替えチェックリスト
- [ ] `IAP_ENABLED: true` ＋ 商品ID一致 ＋ レシート検証
- [ ] `AD_REWARDED_ENABLED: true` ＋ 自分のAdMob ID
- [ ] `ADS_ENABLED: true`（スワイプ内広告を出す場合）
- [ ] `BACKEND: true` ＋ `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `WORKER_URL`
- [ ] 課金状態をサーバー管理へ移行（localStorage依存をやめる）
- [ ] プライバシーポリシーを「端末内保存」→実保存に更新
