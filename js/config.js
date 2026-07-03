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
    BACKEND: false,            // true で Supabase 接続（app.js の実接続差し替え後に有効）
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    WORKER_URL: "",            // 画像・動画アップロード用 Cloudflare Worker の URL
    ADS_ENABLED: false,        // スワイプ内に広告カードを差し込むか
    AD_INTERVAL: 6,            // 実カード何枚ごとに広告カードを1枚挟むか

    // ── トーク枠（メッセージできる人数）─────────────────────────
    MSG_SLOTS_FREE: 5,         // 無料でトークを開ける人数
    MSG_AD_SLOTS: 3,           // 動画広告で一時的に増える枠数
    MSG_AD_HOURS: 24,          // その追加枠が有効な時間（時間）
    ID_EXCHANGE_MIN_TURNS: 1,  // ID交換ボタンが出るまでの往復回数（1往復してから）
    MSG_MAX_TURNS: 10,         // ID交換前の往復上限。到達したら「交換 or 解除」に絞る
    PENDING_EXPIRE_HOURS: 48,  // 成立・未トークのまま放置で自動的に消えるまでの時間

    // ── スワイプ枠（1日の上限）──────────────────────────────
    SWIPE_LIMIT: 25,           // 1日に「交換したい/見送り」できる回数
    SWIPE_AD_ADD: 5,           // 動画広告1回でスワイプが増える数
    SWIPE_AD_MAX: 3,           // スワイプ枠を広告で増やせる1日の回数

    // ── マッチング調整 ─────────────────────────────────────
    SAME_GENDER_MALE: 0.65,    // 男性が選んだ人に同性(男)が出る確率
    SAME_GENDER_FEMALE: 0.55,  // 女性が選んだ人に同性(女)が出る確率
    BOOST_MINUTES: 30,         // マッチ率アップ（課金アイテム）の持続時間

    // ── 価格（表示用。実課金はストアのIAPで設定。ここは唯一の表示ソース）──
    PRICE_SUB_MONTH: "¥550",   // プレミアム月額（月額のみ）
    PRICE_BOOST: "¥250",       // ブースト30分（単発）
    PRICE_MSG_SLOTS: "¥120",   // トーク枠追加（単発）
    PRICE_SWIPE: "¥120",       // スワイプ+5（単発）

    // ── 課金（IAP）── 既定OFF＝デモ（購入は即成功扱い）。
    // 本番化：Capacitorの課金プラグインを入れて IAP_ENABLED:true、
    // 各 productId を App Store Connect / Google Play で作成して合わせる。
    IAP_ENABLED: false,
    IAP_PRODUCTS: {
      sub_month: "logswap_premium_month",
      boost: "logswap_boost_30m",
      msg_slots: "logswap_talkslots_3",
      swipe: "logswap_swipe_5"
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
  window.LOGSWAP_CONFIG = cfg;
})();
