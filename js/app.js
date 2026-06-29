/**
 * LogSwap｜セットログ交換デモ
 *
 * ヒーロー内の実機フレームで動く、Tinder風スワイプデモ。
 * 相互に「交換したい」が出たらログ交換が成立する擬似マッチング。
 * バックエンドはなく、すべてブラウザ内で完結します。
 *
 * これは「セットログ（日常ログ）を交換するためのツール」であり、
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
  var matchCountEl = document.getElementById("matchCount");
  var coachEl = document.getElementById("coach");

  // 画像URL（picsum を webp で。リポジトリを軽く保つため外部参照）
  function photoUrl(seed, w, h) {
    return "https://picsum.photos/seed/" + encodeURIComponent(seed) + "/" + w + "/" + h + ".webp";
  }

  // ---------- 初期化 ----------
  function init() {
    users = (window.MOCK_USERS || []).slice();
    index = 0;
    matches = [];
    coachShown = false;
    updateMatchBadge();
    render();
    bindControls();
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

    var tags = user.tags.map(function (t) {
      return '<span class="tag">#' + esc(t) + "</span>";
    }).join("");

    var thumbs = user.log.map(function (l) {
      return '<div class="thumb">' +
        '<img src="' + photoUrl(l.seed, 120, 120) + '" width="120" height="120" ' +
        'loading="lazy" decoding="async" alt="' + esc(l.note) + '" />' +
        '<span class="thumb-t">' + esc(l.t) + "</span></div>";
    }).join("");

    card.innerHTML =
      '<div class="card-media">' +
        '<img class="card-photo" src="' + photoUrl(user.photo, 700, 900) + '" ' +
          'width="700" height="900" decoding="async" ' +
          (isTop ? "" : 'loading="lazy" ') + 'alt="' + esc(user.name) + ' さんのきょうのログ" />' +
        '<div class="card-scrim"></div>' +
        '<span class="stamp stamp-yes">交換したい</span>' +
        '<span class="stamp stamp-no">見送り</span>' +
        '<div class="card-head">' +
          "<h3>" + esc(user.name) + ' <span class="handle">' + esc(user.handle) + "</span></h3>" +
          '<p class="card-vibe">' + esc(user.vibe) + "</p>" +
        "</div>" +
      "</div>" +
      '<div class="card-foot">' +
        '<p class="card-bio">' + esc(user.bio) + "</p>" +
        '<div class="card-tags">' + tags + "</div>" +
        '<div class="log-cap">きょうのセットログ</div>' +
        '<div class="thumbs">' + thumbs + "</div>" +
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

  // ---------- マッチ ----------
  function registerMatch(user) {
    if (matches.some(function (m) { return m.id === user.id; })) return;
    matches.push(user);
    updateMatchBadge();
    showMatch(user);
  }

  function updateMatchBadge() {
    if (matches.length > 0) {
      matchCountEl.hidden = false;
      matchCountEl.textContent = matches.length;
    } else {
      matchCountEl.hidden = true;
    }
  }

  function showMatch(user) {
    var overlay = document.getElementById("matchOverlay");
    document.getElementById("matchSub").textContent =
      esc(user.name) + " さんと、おたがいに交換を希望しました。";
    document.getElementById("matchLogs").innerHTML =
      '<span class="match-av match-you" role="img" aria-label="あなた">' +
        '<svg viewBox="0 0 24 24" width="34" height="34" class="ico-line"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg>' +
      "</span>" +
      '<span class="match-swap" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" width="22" height="22" class="ico-line"><path d="M7 7h9l-2.5-2.5M17 17H8l2.5 2.5"/></svg>' +
      "</span>" +
      '<img class="match-av" src="' + photoUrl(user.photo, 160, 160) + '" width="160" height="160" alt="' + esc(user.name) + '" />';
    overlay.hidden = false;
    if (!reduceMotion) burstConfetti();
    // 対応端末では軽くバイブ（成立の手応え）
    if (navigator.vibrate) { try { navigator.vibrate([0, 35, 30, 55]); } catch (e) {} }

    document.getElementById("viewLogBtn").onclick = function () {
      overlay.hidden = true;
      openViewer(user);
    };
    document.getElementById("keepSwiping").onclick = function () {
      overlay.hidden = true;
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

  // ---------- マッチ一覧シート ----------
  function openSheet() {
    var sheet = document.getElementById("matchesSheet");
    var list = document.getElementById("matchesList");
    if (matches.length === 0) {
      list.innerHTML = '<p class="sheet-empty">まだ交換成立したログはありません。<br>「交換したい」を送ってみましょう。</p>';
    } else {
      list.innerHTML = matches.map(function (u) {
        return '<button class="match-row" type="button" data-id="' + u.id + '">' +
          '<img class="row-av" src="' + photoUrl(u.photo, 96, 96) + '" width="96" height="96" alt="" />' +
          '<span class="row-meta"><span class="row-name">' + esc(u.name) + "</span>" +
          '<span class="row-vibe">' + esc(u.vibe) + "</span></span>" +
          '<span class="row-go" aria-hidden="true">見る →</span></button>';
      }).join("");
      Array.prototype.forEach.call(list.querySelectorAll(".match-row"), function (row) {
        row.onclick = function () {
          var u = matches.filter(function (m) { return m.id === row.dataset.id; })[0];
          sheet.hidden = true;
          openViewer(u);
        };
      });
    }
    sheet.hidden = false;
  }

  // ---------- ログビューア ----------
  function openViewer(user) {
    document.getElementById("viewerHead").innerHTML =
      '<img class="viewer-av" src="' + photoUrl(user.photo, 120, 120) + '" width="120" height="120" alt="" />' +
      '<div><div class="viewer-name" id="viewerName">' + esc(user.name) + " さんのセットログ</div>" +
      '<div class="viewer-vibe">' + esc(user.vibe) + "</div></div>";
    document.getElementById("viewerTimeline").innerHTML = user.log.map(function (l) {
      return '<div class="tl-item">' +
        '<span class="tl-time">' + esc(l.t) + "</span>" +
        '<img class="tl-clip" src="' + photoUrl(l.seed, 96, 96) + '" width="96" height="96" loading="lazy" alt="" />' +
        '<span class="tl-note">' + esc(l.note) + "</span></div>";
    }).join("");
    document.getElementById("logViewer").hidden = false;
  }

  // ---------- イベント結線 ----------
  function bindControls() {
    document.getElementById("yesBtn").onclick = function () { swipeTop("yes"); };
    document.getElementById("noBtn").onclick = function () { swipeTop("no"); };
    document.getElementById("infoBtn").onclick = function () {
      if (index < users.length) openViewer(users[index]);
    };
    document.getElementById("resetBtn").onclick = init;
    document.getElementById("matchesBtn").onclick = openSheet;
    document.getElementById("closeSheet").onclick = function () {
      document.getElementById("matchesSheet").hidden = true;
    };
    document.getElementById("closeViewer").onclick = function () {
      document.getElementById("logViewer").hidden = true;
    };
    // オーバーレイの背景クリックで閉じる
    eachOverlay(function (ov) {
      ov.addEventListener("click", function (e) {
        if (e.target === ov) ov.hidden = true;
      });
    });
    // Esc で閉じる
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { eachOverlay(function (ov) { ov.hidden = true; }); return; }
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
    ["matchOverlay", "matchesSheet", "logViewer"].forEach(function (id) {
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

  init();
  setupReveal();
})();
