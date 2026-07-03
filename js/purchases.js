/**
 * LogSwap｜課金レイヤ（IAP）
 *
 * アプリ側は LogSwapPurchases.buy(productKey, onSuccess) と restore(onDone) だけを呼ぶ。
 * ストア/プラグイン依存をここ1か所に閉じ込める。
 *
 * - 既定（CONFIG.IAP_ENABLED=false または プラグイン未導入）＝デモ：
 *   実決済せず即 onSuccess()（＝これまで通り、状態フラグを立てるだけ）。
 * - 本番：Capacitorの課金プラグイン（例: @capacitor-community/in-app-purchase 等）を
 *   導入し config で有効化。productKey→CONFIG.IAP_PRODUCTS の productId で購入し、
 *   **レシートは必ずサーバー（Supabase Edge Function / Worker）で検証**してから反映する。
 *
 * productKey: "sub_month" | "sub_year" | "boost" | "msg_slots" | "swipe"
 */
(function () {
  "use strict";
  var CONFIG = window.LOGSWAP_CONFIG || {};

  function iap() {
    try {
      return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.InAppPurchase;
    } catch (e) { return null; }
  }

  // 購入。成功で onSuccess(result)、失敗/中断で onFail(err)。
  function buy(productKey, onSuccess, onFail) {
    var plugin = iap();
    if (!CONFIG.IAP_ENABLED || !plugin) {
      if (onSuccess) onSuccess({ demo: true });   // デモ：即成功扱い
      return;
    }
    var pid = (CONFIG.IAP_PRODUCTS || {})[productKey];
    if (!pid) { if (onFail) onFail(new Error("unknown product: " + productKey)); return; }
    Promise.resolve()
      .then(function () { return plugin.purchase({ productId: pid }); })
      .then(function (res) {
        // TODO(本番): res.receipt をサーバーへ送り検証→検証OKで課金状態を確定
        if (onSuccess) onSuccess(res);
      })
      .catch(function (err) { if (onFail) onFail(err); });
  }

  // 購入の復元（ストア審査の必須要件）。onDone(restoredList)。
  function restore(onDone) {
    var plugin = iap();
    if (!CONFIG.IAP_ENABLED || !plugin) { if (onDone) onDone([]); return; }
    Promise.resolve()
      .then(function () { return plugin.restorePurchases(); })
      .then(function (r) { if (onDone) onDone(r || []); })
      .catch(function () { if (onDone) onDone([]); });
  }

  window.LogSwapPurchases = { buy: buy, restore: restore };
})();
