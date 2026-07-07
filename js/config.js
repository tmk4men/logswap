/**
 * LogSwap 実行時設定。
 * バックエンド未接続でもそのまま動く（既定はデモ動作＝これまで通り）。
 * 実運用に切り替えるときは BACKEND / SUPABASE_* / WORKER_URL を埋める。
 *
 * 端末側で一時的に上書きしたい時は localStorage "logswap_config" に JSON を入れると
 * この既定にマージされる（広告の表示確認やステージング切替に使える）。
 */
(function () {
  var defaults = {
    BACKEND: true,             // Supabase + R2 実接続（app.js 実装済み）
    SUPABASE_URL: "https://pryabdockektzvghowcb.supabase.co",
    SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByeWFiZG9ja2VrdHp2Z2hvd2NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwNjg0NjgsImV4cCI6MjA5ODY0NDQ2OH0.1ybnhHygEZ_kNdqqjQ5ot4pnPgmKOZrTR6XxwE42Gak",
    WORKER_URL: "https://logswap-media.tmk4men.workers.dev", // 画像・動画アップロード用 Cloudflare Worker
    ADS_ENABLED: false,        // スワイプ内に広告カードを差し込むか
    AD_INTERVAL: 6,            // 実カード何枚ごとに広告カードを1枚挟むか

    // ── トーク枠（メッセージできる人数）─────────────────────────
    MSG_SLOTS_FREE: 5,         // 無料でトークを開ける人数
    MSG_AD_SLOTS: 3,           // 動画広告1回で増える枠数
    MSG_AD_HOURS: 24,          // その追加枠が有効な時間（時間）
    MSG_AD_MAX: 5,             // トーク枠の広告を見られる1日の回数
    ID_EXCHANGE_MIN_TURNS: 1,  // ID交換ボタンが出るまでの往復回数（1往復してから）
    MSG_MAX_TURNS: 10,         // ID交換前の往復上限。到達したら「交換 or 解除」に絞る
    PENDING_EXPIRE_HOURS: 48,  // 成立・未トークのまま放置で自動的に消えるまでの時間

    // ── スワイプ枠（1日の上限）──────────────────────────────
    SWIPE_LIMIT: 25,           // 1日に「交換したい/見送り」できる回数
    SWIPE_AD_ADD: 5,           // 動画広告1回でスワイプが増える数
    SWIPE_AD_MAX: 1,           // スワイプ枠を広告で増やせる1日の回数（1日1回まで）

    // ── マッチング調整 ─────────────────────────────────────
    SAME_GENDER_MALE: 0.65,    // 男性が選んだ人に同性(男)が出る確率
    SAME_GENDER_FEMALE: 0.55,  // 女性が選んだ人に同性(女)が出る確率
    BOOST_MINUTES: 30,         // マッチ率アップ（課金アイテム）の持続時間

    // ── 価格（表示用。実課金はストアのIAPで設定。ここは唯一の表示ソース）──
    PRICE_SUB_MONTH: "¥600",   // プレミアム月額（月額のみ）
    PRICE_BOOST: "¥250",       // ブースト30分（単発）
    // ※トーク枠・スワイプ+5 は「動画広告 or プレミアム」で解放（有料販売なし）

    // ── 課金（IAP）── 実課金ON。
    // 実装は cordova-plugin-purchase（js/purchases.js）。
    // ネイティブ（iOS/Android）＝App Store/Google Playの本物の課金。
    // Web/デスクトップ＝プラグインが無いので自動でデモ動作（挙動はこれまで通り）。
    // 事前準備：各 productId を App Store Connect / Google Play に登録し、
    // iOSは Xcode で StoreKit（In-App Purchase）ケイパビリティを有効化しておくこと。
    IAP_ENABLED: true,
    IAP_PRODUCTS: {
      sub_month: "logswap_premium_month",
      boost: "logswap_boost_30m"
    },

    // ── リワード動画広告（AdMob）── 既定OFF＝デモ（見なくても即報酬）。
    // 本番化：@capacitor-community/admob を入れて AD_REWARDED_ENABLED:true、
    // 広告ユニットIDを自分のものへ（既定はGoogleのテストID）。
    AD_REWARDED_ENABLED: false,
    ADMOB: {
      appId: "",
      rewarded: "ca-app-pub-3940256099942544/5224354917", // Googleテスト用
      banner: "ca-app-pub-3940256099942544/6300978111"     // Googleテスト用
    }
  };
  var override = {};
  try { override = JSON.parse(localStorage.getItem("logswap_config") || "{}") || {}; } catch (e) {}
  var cfg = {};
  for (var k in defaults) cfg[k] = (k in override) ? override[k] : defaults[k];

  // スクショ・動作確認用：URLに ?demo を付けるとバックエンドを切ってデモ動作にする。
  // （Supabaseの実データではなく data.js のモックユーザーがスワイプ欄に並ぶ）
  // 本番URL（パラメータ無し）はこれまで通り。例: app.html?demo=1
  try {
    if (new URLSearchParams(location.search || "").has("demo")) cfg.BACKEND = false;
  } catch (e) {}

  window.LOGSWAP_CONFIG = cfg;
})();
