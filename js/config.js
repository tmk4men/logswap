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
    AD_INTERVAL: 6             // 実カード何枚ごとに広告カードを1枚挟むか
  };
  var override = {};
  try { override = JSON.parse(localStorage.getItem("logswap_config") || "{}") || {}; } catch (e) {}
  var cfg = {};
  for (var k in defaults) cfg[k] = (k in override) ? override[k] : defaults[k];
  window.LOGSWAP_CONFIG = cfg;
})();
