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
  // Native Advanced 用プラグイン（@brandonknudsen/admob-native-advanced）。
  function nativeAds() {
    try {
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMobNativeAdvanced;
    } catch (e) { return null; }
  }
  function isIOS() {
    try { return window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform() === "ios"; }
    catch (e) { return false; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
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

  var bannerCreated = false;
  function noop() {}

  // AdMob SDK 初期化（アプリ起動時に1回）。ネイティブ以外は no-op。
  function initAds() {
    var p = admob();
    if (p) {
      Promise.resolve()
        .then(function () { return p.initialize({ initializeForTesting: false }); })
        .catch(noop);
    }
    var np = nativeAds();
    if (np && CONFIG.AD_NATIVE_ENABLED) {
      var appId = (CONFIG.ADMOB && CONFIG.ADMOB.appId) || "";
      Promise.resolve()
        .then(function () { return np.initialize({ appId: appId }); })
        .catch(noop);
    }
  }

  // ログ画面用バナーを表示。ネイティブ実バナーを出せたら true（＝自社バナーは不要）、
  // 出せなければ false（呼び出し側がWeb用の自社バナーを出す）。
  function showLogBanner() {
    var p = admob();
    if (!p || !CONFIG.AD_BANNER_ENABLED) return false;
    var unit = (CONFIG.ADMOB && CONFIG.ADMOB.banner) || "";
    if (!unit) return false;
    if (bannerCreated) { p.resumeBanner().catch(noop); return true; }
    p.showBanner({
      adId: unit,
      adSize: "ADAPTIVE_BANNER",     // 端末幅に自動フィット
      position: "BOTTOM_CENTER",     // 画面下端に固定オーバーレイ
      margin: CONFIG.AD_BANNER_MARGIN || 0, // タブバーの上に浮かせる
      isTesting: false
    }).catch(noop);
    bannerCreated = true;
    return true;
  }

  // ログ画面から離れたらバナーを隠す（破棄はせず、次回 resume で復帰）。
  function hideLogBanner() {
    var p = admob();
    if (!p || !bannerCreated) return;
    p.hideBanner().catch(noop);
  }

  // ── スワイプ内 Native Advanced 広告 ─────────────────────────────
  // 表示中の iOS ネイティブオーバーレイの adId 一覧（デッキ再描画前に破棄する）。
  var iosOverlayIds = [];

  // Android/Web：返ってきた広告アセットを DOM に描画（ポリシー準拠のためAdChoices/広告表記あり）。
  function renderNativeAssets(slotEl, ad) {
    var media = ad.mediaContentUrl
      ? '<img class="nad-media" src="' + esc(ad.mediaContentUrl) + '" alt="" />'
      : '<div class="nad-media nad-media-empty"></div>';
    var icon = ad.iconUrl ? '<img class="nad-icon" src="' + esc(ad.iconUrl) + '" alt="" />' : "";
    var cta = ad.callToAction || "詳しく見る";
    var adChoices = ad.adChoicesIconUrl
      ? '<img class="nad-adchoices" src="' + esc(ad.adChoicesIconUrl) + '" alt="AdChoices" />'
      : "";
    slotEl.innerHTML =
      '<span class="ad-badge">広告</span>' + adChoices +
      media +
      '<div class="nad-scrim"></div>' +
      '<div class="nad-info">' +
        '<div class="nad-row">' + icon +
          '<div class="nad-lines">' +
            '<span class="nad-head">' + esc(ad.headline || "") + "</span>" +
            (ad.advertiser ? '<span class="nad-adv">' + esc(ad.advertiser) + "</span>" : "") +
          "</div>" +
        "</div>" +
        (ad.body ? '<p class="nad-body">' + esc(ad.body) + "</p>" : "") +
        '<button class="nad-cta" type="button">' + esc(cta) + " →</button>" +
      "</div>";
  }

  // iOS：ネイティブ広告ビューをカード枠の上にオーバーレイ配置（クリック計測はSDKが自動）。
  function mountIosOverlay(slotEl, ad) {
    var np = nativeAds();
    if (!np) return;
    var r = slotEl.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    iosOverlayIds.push(ad.adId);
    np.positionNativeAd({
      adId: ad.adId,
      x: Math.round(r.left), y: Math.round(r.top),
      width: Math.round(r.width), height: Math.round(r.height)
    }).catch(noop);
  }

  // デッキ再描画・ドラッグ開始時に呼ぶ：出ている iOS オーバーレイを全て隠す。
  function clearNativeOverlays() {
    var np = nativeAds();
    if (!np || !iosOverlayIds.length) return;
    var ids = iosOverlayIds; iosOverlayIds = [];
    for (var i = 0; i < ids.length; i++) {
      np.hideNativeAd({ adId: ids[i] }).catch(noop);
    }
  }

  // スワイプ広告カードの枠（.ad-media[data-ad-slot="swipe"]）に Native Advanced 広告を読み込む。
  // 成功すれば実広告を描画。非対応/失敗時は何もしない＝app.js の自社プロモがそのまま残る。
  function fillSwipeSlot(slotEl, opts) {
    var np = nativeAds();
    if (!np || !CONFIG.AD_NATIVE_ENABLED || !slotEl) return false;
    var unit = (CONFIG.ADMOB && CONFIG.ADMOB.native) || "";
    if (!unit) return false;
    np.loadAd({ adUnitId: unit }).then(function (ad) {
      if (!ad || !slotEl.isConnected) return;
      if (isIOS()) {
        mountIosOverlay(slotEl, ad);   // impression/click は iOS 側で自動計測
      } else {
        renderNativeAssets(slotEl, ad);
        np.reportImpression({ adId: ad.adId }).catch(noop);
        slotEl.addEventListener("click", function () {
          np.reportClick({ adId: ad.adId }).catch(noop);
        });
      }
    }).catch(noop);
    return true; // 読み込みを開始（非同期。失敗時は自社プロモが残る）
  }

  window.LogSwapAds = {
    showRewarded: showRewarded,
    fillSwipeSlot: fillSwipeSlot,
    clearNativeOverlays: clearNativeOverlays,
    initAds: initAds,
    showLogBanner: showLogBanner,
    hideLogBanner: hideLogBanner
  };
})();
