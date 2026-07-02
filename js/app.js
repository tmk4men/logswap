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
    if (users[index] && users[index].id === user.id) index++; // 表示中のカードなら次へ送る
    render();
    renderChat();
    updateTabIndicators();
  }

  var pendingImage = null;     // ダウンスケール済み画像 dataURL
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

  // ---------- 初期化 ----------
  function init() {
    users = (window.MOCK_USERS || []).filter(function (u) { return !isBlocked(u.id); });
    users = interleaveAds(users);
    index = 0;
    matches = [];
    coachShown = false;
    // app.html では初回（プロフィール未登録）はプロフ入力から入る
    var gate = document.getElementById("profileSetup");
    if (gate && !getProfile()) { setAppGated(true); return; }
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

  // ---------- チャット（成立した相手を上に並べる）----------
  function renderChat() {
    var list = document.getElementById("chatList");
    if (!list) return;
    if (!matches.length) {
      list.innerHTML = '<p class="chat-empty">ログを交換すると、ここに相手が表示されます。</p>';
      return;
    }
    list.innerHTML = matches.slice().reverse().map(function (u) {
      return '<button class="chat-row" type="button" data-id="' + u.id + '">' +
        '<img class="chat-av" src="' + photoUrl(u.photo, 96, 96) + '" alt="" />' +
        '<span class="chat-meta"><span class="chat-name">' + esc(u.name) + "</span>" +
        '<span class="chat-last">ログを交換しました</span></span>' +
        '<span class="chat-go" aria-hidden="true">›</span></button>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".chat-row"), function (row) {
      row.onclick = function () {
        var u = matches.filter(function (m) { return m.id === row.dataset.id; })[0];
        if (u) openViewer(u);
      };
    });
  }
  // タブのインジケータ：チャットの赤い点＋「いいねされた人数」の赤い数字
  function updateTabIndicators() {
    var dot = document.getElementById("chatDot");
    if (dot) dot.hidden = matches.length === 0; // 成立したのに未対応の相手がいる印
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
        '<div class="ps-meta">' + (p.pref ? esc(p.pref) : "地域未設定") + "</div>" +
        (tags ? '<div class="ps-tags">' + tags + "</div>" : "") +
        '<div class="ps-note">ログの動画：' + (p.videoName ? "設定済み" : "未設定") + "</div>" +
      "</div>";
  }
  function openProfileEdit() {
    var p = getProfile() || {};
    var n = document.getElementById("pf-name"); if (n) n.value = p.name || "";
    var pr = document.getElementById("pf-pref"); if (pr) pr.value = p.pref || "";
    var g = document.getElementById("pf-gender"); if (g) g.value = p.gender || "";
    pendingImage = p.image || null;
    var set = {}; (p.tags || []).forEach(function (t) { set[t] = 1; });
    Array.prototype.forEach.call(document.querySelectorAll("#pf-tags .pf-chip"), function (c) {
      var on = !!set[c.dataset.tag];
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    setUploadState("pf-image", p.image ? "画像を変更" : "画像を選ぶ", !!p.image);
    setUploadState("pf-video", p.videoName ? "動画を変更" : "動画を選ぶ", !!p.videoName);
    // 既存プロフィールの編集時は同意・年齢確認済みとして扱う
    var agree = document.getElementById("pf-agree"); if (agree) agree.checked = true;
    var agreeErr = document.getElementById("pf-agree-err"); if (agreeErr) agreeErr.hidden = true;
    var age = document.getElementById("pf-age"); if (age) age.checked = true;
    var ageErr = document.getElementById("pf-age-err"); if (ageErr) ageErr.hidden = true;
    setAppGated(true);
  }

  // アカウント削除：端末内のデータを全消去して初回状態へ戻す。
  // （バックエンド接続時は、ここでサーバー側の退会APIも呼ぶ。ストア審査の必須要件）
  function deleteAccount() {
    try {
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(BLOCK_KEY);
      localStorage.removeItem(REPORT_KEY);
    } catch (e) {}
    pendingImage = null;
    pendingVideoName = "";
    pendingVideoBlob = null;
    if (pendingVideoUrl) { try { URL.revokeObjectURL(pendingVideoUrl); } catch (e) {} pendingVideoUrl = null; }
    // 入力フォームを白紙化して初回入力ゲートへ
    var f = document.getElementById("profileSetup");
    if (f && f.reset) f.reset();
    Array.prototype.forEach.call(document.querySelectorAll("#pf-tags .pf-chip.is-on"), function (c) {
      c.classList.remove("is-on"); c.setAttribute("aria-pressed", "false");
    });
    setUploadState("pf-image", "画像を選ぶ", false);
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
      if (dx > SWIPE_THRESHOLD) commit(card, user, "yes");
      else if (dx < -SWIPE_THRESHOLD) commit(card, user, "no");
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
    if (top) commit(top, users[index], choice);
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
  var OVERLAY_IDS = ["deleteOverlay", "blockOverlay", "reportOverlay", "policyOverlay", "termsOverlay",
    "previewOverlay", "logViewer", "matchOverlay"];

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
      var tagsBox = document.getElementById("pf-tags");
      if (tagsBox) tagsBox.addEventListener("click", function (e) {
        var chip = e.target.closest(".pf-chip");
        if (!chip) return;
        var on = chip.classList.toggle("is-on");
        chip.setAttribute("aria-pressed", on ? "true" : "false");
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
        saveProfile({
          name: name,
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
})();
