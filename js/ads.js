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

  // iOS の ATT（App Tracking Transparency）許諾待ち。
  //
  // ダイアログを出すのは AppDelegate.swift（ネイティブ）。JS からプラグイン経由で
  // 出す方式は、WebView の読み込みやプラグイン登録の失敗で「一度も出ない」事故に
  // なる（審査 5.1.2(i) でこれを踏んだ）。ここでは回答が確定するまで待ってから
  // AdMob を初期化する＝許可された場合に IDFA が確実に使われるようにする。
  //
  // 保険として、3秒待っても未回答のまま（＝ネイティブ側が出せていない）なら
  // JS からも1回だけ要求する。許可/不許可どちらでも done() で先へ進む。
  function waitForTracking(p, done) {
    if (!isIOS() || !p || typeof p.trackingAuthorizationStatus !== "function") { done(); return; }
    var tries = 0, asked = false, finished = false;
    function finish() { if (!finished) { finished = true; done(); } }
    function tick() {
      Promise.resolve()
        .then(function () { return p.trackingAuthorizationStatus(); })
        .then(function (res) {
          // 回答済み（authorized/denied/restricted）になったら初期化へ
          if (res && res.status && res.status !== "notDetermined") { finish(); return; }
          tries++;
          if (tries === 6 && !asked && typeof p.requestTrackingAuthorization === "function") {
            asked = true;                      // 3秒経っても未回答＝ネイティブが出せていない
            Promise.resolve(p.requestTrackingAuthorization()).catch(noop);
          }
          if (tries > 24) { finish(); return; } // 12秒で諦めて非パーソナライズのまま進む
          setTimeout(tick, 500);
        })
        .catch(function () { finish(); });
    }
    tick();
  }

  // AdMob SDK 初期化（アプリ起動時に1回）。ネイティブ以外は no-op。
  function initAds() {
    var p = admob();
    var np = nativeAds();
    function start() {
      if (p) {
        Promise.resolve()
          .then(function () { return p.initialize({ initializeForTesting: false }); })
          .catch(noop);
      }
      if (np && CONFIG.AD_NATIVE_ENABLED) {
        var appId = (CONFIG.ADMOB && CONFIG.ADMOB.appId) || "";
        Promise.resolve()
          .then(function () { return np.initialize({ appId: appId }); })
          .catch(noop);
      }
    }
    if (!isIOS()) { start(); return; }
    // iOS は ATT の回答が出てから AdMob を初期化する（ダイアログ自体はネイティブが出す）。
    waitForTracking(p, start);
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

  // --- ATT（プロフィール画面の「広告のトラッキング設定」から使う） ---------
  //
  // ダイアログの主起点はネイティブ（AppDelegate）だが、
  //  ・審査端末に前バージョンが残っていて回答済みになっている
  //  ・端末の「Appからのトラッキング要求を許可」が OFF
  // のどちらでも「起動しても何も出ない」状態になり、審査で ATT 未実装と見なされる。
  // そこで、いつでも到達できる手動の導線をアプリ内に用意して状態も見せる。

  // "authorized" / "denied" / "restricted" / "notDetermined" / "unsupported"
  function trackingStatus() {
    var p = admob();
    if (!isIOS() || !p || typeof p.trackingAuthorizationStatus !== "function") {
      return Promise.resolve("unsupported");
    }
    return Promise.resolve()
      .then(function () { return p.trackingAuthorizationStatus(); })
      .then(function (res) { return (res && res.status) || "unsupported"; })
      .catch(function () { return "unsupported"; });
  }

  // 未回答なら OS のダイアログを出す。回答後の状態を返す。
  function requestTracking() {
    var p = admob();
    if (!isIOS() || !p || typeof p.requestTrackingAuthorization !== "function") {
      return Promise.resolve("unsupported");
    }
    return Promise.resolve()
      .then(function () { return p.requestTrackingAuthorization(); })
      .then(function () { return trackingStatus(); })
      .catch(function () { return trackingStatus(); });
  }

  // iOS の「設定」アプリを開く。Capacitor は http(s) 以外のスキームを
  // UIApplication.open に流すので app-settings: が通る。失敗しても実害なし。
  function openIOSSettings() {
    try { window.location.href = "app-settings:"; } catch (e) { /* 案内文だけ残す */ }
  }

  window.LogSwapAds = {
    trackingStatus: trackingStatus,
    requestTracking: requestTracking,
    openIOSSettings: openIOSSettings,
    isIOS: isIOS,
    showRewarded: showRewarded,
    fillSwipeSlot: fillSwipeSlot,
    clearNativeOverlays: clearNativeOverlays,
    initAds: initAds,
    showLogBanner: showLogBanner,
    hideLogBanner: hideLogBanner
  };
})();
