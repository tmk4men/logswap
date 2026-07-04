# 本番化ガイド（課金 / 広告 / バックエンド）

このアプリは既定で **デモ（no-cloud・no-store）** として完全に動きます。
下記を埋めると、実際の課金・広告・サーバー接続に切り替わります。実装の差込口は
すべて `js/config.js` のフラグと、薄い抽象化レイヤ（`js/ads.js` / `js/purchases.js`）に
集約してあります。

---

## 1. 課金（IAP：App Store直結・実装済み）

**価格（確定）**：プレミアム 月¥550、単発 ブースト¥250。
（トーク枠追加・スワイプ+5 は動画広告 or プレミアムで解放＝有料販売なし。）

**実装は完了しています**（`js/purchases.js` = `cordova-plugin-purchase` 直結、`config.js` の
`IAP_ENABLED:true`）。加入状態は「買った瞬間に決め打ち」ではなく、**ストアが返す“現在有効な
購読”を起動のたびに同期**する設計なので、解約・期限切れが正しく反映されます（RevenueCat等の
外部サービス不要）。Web/デスクトップはプラグインが無いので自動でデモ動作（挙動は従来通り）。

商品ID（`js/config.js` の `IAP_PRODUCTS` と一致させる）：
- `logswap_premium_month`（自動更新サブスク・月）
- `logswap_boost_30m`（消耗型＝ブースト）

### 残りは「ストア側の登録」と「実機テスト」だけ（Macで）

1. **依存を取得**（Mac）
   ```
   npm install          # cordova-plugin-purchase を含む
   npm run build:www && npx cap sync ios
   ```
2. **App Store Connect で商品を作成**（[appstoreconnect.apple.com](https://appstoreconnect.apple.com)）
   - サブスクグループを1つ作り、その中に **自動更新サブスク** `logswap_premium_month`（¥550/月）
   - **消耗型（Consumable）** `logswap_boost_30m`（¥250）
   - どちらも表示名・説明・価格を入力し、「提出準備完了」まで。**アプリの審査と一緒に初回提出**されます。
3. **Xcode で StoreKit ケイパビリティを有効化**
   - `npx cap open ios` → プロジェクト App → **Signing & Capabilities** → **+ Capability** →
     **In-App Purchase** を追加。
4. **サンドボックスで実機テスト**
   - App Store Connect → ユーザーとアクセス → **Sandbox テスター** を1つ作成。
   - iPhone実機に配線して実行 → 設定アプリでサンドボックスのApple IDにサインイン（またはXcode実行時に購入で聞かれる）。
   - プレミアム「登録する」→ サンドボックス購入 → **プレミアム加入に切り替わる**、アプリ再起動しても維持、
     「サブスクを管理」で解約 → 再起動後に**加入が外れる**、まで確認。ブーストは購入で所持+1。「購入を復元」も確認。
5. **Android（後日）**：Google Play で同じ productId の定期購入＋消費型アイテムを登録すれば、
   `purchases.js` はプラットフォーム自動判定なのでそのまま動きます（今回はiOS優先）。

### 実装メモ
- **購入画面の必須表記（App Store 3.1.2）は実装済み**：プロモ全画面／プレミアム欄に
  「自動更新の説明＋利用規約＋プライバシー」のリンク（`.iap-legal`）と価格・期間を表示。
- 表示価格はストアのローカライズ価格を優先（取れなければ `PRICE_*` の表示値）。
- アプリ内では解約させず、`Purchases.manageSubscriptions()` でストアの購読管理へ誘導。
- クライアント状態は localStorage だが、**加入是非は毎起動でStoreKitの現在エンタイトルメントから
  再同期**するので改ざんに強い（サーバー検証を足すならレシートをWorkerへ送る余地あり＝任意）。

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
- [x] `IAP_ENABLED: true` ＋ `purchases.js` を StoreKit 直結で実装
- [ ] App Store Connect に商品登録（`logswap_premium_month` / `logswap_boost_30m`）
- [ ] Xcode で In-App Purchase ケイパビリティ追加
- [ ] サンドボックス実機テスト（加入→再起動維持→解約→加入外れる／ブースト／復元）
- [ ] `AD_REWARDED_ENABLED: true` ＋ 自分のAdMob ID（公開後）
- [ ] `ADS_ENABLED: true`（スワイプ内広告を出す場合）
- [x] `BACKEND: true` ＋ `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `WORKER_URL`
- [x] プライバシーポリシーを実保存（Supabase/R2）の実態に更新済み
