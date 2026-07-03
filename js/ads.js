/**
 * LogSwap｜広告レイヤ（リワード動画）
 *
 * アプリ側は LogSwapAds.showRewarded(onReward) だけを呼ぶ。
 * 実装の差し替え点をここ1か所に閉じ込める。
 *
 * - 既定（CONFIG.AD_REWARDED_ENABLED=false または プラグイン未導入）＝デモ：
 *   広告を出さずに即 onReward()（＝これまで通りの挙動）。
 * - 本番：@capacitor-community/admob を導入し config で有効化すると、
 *   実際のリワード動画を見せ、報酬確定で onReward() を呼ぶ。
 *
 * スワイプ内のバナー/インタースティシャル枠は buildCard の .ad-media[data-ad-slot]
 * が差込口。実バナー描画もここに fillSwipeSlot として足せる（未実装）。
 */
(function () {
  "use strict";
  var CONFIG = window.LOGSWAP_CONFIG || {};

  function admob() {
    try {
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob;
    } catch (e) { return null; }
  }

  // リワード動画を見せ、報酬が確定したら onReward()。中断は onCancel()。
  function showRewarded(onReward, onCancel) {
    var plugin = admob();
    if (!CONFIG.AD_REWARDED_ENABLED || !plugin) {
      if (onReward) onReward();          // デモ：広告なしで即報酬
      return;
    }
    var unit = (CONFIG.ADMOB && CONFIG.ADMOB.rewarded) || "";
    // @capacitor-community/admob: prepareRewardVideoAd → showRewardVideoAd
    Promise.resolve()
      .then(function () { return plugin.prepareRewardVideoAd({ adId: unit }); })
      .then(function () { return plugin.showRewardVideoAd(); })
      .then(function () { if (onReward) onReward(); })
      .catch(function () { if (onCancel) onCancel(); });
  }

  window.LogSwapAds = { showRewarded: showRewarded };
})();
