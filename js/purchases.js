/**
 * LogSwap｜課金レイヤ（アプリ内課金 / IAP）
 *
 * アプリ側は次の3つだけを呼ぶ:
 *   LogSwapPurchases.init({ onSubChange, onBoostGranted })  … 起動時に1回
 *   LogSwapPurchases.buy(productKey, onOrdered, onFail)      … 購入
 *   LogSwapPurchases.restore(onDone)                         … 購入の復元
 * （補助）manageSubscriptions() / priceOf(productKey)
 *
 * 実装は cordova-plugin-purchase（window.CdvPurchase.store）。iOS=App Store、
 * Android=Google Play の「本物の」課金を通す。お金は必ずストアの決済を経由する。
 *
 * 重要な設計:
 *  - 加入状態（sub）は買った瞬間に決め打ちしない。ストアが返す「現在有効な購読」を
 *    正としてアプリへ通知する（onSubChange）。起動のたびに同期するので、
 *    解約・期限切れが正しく反映される（＝App Store直結でも状態がズレない）。
 *  - 消耗型ブースト（logswap_boost_30m）は verified で1個付与（onBoostGranted）。
 *  - CdvPurchase が無い環境（Web/デスクトップ）や CONFIG.IAP_ENABLED=false のときは
 *    デモにフォールバック（実決済せず即成功扱い）。Webの体験はこれまで通り。
 *
 * productKey: "sub_month" | "boost"（CONFIG.IAP_PRODUCTS で productId に対応）
 */
(function () {
  "use strict";
  var CONFIG = window.LOGSWAP_CONFIG || {};
  var PRODUCTS = CONFIG.IAP_PRODUCTS || {};

  // 起動時に app.js から渡されるコールバック（デモ経路でも同じものを使う）
  var handlers = { sub: function () {}, boost: function () {} };
  var started = false;

  function CP() { try { return window.CdvPurchase; } catch (e) { return null; } }
  function store() { var c = CP(); return c && c.store; }
  function platform() {
    try {
      var p = window.Capacitor && window.Capacitor.getPlatform && window.Capacitor.getPlatform();
      return p || "web";
    } catch (e) { return "web"; }
  }
  function storePlatform() {
    var c = CP(); if (!c) return null;
    var p = platform();
    if (p === "ios") return c.Platform.APPLE_APPSTORE;
    if (p === "android") return c.Platform.GOOGLE_PLAY;
    return null; // web → デモ
  }
  // 実課金が使える環境か（プラグイン有り＋有効＋対応プラットフォーム）
  function usable() { return !!(CONFIG.IAP_ENABLED && store() && storePlatform()); }

  function pid(key) { return PRODUCTS[key]; }
  function subId() { return pid("sub_month"); }
  function boostId() { return pid("boost"); }

  // 起動時に1回。プラグインを初期化し、購読状態の監視をつなぐ。
  function init(opts) {
    opts = opts || {};
    handlers.sub = opts.onSubChange || handlers.sub;
    handlers.boost = opts.onBoostGranted || handlers.boost;

    if (!usable() || started) return;   // Web/デモ or 二重初期化はここで終了
    started = true;

    var CdvPurchase = CP();
    var st = store();
    var plat = storePlatform();
    var PT = CdvPurchase.ProductType;
    var sId = subId(), bId = boostId();

    var regs = [];
    if (sId) regs.push({ id: sId, type: PT.PAID_SUBSCRIPTION, platform: plat });
    if (bId) regs.push({ id: bId, type: PT.CONSUMABLE, platform: plat });
    if (!regs.length) return;
    st.register(regs);

    // 現在有効な購読をアプリへ反映（買った/復元した/期限切れ/起動時、いずれも）
    function syncSub() {
      var active = false;
      try { active = sId ? st.owned(sId) : false; } catch (e) {}
      try { handlers.sub(!!active); } catch (e) {}
    }

    st.when()
      .approved(function (tx) { try { tx.verify(); } catch (e) {} })
      .verified(function (receipt) { try { receipt.finish(); } catch (e) {} })
      // finished＝取引が完了した唯一の配信ポイント。消耗型ブーストはここで1個付与（取引ごとに1回）。
      .finished(function (tx) {
        try {
          (tx.products || []).forEach(function (p) {
            if (bId && p && p.id === bId) { try { handlers.boost(); } catch (e) {} }
          });
        } catch (e) {}
        syncSub();
      })
      .receiptUpdated(function () { syncSub(); })
      .productUpdated(function () { syncSub(); });

    Promise.resolve()
      .then(function () { return st.initialize([plat]); })
      .then(function () { syncSub(); })
      .catch(function (e) { try { console.error("IAP init failed", e); } catch (_) {} });
  }

  // 購入。productKey="sub_month"|"boost"。
  //  - 実課金: 注文を出すだけ。加入/付与は上の監視（handlers）から反映される。
  //    onOrdered(注文受理) / onFail(err)。
  //  - デモ: 実決済せず、同じ handlers を直接叩いて成功を模す。
  function buy(productKey, onOrdered, onFail) {
    if (!usable()) {
      // デモ：本番と同じ結果（加入 or ブースト付与）を即時に再現
      try {
        if (productKey === "sub_month" || productKey === "sub_year") handlers.sub(true);
        else if (productKey === "boost") handlers.boost();
      } catch (e) {}
      if (onOrdered) onOrdered({ demo: true });
      return;
    }
    var st = store();
    var id = pid(productKey);
    if (!id) { if (onFail) onFail(new Error("unknown product: " + productKey)); return; }
    var product = st.get(id);
    var offer = product && product.getOffer && product.getOffer();
    if (!offer) { if (onFail) onFail(new Error("offer not loaded: " + id)); return; }
    Promise.resolve()
      .then(function () { return st.order(offer); })
      .then(function (err) {
        if (err) { if (onFail) onFail(err); return; }  // ユーザー中断や決済失敗
        if (onOrdered) onOrdered({});                  // 受理。反映は handlers 経由
      })
      .catch(function (e) { if (onFail) onFail(e); });
  }

  // 購入の復元（ストア審査の必須要件）。復元後は handlers（onSubChange）で反映。
  function restore(onDone) {
    if (!usable()) { if (onDone) onDone([]); return; }
    var st = store();
    Promise.resolve()
      .then(function () { return st.restorePurchases(); })
      .then(function () { if (onDone) onDone([{ restored: true }]); })
      .catch(function () { if (onDone) onDone([]); });
  }

  // サブスクの解約・管理（アプリ内では解約できないのでストアの管理画面へ誘導）
  function manageSubscriptions() {
    if (!usable()) return false;
    var st = store();
    try { st.manageSubscriptions(); return true; } catch (e) { return false; }
  }

  // ストアが返すローカライズ済み価格文字列（読み込めていれば）。無ければ null。
  function priceOf(productKey) {
    if (!usable()) return null;
    try {
      var p = store().get(pid(productKey));
      var offer = p && p.getOffer && p.getOffer();
      var phase = offer && offer.pricingPhases && offer.pricingPhases[0];
      return (phase && phase.price) || null;
    } catch (e) { return null; }
  }

  window.LogSwapPurchases = {
    init: init,
    buy: buy,
    restore: restore,
    manageSubscriptions: manageSubscriptions,
    priceOf: priceOf,
    isNative: function () { return usable(); }
  };
})();
