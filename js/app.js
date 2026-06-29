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

  var pendingImage = null;     // ダウンスケール済み画像 dataURL
  var pendingVideoName = "";   // 動画ファイル名（実体の保存はバックエンド前提）
  var pendingVideoUrl = null;  // セッション内プレビュー用 objectURL

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
    box.hidden = !(pendingVideoUrl || pendingImage);
  }

  // ---------- 初期化 ----------
  function init() {
    users = (window.MOCK_USERS || []).slice();
    index = 0;
    matches = [];
    coachShown = false;
    // app.html では初回（プロフィール未登録）はプロフ入力から入る
    var gate = document.getElementById("profileSetup");
    if (gate && !getProfile()) { setAppGated(true); }
    else { render(); }
  }

  // プロフ入力ゲートの表示切替（app.html のみ。要素が無ければ何もしない）
  function setAppGated(gated) {
    var gate = document.getElementById("profileSetup");
    var stage = document.querySelector(".app-stage .stage");
    if (gate) gate.hidden = !gated;
    if (stage) stage.hidden = gated;
    if (gated) {
      controlsEl.setAttribute("aria-hidden", "true");
      controlsEl.style.visibility = "hidden";
      setFocus(document.getElementById("pf-name"));
    } else {
      controlsEl.removeAttribute("aria-hidden");
      controlsEl.style.visibility = "visible";
    }
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
        yesStamp.style.opacity = 0; noStamp.style.opacity = 0;
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
  var OVERLAY_IDS = ["logViewer", "matchOverlay"]; // 手前から順に

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
  }

  function showMatch(user) {
    var overlay = document.getElementById("matchOverlay");
    document.getElementById("matchSub").textContent =
      esc(user.name) + " さんと、おたがいに交換を希望しました。";
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

  // ---------- 自己紹介（プロフィール詳細）----------
  function openViewer(user) {
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

  // ---------- イベント結線 ----------
  function bindControls() {
    document.getElementById("yesBtn").onclick = function () { swipeTop("yes"); };
    document.getElementById("noBtn").onclick = function () { swipeTop("no"); };
    document.getElementById("infoBtn").onclick = function () {
      if (index < users.length) openViewer(users[index]);
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
          pendingVideoUrl = URL.createObjectURL(f);
          setUploadState("pf-video", "動画を変更", true);
          updatePreview();
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
        saveProfile({
          name: name,
          pref: document.getElementById("pf-pref").value,
          gender: document.getElementById("pf-gender").value,
          image: pendingImage || "",
          videoName: pendingVideoName || ""
        });
        setAppGated(false);
        render();
      });
    }
    document.getElementById("closeViewer").onclick = function () {
      closeOverlay(document.getElementById("logViewer"));
    };
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
    ["matchOverlay", "logViewer"].forEach(function (id) {
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
