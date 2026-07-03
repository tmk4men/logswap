/**
 * LogSwap｜ログ交換デモ
 *
 * ヒーロー内の実機フレームで動く、Tinder風スワイプデモ。
 * 相互に「交換したい」が出たらログ交換が成立する擬似マッチング。
 * バックエンドはなく、すべてブラウザ内で完結します。
 *
 * これは「ログ（日常ログ）を交換するためのツール」であり、
 * 性別・年齢でのフィルタなど、出会いを目的とした要素は持たせていません。
 */
(function () {
  "use strict";

  var SWIPE_THRESHOLD = 96; // px。これを超えてリリースすると確定。
  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var CONFIG = window.LOGSWAP_CONFIG || {};

  // 広告・課金レイヤ（ads.js / purchases.js）。未読込でも動くフォールバック付き。
  var Ads = window.LogSwapAds || { showRewarded: function (cb) { if (cb) cb(); } };
  var Purchases = window.LogSwapPurchases ||
    { buy: function (k, ok) { if (ok) ok(); }, restore: function (d) { if (d) d([]); } };

  // スワイプ内広告：実カード AD_INTERVAL 枚ごとに広告カードを1枚差し込む。
  // 既定は無効（config.js の ADS_ENABLED）。有効時のみ配列に __ad マーカーを挿入。
  // 広告カードは「枠」だけ。実際の広告は AdMob(アプリ)/AdSense(Web) を後から差す。
  function interleaveAds(list) {
    if (!CONFIG.ADS_ENABLED) return list;
    var n = Math.max(2, parseInt(CONFIG.AD_INTERVAL, 10) || 6);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      out.push(list[i]);
      if ((i + 1) % n === 0) out.push({ __ad: true, id: "ad_" + (i + 1) });
    }
    return out;
  }

  var users = [];
  var index = 0;
  var matches = [];
  var coachShown = false;

  var deckEl = document.getElementById("deck");
  var emptyEl = document.getElementById("empty");
  var controlsEl = document.getElementById("controls");
  var coachEl = document.getElementById("coach");

  // 画像URL（picsum を webp で。リポジトリを軽く保つため外部参照）
  function photoUrl(seed, w, h) {
    return "https://picsum.photos/seed/" + encodeURIComponent(seed) + "/" + w + "/" + h + ".webp";
  }

  // ---------- プロフィール（初回入力 → localStorage に保存） ----------
  var PROFILE_KEY = "logswap_profile";
  function getProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
    catch (e) { return null; }
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) {}
  }

  // ---------- 安全機能：ブロック／通報（端末内に保存。実運用ではサーバへ送信） ----------
  var BLOCK_KEY = "logswap_blocked";   // 非表示にする相手のID一覧（ブロック＋通報）
  var REPORT_KEY = "logswap_reports";  // 通報記録（理由つき）
  var viewerUser = null;               // いま詳細を開いている相手

  function getBlocked() {
    try { return JSON.parse(localStorage.getItem(BLOCK_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function isBlocked(id) { return getBlocked().indexOf(id) !== -1; }
  function blockId(id) {
    var a = getBlocked();
    if (a.indexOf(id) === -1) { a.push(id); try { localStorage.setItem(BLOCK_KEY, JSON.stringify(a)); } catch (e) {} }
  }
  function addReport(id, reason) {
    var a;
    try { a = JSON.parse(localStorage.getItem(REPORT_KEY) || "[]"); } catch (e) { a = []; }
    a.push({ id: id, reason: reason });
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(a)); } catch (e) {}
  }
  // 相手を非表示化：ブロック保存＋現在のデッキ／交換相手から除去して再描画
  function hideUser(user) {
    if (!user) return;
    blockId(user.id);
    matches = matches.filter(function (m) { return m.id !== user.id; });
    delete convos[user.id];
    if (users[index] && users[index].id === user.id) index++; // 表示中のカードなら次へ送る
    render();
    renderChat();
    updateTabIndicators();
  }

  // ---------- 禁止ワード（個人情報の誘導・過度に性的な表現）----------
  // 定型文＋スタンプ制なのでメッセージ本文は安全側。名前・ハンドルIDに適用する。
  // 交換用ID（shareId）は「連絡先を渡すための欄」なので、ここでは検査しない。
  var BANNED_WORDS = [
    "line", "ライン", "らいん", "カカオ", "kakao", "telegram", "テレグラム", "discord", "ディスコ",
    "インスタ", "instagram", "twitter", "tiktok", "電話番号", "090", "080", "070", "@gmail", "@yahoo",
    "セックス", "sex", "エッチ", "ワンナイト", "パパ活", "ママ活", "援交", "裏垢", "avトーク", "セフレ"
  ];
  function findBanned(text) {
    if (!text) return "";
    var t = String(text).toLowerCase().replace(/\s/g, "");
    for (var i = 0; i < BANNED_WORDS.length; i++) {
      if (t.indexOf(BANNED_WORDS[i].toLowerCase()) !== -1) return BANNED_WORDS[i];
    }
    return "";
  }

  // ---------- 利用状態（トーク枠・スワイプ枠・課金・ブースト）localStorage ----------
  var STATE_KEY = "logswap_state";
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function getState() {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || "{}") || {}; }
    catch (e) { return {}; }
  }
  function saveState(s) { try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (e) {} }
  function isSub() { return !!getState().sub; }

  // 日付が変わっていたらスワイプ関連カウンタをリセット
  function rollSwipeDay(s) {
    if (s.swipeDate !== today()) {
      s.swipeDate = today(); s.swipeUsed = 0; s.swipeAdCount = 0; s.swipeAdBonus = 0;
      return true;
    }
    return false;
  }
  function swipesLeft() {
    if (isSub()) return Infinity;
    var s = getState();
    if (rollSwipeDay(s)) saveState(s);
    var cap = (CONFIG.SWIPE_LIMIT || 25) + (s.swipeAdBonus || 0);
    return Math.max(0, cap - (s.swipeUsed || 0));
  }
  function useSwipe() {
    if (isSub()) return;
    var s = getState();
    rollSwipeDay(s);
    s.swipeUsed = (s.swipeUsed || 0) + 1;
    saveState(s);
  }
  function swipeAdLeft() {
    var s = getState();
    if (rollSwipeDay(s)) saveState(s);
    return Math.max(0, (CONFIG.SWIPE_AD_MAX || 3) - (s.swipeAdCount || 0));
  }
  function addSwipeAd() {
    var s = getState();
    rollSwipeDay(s);
    if ((s.swipeAdCount || 0) >= (CONFIG.SWIPE_AD_MAX || 3)) return false;
    s.swipeAdCount = (s.swipeAdCount || 0) + 1;
    s.swipeAdBonus = (s.swipeAdBonus || 0) + (CONFIG.SWIPE_AD_ADD || 5);
    saveState(s);
    return true;
  }
  // 課金でスワイプ枠を追加（広告の1日上限に縛られない）
  function addSwipePaid() {
    var s = getState();
    rollSwipeDay(s);
    s.swipeAdBonus = (s.swipeAdBonus || 0) + (CONFIG.SWIPE_AD_ADD || 5);
    saveState(s);
  }

  // トーク枠：無料はMSG_SLOTS_FREE、広告で一定時間だけ増える、サブスクで無制限
  function msgSlotCap() {
    if (isSub()) return Infinity;
    var s = getState();
    var cap = CONFIG.MSG_SLOTS_FREE || 3;
    if (s.msgAdUntil && Date.now() < s.msgAdUntil) cap += (s.msgAdSlots || 0);
    return cap;
  }
  function addMsgAd() {
    var s = getState();
    s.msgAdSlots = CONFIG.MSG_AD_SLOTS || 3;
    s.msgAdUntil = Date.now() + (CONFIG.MSG_AD_HOURS || 24) * 3600 * 1000;
    saveState(s);
  }

  // マッチ率アップ（課金アイテムのデモ）
  function boostActive() { var s = getState(); return !!(s.boostUntil && Date.now() < s.boostUntil); }
  function startBoost() {
    var s = getState();
    s.boostUntil = Date.now() + (CONFIG.BOOST_MINUTES || 30) * 60000;
    saveState(s);
  }

  // Setlog招待IDのプール。1グループにつき1つ。交換で1つ消費し、使い切り（再送しない）。
  // 形式: [{ code:"...", usedWith: 相手id|null }]。旧フィールド shareId は1件として移行。
  function getInviteIds(p) {
    p = p || getProfile() || {};
    if (Array.isArray(p.inviteIds)) return p.inviteIds;
    if (p.shareId) return [{ code: p.shareId, usedWith: p.shareIdUsedWith || null }];
    return [];
  }
  function availableInviteCount() {
    return getInviteIds().filter(function (x) { return !x.usedWith; }).length;
  }

  // 交換用IDのチップ入力（Enter/改行で確定、✕で1つずつ削除）。編集中の未使用コード。
  var pendingInvites = [];
  function renderInviteChips() {
    var box = document.getElementById("inviteChips");
    if (!box) return;
    box.innerHTML = pendingInvites.map(function (code, i) {
      return '<span class="invite-chip"><span class="invite-code">' + esc(code) + "</span>" +
        '<button type="button" class="invite-x" data-i="' + i + '" aria-label="削除">' +
        '<svg viewBox="0 0 24 24" width="12" height="12" class="ico-line"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
        "</button></span>";
    }).join("");
  }
  function addInvite(raw) {
    var used = getInviteIds().filter(function (x) { return x.usedWith; }).map(function (x) { return x.code; });
    String(raw).split(/[\n,]/).forEach(function (s) {
      var code = s.trim();
      if (!code) return;
      if (pendingInvites.indexOf(code) !== -1) return; // 重複
      if (used.indexOf(code) !== -1) return;           // 使用済みは復活させない
      pendingInvites.push(code);
    });
    renderInviteChips();
  }

  // ---------- 会話（成立相手ごと。定型文＋スタンプのみ・セッション内保持）----------
  var convos = {}; // id -> { open, msgs:[{from,kind,body}], meAgreed, themAgreed, revealed, theirId }
  function convo(id) {
    if (!convos[id]) {
      convos[id] = { open: false, msgs: [], meAgreed: false, themAgreed: false, revealed: false, theirId: "" };
    }
    return convos[id];
  }
  // いま何人とトークを開いているか（＝使っている枠数）
  function openThreadCount() {
    return matches.filter(function (m) { return convos[m.id] && convos[m.id].open; }).length;
  }
  // 空き枠があれば、待機中（モザイク）の相手を期限が近い順にトーク一覧へ繰り上げる。
  // サブスク（無制限）なら全員をトーク一覧へ。
  function fillSlots() {
    var cap = msgSlotCap();
    if (cap === Infinity) {
      matches.forEach(function (m) { convo(m.id).open = true; });
      return;
    }
    var waiting = matches.filter(function (m) { return !convo(m.id).open; })
      .sort(function (a, b) { return (convo(a.id).matchedAt || 0) - (convo(b.id).matchedAt || 0); });
    for (var i = 0; i < waiting.length && openThreadCount() < cap; i++) {
      convo(waiting[i].id).open = true;
    }
  }
  // 成立・未トーク（モザイク待機）のまま期限が過ぎた相手を消す。消えたら true。
  function pruneExpiredPending() {
    var ms = (CONFIG.PENDING_EXPIRE_HOURS || 48) * 3600 * 1000;
    var now = Date.now();
    var changed = false;
    matches = matches.filter(function (m) {
      var c = convos[m.id];
      if (c && !c.open && c.matchedAt && (now - c.matchedAt) > ms) {
        delete convos[m.id];
        changed = true;
        return false;
      }
      return true;
    });
    return changed;
  }

  var pendingImage = null;     // ダウンスケール済み画像 dataURL
  var pendingImage2 = null;    // サブ画像（任意）dataURL
  var pendingVideoName = "";   // 動画ファイル名（実体の保存はバックエンド前提）
  var pendingVideoUrl = null;  // セッション内プレビュー用 objectURL
  var pendingVideoBlob = null; // 圧縮後の動画データ（バックエンド接続時にアップロードする本体）

  // 動画をアップロード前に端末内で低画質・低ビットレートへ再エンコードする。
  // 保存料も配信の転送量も両方減らせる（＝サーバー運用費を安くする一番効く手）。
  // MediaRecorder 非対応環境では null を返し、呼び出し側が原本にフォールバックする。
  function compressVideo(file, opts, cb) {
    opts = opts || {};
    var maxDim = opts.maxDim || 640;       // 長辺の上限（px）。少しだけ低画質にする。
    var bitrate = opts.bitrate || 900000;  // 目標ビットレート（bps）
    var fps = opts.fps || 24;

    var canRecord = typeof MediaRecorder !== "undefined" &&
      HTMLCanvasElement.prototype.captureStream;
    if (!canRecord) { cb(null); return; }

    var mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]
      .filter(function (m) { try { return MediaRecorder.isTypeSupported(m); } catch (e) { return false; } })[0];
    if (!mime) { cb(null); return; }

    var url = URL.createObjectURL(file);
    var v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;

    var done = false;
    function finish(blob) { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch (e) {} cb(blob); }
    // 保険：処理が固まっても放置しない（3秒動画なので余裕をみて8秒）
    var guard = setTimeout(function () { finish(null); }, 8000);

    v.onloadedmetadata = function () {
      var scale = Math.min(1, maxDim / Math.max(v.videoWidth || 1, v.videoHeight || 1));
      var w = Math.max(2, Math.round((v.videoWidth || maxDim) * scale / 2) * 2);
      var h = Math.max(2, Math.round((v.videoHeight || maxDim) * scale / 2) * 2);
      var canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext("2d");

      var stream = canvas.captureStream(fps);
      var rec;
      try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate }); }
      catch (e) { clearTimeout(guard); finish(null); return; }

      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = function () { clearTimeout(guard); finish(new Blob(chunks, { type: mime })); };

      var drawing = true;
      function draw() {
        if (!drawing) return;
        try { ctx.drawImage(v, 0, 0, w, h); } catch (e) {}
        if (!v.ended) requestAnimationFrame(draw);
      }
      v.onended = function () { drawing = false; try { rec.stop(); } catch (e) {} };
      try { rec.start(); } catch (e) { clearTimeout(guard); finish(null); return; }
      var p = v.play();
      draw();
      if (p && p.catch) p.catch(function () { drawing = false; try { rec.stop(); } catch (e) {} clearTimeout(guard); finish(null); });
    };
    v.onerror = function () { clearTimeout(guard); finish(null); };
  }

  // 動画サイズの表示（圧縮の効きを見せる。安く運用できる手応え）
  function showVideoSize(bytes, compressed) {
    var el = document.getElementById("pf-video-size");
    if (!el) return;
    if (!bytes) { el.hidden = true; return; }
    var kb = bytes / 1024;
    var size = kb >= 1024 ? (kb / 1024).toFixed(1) + "MB" : Math.round(kb) + "KB";
    el.textContent = compressed ? "圧縮後の動画サイズ：約" + size : "動画サイズ：約" + size;
    el.hidden = false;
  }

  // 画像を端末内で縮小して dataURL 化（localStorage に収めるため）
  function downscaleImage(file, maxSize, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        try { cb(canvas.toDataURL("image/jpeg", 0.82)); } catch (e) { cb(""); }
      };
      img.onerror = function () { cb(""); };
      img.src = reader.result;
    };
    reader.onerror = function () { cb(""); };
    reader.readAsDataURL(file);
  }

  // アップロードボタンの見た目（文言と選択済みスタイル）を更新
  function setUploadState(forId, text, isSet) {
    var btn = document.querySelector('label[for="' + forId + '"]');
    if (btn) btn.classList.toggle("is-set", !!isSet);
    var lbl = document.getElementById(forId + "-label");
    if (lbl) lbl.textContent = text;
  }

  // 「相手に表示されるプロフィール」プレビュー（動画を大きく＋左下に画像アイコン）
  function updatePreview() {
    var box = document.getElementById("pfPreview");
    if (!box) return;
    var media = document.getElementById("pfPvMedia");
    var icon = document.getElementById("pfPvIcon");
    if (pendingVideoUrl) {
      media.innerHTML = '<video src="' + pendingVideoUrl + '" muted loop autoplay playsinline preload="metadata"></video>';
    } else {
      media.innerHTML = '<div class="pf-pv-empty">動画を選ぶと<br>ここに大きく表示されます</div>';
    }
    if (pendingImage) { icon.src = pendingImage; icon.hidden = false; }
    else { icon.removeAttribute("src"); icon.hidden = true; }
  }

  // 相手条件でしぼり込み（プレミアム時のみ有効）。state.fltGender / fltPref を使う。
  function applyFilter(list) {
    if (!isSub()) return list;
    var s = getState();
    return list.filter(function (u) {
      if (u.__ad) return true;
      if (s.fltGender && u.gender !== s.fltGender) return false;
      if (s.fltPref && u.pref !== s.fltPref) return false;
      return true;
    });
  }
  // 性別の重み付け並べ替え：男性→65%で男、女性→55%で女が上に来やすくする。
  function orderByGender(list, myGender) {
    var pSame = myGender === "male" ? (CONFIG.SAME_GENDER_MALE || 0.65)
      : myGender === "female" ? (CONFIG.SAME_GENDER_FEMALE || 0.55) : 0;
    if (!pSame) return list;
    return list.slice().map(function (u) {
      var same = u.gender === myGender;
      var w = same ? pSame : (1 - pSame);
      return { u: u, k: Math.random() * (w + 0.0001) };
    }).sort(function (a, b) { return b.k - a.k; }).map(function (x) { return x.u; });
  }
  // ブースト中は「交換が成立しやすい相手（likesBack）」を前に寄せる。
  function orderByBoost(list) {
    if (!boostActive()) return list;
    return list.slice().sort(function (a, b) {
      return (b.likesBack ? 1 : 0) - (a.likesBack ? 1 : 0);
    });
  }

  // デッキ（スワイプ候補）を条件で組み直す。matches / convos は保持する。
  function buildDeck() {
    var prof = getProfile() || {};
    users = (window.MOCK_USERS || []).filter(function (u) { return !isBlocked(u.id); });
    users = applyFilter(users);
    users = orderByGender(users, prof.gender);
    users = orderByBoost(users);
    users = interleaveAds(users);
    index = 0;
  }
  // フィルタ/ブースト/課金の変更時：デッキだけ組み直す（成立相手は消さない）
  function rebuildDeck() { buildDeck(); render(); renderChat(); }

  // ---------- 初期化 ----------
  function init() {
    buildDeck();
    matches = [];
    convos = {};
    threadUser = null;
    coachShown = false;
    // app.html では初回（プロフィール未登録）はプロフ入力から入る
    var gate = document.getElementById("profileSetup");
    if (gate && !getProfile()) { // 新規：ハンドルID設定可・招待チップ空・同意欄あり
      setHandleLocked(false);
      setProfileFormMode(false);
      pendingInvites = []; renderInviteChips();
      var iin = document.getElementById("pf-invite-input"); if (iin) iin.value = "";
      setAppGated(true); return;
    }
    setAppGated(false);
    render();
    showView("swipe");
    renderChat();
    updateTabIndicators();
  }

  // プロフ入力ゲートの表示切替（app.html のみ。要素が無ければ何もしない）
  function setAppGated(gated) {
    var gate = document.getElementById("profileSetup");
    var stage = document.querySelector(".app-stage .stage");
    var tabbar = document.getElementById("tabbar");
    if (gate) gate.hidden = !gated;
    if (stage) stage.hidden = gated;
    if (gated) {
      var sw = document.getElementById("view-swipe"); if (sw) sw.hidden = false; // 入力フォームはここに入っている
      var ch = document.getElementById("view-chat"); if (ch) ch.hidden = true;
      var pr = document.getElementById("view-profile"); if (pr) pr.hidden = true;
      if (tabbar) tabbar.hidden = true;
      controlsEl.hidden = true;
      controlsEl.setAttribute("aria-hidden", "true");
      controlsEl.style.visibility = "hidden";
      setFocus(document.getElementById("pf-name"));
    } else {
      if (tabbar) tabbar.hidden = false;
      controlsEl.hidden = false;
      controlsEl.removeAttribute("aria-hidden");
      controlsEl.style.visibility = "visible";
    }
  }

  // ---------- タブ切替（スワイプ / ログ・チャット / プロフィール）----------
  function showView(name) {
    var map = { swipe: "view-swipe", chat: "view-chat", profile: "view-profile" };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.hidden = (k !== name);
    });
    if (controlsEl) controlsEl.hidden = (name !== "swipe");
    Array.prototype.forEach.call(document.querySelectorAll("#tabbar .tab"), function (t) {
      var on = t.dataset.view === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (name === "chat") renderChat();
    if (name === "profile") renderProfile();
  }

  // ---------- チャット（枠バー＋未トーク（モザイク）＋トーク中）----------
  function renderChat() {
    var list = document.getElementById("chatList");
    if (!list) return;

    pruneExpiredPending();           // 期限切れの待機相手を掃除
    fillSlots();                     // 空き枠があれば繰り上げ

    var pending = matches.filter(function (m) { return !(convos[m.id] && convos[m.id].open); });
    var active = matches.filter(function (m) { return convos[m.id] && convos[m.id].open; });

    // 枠バー
    var cap = msgSlotCap();
    var slotText = document.getElementById("slotText");
    var slotAdd = document.getElementById("slotAddBtn");
    if (slotText) {
      slotText.textContent = "（" + openThreadCount() + "/" + (cap === Infinity ? "∞" : cap) + "）";
    }
    if (slotAdd) slotAdd.hidden = (cap === Infinity);

    // 未トーク（モザイクで上部に）
    var pwrap = document.getElementById("pendingWrap");
    var pstrip = document.getElementById("pendingStrip");
    var pcount = document.getElementById("pendingCount");
    if (pwrap && pstrip) {
      if (!pending.length) { pwrap.hidden = true; pstrip.innerHTML = ""; }
      else {
        pwrap.hidden = false;
        if (pcount) pcount.textContent = pending.length + "人";
        var total = (CONFIG.PENDING_EXPIRE_HOURS || 48) * 3600 * 1000;
        var now = Date.now();
        // 期限が近い順（matchedAtが古い順）に並べる
        var sorted = pending.slice().sort(function (a, b) {
          return (convo(a.id).matchedAt || 0) - (convo(b.id).matchedAt || 0);
        });
        pstrip.innerHTML = sorted.map(function (u) {
          var remain = total - (now - (convo(u.id).matchedAt || now));
          var ratio = Math.max(0, Math.min(1, remain / total));
          var color = ratio > 0.66 ? "green" : ratio > 0.33 ? "yellow" : "red";
          var hrs = Math.max(0, Math.ceil(remain / 3600000));
          return '<button class="pending-item" type="button" data-id="' + u.id + '" title="あと約' + hrs + '時間">' +
            '<span class="pending-clock ' + color + '" aria-hidden="true">' +
              '<svg viewBox="0 0 24 24" width="13" height="13" class="ico-line"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v4.7l3 1.8"/></svg>' +
            "</span>" +
            '<img class="pending-av" src="' + photoUrl(u.photo, 120, 120) + '" alt="" />' +
            '<span class="pending-name">' + esc(u.name) + "</span></button>";
        }).join("");
        Array.prototype.forEach.call(pstrip.querySelectorAll(".pending-item"), function (b) {
          b.onclick = function () {
            var u = matches.filter(function (m) { return m.id === b.dataset.id; })[0];
            if (u) openThread(u);
          };
        });
      }
    }

    // トーク中
    if (!active.length) {
      list.innerHTML = pending.length
        ? '<p class="chat-empty">上の相手をタップするとトークを始められます。</p>'
        : '<p class="chat-empty">ログを交換すると、ここに相手が表示されます。</p>';
      return;
    }
    list.innerHTML = active.slice().reverse().map(function (u) {
      var c = convo(u.id);
      var last = c.msgs.length ? c.msgs[c.msgs.length - 1] : null;
      var lastText = last ? (last.kind === "stamp" ? last.body : esc(last.body)) : "トーク中";
      return '<button class="chat-row" type="button" data-id="' + u.id + '">' +
        '<img class="chat-av" src="' + photoUrl(u.photo, 96, 96) + '" alt="" />' +
        '<span class="chat-meta"><span class="chat-name">' + esc(u.name) +
        (c.revealed ? ' <span class="chat-idok">ID交換済</span>' : "") + "</span>" +
        '<span class="chat-last">' + lastText + "</span></span>" +
        '<span class="chat-go" aria-hidden="true">›</span></button>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".chat-row"), function (row) {
      row.onclick = function () {
        var u = matches.filter(function (m) { return m.id === row.dataset.id; })[0];
        if (u) openThread(u);
      };
    });
  }

  // トークのスタンプは絵文字（3種）。body に絵文字そのものを保持する。
  // ※UIのアイコン（鍵・稲妻など）は絵文字を使わずSVGで統一。
  // 小さな装飾SVG（鍵・稲妻）。
  var KEY_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" class="ico-line" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M17 4l2 2M15 6l1.5 1.5"/></svg>';
  var BOLT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" class="ico-line" aria-hidden="true"><path d="M13 3L5 13h5l-1 8 8-11h-5z"/></svg>';

  // ---------- トーク画面（定型文＋スタンプのみ）----------
  var threadUser = null;
  function openThread(user) {
    var c = convo(user.id);
    // まだ枠を使っていない相手なら、枠が空いているか確認してから開く
    if (!c.open) {
      if (openThreadCount() >= msgSlotCap()) { showSlotLimit(); return; }
      c.open = true;
    }
    threadUser = user;
    var av = document.getElementById("threadAv");
    // メインアイコンは動画ではなくプロフィール画像（静止画）
    if (av) av.src = photoUrl(user.photo, 160, 160);
    var nm = document.getElementById("threadName");
    if (nm) nm.textContent = user.name;
    var hd = document.getElementById("threadHandle");
    if (hd) hd.textContent = user.handle || "";
    renderThread(user);
    updateTabIndicators();
    renderChat();
    openOverlay(document.getElementById("threadOverlay"));
  }

  function renderThread(user) {
    var c = convo(user.id);
    var log = document.getElementById("threadLog");
    if (log) {
      if (!c.msgs.length) {
        log.innerHTML = '<p class="thread-hint">定型文やスタンプであいさつしてみましょう。</p>';
      } else {
        log.innerHTML = c.msgs.map(function (m) {
          var cls = "bubble " + (m.from === "me" ? "me" : "them") + (m.kind === "stamp" ? " is-stamp" : "");
          return '<div class="' + cls + '">' + (m.kind === "stamp" ? m.body : esc(m.body)) + "</div>";
        }).join("");
      }
      log.scrollTop = log.scrollHeight;
    }
    renderIdExchange(user);
    // ID交換前に往復上限へ達したら、入力（定型文・スタンプ）を止める
    var c2 = convo(user.id);
    var myTurns = c2.msgs.filter(function (m) { return m.from === "me"; }).length;
    setThreadInputCapped(!c2.revealed && myTurns >= (CONFIG.MSG_MAX_TURNS || 10));
  }

  // 往復上限に達したら入力欄を無効化（見た目も薄く）
  function setThreadInputCapped(capped) {
    var wrap = document.querySelector("#threadOverlay .thread-input");
    if (!wrap) return;
    wrap.classList.toggle("is-disabled", !!capped);
    Array.prototype.forEach.call(wrap.querySelectorAll("button"), function (b) { b.disabled = !!capped; });
  }

  // ID交換の合意バー：一定の往復後に「交換する」ボタン→両者合意で使い切りID公開
  function renderIdExchange(user) {
    var bar = document.getElementById("idxBar");
    if (!bar) return;
    var c = convo(user.id);
    var myTurns = c.msgs.filter(function (m) { return m.from === "me"; }).length;
    var need = (typeof CONFIG.ID_EXCHANGE_MIN_TURNS === "number") ? CONFIG.ID_EXCHANGE_MIN_TURNS : 3;

    if (c.revealed) {
      // 公開したIDは1つだけ（あなたの招待ID）。2人とものID公開は不要。
      bar.hidden = false;
      bar.className = "idx-bar revealed";
      bar.innerHTML =
        '<div class="idx-done">' + KEY_SVG + ' IDを公開しました</div>' +
        '<div class="idx-pair"><span class="idx-label">あなたの招待ID</span><span class="idx-val">' + esc(c.myGivenId || "") + "</span></div>";
      return;
    }
    // 公開できる招待IDが尽きていたら交換不可（使い回し防止）
    if (availableInviteCount() === 0) {
      bar.hidden = false;
      bar.className = "idx-bar wait";
      bar.innerHTML = '<span class="idx-wait">公開できるSetlog招待IDがありません。プロフィールで追加してください。</span>';
      return;
    }
    if (c.requested) {
      // あなたが交換を求めた → 相手も乗り気の表示 → OKで自分のIDを公開
      bar.hidden = false;
      bar.className = "idx-bar ready";
      bar.innerHTML =
        '<span class="idx-cap idx-cap-strong">' + esc(user.name) + ' さんも交換したがっています！</span>' +
        '<div class="idx-btns"><button class="idx-btn" id="idxOkBtn" type="button">' + KEY_SVG + ' OK（IDを公開）</button></div>' +
        '<span class="idx-cap">OKすると、あなたの招待IDが1つ相手へ渡されます</span>';
      var ok = document.getElementById("idxOkBtn");
      if (ok) ok.onclick = function () { confirmIdExchange(user); };
      return;
    }
    if (myTurns < need) {
      bar.hidden = false;
      bar.className = "idx-bar wait";
      bar.innerHTML = '<span class="idx-wait">あと' + (need - myTurns) + '回やりとりすると、ID交換できます</span>';
      return;
    }
    // 「IDを交換しますか？」ボタン。上限(MAX)に達したら解除も出す。
    var max = CONFIG.MSG_MAX_TURNS || 10;
    var capped = myTurns >= max;
    bar.hidden = false;
    bar.className = "idx-bar ready" + (capped ? " capped" : "");
    bar.innerHTML =
      (capped ? '<span class="idx-cap idx-cap-strong">往復の上限です。交換するか、解除してください。</span>' : "") +
      '<div class="idx-btns">' +
        '<button class="idx-btn" id="idxBtn" type="button">' + KEY_SVG + ' IDを交換しますか？</button>' +
        (capped ? '<button class="idx-unmatch" id="idxUnmatch" type="button">解除する</button>' : "") +
      "</div>";
    var btn = document.getElementById("idxBtn");
    if (btn) btn.onclick = function () { requestIdExchange(user); };
    var un = document.getElementById("idxUnmatch");
    if (un) un.onclick = function () { unmatchThread(user); };
  }

  // 交換を求める：相手に「交換したがってる」と伝わる（デモは相手も乗り気）
  function requestIdExchange(user) {
    var c = convo(user.id);
    c.requested = true;
    c.msgs.push({ from: "them", kind: "text", body: "交換したい！" });
    renderThread(user);
    renderChat();
  }

  // OK：あなたの招待IDを1つ消費して公開（使い切り）。相手のIDは公開不要。
  function confirmIdExchange(user) {
    var c = convo(user.id);
    var prof = getProfile() || {};
    var invites = getInviteIds(prof);
    var slot = null;
    for (var i = 0; i < invites.length; i++) { if (!invites[i].usedWith) { slot = invites[i]; break; } }
    if (!slot) { renderThread(user); return; } // 公開できるIDが無い
    slot.usedWith = user.id;                    // 使い切り：二度と送信されない
    prof.inviteIds = invites;
    saveProfile(prof);
    c.revealed = true;
    c.myGivenId = slot.code;
    c.msgs.push({ from: "them", kind: "text", body: "ありがとう！受け取りました！" });
    renderThread(user);
    renderChat();
  }

  function sendToThread(user, kind, body) {
    var c = convo(user.id);
    // ID交換前の往復上限に達していたら送らない（入力は無効化済みだが二重の保険）
    var myTurns = c.msgs.filter(function (m) { return m.from === "me"; }).length;
    if (!c.revealed && myTurns >= (CONFIG.MSG_MAX_TURNS || 10)) return;
    c.msgs.push({ from: "me", kind: kind, body: body });
    renderThread(user);
    // 擬似返信（デモ。実運用では相手の実メッセージに置き換え）
    setTimeout(function () {
      if (threadUser !== user) return;
      var stamps = ["😊", "⭕"];
      var phrases = ["いいですね！", "こちらこそ！", "ありがとうございます！", "楽しみです"];
      var useStamp = Math.random() < 0.5;
      c.msgs.push(useStamp
        ? { from: "them", kind: "stamp", body: stamps[Math.floor(Math.random() * stamps.length)] }
        : { from: "them", kind: "text", body: phrases[Math.floor(Math.random() * phrases.length)] });
      renderThread(user);
      renderChat();
    }, 650);
  }

  // 交換を解除（＝トーク枠が1つ空く）
  function unmatchThread(user) {
    matches = matches.filter(function (m) { return m.id !== user.id; });
    delete convos[user.id];
    threadUser = null;
    closeOverlay(document.getElementById("threadOverlay"));
    renderChat();
    updateTabIndicators();
  }

  // ---------- 上限の案内（トーク枠／スワイプ枠）----------
  function showLimit(opts) {
    var ov = document.getElementById("limitOverlay");
    if (!ov) return;
    document.getElementById("limitTitle").textContent = opts.title;
    document.getElementById("limitSub").textContent = opts.sub;
    var box = document.getElementById("limitActions");
    box.innerHTML = "";
    opts.actions.forEach(function (a) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = a.primary ? "btn-primary" : "btn-ghost";
      b.textContent = a.label;
      if (a.disabled) { b.disabled = true; b.className = "btn-ghost"; }
      else b.onclick = function () { closeOverlay(ov); a.onClick(); };
      box.appendChild(b);
    });
    openOverlay(ov);
  }
  function showSwipeLimit() {
    var canAd = swipeAdLeft() > 0;
    showLimit({
      title: "今日のスワイプは終わりです",
      sub: canAd
        ? "動画広告を見ると" + (CONFIG.SWIPE_AD_ADD || 5) + "回ぶん増やせます（今日あと" + swipeAdLeft() + "回）。プレミアムなら無制限です。"
        : "今日はこれ以上増やせません。プレミアムなら無制限になります。",
      actions: [
        { label: "動画広告を見る（＋" + (CONFIG.SWIPE_AD_ADD || 5) + "・無料）", primary: true, disabled: !canAd,
          onClick: function () { Ads.showRewarded(function () { if (addSwipeAd()) render(); }); } },
        { label: "スワイプ＋" + (CONFIG.SWIPE_AD_ADD || 5) + "を" + (CONFIG.PRICE_SWIPE || "") + "で",
          onClick: function () { Purchases.buy("swipe", function () { addSwipePaid(); render(); }); } },
        { label: "プレミアムに加入（" + (CONFIG.PRICE_SUB_MONTH || "") + "／月）", onClick: function () { subscribe(); } }
      ]
    });
  }
  function showSlotLimit() {
    showLimit({
      title: "トークできる人数の上限です",
      sub: "動画広告で" + (CONFIG.MSG_AD_SLOTS || 3) + "枠を" + (CONFIG.MSG_AD_HOURS || 24) +
        "時間ふやすか、誰かとの交換を解除すると空きます。プレミアムなら無制限です。",
      actions: [
        { label: "動画広告で" + (CONFIG.MSG_AD_SLOTS || 3) + "枠ふやす（無料）", primary: true,
          onClick: function () { Ads.showRewarded(function () { addMsgAd(); renderChat(); }); } },
        { label: (CONFIG.MSG_AD_SLOTS || 3) + "枠を" + (CONFIG.PRICE_MSG_SLOTS || "") + "で",
          onClick: function () { Purchases.buy("msg_slots", function () { addMsgAd(); renderChat(); }); } },
        { label: "プレミアムに加入（" + (CONFIG.PRICE_SUB_MONTH || "") + "／月）", onClick: function () { subscribe(); } }
      ]
    });
  }

  // 課金：加入（上限案内から。既定は月額プラン扱い）。購入はIAPレイヤ経由。
  function subscribe() {
    Purchases.buy("sub_month", function () {
      var s = getState(); s.sub = true; if (!s.subPlan) s.subPlan = "month"; saveState(s);
      rebuildDeck(); renderProfile();
    });
  }
  // タブのインジケータ：チャットの赤い点＋「いいねされた人数」の赤い数字
  function updateTabIndicators() {
    var dot = document.getElementById("chatDot");
    // 成立したのにまだトークしていない相手がいる印
    var pending = matches.filter(function (m) { return !(convos[m.id] && convos[m.id].open); }).length;
    if (dot) dot.hidden = pending === 0;
    var lb = document.getElementById("likesBadge");
    if (lb) {
      var liked = users.filter(function (u) { return u.likesBack; }).length - matches.length;
      if (liked > 0) { lb.hidden = false; lb.textContent = liked; } // 人数のみ。相手情報は出さない
      else lb.hidden = true;
    }
  }

  // ---------- プロフィールタブ（保存済みの表示＋編集）----------
  function renderProfile() {
    var box = document.getElementById("profileSummary");
    if (!box) return;
    var p = getProfile() || {};
    var av = p.image
      ? '<img class="ps-av" src="' + p.image + '" alt="" />'
      : '<div class="ps-av ps-av-empty"><svg viewBox="0 0 24 24" width="40" height="40" class="ico-line"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg></div>';
    var tags = (p.tags || []).map(function (t) {
      return '<span class="tag">#' + esc(t) + "</span>";
    }).join("");
    box.innerHTML =
      '<div class="ps-card">' +
        av +
        '<div class="ps-name">' + esc(p.name || "未設定") + "</div>" +
        (p.handle ? '<div class="ps-handle">' + esc(p.handle) + "</div>" : "") +
        '<div class="ps-meta">' + (p.pref ? esc(p.pref) : "地域未設定") + "</div>" +
        (tags ? '<div class="ps-tags">' + tags + "</div>" : "") +
        (p.image2 ? '<img class="ps-sub" src="' + p.image2 + '" alt="サブ画像" />' : "") +
        '<div class="ps-note">ログの動画：' + (p.videoName ? "設定済み" : "未設定") + "</div>" +
      "</div>";
    renderPremium();
  }

  // プレミアム欄（加入状態・しぼり込み・ブースト）を描画
  function renderPremium() {
    var state = document.getElementById("premiumState");
    var plans = document.getElementById("premiumPlans");
    var cancel = document.getElementById("subCancelBtn");
    var filter = document.getElementById("premiumFilter");
    var s = getState();
    var sub = isSub();
    // 価格をconfigからボタンへ流し込む（月額のみ）
    var mBtn = document.getElementById("subMonthBtn");
    if (mBtn) mBtn.textContent = "プレミアムに加入（" + (CONFIG.PRICE_SUB_MONTH || "") + "／月）";
    var boostLabel = document.getElementById("boostLabel");
    if (boostLabel) boostLabel.textContent = "ブースト（30分・" + (CONFIG.PRICE_BOOST || "") + "）";

    if (state) {
      state.textContent = sub ? "加入中（月額）" : "未加入";
      state.classList.toggle("on", sub);
    }
    if (plans) plans.hidden = sub;   // 加入中はプラン選択を隠し、解約ボタンを出す
    if (cancel) cancel.hidden = !sub;
    if (filter) filter.hidden = !sub;
    var fg = document.getElementById("flt-gender"); if (fg) fg.value = s.fltGender || "";
    var fp = document.getElementById("flt-pref"); if (fp) fp.value = s.fltPref || "";
    var note = document.getElementById("boostNote");
    if (note) {
      if (boostActive()) {
        var mins = Math.max(1, Math.round((getState().boostUntil - Date.now()) / 60000));
        note.hidden = false; note.innerHTML = BOLT_SVG + " ブースト中（あと約" + mins + "分）";
      } else note.hidden = true;
    }
  }
  // プロフィール入力フォームのモード：初回登録 or 2回目以降の編集
  // 編集時は「利用規約・年齢の同意」と「はじめる」文言を出さない。
  function setProfileFormMode(isEdit) {
    var consent = document.querySelector("#profileSetup .pf-consent");
    if (consent) consent.hidden = !!isEdit;
    var start = document.getElementById("pfStart");
    if (start) start.textContent = isEdit ? "保存する" : "はじめる";
    var h = document.querySelector("#profileSetup .ps-head h2");
    if (h) h.textContent = isEdit ? "プロフィールを編集" : "プロフィールを作成";
  }

  // ハンドルIDの入力ロック（一度設定したら変更不可）
  function setHandleLocked(locked) {
    var h = document.getElementById("pf-handle");
    if (h) { h.disabled = !!locked; h.classList.toggle("is-locked", !!locked); }
    var wrap = h && h.closest(".pf-handle-wrap");
    if (wrap) wrap.classList.toggle("is-locked", !!locked);
    var note = document.getElementById("pf-handle-locked");
    if (note) note.hidden = !locked;
  }

  function openProfileEdit() {
    var p = getProfile() || {};
    var n = document.getElementById("pf-name"); if (n) n.value = p.name || "";
    var h = document.getElementById("pf-handle"); if (h) h.value = (p.handle || "").replace(/^@/, "");
    setHandleLocked(!!p.handle); // 既存のハンドルIDは変更不可
    pendingInvites = getInviteIds(p).filter(function (x) { return !x.usedWith; })
      .map(function (x) { return x.code; });
    renderInviteChips();
    var invIn = document.getElementById("pf-invite-input"); if (invIn) invIn.value = "";
    var usedNote = document.getElementById("pf-invites-used");
    if (usedNote) {
      var usedN = getInviteIds(p).filter(function (x) { return x.usedWith; }).length;
      if (usedN) { usedNote.hidden = false; usedNote.textContent = "使用済みの招待ID：" + usedN + "件（交換で相手に渡し済み・再送されません）"; }
      else usedNote.hidden = true;
    }
    var pr = document.getElementById("pf-pref"); if (pr) pr.value = p.pref || "";
    var g = document.getElementById("pf-gender"); if (g) g.value = p.gender || "";
    pendingImage = p.image || null;
    var set = {}; (p.tags || []).forEach(function (t) { set[t] = 1; });
    Array.prototype.forEach.call(document.querySelectorAll("#pf-tags .pf-chip"), function (c) {
      var on = !!set[c.dataset.tag];
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    pendingImage2 = p.image2 || null;
    setUploadState("pf-image", p.image ? "画像を変更" : "画像を選ぶ", !!p.image);
    setUploadState("pf-image2", p.image2 ? "画像を変更" : "画像を選ぶ", !!p.image2);
    setUploadState("pf-video", p.videoName ? "動画を変更" : "動画を選ぶ", !!p.videoName);
    // 既存プロフィールの編集時は同意・年齢確認済みとして扱い、同意欄は出さない
    var agree = document.getElementById("pf-agree"); if (agree) agree.checked = true;
    var agreeErr = document.getElementById("pf-agree-err"); if (agreeErr) agreeErr.hidden = true;
    var age = document.getElementById("pf-age"); if (age) age.checked = true;
    var ageErr = document.getElementById("pf-age-err"); if (ageErr) ageErr.hidden = true;
    setProfileFormMode(true);
    setAppGated(true);
  }

  // アカウント削除：端末内のデータを全消去して初回状態へ戻す。
  // （バックエンド接続時は、ここでサーバー側の退会APIも呼ぶ。ストア審査の必須要件）
  function deleteAccount() {
    try {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(BLOCK_KEY);
      localStorage.removeItem(REPORT_KEY);
      localStorage.removeItem(STATE_KEY);
    } catch (e) {}
    convos = {};
    threadUser = null;
    pendingImage = null;
    pendingImage2 = null;
    pendingVideoName = "";
    pendingVideoBlob = null;
    if (pendingVideoUrl) { try { URL.revokeObjectURL(pendingVideoUrl); } catch (e) {} pendingVideoUrl = null; }
    // 入力フォームを白紙化して初回入力ゲートへ
    var f = document.getElementById("profileSetup");
    if (f && f.reset) f.reset();
    Array.prototype.forEach.call(document.querySelectorAll("#pf-tags .pf-chip.is-on"), function (c) {
      c.classList.remove("is-on"); c.setAttribute("aria-pressed", "false");
    });
    pendingInvites = []; renderInviteChips();
    setUploadState("pf-image", "画像を選ぶ", false);
    setUploadState("pf-image2", "画像を選ぶ", false);
    setUploadState("pf-video", "動画を選ぶ", false);
    showVideoSize(0);
    init();
  }

  // 先頭2枚だけ描画して、スタック感を出す。
  function render() {
    deckEl.innerHTML = "";
    var remaining = users.length - index;
    if (remaining <= 0) {
      emptyEl.hidden = false;
      controlsEl.setAttribute("aria-hidden", "true");
      controlsEl.style.visibility = "hidden";
      hideCoach();
      return;
    }
    emptyEl.hidden = true;
    controlsEl.removeAttribute("aria-hidden");
    controlsEl.style.visibility = "visible";

    var upper = Math.min(index + 2, users.length);
    for (var i = upper - 1; i >= index; i--) {
      var isTop = i === index;
      var card = buildCard(users[i], isTop);
      if (!isTop) card.classList.add("is-back");
      deckEl.appendChild(card);
      if (isTop) enableDrag(card, users[i]);
    }

    if (!coachShown) showCoach();
  }

  function buildCard(user, isTop) {
    var card = document.createElement("article");
    card.className = "card" + (isTop ? " enter" : "");
    card.dataset.id = user.id;

    // 広告カード（枠のみ。AdMob/AdSense をここに差し込む想定）
    if (user.__ad) {
      card.className += " ad-card";
      card.innerHTML =
        '<div class="card-media ad-media" data-ad-slot="swipe">' +
          '<span class="ad-badge">広告</span>' +
          '<div class="ad-inner">' +
            '<svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" class="ico-line"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/></svg>' +
            '<p class="ad-note">スポンサー</p>' +
          "</div>" +
        "</div>";
      return card;
    }

    // メインは登録した動画（無ければ画像にフォールバック）
    var media = user.video
      ? '<video class="card-video" src="' + esc(user.video) + '" ' +
          'poster="' + photoUrl(user.photo, 700, 1000) + '" muted loop playsinline ' +
          'preload="metadata" ' + (isTop ? "autoplay " : "") + '></video>'
      : '<img class="card-photo" src="' + photoUrl(user.photo, 700, 1000) + '" ' +
          'decoding="async" alt="' + esc(user.name) + ' さんの動画" />';

    card.innerHTML =
      '<div class="card-media">' +
        media +
        '<div class="card-scrim"></div>' +
        '<span class="stamp stamp-yes">交換したい</span>' +
        '<span class="stamp stamp-no">見送り</span>' +
        '<div class="card-id">' +
          '<img class="card-avatar" src="' + photoUrl(user.photo, 120, 120) + '" alt="" />' +
          '<h3 class="card-name">' + esc(user.name) + "</h3>" +
        "</div>" +
      "</div>";

    return card;
  }

  // ---------- ドラッグ（スワイプ）処理 ----------
  function enableDrag(card, user) {
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    var yesStamp = card.querySelector(".stamp-yes");
    var noStamp = card.querySelector(".stamp-no");

    function onDown(e) {
      if (e.target.closest(".thumbs")) return; // サムネのスクロールは妨げない
      dragging = true;
      card.classList.add("dragging");
      hideCoach();
      startX = e.clientX; startY = e.clientY;
      if (e.pointerId != null && card.setPointerCapture) card.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      if (!dragging) return;
      dx = e.clientX - startX; dy = e.clientY - startY;
      var rot = dx / 22;
      card.style.transform = "translate(" + dx + "px," + dy * 0.4 + "px) rotate(" + rot + "deg)";
      var ratio = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
      card.style.setProperty("--tint", ratio.toFixed(3));
      card.dataset.dir = dx >= 0 ? "yes" : "no";
      if (!yesStamp || !noStamp) return; // 広告カードはスタンプ無し
      if (dx > 0) { yesStamp.style.opacity = ratio; noStamp.style.opacity = 0; }
      else { noStamp.style.opacity = ratio; yesStamp.style.opacity = 0; }
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      card.classList.remove("dragging");
      if (dx > SWIPE_THRESHOLD) attemptSwipe(card, user, "yes");
      else if (dx < -SWIPE_THRESHOLD) attemptSwipe(card, user, "no");
      else {
        card.style.transform = "";
        card.style.setProperty("--tint", "0");
        if (yesStamp) yesStamp.style.opacity = 0;
        if (noStamp) noStamp.style.opacity = 0;
      }
      dx = 0; dy = 0;
    }

    card.addEventListener("pointerdown", onDown);
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerup", onUp);
    card.addEventListener("pointercancel", onUp);
  }

  // スワイプを1回消費して確定する。上限に達していたら止めて案内を出す。
  function attemptSwipe(card, user, choice) {
    var real = user && !user.__ad; // 広告カードは枠を消費しない
    if (real && swipesLeft() <= 0) {
      // カードを元の位置へ戻す
      card.style.transform = "";
      card.style.setProperty("--tint", "0");
      var y = card.querySelector(".stamp-yes"), n = card.querySelector(".stamp-no");
      if (y) y.style.opacity = 0;
      if (n) n.style.opacity = 0;
      showSwipeLimit();
      return;
    }
    if (real) useSwipe();
    commit(card, user, choice);
  }

  // カードを画面外へ飛ばして次へ
  function commit(card, user, choice) {
    var dir = choice === "yes" ? 1 : -1;
    card.classList.add("leaving");
    var fly = reduceMotion ? 0 : 1;
    card.style.transform = "translate(" + (dir * 480 * fly) + "px," + (40 * fly) +
      "px) rotate(" + (dir * 22 * fly) + "deg)";
    card.style.opacity = "0";

    index++;
    var delay = reduceMotion ? 0 : 300;
    setTimeout(function () {
      render();
      if (choice === "yes" && user.likesBack) registerMatch(user);
    }, delay);
  }

  function swipeTop(choice) {
    if (index >= users.length) return;
    var top = deckEl.querySelector('.card[data-id="' + users[index].id + '"]');
    if (top) attemptSwipe(top, users[index], choice);
  }

  // ---------- コーチ（最初のヒント）----------
  function showCoach() {
    if (reduceMotion || !coachEl) return;
    coachEl.hidden = false;
    coachShown = true;
    setTimeout(hideCoach, 3200);
  }
  function hideCoach() {
    if (coachEl) coachEl.hidden = true;
    coachShown = true;
  }

  // ---------- オーバーレイ開閉＋フォーカス管理（a11y） ----------
  var lastFocused = null;
  // 手前（最前面）から順に。フォーカストラップ・背景クリック・Escで使う
  var OVERLAY_IDS = ["limitOverlay", "deleteOverlay", "blockOverlay", "reportOverlay", "policyOverlay",
    "termsOverlay", "previewOverlay", "logViewer", "threadOverlay", "matchOverlay"];

  function focusables(el) {
    return Array.prototype.filter.call(
      el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (n) { return !n.disabled && n.offsetParent !== null; }
    );
  }
  function setFocus(el) {
    if (!el || !el.focus) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
  }
  function currentOverlay() {
    for (var i = 0; i < OVERLAY_IDS.length; i++) {
      var el = document.getElementById(OVERLAY_IDS[i]);
      if (el && !el.hidden) return el;
    }
    return null;
  }
  function openOverlay(el) {
    if (!lastFocused) lastFocused = document.activeElement; // 復帰先を記憶
    el.hidden = false;
    setFocus(focusables(el)[0]); // ダイアログ内へフォーカスを移す
  }
  function closeOverlay(el) {
    el.hidden = true;
    // 他に開いているものが無ければ、開く前の要素へフォーカスを戻す
    if (!anyOverlayOpen() && lastFocused) { setFocus(lastFocused); lastFocused = null; }
  }

  // ---------- マッチ（成立演出のみ） ----------
  function registerMatch(user) {
    if (matches.some(function (m) { return m.id === user.id; })) return;
    matches.push(user);
    var c = convo(user.id);
    if (!c.matchedAt) c.matchedAt = Date.now();
    fillSlots(); // 枠が空いていれば自動でトーク一覧へ。無ければモザイクで待機。
    showMatch(user);
    renderChat();
    updateTabIndicators();
  }

  function showMatch(user) {
    var overlay = document.getElementById("matchOverlay");
    document.getElementById("matchSub").textContent =
      esc(user.name) + " さんとログを交換しました！";
    var me = getProfile();
    var youAv = (me && me.image)
      ? '<img class="match-av" src="' + me.image + '" width="160" height="160" alt="あなた" />'
      : '<span class="match-av match-you" role="img" aria-label="あなた">' +
          '<svg viewBox="0 0 24 24" width="34" height="34" class="ico-line"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg>' +
        "</span>";
    document.getElementById("matchLogs").innerHTML =
      youAv +
      '<span class="match-swap" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" class="ico-line"><path d="M7 7h9l-2.5-2.5M17 17H8l2.5 2.5"/></svg>' +
      "</span>" +
      '<img class="match-av" src="' + photoUrl(user.photo, 160, 160) + '" width="160" height="160" alt="' + esc(user.name) + '" />';
    openOverlay(overlay);
    if (!reduceMotion) burstConfetti();
    // 対応端末では軽くバイブ（成立の手応え）
    if (navigator.vibrate) { try { navigator.vibrate([0, 35, 30, 55]); } catch (e) {} }

    document.getElementById("keepSwiping").onclick = function () {
      closeOverlay(overlay);
    };
  }

  // 紙吹雪（軽量・CSSアニメ）派手版
  function burstConfetti() {
    var box = document.getElementById("confetti");
    if (!box) return;
    box.innerHTML = "";
    var colors = ["#fb4a3e", "#ff7a70", "#f4b942", "#3aa981", "#7aa2ff", "#ffffff", "#1f1d1a"];
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 80; i++) {
      var p = document.createElement("i");
      p.className = "cf" + (i % 3 === 0 ? " round" : "");
      var w = 6 + Math.random() * 7;
      p.style.left = (Math.random() * 100) + "%";
      p.style.width = w.toFixed(1) + "px";
      p.style.height = (i % 3 === 0 ? w : w * 1.6).toFixed(1) + "px";
      p.style.background = colors[i % colors.length];
      p.style.setProperty("--dx", (Math.random() * 220 - 110).toFixed(0) + "px");
      p.style.setProperty("--r", (Math.random() * 900 - 200).toFixed(0) + "deg");
      p.style.animationDelay = (Math.random() * 0.35) + "s";
      p.style.animationDuration = (1.1 + Math.random() * 1.1) + "s";
      p.style.opacity = (0.85 + Math.random() * 0.15).toFixed(2);
      frag.appendChild(p);
    }
    box.appendChild(frag);
    setTimeout(function () { box.innerHTML = ""; }, 2600);
  }

  // ---------- 自己紹介（プロフィール詳細） ----------
  function openViewer(user) {
    viewerUser = user;
    document.getElementById("viewerHead").innerHTML =
      '<img class="viewer-av" src="' + photoUrl(user.photo, 120, 120) + '" width="120" height="120" alt="" />' +
      '<div><div class="viewer-name" id="viewerName">' + esc(user.name) + "</div>" +
      '<div class="viewer-vibe">' + (user.pref ? esc(user.pref) : "") +
        (user.vibe ? "・" + esc(user.vibe) : "") + "</div></div>";
    var tags = (user.tags || []).map(function (t) {
      return '<span class="tag">#' + esc(t) + "</span>";
    }).join("");
    document.getElementById("viewerTimeline").innerHTML =
      '<p class="viewer-bio">' + esc(user.bio || "") + "</p>" +
      (tags ? '<div class="viewer-tags">' + tags + "</div>" : "");
    openOverlay(document.getElementById("logViewer"));
  }

  // ---------- 通報・ブロックの結線 ----------
  function bindModeration() {
    var reportBtn = document.getElementById("reportUserBtn");
    var blockBtn = document.getElementById("blockUserBtn");
    if (!reportBtn && !blockBtn) return; // 対象UIが無いページ（index.html 等）

    var reportOv = document.getElementById("reportOverlay");
    var blockOv = document.getElementById("blockOverlay");

    if (reportBtn) reportBtn.addEventListener("click", function () {
      if (!viewerUser) return;
      openOverlay(reportOv);
    });
    if (blockBtn) blockBtn.addEventListener("click", function () {
      if (!viewerUser) return;
      var sub = document.getElementById("blockSub");
      if (sub) sub.textContent = esc(viewerUser.name) + " さんは今後、あなたに表示されなくなります。";
      openOverlay(blockOv);
    });

    var reportCancel = document.getElementById("reportCancel");
    if (reportCancel) reportCancel.addEventListener("click", function () { closeOverlay(reportOv); });
    var reportSubmit = document.getElementById("reportSubmit");
    if (reportSubmit) reportSubmit.addEventListener("click", function () {
      var target = viewerUser;
      var picked = document.querySelector('#reportReasons input[name="reportReason"]:checked');
      var reason = picked ? picked.value : "その他";
      if (target) { addReport(target.id, reason); }
      closeOverlay(reportOv);
      closeOverlay(document.getElementById("logViewer"));
      if (target) hideUser(target);
      viewerUser = null;
    });

    var blockCancel = document.getElementById("blockCancel");
    if (blockCancel) blockCancel.addEventListener("click", function () { closeOverlay(blockOv); });
    var blockConfirm = document.getElementById("blockConfirm");
    if (blockConfirm) blockConfirm.addEventListener("click", function () {
      var target = viewerUser;
      closeOverlay(blockOv);
      closeOverlay(document.getElementById("logViewer"));
      if (target) hideUser(target);
      viewerUser = null;
    });
  }

  // ---------- イベント結線 ----------
  function bindControls() {
    document.getElementById("yesBtn").onclick = function () { swipeTop("yes"); };
    document.getElementById("noBtn").onclick = function () { swipeTop("no"); };
    document.getElementById("infoBtn").onclick = function () {
      if (index < users.length && !users[index].__ad) openViewer(users[index]);
    };
    document.getElementById("resetBtn").onclick = init;

    // 初回プロフィール入力フォーム（app.html のみ）
    var pform = document.getElementById("profileSetup");
    if (pform) {
      var imgInput = document.getElementById("pf-image");
      var vidInput = document.getElementById("pf-video");

      if (imgInput) imgInput.addEventListener("change", function () {
        var f = imgInput.files && imgInput.files[0];
        if (!f) { pendingImage = null; setUploadState("pf-image", "画像を選ぶ", false); updatePreview(); return; }
        downscaleImage(f, 512, function (dataUrl) {
          pendingImage = dataUrl || null;
          setUploadState("pf-image", dataUrl ? "画像を変更" : "画像を選ぶ", !!dataUrl);
          updatePreview();
        });
      });

      var img2Input = document.getElementById("pf-image2");
      if (img2Input) img2Input.addEventListener("change", function () {
        var f = img2Input.files && img2Input.files[0];
        if (!f) { pendingImage2 = null; setUploadState("pf-image2", "画像を選ぶ", false); return; }
        downscaleImage(f, 512, function (dataUrl) {
          pendingImage2 = dataUrl || null;
          setUploadState("pf-image2", dataUrl ? "画像を変更" : "画像を選ぶ", !!dataUrl);
        });
      });

      if (vidInput) vidInput.addEventListener("change", function () {
        var f = vidInput.files && vidInput.files[0];
        var verr = document.getElementById("pf-video-err");
        if (verr) verr.hidden = true;
        if (pendingVideoUrl) { try { URL.revokeObjectURL(pendingVideoUrl); } catch (e) {} pendingVideoUrl = null; }
        pendingVideoName = "";
        pendingVideoBlob = null;
        showVideoSize(0);
        if (!f) { setUploadState("pf-video", "動画を選ぶ", false); updatePreview(); return; }
        // 長さ3秒までを検査（メタデータだけ読む）
        var probeUrl = URL.createObjectURL(f);
        var probe = document.createElement("video");
        probe.preload = "metadata";
        probe.onloadedmetadata = function () {
          var d = probe.duration;
          try { URL.revokeObjectURL(probeUrl); } catch (e) {}
          if (isFinite(d) && d > 3.3) { // 3秒まで（エンコード誤差を少し許容）
            if (verr) { verr.textContent = "動画は3秒までです（選んだ動画は約" + d.toFixed(1) + "秒）。"; verr.hidden = false; }
            vidInput.value = "";
            setUploadState("pf-video", "動画を選ぶ", false);
            updatePreview();
            return;
          }
          pendingVideoName = f.name;
          // 長さOK → 低画質・低ビットレートに圧縮してからプレビュー・保存に使う
          setUploadState("pf-video", "動画を処理中…", true);
          compressVideo(f, { maxDim: 640, bitrate: 900000 }, function (blob) {
            // 圧縮できて実際に軽くなった時だけ採用。ダメなら原本にフォールバック。
            var use = (blob && blob.size > 0 && blob.size < f.size) ? blob : f;
            pendingVideoBlob = use;
            pendingVideoUrl = URL.createObjectURL(use);
            showVideoSize(use.size, use !== f);
            setUploadState("pf-video", "動画を変更", true);
            updatePreview();
          });
        };
        probe.onerror = function () {
          try { URL.revokeObjectURL(probeUrl); } catch (e) {}
          if (verr) { verr.textContent = "この動画を読み込めませんでした。別の動画をお試しください。"; verr.hidden = false; }
          vidInput.value = "";
          setUploadState("pf-video", "動画を選ぶ", false);
          updatePreview();
        };
        probe.src = probeUrl;
      });

      // ハッシュタグのトグル選択
      var TAG_MAX = 3;
      var tagsBox = document.getElementById("pf-tags");
      if (tagsBox) tagsBox.addEventListener("click", function (e) {
        var chip = e.target.closest(".pf-chip");
        if (!chip) return;
        var maxNote = document.getElementById("pf-tags-max");
        // すでにONなら常に外せる。OFF→ONは3つまで。
        if (!chip.classList.contains("is-on")) {
          var count = tagsBox.querySelectorAll(".pf-chip.is-on").length;
          if (count >= TAG_MAX) { if (maxNote) maxNote.hidden = false; return; }
        }
        var on = chip.classList.toggle("is-on");
        chip.setAttribute("aria-pressed", on ? "true" : "false");
        if (maxNote) maxNote.hidden = tagsBox.querySelectorAll(".pf-chip.is-on").length < TAG_MAX;
      });

      // 交換用ID：Enter/改行で確定してチップ化、✕で1つずつ削除
      var inviteInput = document.getElementById("pf-invite-input");
      if (inviteInput) {
        inviteInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            if (inviteInput.value.trim()) { addInvite(inviteInput.value); inviteInput.value = ""; }
          }
        });
        inviteInput.addEventListener("paste", function (e) {
          var t = (e.clipboardData || window.clipboardData).getData("text");
          if (t && /[\n,]/.test(t)) { e.preventDefault(); addInvite(t); inviteInput.value = ""; }
        });
      }
      var inviteChipsBox = document.getElementById("inviteChips");
      if (inviteChipsBox) inviteChipsBox.addEventListener("click", function (e) {
        var x = e.target.closest(".invite-x");
        if (!x) return;
        var i = parseInt(x.dataset.i, 10);
        if (!isNaN(i)) { pendingInvites.splice(i, 1); renderInviteChips(); }
      });

      // プレビュー（モーダル）
      var pvBtn = document.getElementById("previewBtn");
      if (pvBtn) pvBtn.addEventListener("click", function () {
        updatePreview();
        openOverlay(document.getElementById("previewOverlay"));
      });
      var pvClose = document.getElementById("closePreview");
      if (pvClose) pvClose.addEventListener("click", function () {
        closeOverlay(document.getElementById("previewOverlay"));
      });

      var openPolicy = document.getElementById("openPolicyBtn");
      if (openPolicy) openPolicy.addEventListener("click", function () {
        openOverlay(document.getElementById("policyOverlay"));
      });
      var closePolicy = document.getElementById("closePolicy");
      if (closePolicy) closePolicy.addEventListener("click", function () {
        closeOverlay(document.getElementById("policyOverlay"));
      });

      var openTerms = document.getElementById("openTermsBtn");
      if (openTerms) openTerms.addEventListener("click", function () {
        openOverlay(document.getElementById("termsOverlay"));
      });
      var closeTerms = document.getElementById("closeTerms");
      if (closeTerms) closeTerms.addEventListener("click", function () {
        closeOverlay(document.getElementById("termsOverlay"));
      });

      pform.addEventListener("submit", function (e) {
        e.preventDefault();
        var nameEl = document.getElementById("pf-name");
        var name = nameEl.value.trim();
        var err = document.getElementById("pf-name-err");
        if (!name) {
          if (err) err.hidden = false;
          nameEl.setAttribute("aria-invalid", "true");
          setFocus(nameEl);
          return;
        }
        if (err) err.hidden = true;
        nameEl.removeAttribute("aria-invalid");

        // ハンドルID：一度設定したら変更不可。既存があればそれを使い、検証は新規時のみ。
        var handleEl = document.getElementById("pf-handle");
        var handleErr = document.getElementById("pf-handle-err");
        var existingProfile = getProfile();
        var handle;
        if (existingProfile && existingProfile.handle) {
          handle = existingProfile.handle.replace(/^@/, ""); // 変更不可：既存を維持
          if (handleErr) handleErr.hidden = true;
        } else {
          handle = (handleEl ? handleEl.value : "").trim().replace(/^@/, "");
          if (handle && !/^[A-Za-z0-9_]{1,20}$/.test(handle)) {
            if (handleErr) { handleErr.textContent = "ハンドルIDは半角英数字と _ のみ使えます。"; handleErr.hidden = false; }
            setFocus(handleEl);
            return;
          }
          var badHandle = findBanned(handle);
          if (badHandle) {
            if (handleErr) { handleErr.textContent = "ハンドルIDに使えない語が含まれています（" + badHandle + "）。"; handleErr.hidden = false; }
            setFocus(handleEl);
            return;
          }
          if (handleErr) handleErr.hidden = true;
          if (!handle) handle = "user" + String(Math.floor(Math.random() * 1e6)); // 空なら自動採番
        }
        // 名前の禁止ワード検査（連絡先誘導・過度に性的な表現）
        var badName = findBanned(name);
        if (badName) {
          if (err) { err.textContent = "名前に使えない語が含まれています（" + badName + "）。"; err.hidden = false; }
          setFocus(nameEl);
          return;
        }

        var age = document.getElementById("pf-age");
        var ageErr = document.getElementById("pf-age-err");
        if (age && !age.checked) {
          if (ageErr) ageErr.hidden = false;
          setFocus(age);
          return;
        }
        if (ageErr) ageErr.hidden = true;
        var agree = document.getElementById("pf-agree");
        var agreeErr = document.getElementById("pf-agree-err");
        if (agree && !agree.checked) {
          if (agreeErr) agreeErr.hidden = false;
          setFocus(agree);
          return;
        }
        if (agreeErr) agreeErr.hidden = true;
        var tags = Array.prototype.map.call(
          document.querySelectorAll("#pf-tags .pf-chip.is-on"),
          function (c) { return c.dataset.tag; }
        );
        var prevProf = getProfile() || {};
        // 入力中でEnter未確定の値も取り込む
        var invInputEl = document.getElementById("pf-invite-input");
        if (invInputEl && invInputEl.value.trim()) { addInvite(invInputEl.value); invInputEl.value = ""; }
        // 招待IDプールを再構築：使用済みは必ず保持（＝再送しない）、チップは未使用ぶん
        var prevInvites = getInviteIds(prevProf);
        var usedEntries = prevInvites.filter(function (x) { return x.usedWith; });
        var usedCodes = {};
        usedEntries.forEach(function (x) { usedCodes[x.code] = 1; });
        var seen = {};
        var unusedEntries = [];
        pendingInvites.forEach(function (code) {
          if (usedCodes[code] || seen[code]) return; // 使用済み・重複は追加しない
          seen[code] = 1;
          unusedEntries.push({ code: code, usedWith: null });
        });
        var inviteIds = usedEntries.concat(unusedEntries);
        saveProfile({
          name: name,
          handle: "@" + handle,
          inviteIds: inviteIds,
          image2: pendingImage2 || "",
          pref: document.getElementById("pf-pref").value,
          gender: document.getElementById("pf-gender").value,
          tags: tags,
          image: pendingImage || "",
          videoName: pendingVideoName || ""
        });
        setAppGated(false);
        render();
        showView("swipe");
        renderChat();
        updateTabIndicators();
      });
    }

    // 下部タブの切替
    var tabbar = document.getElementById("tabbar");
    if (tabbar) tabbar.addEventListener("click", function (e) {
      var t = e.target.closest(".tab");
      if (t) showView(t.dataset.view);
    });
    var editBtn = document.getElementById("editProfileBtn");
    if (editBtn) editBtn.addEventListener("click", openProfileEdit);

    // ── トーク枠を増やす（チャットタブの枠バー）
    var slotAdd = document.getElementById("slotAddBtn");
    if (slotAdd) slotAdd.addEventListener("click", showSlotLimit);

    // ── トーク画面：閉じる・スタンプ・定型文・解除
    var threadClose = document.getElementById("threadClose");
    if (threadClose) threadClose.addEventListener("click", function () {
      closeOverlay(document.getElementById("threadOverlay"));
      threadUser = null;
    });
    // 相手のアイコンをタップ → プロフィール（自己紹介）を表示
    var threadAvEl = document.getElementById("threadAv");
    if (threadAvEl) threadAvEl.addEventListener("click", function () {
      if (threadUser) openViewer(threadUser);
    });
    var stampsBox = document.getElementById("threadStamps");
    if (stampsBox) stampsBox.addEventListener("click", function (e) {
      var b = e.target.closest(".stamp-btn");
      if (b && threadUser) sendToThread(threadUser, "stamp", b.dataset.stamp);
    });
    var phrasesBox = document.getElementById("threadPhrases");
    if (phrasesBox) phrasesBox.addEventListener("click", function (e) {
      var b = e.target.closest(".phrase-btn");
      if (b && threadUser) sendToThread(threadUser, "text", b.textContent);
    });
    var threadUnmatchBtn = document.getElementById("threadUnmatch");
    if (threadUnmatchBtn) threadUnmatchBtn.addEventListener("click", function () {
      if (threadUser) unmatchThread(threadUser);
    });

    // ── 上限オーバーレイの閉じる
    var limitCancel = document.getElementById("limitCancel");
    if (limitCancel) limitCancel.addEventListener("click", function () {
      closeOverlay(document.getElementById("limitOverlay"));
    });

    // ── プレミアム（加入・解約／しぼり込み／ブースト）
    function setSub(on, plan) {
      var s = getState(); s.sub = on; if (on) s.subPlan = plan; saveState(s);
      rebuildDeck(); renderProfile();
    }
    var subMonth = document.getElementById("subMonthBtn");
    if (subMonth) subMonth.addEventListener("click", function () {
      Purchases.buy("sub_month", function () { setSub(true, "month"); });
    });
    var subCancel = document.getElementById("subCancelBtn");
    if (subCancel) subCancel.addEventListener("click", function () { setSub(false); });
    var restoreBtn = document.getElementById("restoreBtn");
    if (restoreBtn) restoreBtn.addEventListener("click", function () {
      Purchases.restore(function (list) {
        // 実運用：復元された購入に応じて課金状態を戻す。デモは対象なし。
        if (list && list.length) { var s = getState(); s.sub = true; saveState(s); rebuildDeck(); renderProfile(); }
      });
    });
    var fltGender = document.getElementById("flt-gender");
    if (fltGender) fltGender.addEventListener("change", function () {
      var s = getState(); s.fltGender = fltGender.value; saveState(s); rebuildDeck();
    });
    var fltPref = document.getElementById("flt-pref");
    if (fltPref) {
      // 地域の選択肢をプロフ入力のものから複製
      var src = document.getElementById("pf-pref");
      if (src) Array.prototype.forEach.call(src.querySelectorAll("option"), function (o) {
        if (!o.value) return;
        var opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.textContent;
        fltPref.appendChild(opt);
      });
      fltPref.addEventListener("change", function () {
        var s = getState(); s.fltPref = fltPref.value; saveState(s); rebuildDeck();
      });
    }
    var boostBtn = document.getElementById("boostBtn");
    if (boostBtn) boostBtn.addEventListener("click", function () {
      Purchases.buy("boost", function () { startBoost(); rebuildDeck(); renderPremium(); });
    });

    // アカウント削除（確認ダイアログを挟む）
    var delBtn = document.getElementById("deleteAccountBtn");
    var delOv = document.getElementById("deleteOverlay");
    if (delBtn && delOv) {
      delBtn.addEventListener("click", function () { openOverlay(delOv); });
      var delCancel = document.getElementById("deleteCancel");
      if (delCancel) delCancel.addEventListener("click", function () { closeOverlay(delOv); });
      var delConfirm = document.getElementById("deleteConfirm");
      if (delConfirm) delConfirm.addEventListener("click", function () {
        closeOverlay(delOv);
        deleteAccount();
      });
    }
    document.getElementById("closeViewer").onclick = function () {
      closeOverlay(document.getElementById("logViewer"));
    };

    // 通報・ブロック（app.html のみ。要素が無ければ何もしない）
    bindModeration();
    // オーバーレイの背景クリックで閉じる
    eachOverlay(function (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) closeOverlay(ov);
      });
    });
    // キーボード操作
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { eachOverlay(function (ov) { if (!ov.hidden) closeOverlay(ov); }); return; }
      // モーダル表示中は Tab をダイアログ内に閉じ込める（フォーカストラップ）
      if (e.key === "Tab") {
        var ov = currentOverlay();
        if (!ov) return;
        var f = focusables(ov);
        if (!f.length) { e.preventDefault(); return; }
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); setFocus(last); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); setFocus(first); }
        return;
      }
      // モーダルが開いている間は矢印キーで背後のデッキを動かさない
      if (anyOverlayOpen()) return;
      if (e.key === "ArrowRight") swipeTop("yes");
      else if (e.key === "ArrowLeft") swipeTop("no");
    });
  }

  function anyOverlayOpen() {
    var open = false;
    eachOverlay(function (ov) { if (!ov.hidden) open = true; });
    return open;
  }

  function eachOverlay(fn) {
    OVERLAY_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) fn(el);
    });
  }

  // ---------- スクロール出現（IntersectionObserver）----------
  function setupReveal() {
    var els = document.querySelectorAll(".reveal");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      Array.prototype.forEach.call(els, function (el) { el.classList.add("in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.16, rootMargin: "0px 0px -8% 0px" });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  // ---------- ユーティリティ ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  bindControls();
  init();
  setupReveal();

  // 待機（モザイク）相手の残り時間の色更新＆期限切れ掃除を定期実行
  setInterval(function () {
    if (pruneExpiredPending()) updateTabIndicators();
    var chat = document.getElementById("view-chat");
    if (chat && !chat.hidden) renderChat();
  }, 60000);
})();
