/**
 * LogSwap — セットログ交換デモ
 *
 * Tinder風のカードスタックを実装し、相互に◯（交換希望）が出たら
 * 「ログ交換 成立」とするデモ。バックエンドはなく、擬似マッチング。
 *
 * これは「セットログ（日常ログ）を交換するためのツール」であり、
 * 異性紹介・出会い目的の要素（性別・年齢でのフィルタ等）は意図的に持たせていません。
 */
(function () {
  "use strict";

  var SWIPE_THRESHOLD = 110; // px。これを超えてリリースすると確定。
  var users = [];
  var index = 0;
  var matches = [];

  var deckEl = document.getElementById("deck");
  var emptyEl = document.getElementById("empty");
  var controlsEl = document.getElementById("controls");
  var matchCountEl = document.getElementById("matchCount");

  // ---------- 初期化 ----------
  function init() {
    users = (window.MOCK_USERS || []).slice();
    index = 0;
    matches = [];
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
      controlsEl.style.visibility = "hidden";
      return;
    }
    emptyEl.hidden = true;
    controlsEl.style.visibility = "visible";

    // 後ろのカードから先に追加（DOM順 = 重なり順）
    var upper = Math.min(index + 2, users.length);
    for (var i = upper - 1; i >= index; i--) {
      var isTop = i === index;
      var card = buildCard(users[i], isTop);
      // 背面カードは少し小さく・下げる
      if (!isTop) {
        card.style.transform = "scale(0.95) translateY(14px)";
        card.style.filter = "brightness(0.97)";
      }
      deckEl.appendChild(card);
      if (isTop) enableDrag(card, users[i]);
    }
  }

  function buildCard(user, isTop) {
    var card = document.createElement("div");
    card.className = "card";
    card.dataset.id = user.id;

    var grad = "linear-gradient(160deg," + user.color[0] + "," + user.color[1] + ")";

    var tags = user.tags.map(function (t) {
      return '<span class="tag">#' + esc(t) + "</span>";
    }).join("");

    var strip = user.log.map(function (l) {
      return '<div class="log-chip"><div class="clip">' + l.clip +
        '</div><div class="time">' + esc(l.t) + "</div></div>";
    }).join("");

    card.innerHTML =
      '<div class="card-top" style="background:' + grad + '">' +
        '<span class="stamp stamp-yes">交換</span>' +
        '<span class="stamp stamp-no">見送り</span>' +
        '<span class="card-avatar">' + user.emoji + "</span>" +
      "</div>" +
      '<div class="card-body">' +
        '<div class="card-name"><h2>' + esc(user.name) + "</h2>" +
          '<span class="handle">' + esc(user.handle) + "</span></div>" +
        '<div class="card-vibe">' + esc(user.vibe) + "</div>" +
        '<p class="card-bio">' + esc(user.bio) + "</p>" +
        '<div class="card-tags">' + tags + "</div>" +
        '<div class="log-label">きょうのセットログ</div>' +
        '<div class="log-strip">' + strip + "</div>" +
      "</div>";

    return card;
  }

  // ---------- ドラッグ（スワイプ）処理 ----------
  function enableDrag(card, user) {
    var startX = 0, startY = 0, dx = 0, dy = 0, dragging = false;
    var yesStamp = card.querySelector(".stamp-yes");
    var noStamp = card.querySelector(".stamp-no");

    function onDown(e) {
      dragging = true;
      card.classList.add("dragging");
      startX = pointX(e);
      startY = pointY(e);
      card.setPointerCapture && e.pointerId != null && card.setPointerCapture(e.pointerId);
    }

    function onMove(e) {
      if (!dragging) return;
      dx = pointX(e) - startX;
      dy = pointY(e) - startY;
      var rot = dx / 18;
      card.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + rot + "deg)";
      var ratio = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
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
        yesStamp.style.opacity = 0;
        noStamp.style.opacity = 0;
      }
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
    card.style.transform = "translate(" + (dir * 600) + "px," + (dir * 60) +
      "px) rotate(" + (dir * 30) + "deg)";
    card.style.opacity = "0";

    index++;
    setTimeout(function () {
      render();
      if (choice === "yes" && user.likesBack) registerMatch(user);
    }, 320);
  }

  // ボタン操作（上のカードをプログラム的にスワイプ）
  function swipeTop(choice) {
    if (index >= users.length) return;
    var top = deckEl.querySelector('.card[data-id="' + users[index].id + '"]');
    if (top) commit(top, users[index], choice);
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
      esc(user.name) + " さんとおたがいに交換を希望しました";
    document.getElementById("matchLogs").innerHTML =
      '<span class="who">🙂</span><span class="arrow">⇄</span><span class="who">' +
      user.emoji + "</span>";
    overlay.hidden = false;

    document.getElementById("viewLogBtn").onclick = function () {
      overlay.hidden = true;
      openViewer(user);
    };
    document.getElementById("keepSwiping").onclick = function () {
      overlay.hidden = true;
    };
  }

  // ---------- マッチ一覧シート ----------
  function openSheet() {
    var sheet = document.getElementById("matchesSheet");
    var list = document.getElementById("matchesList");
    if (matches.length === 0) {
      list.innerHTML = '<div class="sheet-empty">まだ交換成立したログはありません。<br>◯でログ交換を申し込みましょう。</div>';
    } else {
      list.innerHTML = matches.map(function (u) {
        return '<div class="match-row" data-id="' + u.id + '">' +
          '<span class="av">' + u.emoji + "</span>" +
          '<div class="meta"><div class="nm">' + esc(u.name) + "</div>" +
          '<div class="vb">' + esc(u.vibe) + "</div></div>" +
          '<span class="go">見る →</span></div>';
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
      '<span class="av">' + user.emoji + "</span>" +
      '<div><div class="nm">' + esc(user.name) + " さんのセットログ</div>" +
      '<div class="vb">' + esc(user.vibe) + "</div></div>";
    document.getElementById("viewerTimeline").innerHTML = user.log.map(function (l) {
      return '<div class="tl-item"><div class="tl-time">' + esc(l.t) + "</div>" +
        '<div class="tl-clip">' + l.clip + "</div>" +
        '<div class="tl-note">' + esc(l.note) + "</div></div>";
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
    // キーボード操作（PC確認用）
    document.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") swipeTop("yes");
      else if (e.key === "ArrowLeft") swipeTop("no");
    });
  }

  // ---------- ユーティリティ ----------
  function pointX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }
  function pointY(e) { return e.touches ? e.touches[0].clientY : e.clientY; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  init();
})();
