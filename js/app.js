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

  // バックエンド接続層（js/backend.js）。未接続/無効時は enabled=false でデモ動作。
  var Backend = window.LogSwapBackend || { enabled: false };
  var BE = Backend.enabled;

  // i18n（js/i18n.js）。t("日本語") で英語化。未読込ならそのまま日本語。
  var t = (window.I18N && window.I18N.t) || function (s) { return s; };

  // 広告・課金レイヤ（ads.js / purchases.js）。未読込でも動くフォールバック付き。
  var Ads = window.LogSwapAds || { showRewarded: function (cb) { if (cb) cb(); } };
  var Purchases = window.LogSwapPurchases ||
    { init: function () {}, buy: function (k, ok) { if (ok) ok(); }, restore: function (d) { if (d) d([]); },
      manageSubscriptions: function () { return false; }, priceOf: function () { return null; }, isNative: function () { return false; } };

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

  // 画像なしのときの人型プレースホルダ（丸アイコンに“偽の写真”を出さないため）
  var AVATAR_PLACEHOLDER = "data:image/svg+xml;utf8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#2c2c37"/><circle cx="50" cy="41" r="17" fill="#6b6875"/><path d="M20 86c0-16 14-25 30-25s30 9 30 25z" fill="#6b6875"/></svg>');
  // 画像URL。実URL（R2など http/https）はそのまま。画像なし（空）は人型プレースホルダ。
  // 非空の seed（デモのモック）だけ picsum を使う。※丸アイコンは実プロフィール画像のみ。
  function photoUrl(seed, w, h) {
    if (typeof seed === "string" && /^https?:\/\//.test(seed)) return seed;
    if (!seed) return AVATAR_PLACEHOLDER;
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

  // バックエンド接続時のプロフィール保存：新規メディアだけアップロード→DBへ upsert→
  // 返ってきた実データ（URL入り）を localStorage にミラーしてデッキを更新。
  function saveProfileToBackend(profileObj) {
    var media = {};
    if (typeof pendingImage === "string" && pendingImage.indexOf("data:") === 0) media.image = pendingImage;
    if (typeof pendingImage2 === "string" && pendingImage2.indexOf("data:") === 0) media.image2 = pendingImage2;
    if (pendingVideoBlob) media.video = pendingVideoBlob;
    setFormSaving(true);
    Backend.saveProfile(profileObj, media).then(function (saved) {
      saveProfile(saved);
      setFormSaving(false);
      setAppGated(false);
      showView("swipe");
      renderChat();
      updateTabIndicators();
      return refreshDeck();
    }).catch(function (e) {
      setFormSaving(false);
      console.error("save profile failed", e);
      showSaveError(e);
    });
  }
  function setFormSaving(on) {
    var b = document.getElementById("pfStart");
    if (!b) return;
    if (on) { if (!b._label) b._label = b.textContent; b.disabled = true; b.textContent = "保存中…"; }
    else { b.disabled = false; if (b._label) { b.textContent = b._label; b._label = ""; } }
  }
  function showSaveError(e) {
    if (e && e.code === "23505") { // handle 一意制約違反
      var he = document.getElementById("pf-handle-err");
      if (he) { he.textContent = "このハンドルIDは既に使われています。別のIDにしてください。"; he.hidden = false; }
      var h = document.getElementById("pf-handle"); if (h && !h.disabled) setFocus(h);
      return;
    }
    var ne = document.getElementById("pf-name-err");
    if (ne) { ne.textContent = "保存に失敗しました。通信環境を確認して、もう一度お試しください。"; ne.hidden = false; }
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
    if (BE) { Backend.report(id, reason).catch(function (e) { console.error("report failed", e); }); return; }
    var a;
    try { a = JSON.parse(localStorage.getItem(REPORT_KEY) || "[]"); } catch (e) { a = []; }
    a.push({ id: id, reason: reason });
    try { localStorage.setItem(REPORT_KEY, JSON.stringify(a)); } catch (e) {}
  }
  // 相手を非表示化：ブロック保存＋現在のデッキ／交換相手から除去して再描画
  function hideUser(user) {
    if (!user) return;
    blockId(user.id);
    if (BE) {
      Backend.block(user.id).catch(function (e) { console.error("block failed", e); });
      // ブロックは成立も解除する（さもないと相手はまだメッセージでき、リロードで復活する）
      var bc = convos[user.id];
      if (bc && bc.matchId) {
        if (bc._unsub) { try { bc._unsub(); } catch (e) {} }
        Backend.deleteMatch(bc.matchId).catch(function (e) { console.error("unmatch on block failed", e); });
      }
    }
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
    "セックス", "sex", "エッチ", "ワンナイト", "パパ活", "ママ活", "援交", "裏垢", "avトーク", "セフレ",
    "やりもく", "ヤリモク", "おっぱい", "ちんこ", "まんこ", "出会い"
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
  // トーク枠：無料はMSG_SLOTS_FREE、広告で一定時間だけ増える、サブスクで無制限
  function msgSlotCap() {
    if (isSub()) return Infinity;
    var s = getState();
    var cap = CONFIG.MSG_SLOTS_FREE || 3;
    if (s.msgAdUntil && Date.now() < s.msgAdUntil) cap += (s.msgAdSlots || 0);
    return cap;
  }
  // トーク枠の広告：1日 MSG_AD_MAX 回まで。1回で MSG_AD_SLOTS 枠を MSG_AD_HOURS 時間ぶん加算。
  function msgAdLeft() {
    var s = getState();
    if (s.msgAdDate !== today()) { s.msgAdDate = today(); s.msgAdCount = 0; saveState(s); }
    return Math.max(0, (CONFIG.MSG_AD_MAX || 5) - (s.msgAdCount || 0));
  }
  function addMsgAd() {
    var s = getState();
    if (s.msgAdDate !== today()) { s.msgAdDate = today(); s.msgAdCount = 0; }
    if ((s.msgAdCount || 0) >= (CONFIG.MSG_AD_MAX || 5)) return false;
    s.msgAdCount = (s.msgAdCount || 0) + 1;
    // 24時間ウィンドウが切れていたら枠をリセットしてから加算
    if (!(s.msgAdUntil && Date.now() < s.msgAdUntil)) s.msgAdSlots = 0;
    s.msgAdSlots = (s.msgAdSlots || 0) + (CONFIG.MSG_AD_SLOTS || 3);
    s.msgAdUntil = Date.now() + (CONFIG.MSG_AD_HOURS || 24) * 3600 * 1000;
    saveState(s);
    return true;
  }

  // マッチ率アップ（課金アイテム）：購入で「所持」が増え、スワイプ画面から使用して30分アクティブ化
  function boostActive() { var s = getState(); return !!(s.boostUntil && Date.now() < s.boostUntil); }
  function boostOwnedCount() { return getState().boostOwned || 0; }
  function addBoostItem() { var s = getState(); s.boostOwned = (s.boostOwned || 0) + 1; saveState(s); }
  // 所持ブーストを1つ使って30分アクティブ化。既に使用中／所持0なら何もしない。
  function useBoostItem() {
    var s = getState();
    if (s.boostUntil && Date.now() < s.boostUntil) return false;
    if ((s.boostOwned || 0) < 1) return false;
    s.boostOwned -= 1;
    s.boostUntil = Date.now() + (CONFIG.BOOST_MINUTES || 30) * 60000;
    saveState(s);
    return true;
  }

  // スワイプ画面右上のブーストアイコン（所持 or 使用中で表示）
  function renderSwipeBoost() {
    var btn = document.getElementById("swipeBoost");
    if (!btn) return;
    var owned = boostOwnedCount();
    var active = boostActive();
    btn.hidden = !(owned > 0 || active);
    btn.classList.toggle("is-active", active);
    var badge = document.getElementById("swipeBoostBadge");
    if (badge) {
      var showBadge = !active && owned > 0;
      badge.hidden = !showBadge;
      if (showBadge) badge.textContent = owned;
    }
  }
  // ブーストアイコンをタップ → 使用ダイアログ（使用中は残り時間、所持ありは「使用する」）
  function openBoostDialog() {
    var ov = document.getElementById("boostOverlay");
    if (!ov) return;
    var title = document.getElementById("boostDlgTitle");
    var sub = document.getElementById("boostDlgSub");
    var useBtn = document.getElementById("boostUseBtn");
    if (boostActive()) {
      var mins = Math.max(1, Math.round((getState().boostUntil - Date.now()) / 60000));
      if (title) title.textContent = "ブースト中";
      if (sub) sub.textContent = "あと約" + mins + "分、あなたが交換されやすくなっています。";
      if (useBtn) useBtn.hidden = true;
    } else {
      if (title) title.textContent = "ブーストを使う";
      if (sub) sub.textContent = "30分間、あなたが交換されやすくなります。（所持：" + boostOwnedCount() + "個）";
      if (useBtn) useBtn.hidden = boostOwnedCount() < 1;
    }
    openOverlay(ov);
  }
  // アプリバー右の自分のアイコン（プロフィール画像を丸く表示）
  function renderMyAvatar() {
    var el = document.getElementById("myAvatar");
    if (!el) return;
    var gate = document.getElementById("profileSetup");
    var gated = gate && !gate.hidden;
    var p = getProfile();
    if (gated || !p) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = p.image
      ? '<img src="' + esc(p.image) + '" alt="" />'
      : '<svg viewBox="0 0 24 24" width="20" height="20" class="ico-line"><circle cx="12" cy="8" r="4"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/></svg>';
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
  var veState = null;          // 動画エディタ（トリミング・向き調整）の作業中の状態

  // 縦カード用の出力サイズ（4:5 の縦長）。長辺は圧縮の maxDim と同じ 640。
  var VIDEO_OUT_W = 512, VIDEO_OUT_H = 640;

  // 動画フレームを「向き・拡大・位置・全体/切り抜き」に従って outW×outH の枠へ描く。
  // エディタのプレビューと、書き出し（compressVideo）の両方でこの1関数を使い、見た目を一致させる。
  function drawFramed(ctx, video, outW, outH, st) {
    st = st || {};
    var rot = (((st.rotation || 0) % 360) + 360) % 360;
    var zoom = st.zoom || 1;
    var fit = st.fit || "cover";
    var offX = (st.offsetX == null ? 0 : st.offsetX);
    var offY = (st.offsetY == null ? 0 : st.offsetY);
    var vw = video.videoWidth || outW, vh = video.videoHeight || outH;
    var rw = (rot === 90 || rot === 270) ? vh : vw; // 回転後の外接ボックス
    var rh = (rot === 90 || rot === 270) ? vw : vh;
    var base = (fit === "contain") ? Math.min(outW / rw, outH / rh) : Math.max(outW / rw, outH / rh);
    var s = base * zoom;
    var slackX = Math.max(0, rw * s - outW) / 2;
    var slackY = Math.max(0, rh * s - outH) / 2;
    ctx.save();
    ctx.fillStyle = "#1b1a17";
    ctx.fillRect(0, 0, outW, outH);
    ctx.translate(outW / 2 + offX * slackX, outH / 2 + offY * slackY);
    ctx.rotate(rot * Math.PI / 180);
    var dW = vw * s, dH = vh * s;
    ctx.drawImage(video, -dW / 2, -dH / 2, dW, dH);
    ctx.restore();
  }

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
      var frame = opts.frame || null; // {outW,outH,transform} が来たら枠に合わせて書き出す
      var w, h;
      if (frame) {
        w = frame.outW; h = frame.outH;
      } else {
        var scale = Math.min(1, maxDim / Math.max(v.videoWidth || 1, v.videoHeight || 1));
        w = Math.max(2, Math.round((v.videoWidth || maxDim) * scale / 2) * 2);
        h = Math.max(2, Math.round((v.videoHeight || maxDim) * scale / 2) * 2);
      }
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
        try {
          if (frame) drawFramed(ctx, v, w, h, frame.transform);
          else ctx.drawImage(v, 0, 0, w, h);
        } catch (e) {}
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
  // dataURL（File でもネイティブピッカーでも）を縮小して JPEG dataURL で返す
  function downscaleFromDataUrl(dataUrl, maxSize, cb) {
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
    img.src = dataUrl;
  }
  function downscaleImage(file, maxSize, cb) {
    var reader = new FileReader();
    reader.onload = function () { downscaleFromDataUrl(reader.result, maxSize, cb); };
    reader.onerror = function () { cb(""); };
    reader.readAsDataURL(file);
  }

  // アップロードボタンの見た目（文言と選択済みスタイル）を更新。文言は言語に合わせて翻訳。
  function setUploadState(forId, text, isSet) {
    var btn = document.querySelector('label[for="' + forId + '"]');
    if (btn) btn.classList.toggle("is-set", !!isSet);
    var lbl = document.getElementById(forId + "-label");
    if (lbl) lbl.textContent = t(text);
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
      media.innerHTML = '<div class="pf-pv-empty">' + t("動画を選ぶと") + "<br>" + t("ここに大きく表示されます") + "</div>";
    }
    if (pendingImage) { icon.src = pendingImage; icon.hidden = false; }
    else { icon.removeAttribute("src"); icon.hidden = true; }
  }

  // 動画ボタンのラベルを「いまの状態」に合わせて戻す（エディタをキャンセルした時などに使う）
  function refreshVideoBtn() {
    var has = !!pendingVideoBlob;
    setUploadState("pf-video", has ? "動画を変更" : "動画を選ぶ", has);
  }

  // ---------- 動画ファイルの検査（<input> でもネイティブピッカーでも共通）----------
  // 長さを確認したら、そのままエディタ（トリミング・向き調整）を開く。
  function processVideoFile(f) {
    var verr = document.getElementById("pf-video-err");
    if (verr) verr.hidden = true;
    if (!f) {
      if (pendingVideoUrl) { try { URL.revokeObjectURL(pendingVideoUrl); } catch (e) {} pendingVideoUrl = null; }
      pendingVideoName = ""; pendingVideoBlob = null;
      showVideoSize(0);
      setUploadState("pf-video", "動画を選ぶ", false);
      updatePreview();
      return;
    }
    // 長さ3秒までを検査（メタデータだけ読む）
    var probeUrl = URL.createObjectURL(f);
    var probe = document.createElement("video");
    probe.preload = "metadata";
    probe.onloadedmetadata = function () {
      var d = probe.duration;
      try { URL.revokeObjectURL(probeUrl); } catch (e) {}
      if (isFinite(d) && d > 3.3) { // 3秒まで（エンコード誤差を少し許容）
        if (verr) { verr.textContent = t("動画は3秒までです（選んだ動画は約") + d.toFixed(1) + t("秒）。"); verr.hidden = false; }
        refreshVideoBtn(); // いまの動画（あれば）はそのまま残す
        return;
      }
      openVideoEditor(f); // 長さOK → 見せ方を調整してから書き出し
    };
    probe.onerror = function () {
      try { URL.revokeObjectURL(probeUrl); } catch (e) {}
      if (verr) { verr.textContent = t("この動画を読み込めませんでした。別の動画をお試しください。"); verr.hidden = false; }
      refreshVideoBtn();
    };
    probe.src = probeUrl;
  }

  // エディタで決めた枠（transform）で低画質・低ビットレートに書き出し、プレビュー・保存に使う。
  function finishVideo(file, transform) {
    pendingVideoName = file.name || "video";
    setUploadState("pf-video", "動画を処理中…", true);
    var opts = { maxDim: 640, bitrate: 900000 };
    if (transform) opts.frame = { outW: VIDEO_OUT_W, outH: VIDEO_OUT_H, transform: transform };
    compressVideo(file, opts, function (blob) {
      // 通常は「軽くなった時だけ」採用。ただし枠を焼き込む時は blob 側が正しい見た目なので優先。
      var use = (blob && blob.size > 0 && blob.size < file.size) ? blob : file;
      if (transform && blob && blob.size > 0) use = blob;
      if (pendingVideoUrl) { try { URL.revokeObjectURL(pendingVideoUrl); } catch (e) {} }
      pendingVideoBlob = use;
      pendingVideoUrl = URL.createObjectURL(use);
      showVideoSize(use.size, use !== file);
      setUploadState("pf-video", "動画を変更", true);
      updatePreview();
    });
  }

  // ---------- 動画エディタ（トリミング・向き調整）----------
  function openVideoEditor(file) {
    var ov = document.getElementById("videoEditor");
    var canvas = document.getElementById("veCanvas");
    if (!ov || !canvas || !canvas.getContext) { finishVideo(file, null); return; } // UI が無ければ従来どおり
    var ctx = canvas.getContext("2d");
    var url = URL.createObjectURL(file);
    var video = document.createElement("video");
    video.muted = true; video.loop = true; video.playsInline = true;
    video.setAttribute("playsinline", ""); video.preload = "auto"; video.src = url;

    var st = { rotation: 0, zoom: 1, fit: "cover", offsetX: 0, offsetY: 0 };
    var alive = true, raf = 0;
    function loop() {
      if (!alive) return;
      try { drawFramed(ctx, video, canvas.width, canvas.height, st); } catch (e) {}
      raf = requestAnimationFrame(loop);
    }
    var fitBtn = document.getElementById("veFit");
    var zoomInput = document.getElementById("veZoom");
    function syncTools() {
      if (fitBtn) fitBtn.textContent = t(st.fit === "contain" ? "切り抜き" : "全体を表示");
      if (zoomInput) zoomInput.value = String(st.zoom);
    }
    video.onloadedmetadata = function () {
      // 横長の動画は既定で「全体を表示」＝端が切れない。縦・正方形は「切り抜き」で大きく。
      st.fit = (video.videoWidth > video.videoHeight * 1.05) ? "contain" : "cover";
      syncTools();
      var p = video.play(); if (p && p.catch) p.catch(function () {});
      loop();
    };

    veState = {
      file: file, url: url, video: video, st: st,
      stop: function () {
        alive = false;
        if (raf) { try { cancelAnimationFrame(raf); } catch (e) {} }
        try { video.pause(); } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
      }
    };
    syncTools();
    openOverlay(ov);
  }

  // エディタを閉じる（決定 or キャンセル）。commit=true なら書き出しへ。
  function closeVideoEditor(commit) {
    var ov = document.getElementById("videoEditor");
    var state = veState; veState = null;
    if (ov) closeOverlay(ov);
    if (!state) return;
    var file = state.file, st = state.st;
    state.stop();
    if (commit) {
      finishVideo(file, { rotation: st.rotation, zoom: st.zoom, fit: st.fit, offsetX: st.offsetX, offsetY: st.offsetY });
    } else {
      refreshVideoBtn(); // 元の状態に戻す
    }
  }

  // ---------- ネイティブ（Capacitor）の写真ライブラリ専用ピッカー ----------
  // アプリ内では <input type=file> を使わず、カメラを一切出さないネイティブピッカーで選ばせる。
  // Web（Safari等）では Capacitor が無いので、従来の <input type=file> にフォールバックする。
  function isNativeApp() {
    return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
  }
  function getFilePicker() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.FilePicker) || null;
  }
  function base64ToBlob(b64, type) {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || "application/octet-stream" });
  }
  // 画像を選び終えたあとの共通処理（縮小して pending に格納）
  function applyPickedImageDataUrl(slot, dataUrl) {
    downscaleFromDataUrl(dataUrl, 512, function (scaled) {
      if (slot === "pf-image2") pendingImage2 = scaled || null;
      else pendingImage = scaled || null;
      setUploadState(slot, scaled ? "画像を変更" : "画像を選ぶ", !!scaled);
      updatePreview();
    });
  }
  function pickImageNative(slot) {
    var FP = getFilePicker();
    if (!FP) return;
    FP.pickImages({ limit: 1, readData: true }).then(function (res) {
      var f = res && res.files && res.files[0];
      if (!f || !f.data) return;
      applyPickedImageDataUrl(slot, "data:" + (f.mimeType || "image/jpeg") + ";base64," + f.data);
    }).catch(function () { /* キャンセル等は無視 */ });
  }
  function pickVideoNative() {
    var FP = getFilePicker();
    if (!FP) return;
    FP.pickVideos({ limit: 1, readData: true }).then(function (res) {
      var f = res && res.files && res.files[0];
      if (!f || !f.data) return;
      var blob = base64ToBlob(f.data, f.mimeType || "video/mp4");
      var name = f.name || "video.mp4";
      var file;
      try { file = new File([blob], name, { type: blob.type }); }
      catch (e) { file = blob; } // File 未対応環境の保険（Blob をそのまま使う）
      processVideoFile(file);
    }).catch(function () {});
  }
  // 「選ぶ」ラベルのタップをネイティブピッカーに差し替える（Web は既定の <input> 動作のまま）
  function wireNativePickers() {
    if (!isNativeApp()) return; // Web では何もしない
    [["pf-image", "image"], ["pf-image2", "image2"], ["pf-video", "video"]].forEach(function (pair) {
      var label = document.querySelector('label[for="' + pair[0] + '"]');
      if (!label) return;
      label.addEventListener("click", function (e) {
        if (!getFilePicker()) return; // プラグイン未導入なら従来の <input> にフォールバック
        e.preventDefault();
        if (pair[1] === "video") pickVideoNative();
        else pickImageNative(pair[0]);
      });
    });
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
    // その他・回答しない・未選択 → 男女を半々で交互に見せる
    if (!pSame) return interleaveByGender(list);
    return list.slice().map(function (u) {
      var same = u.gender === myGender;
      var w = same ? pSame : (1 - pSame);
      return { u: u, k: Math.random() * (w + 0.0001) };
    }).sort(function (a, b) { return b.k - a.k; }).map(function (x) { return x.u; });
  }
  // 男女を交互に並べ、スワイプ欄に半々で出す（その他・回答しない のユーザー向け）。
  function interleaveByGender(list) {
    function shuf(a) {
      return a.map(function (u) { return { u: u, k: Math.random() }; })
        .sort(function (x, y) { return x.k - y.k; }).map(function (x) { return x.u; });
    }
    var males = shuf(list.filter(function (u) { return u.gender === "male"; }));
    var females = shuf(list.filter(function (u) { return u.gender === "female"; }));
    var rest = shuf(list.filter(function (u) { return u.gender !== "male" && u.gender !== "female"; }));
    var out = [];
    var n = Math.max(males.length, females.length);
    for (var i = 0; i < n; i++) {
      // どちらを先に出すかは毎回ランダム（先頭の偏りをなくす）
      var pair = Math.random() < 0.5 ? [males[i], females[i]] : [females[i], males[i]];
      if (pair[0]) out.push(pair[0]);
      if (pair[1]) out.push(pair[1]);
    }
    return out.concat(rest);
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
    // アプリ（app.html）はデモ用モックユーザーを出さない（?demo でも空）。
    // モックは config.js を読まない紹介ページ（ランディング）のスワイプ体験デモ専用。
    var demoUsers = window.LOGSWAP_CONFIG ? [] : (window.MOCK_USERS || []);
    users = demoUsers.filter(function (u) { return !isBlocked(u.id); });
    users = applyFilter(users);
    users = orderByGender(users, prof.gender);
    users = orderByBoost(users);
    users = interleaveAds(users);
    index = 0;
  }
  // フィルタ/ブースト/課金の変更時：デッキだけ組み直す（成立相手は消さない）
  function rebuildDeck() {
    if (BE) { refreshDeck(); renderChat(); return; }
    buildDeck(); render(); renderChat();
  }

  // ---------- 初期化 ----------
  function init() {
    matches = [];
    convos = {};
    threadUser = null;
    coachShown = false;
    if (BE) { initBackend(); return; }
    buildDeck();
    // app.html では初回（プロフィール未登録）はプロフ入力から入る
    var gate = document.getElementById("profileSetup");
    if (gate && !getProfile()) { showSetupGate(); return; }
    setAppGated(false);
    render();
    showView("swipe");
    renderChat();
    updateTabIndicators();
  }

  // 新規プロフィール入力ゲートを表示（ハンドルID設定可・招待チップ空・同意欄あり）
  function showSetupGate() {
    setHandleLocked(false);
    setProfileFormMode(false);
    pendingInvites = []; renderInviteChips();
    var iin = document.getElementById("pf-invite-input"); if (iin) iin.value = "";
    setAppGated(true);
  }

  // バックエンド接続時の起動：匿名ログイン → 自分のプロフィール → 成立相手 → デッキ
  function initBackend() {
    Backend.init().then(function () {
      return Backend.getMyProfile();
    }).then(function (profile) {
      if (profile && profile.name) {
        saveProfile(profile);   // localStorage を実データのミラーに（同期コードが getProfile を使うため）
      } else {
        try { localStorage.removeItem(PROFILE_KEY); } catch (e) {}
        showSetupGate();
        throw "gate";           // デッキ読込をスキップ
      }
      return hydrateMatches();
    }).then(function () {
      if (matchSub) { try { matchSub(); } catch (e) {} } // 退会後の再ログイン等で貼り直す
      matchSub = Backend.subscribeMatches(handleNewMatch);
      setAppGated(false);
      showView("swipe");
      renderChat();
      updateTabIndicators();
      return refreshDeck();
    }).catch(function (e) {
      if (e === "gate") return;
      console.error("backend init error", e);
      if (!getProfile()) { showSetupGate(); return; }
      setAppGated(false); showView("swipe"); renderChat(); updateTabIndicators();
    });
  }

  // 新しい成立が realtime で届いたとき（先にいいねした側もここで気づける）
  var matchSub = null;
  function handleNewMatch(row) {
    if (!row) return;
    var otherId = row.user_a === Backend.userId ? row.user_b : row.user_a;
    if (!otherId) return;
    convo(otherId).matchId = row.id;
    if (matches.some(function (m) { return m.id === otherId; })) { renderChat(); return; }
    Backend.getProfileById(otherId).then(function (u) {
      if (!u || matches.some(function (m) { return m.id === u.id; })) return;
      u.matchId = row.id;
      registerMatch(u);
    }).catch(function (e) { console.error("new match load failed", e); });
  }
  // 成立相手をサーバーから読み込み matches / convos に反映
  function hydrateMatches() {
    return Backend.listMatches().then(function (list) {
      matches = list.slice();
      list.forEach(function (u) {
        var c = convo(u.id);
        c.matchId = u.matchId;
        if (!c.matchedAt) c.matchedAt = Date.now();
      });
    });
  }

  // スワイプ配信をサーバーから取得して差し替え（プレミアムはしぼり込み条件を反映）
  function refreshDeck() {
    var s = getState();
    var f = isSub() ? { pref: s.fltPref || "", gender: s.fltGender || "" } : {};
    return Backend.getSwipeQueue(50, f).then(function (list) {
      users = interleaveAds(list.filter(function (u) { return !isBlocked(u.id); }));
      index = 0;
      render();
    }).catch(function (e) { console.error("deck load failed", e); users = []; index = 0; render(); });
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
    renderMyAvatar();
    renderSwipeBoost();
    var searchBtn = document.getElementById("searchBtn");
    if (searchBtn) searchBtn.hidden = gated;
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
    if (name === "swipe") renderSwipeBoost();
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
        ? '<p class="chat-empty">' + t("上の相手をタップするとトークを始められます。") + "</p>"
        : '<p class="chat-empty">' + t("ログを交換すると、ここに相手が表示されます。") + "</p>";
      return;
    }
    list.innerHTML = active.slice().reverse().map(function (u) {
      var c = convo(u.id);
      var last = c.msgs.length ? c.msgs[c.msgs.length - 1] : null;
      var lastText = last ? (last.kind === "stamp" ? last.body : esc(last.body)) : t("トーク中");
      return '<button class="chat-row" type="button" data-id="' + u.id + '">' +
        '<img class="chat-av" src="' + photoUrl(u.photo, 96, 96) + '" alt="" />' +
        '<span class="chat-meta"><span class="chat-name">' + esc(u.name) +
        (c.revealed ? ' <span class="chat-idok">' + t("ID交換済") + "</span>" : "") + "</span>" +
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
  var BOLT_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" class="ico-bolt" aria-hidden="true"><path d="M13 3L5 13h5l-1 8 8-11h-5z" fill="#f5b301"/></svg>';

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
    if (BE) hydrateThread(user);
    renderThread(user);
    updateTabIndicators();
    renderChat();
    openOverlay(document.getElementById("threadOverlay"));
  }

  // 独自スタンプ（システム絵文字ではなく手描き風SVG。Setlogのかわいい雰囲気に寄せる）
  var STAMP_SVGS = {
    yes: '<svg viewBox="0 0 64 64" class="stk" aria-hidden="true"><path d="M32 53C15 40 10 27 19 19c5-4.4 11-2 13 3.4C34 17 40 14.6 45 19c9 8 4 21-13 34z" fill="#fb6f63"/><circle cx="26" cy="29" r="2.6" fill="#3a2b28"/><circle cx="38" cy="29" r="2.6" fill="#3a2b28"/><path d="M27 35q5 4 10 0" fill="none" stroke="#3a2b28" stroke-width="2.6" stroke-linecap="round"/></svg>',
    no: '<svg viewBox="0 0 64 64" class="stk" aria-hidden="true"><circle cx="32" cy="33" r="22" fill="#b8d0ea"/><circle cx="25" cy="32" r="2.7" fill="#3a2b28"/><circle cx="39" cy="32" r="2.7" fill="#3a2b28"/><path d="M25 42q7 -5 14 0" fill="none" stroke="#3a2b28" stroke-width="2.7" stroke-linecap="round"/><ellipse cx="47" cy="23" rx="2.2" ry="3.3" fill="#7fb0dd"/></svg>',
    smile: '<svg viewBox="0 0 64 64" class="stk" aria-hidden="true"><circle cx="32" cy="32" r="23" fill="#f6eccf"/><circle cx="24" cy="30" r="2.8" fill="#3a2b28"/><circle cx="40" cy="30" r="2.8" fill="#3a2b28"/><path d="M24 38q8 6 16 0" fill="none" stroke="#3a2b28" stroke-width="2.8" stroke-linecap="round"/><circle cx="18.5" cy="36" r="3.1" fill="#f4a7bd" opacity=".75"/><circle cx="45.5" cy="36" r="3.1" fill="#f4a7bd" opacity=".75"/></svg>'
  };
  function stampSvg(key) { return STAMP_SVGS[key] || esc(key); } // 旧データ（絵文字）は素通しで表示

  function renderThread(user) {
    var c = convo(user.id);
    var log = document.getElementById("threadLog");
    if (log) {
      if (!c.msgs.length) {
        log.innerHTML = '<p class="thread-hint">' + t("定型文やスタンプであいさつしてみましょう。") + "</p>";
      } else {
        log.innerHTML = c.msgs.map(function (m) {
          var cls = "bubble " + (m.from === "me" ? "me" : "them") + (m.kind === "stamp" ? " is-stamp" : "");
          return '<div class="' + cls + '">' + (m.kind === "stamp" ? stampSvg(m.body) : esc(m.body)) + "</div>";
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

    if (c.revealed || c.theirId) {
      // 自分が公開した／相手から受け取った招待IDを表示（両方ありうる）
      bar.hidden = false;
      bar.className = "idx-bar revealed";
      var html = "";
      if (c.revealed) html +=
        '<div class="idx-done">' + KEY_SVG + t(" IDを公開しました") + "</div>" +
        '<div class="idx-pair"><span class="idx-label">' + t("あなたの招待ID") + '</span><span class="idx-val">' + esc(c.myGivenId || "") + "</span></div>";
      if (c.theirId) html +=
        '<div class="idx-pair"><span class="idx-label">' + t("相手の招待ID") + '</span><span class="idx-val">' + esc(c.theirId) + "</span></div>";
      // 相手からもらったが自分はまだ、のときは「自分も公開」ボタン
      if (BE && !c.revealed && c.theirId && availableInviteCount() > 0)
        html += '<div class="idx-btns"><button class="idx-btn" id="idxBtn" type="button">' + KEY_SVG + " " + t("自分のIDも公開する") + "</button></div>";
      bar.innerHTML = html;
      var rb = document.getElementById("idxBtn");
      if (rb) rb.onclick = function () { confirmIdExchange(user); };
      return;
    }
    // 公開できる招待IDが尽きていたら、ここで1つ追加できる（プロフィールと共有）
    // ただし、やりとりが1往復終わるまでは案内（警告）を出さない。
    if (myTurns >= 1 && availableInviteCount() === 0) {
      bar.hidden = false;
      bar.className = "idx-bar addid";
      bar.innerHTML =
        '<span class="idx-wait">' + t("公開できる招待IDがありません。ここで追加できます。") + "</span>" +
        '<div class="idx-add"><input class="idx-add-input" id="idxAddInput" type="text" autocomplete="off" placeholder="' + t("Setlogの招待ID") + '" />' +
        '<button class="idx-add-btn" id="idxAddBtn" type="button">' + t("追加") + "</button></div>";
      var addBtn = document.getElementById("idxAddBtn");
      var addIn = document.getElementById("idxAddInput");
      var doAdd = function () { if (addIn && addIn.value.trim()) addInviteFromThread(user, addIn.value); };
      if (addBtn) addBtn.onclick = doAdd;
      if (addIn) addIn.onkeydown = function (e) { if (e.key === "Enter") { e.preventDefault(); doAdd(); } };
      return;
    }
    if (c.requested) {
      // あなたが交換を求めた → 相手も乗り気の表示 → OKで自分のIDを公開
      bar.hidden = false;
      bar.className = "idx-bar ready";
      bar.innerHTML =
        '<span class="idx-cap idx-cap-strong">' + esc(user.name) + t("さんも交換したがっています！") + "</span>" +
        '<div class="idx-btns"><button class="idx-btn" id="idxOkBtn" type="button">' + KEY_SVG + t(" OK（IDを公開）") + "</button></div>" +
        '<span class="idx-cap">' + t("OKすると、あなたの招待IDが1つ相手へ渡されます") + "</span>";
      var ok = document.getElementById("idxOkBtn");
      if (ok) ok.onclick = function () { confirmIdExchange(user); };
      return;
    }
    if (myTurns < need) {
      bar.hidden = false;
      bar.className = "idx-bar wait";
      bar.innerHTML = '<span class="idx-wait">' + t("あと") + (need - myTurns) + t("回やりとりすると、ID交換できます") + "</span>";
      return;
    }
    // 「IDを交換しますか？」ボタン。上限(MAX)に達したら解除も出す。
    var max = CONFIG.MSG_MAX_TURNS || 10;
    var capped = myTurns >= max;
    bar.hidden = false;
    bar.className = "idx-bar ready" + (capped ? " capped" : "");
    bar.innerHTML =
      (capped ? '<span class="idx-cap idx-cap-strong">' + t("往復の上限です。交換するか、解除してください。") + "</span>" : "") +
      '<div class="idx-btns">' +
        '<button class="idx-btn" id="idxBtn" type="button">' + KEY_SVG + t(" IDを交換しますか？") + "</button>" +
        (capped ? '<button class="idx-unmatch" id="idxUnmatch" type="button">' + t("解除する") + "</button>" : "") +
      "</div>";
    var btn = document.getElementById("idxBtn");
    // バックエンドは相手の自動同意が無いので、押したら自分のIDを直接公開する
    if (btn) btn.onclick = function () { if (BE) confirmIdExchange(user); else requestIdExchange(user); };
    var un = document.getElementById("idxUnmatch");
    if (un) un.onclick = function () { askUnmatch(user); };
  }

  // トークからSetlog招待IDを1つ追加（プロフィールの履歴と共有）。使用済みも保持。
  function addInviteFromThread(user, code) {
    code = String(code).trim();
    if (!code) return;
    var prof = getProfile() || {};
    var invites = getInviteIds(prof);
    if (invites.some(function (x) { return x.code === code; })) { renderThread(user); return; } // 重複
    invites.push({ code: code, usedWith: null });
    prof.inviteIds = invites;
    saveProfile(prof);
    if (BE) Backend.saveProfile(prof, {}).catch(function (e) { console.error("invite save failed", e); });
    renderThread(user); // 追加後は交換ボタンが出る
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
    if (BE) {
      if (!c.matchId) return;
      var finalize = function () {
        slot.usedWith = user.id;
        prof.inviteIds = invites;
        saveProfile(prof);                        // localStorage ミラー
        c.revealed = true; c.myGivenId = slot.code;
        renderThread(user); renderChat();
        Backend.saveProfile(prof, {}).catch(function (e) { console.error("invite persist failed", e); }); // 使用済みをDBに反映
      };
      Backend.revealInvite(c.matchId, slot.code).then(finalize).catch(function (e) {
        if (e && e.code === "23505") finalize(); // 既に公開済み＝成功扱い（使い切りはPKで担保）
        else console.error("reveal failed", e);
      });
      return;
    }
    slot.usedWith = user.id;                    // 使い切り：二度と送信されない
    prof.inviteIds = invites;
    saveProfile(prof);
    c.revealed = true;
    c.myGivenId = slot.code;
    c.msgs.push({ from: "them", kind: "text", body: "ありがとう！受け取りました！" });
    renderThread(user);
    renderChat();
  }

  // バックエンド接続時：トークを開いたら過去メッセージ＋公開状態を読み、新着を購読
  function rowToMsg(row) {
    return {
      id: row.id, from: row.sender === Backend.userId ? "me" : "them",
      kind: row.kind, body: row.body, ts: Date.parse(row.created_at || "") || 0
    };
  }
  function sortMsgs(c) { c.msgs.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); }); }

  function hydrateThread(user) {
    var c = convo(user.id);
    if (!c.matchId || c._hydrated) return;
    c._hydrated = true;
    c.seen = c.seen || {};
    // 先に購読してから履歴を読む（取得中に届いた新着を取りこぼさず、seenも消さない）
    c._unsub = Backend.subscribeMessages(c.matchId, function (row) { appendServerMsg(user, row); });
    Backend.listMessages(c.matchId).then(function (rows) {
      rows.forEach(function (row) {
        if (c.seen[row.id]) return;   // realtimeで既に入った分は重複させない
        c.seen[row.id] = 1;
        c.msgs.push(rowToMsg(row));
      });
      sortMsgs(c);
      if (threadUser === user) renderThread(user);
      updateTabIndicators();
    }).catch(function (e) { console.error("load messages failed", e); });
    Backend.getReveals(c.matchId).then(function (r) {
      if (r.mine) { c.revealed = true; c.myGivenId = r.mine; }
      if (r.theirs) c.theirId = r.theirs;
      if (threadUser === user) renderThread(user);
    }).catch(function () {});
  }
  function appendServerMsg(user, row) {
    var c = convo(user.id);
    c.seen = c.seen || {};
    if (c.seen[row.id]) return;
    c.seen[row.id] = 1;
    c.msgs.push(rowToMsg(row));
    sortMsgs(c);
    if (threadUser === user) renderThread(user);
    updateTabIndicators();
    var chat = document.getElementById("view-chat");
    if (chat && !chat.hidden) renderChat();
  }

  function sendToThread(user, kind, body) {
    var c = convo(user.id);
    // ID交換前の往復上限に達していたら送らない（入力は無効化済みだが二重の保険）
    var myTurns = c.msgs.filter(function (m) { return m.from === "me"; }).length;
    if (!c.revealed && myTurns >= (CONFIG.MSG_MAX_TURNS || 10)) return;
    if (BE) {
      if (!c.matchId) return;
      Backend.sendMessage(c.matchId, kind, body).catch(function (e) { console.error("send failed", e); });
      return; // 自分の送信も realtime で届くのでローカル追加はしない（重複防止）
    }
    c.msgs.push({ from: "me", kind: kind, body: body });
    renderThread(user);
    updateTabIndicators(); // 送信したのでトークタブのバッジを更新
    // 擬似返信（デモ。実運用では相手の実メッセージに置き換え）
    setTimeout(function () {
      if (threadUser !== user) return;
      var stamps = ["smile", "yes"];
      var phrases = ["いいですね！", "こちらこそ！", "ありがとうございます！", "楽しみです"];
      var useStamp = Math.random() < 0.5;
      c.msgs.push(useStamp
        ? { from: "them", kind: "stamp", body: stamps[Math.floor(Math.random() * stamps.length)] }
        : { from: "them", kind: "text", body: phrases[Math.floor(Math.random() * phrases.length)] });
      renderThread(user);
      renderChat();
    }, 650);
  }

  // 交換の解除は「はい／いいえ」で確認してから実行する
  var pendingUnmatch = null;
  function askUnmatch(user) {
    if (!user) return;
    pendingUnmatch = user;
    openOverlay(document.getElementById("unmatchOverlay"));
  }
  // 交換を解除（＝トーク枠が1つ空く）
  function unmatchThread(user) {
    var c = convos[user.id];
    if (BE && c && c.matchId) {
      if (c._unsub) { try { c._unsub(); } catch (e) {} } // realtime購読を解除
      Backend.deleteMatch(c.matchId).catch(function (e) { console.error("unmatch failed", e); });
    }
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
  // スワイプ上限：LogSwap Premier のフルスクリーン案内を出す
  function showSwipeLimit() {
    var ov = document.getElementById("promoOverlay");
    if (!ov) return;
    var canAd = swipeAdLeft() > 0;
    var add = CONFIG.SWIPE_AD_ADD || 5;

    var price = document.getElementById("promoPrice");
    if (price) price.textContent = subPrice();

    var isEn = !!(window.I18N && I18N.lang === "en");
    var adBtn = document.getElementById("promoWatchAd");
    if (adBtn) {
      adBtn.textContent = isEn
        ? "Watch ad (+" + add + " swipes)"
        : "広告を見る（＋" + add + "スワイプ）";
      adBtn.hidden = !canAd;
      adBtn.onclick = function () {
        closeOverlay(ov);
        Ads.showRewarded(function () { if (addSwipeAd()) render(); });
      };
    }
    var adNote = document.getElementById("promoAdNote");
    if (adNote) adNote.hidden = canAd;

    var sub = document.getElementById("promoSubscribe");
    if (sub) sub.onclick = function () { closeOverlay(ov); subscribe(); };

    var x = document.getElementById("promoClose");
    if (x) x.onclick = function () { closeOverlay(ov); };

    openOverlay(ov);
  }
  function showSlotLimit() {
    var canAd = msgAdLeft() > 0;
    showLimit({
      title: "トークできる人数の上限です",
      sub: canAd
        ? "動画広告を1回見ると" + (CONFIG.MSG_AD_SLOTS || 3) + "枠を" + (CONFIG.MSG_AD_HOURS || 24) +
          "時間ふやせます（今日あと" + msgAdLeft() + "回）。誰かとの交換を解除しても空きます。プレミアムなら無制限です。"
        : "今日はこれ以上ふやせません。交換を解除すると空きます。プレミアムなら無制限です。",
      actions: [
        { label: "動画広告で" + (CONFIG.MSG_AD_SLOTS || 3) + "枠ふやす（無料）", primary: true, disabled: !canAd,
          onClick: function () { Ads.showRewarded(function () { addMsgAd(); renderChat(); }); } },
        { label: t("プレミアムに加入（") + (CONFIG.PRICE_SUB_MONTH || "") + t("／月）"), onClick: function () { subscribe(); } }
      ]
    });
  }

  // 購入を開始できないとき（商品情報が未取得・ストア未設定など）に必ず画面へ通知する。
  // ＝ボタンを押しても無反応、という状態を作らない（App Store審査 2.1(a) 対策）。
  var SUPPORT_EMAIL = "tomokiskriiiabc@gmail.com";
  function notifyPurchaseUnavailable() {
    showLimit({
      title: t("いま購入を開始できません"),
      sub: t("時間をおいて、もう一度お試しください。解決しない場合は下記までご連絡ください。") + "\n" + SUPPORT_EMAIL,
      actions: [{ label: t("閉じる"), primary: true, onClick: function () {} }]
    });
  }

  // 課金：加入（上限案内から。既定は月額プラン扱い）。購入はIAPレイヤ経由。
  // 加入状態はここで決め打ちせず、ストアが返す「現在有効な購読」を applySubState で反映する。
  function subscribe() { Purchases.buy("sub_month", null, notifyPurchaseUnavailable); }

  // ストアの購読状態をアプリへ反映（購入/復元/期限切れ/起動時の同期の唯一の入口）。
  // 実課金では Purchases.init のコールバックから、デモでは buy() から呼ばれる。
  function applySubState(active) {
    var s = getState();
    active = !!active;
    if (!!s.sub === active) return;            // 変化なしなら何もしない
    s.sub = active;
    if (active && !s.subPlan) s.subPlan = "month";
    saveState(s);
    rebuildDeck(); renderProfile();
  }
  // 消耗型ブーストが1個付与されたとき（購入検証 or デモ）。
  function grantBoost() { addBoostItem(); renderSwipeBoost(); renderPremium(); }

  // 表示価格：ストアのローカライズ価格が取れればそれを、無ければ config の表示値を使う。
  function subPrice() { return (Purchases.priceOf && Purchases.priceOf("sub_month")) || CONFIG.PRICE_SUB_MONTH || ""; }
  function boostPrice() { return (Purchases.priceOf && Purchases.priceOf("boost")) || CONFIG.PRICE_BOOST || ""; }
  // タブのインジケータ：チャットの赤い点＋「いいねされた人数」の赤い数字
  function updateTabIndicators() {
    var badge = document.getElementById("chatBadge");
    // 成立したのに自分がまだトークを送っていない相手の人数
    var untalked = matches.filter(function (m) {
      var c = convos[m.id];
      return !c || !c.msgs.some(function (msg) { return msg.from === "me"; });
    }).length;
    if (badge) {
      if (untalked > 0) { badge.hidden = false; badge.textContent = untalked; }
      else badge.hidden = true;
    }
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
    var tags = (p.tags || []).map(function (tg) {
      return '<span class="tag">#' + esc(t(tg)) + "</span>";
    }).join("");
    box.innerHTML =
      '<div class="ps-card">' +
        av +
        '<div class="ps-name">' + esc(p.name || t("未設定")) + "</div>" +
        (p.handle ? '<div class="ps-handle">' + esc(p.handle) + "</div>" : "") +
        (p.bio ? '<div class="ps-bio">' + esc(p.bio) + "</div>" : "") +
        '<div class="ps-meta">' + (p.pref ? esc(t(p.pref)) : t("地域未設定")) + "</div>" +
        (tags ? '<div class="ps-tags">' + tags + "</div>" : "") +
        (p.image2 ? '<img class="ps-sub" src="' + p.image2 + '" alt="サブ画像" />' : "") +
        '<div class="ps-note">' + t("ログの動画：") + (p.videoName ? t("設定済み") : t("未設定")) + "</div>" +
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
    // 価格をボタンへ流し込む（ストアの実価格を優先、無ければconfigの表示値）
    var mBtn = document.getElementById("subMonthBtn");
    if (mBtn) mBtn.textContent = t("プレミアムに加入（") + subPrice() + t("／月）");
    var boostLabel = document.getElementById("boostLabel");
    if (boostLabel) boostLabel.textContent = t("ブーストを買う（") + boostPrice() + t("）");

    if (state) {
      state.textContent = sub ? t("加入中（月額）") : t("未加入");
      state.classList.toggle("on", sub);
    }
    if (plans) plans.hidden = sub;   // 加入中はプラン選択を隠し、解約ボタンを出す
    if (cancel) {
      cancel.hidden = !sub;
      // 実課金ではアプリ内解約は不可＝ストアの管理画面へ誘導。デモは即解約。
      cancel.textContent = (Purchases.isNative && Purchases.isNative()) ? t("サブスクを管理") : t("解約する（デモ）");
    }
    if (filter) filter.hidden = !sub;
    var fg = document.getElementById("flt-gender"); if (fg) fg.value = s.fltGender || "";
    var fp = document.getElementById("flt-pref"); if (fp) fp.value = s.fltPref || "";
    var note = document.getElementById("boostNote");
    if (note) {
      if (boostActive()) {
        var mins = Math.max(1, Math.round((getState().boostUntil - Date.now()) / 60000));
        note.hidden = false; note.innerHTML = BOLT_SVG + " ブースト中（あと約" + mins + "分）";
      } else if (boostOwnedCount() > 0) {
        note.hidden = false;
        note.innerHTML = BOLT_SVG + " ブースト所持：" + boostOwnedCount() + "個（スワイプ画面の右上から使えます）";
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
    var bioEl = document.getElementById("pf-bio"); if (bioEl) bioEl.value = p.bio || "";
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
    if (BE && Backend.deleteAccount) {
      Backend.deleteAccount().catch(function (e) { console.error("delete failed", e); }).then(localDeleteReset);
      return;
    }
    localDeleteReset();
  }
  function localDeleteReset() {
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
          '<div class="card-id-row">' +
            '<img class="card-avatar" src="' + photoUrl(user.photo, 120, 120) + '" alt="" />' +
            '<h3 class="card-name">' + esc(user.name) + "</h3>" +
          "</div>" +
          (user.bio ? '<p class="card-bio">' + esc(user.bio) + "</p>" : "") +
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
    // 飛ばす向きのスタンプを出す（ボタン操作でも「選んだ」感と流れる余韻を出す）
    var stamp = card.querySelector(choice === "yes" ? ".stamp-yes" : ".stamp-no");
    if (stamp) stamp.style.opacity = 1;
    card.dataset.dir = choice;
    card.classList.add("leaving");
    var fly = reduceMotion ? 0 : 1;
    card.style.transform = "translate(" + (dir * 520 * fly) + "px," + (60 * fly) +
      "px) rotate(" + (dir * 24 * fly) + "deg)";
    card.style.opacity = "0";

    index++;
    // 飛び切るアニメ（CSS 0.5s）を最後まで見せてから次のカードへ差し替える
    var delay = reduceMotion ? 0 : 520;
    setTimeout(function () {
      render();
      if (choice !== "yes" || user.__ad) return;
      if (BE) {
        Backend.like(user.id).then(function (r) {
          if (r.matched) { user.matchId = r.matchId; registerMatch(user); }
        }).catch(function (e) { console.error("like failed", e); });
      } else if (user.likesBack) {
        registerMatch(user);
      }
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
  var OVERLAY_IDS = ["promoOverlay", "filterOverlay", "boostOverlay", "limitOverlay", "unmatchOverlay", "deleteOverlay", "blockOverlay", "reportOverlay", "policyOverlay",
    "termsOverlay", "previewOverlay", "logViewer", "threadOverlay", "matchOverlay", "videoEditor"];

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
    if (user.matchId) c.matchId = user.matchId;
    if (!c.matchedAt) c.matchedAt = Date.now();
    fillSlots(); // 枠が空いていれば自動でトーク一覧へ。無ければモザイクで待機。
    showMatch(user);
    renderChat();
    updateTabIndicators();
  }

  function showMatch(user) {
    var overlay = document.getElementById("matchOverlay");
    document.getElementById("matchSub").textContent =
      esc(user.name) + t(" さんとログを交換しました！");
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
      '<div class="viewer-vibe">' + (user.pref ? esc(t(user.pref)) : "") +
        (user.vibe ? "・" + esc(user.vibe) : "") + "</div></div>";
    var tags = (user.tags || []).map(function (tg) {
      return '<span class="tag">#' + esc(t(tg)) + "</span>";
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

  // 英語表示のときは「都道府県」の選択を「国名」に差し替える（海外ユーザー向け）
  var COUNTRIES_EN = ["United States", "United Kingdom", "Canada", "Australia", "Japan", "China",
    "South Korea", "Taiwan", "Hong Kong", "Singapore", "India", "Indonesia", "Philippines", "Thailand",
    "Vietnam", "Malaysia", "Germany", "France", "Italy", "Spain", "Netherlands", "Sweden", "Switzerland",
    "Poland", "Russia", "Brazil", "Mexico", "Argentina", "Turkey", "Saudi Arabia", "United Arab Emirates",
    "Egypt", "South Africa", "New Zealand", "Ireland", "Norway", "Denmark", "Finland", "Portugal", "Greece",
    "Austria", "Belgium", "Czechia", "Ukraine", "Nigeria", "Kenya", "Colombia", "Chile", "Peru", "Other"];
  function localizeRegionSelect() {
    if (!window.I18N || window.I18N.lang !== "en") return;
    var sel = document.getElementById("pf-pref");
    if (!sel) return;
    var head = '<option value="">' + window.I18N.t("選択してください") + "</option>" +
               '<option value="">' + window.I18N.t("選択しない") + "</option>";
    sel.innerHTML = head + COUNTRIES_EN.map(function (c) { return "<option>" + c + "</option>"; }).join("");
  }

  // 相手をしぼり込む（プレミアム限定）。非会員には「プレミアムのみ」を表示。
  function openFilterDialog() {
    var ov = document.getElementById("filterOverlay");
    if (!ov) return;
    var locked = document.getElementById("filterLocked");
    var body = document.getElementById("filterBody");
    var apply = document.getElementById("filterApply");
    var sub = isSub();
    if (locked) locked.hidden = sub;
    if (body) body.style.display = sub ? "" : "none";
    if (apply) apply.hidden = !sub;
    var subBtn = document.getElementById("filterSubscribe");
    if (subBtn) {
      subBtn.hidden = sub; // 非会員のときだけ「プレミアムに加入」を出す
      subBtn.textContent = t("プレミアムに加入（") + (CONFIG.PRICE_SUB_MONTH || "") + t("／月）");
    }
    if (sub) {
      var s = getState();
      var g = document.getElementById("filt-gender"); if (g) g.value = s.fltGender || "";
      var p = document.getElementById("filt-pref"); if (p) p.value = s.fltPref || "";
    }
    openOverlay(ov);
  }

  // ---------- イベント結線 ----------
  function bindControls() {
    // 課金画面の「利用規約 / プライバシー」リンク（Apple 3.1.2 の必須表記）。
    // 規約・プライバシー本文の全画面オーバーレイを開く（アプリ内の機能的リンク）。
    Array.prototype.forEach.call(document.querySelectorAll(".iap-legal-link"), function (link) {
      link.addEventListener("click", function () {
        var id = link.getAttribute("data-open") === "terms" ? "termsOverlay" : "policyOverlay";
        var ov = document.getElementById(id);
        if (ov) openOverlay(ov);
      });
    });

    // しぼり込みの地域選択をプロフィールの地域（＝言語で都道府県/国名）から複製
    var filtPref = document.getElementById("filt-pref");
    if (filtPref) {
      var prefSrc = document.getElementById("pf-pref");
      if (prefSrc) Array.prototype.forEach.call(prefSrc.querySelectorAll("option"), function (o) {
        if (!o.value) return;
        var opt = document.createElement("option"); opt.value = o.value; opt.textContent = o.textContent;
        filtPref.appendChild(opt);
      });
    }
    var searchBtn = document.getElementById("searchBtn");
    if (searchBtn) searchBtn.addEventListener("click", openFilterDialog);
    var filterApply = document.getElementById("filterApply");
    if (filterApply) filterApply.addEventListener("click", function () {
      if (!isSub()) return;
      var s = getState();
      var g = document.getElementById("filt-gender"); var p = document.getElementById("filt-pref");
      s.fltGender = g ? g.value : ""; s.fltPref = p ? p.value : ""; saveState(s);
      var fg = document.getElementById("flt-gender"); if (fg) fg.value = s.fltGender; // プロフィール側と同期
      var fp = document.getElementById("flt-pref"); if (fp) fp.value = s.fltPref;
      closeOverlay(document.getElementById("filterOverlay"));
      rebuildDeck();
    });
    var filterCancel = document.getElementById("filterCancel");
    if (filterCancel) filterCancel.addEventListener("click", function () {
      closeOverlay(document.getElementById("filterOverlay"));
    });
    var filterSubscribe = document.getElementById("filterSubscribe");
    if (filterSubscribe) filterSubscribe.addEventListener("click", function () {
      // 加入は applySubState 経由で反映。反映後にダイアログを開き直す（デモは同期的に加入済み）
      Purchases.buy("sub_month", function () { openFilterDialog(); }, notifyPurchaseUnavailable);
    });
    document.getElementById("yesBtn").onclick = function () { swipeTop("yes"); };
    document.getElementById("noBtn").onclick = function () { swipeTop("no"); };
    document.getElementById("infoBtn").onclick = function () {
      if (index < users.length && !users[index].__ad) openViewer(users[index]);
    };
    var resetBtn = document.getElementById("resetBtn");
    if (resetBtn) resetBtn.onclick = init;

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
        processVideoFile(f);
        vidInput.value = ""; // 同じ動画を選び直しても change が発火するように
      });

      // 動画エディタ（トリミング・向き調整）の操作
      var veFit = document.getElementById("veFit");
      var veRotate = document.getElementById("veRotate");
      var veZoom = document.getElementById("veZoom");
      var veDone = document.getElementById("veDone");
      var veCancel = document.getElementById("veCancel");
      var veCanvas = document.getElementById("veCanvas");
      if (veFit) veFit.onclick = function () {
        if (!veState) return;
        veState.st.fit = (veState.st.fit === "contain") ? "cover" : "contain";
        veState.st.zoom = 1; veState.st.offsetX = 0; veState.st.offsetY = 0;
        if (veZoom) veZoom.value = "1";
        veFit.textContent = t(veState.st.fit === "contain" ? "切り抜き" : "全体を表示");
      };
      if (veRotate) veRotate.onclick = function () {
        if (!veState) return;
        veState.st.rotation = (veState.st.rotation + 90) % 360;
        veState.st.offsetX = 0; veState.st.offsetY = 0;
      };
      if (veZoom) veZoom.oninput = function () {
        if (!veState) return;
        veState.st.zoom = parseFloat(veZoom.value) || 1;
      };
      if (veDone) veDone.onclick = function () { closeVideoEditor(true); };
      if (veCancel) veCancel.onclick = function () { closeVideoEditor(false); };

      // ドラッグで位置（切り抜き位置）を調整
      if (veCanvas) {
        var dragging = false, sx = 0, sy = 0, sox = 0, soy = 0;
        function slackOf() {
          var st = veState && veState.st, video = veState && veState.video;
          if (!st || !video) return { x: 0, y: 0 };
          var rot = ((st.rotation % 360) + 360) % 360;
          var vw = video.videoWidth || veCanvas.width, vh = video.videoHeight || veCanvas.height;
          var rw = (rot === 90 || rot === 270) ? vh : vw, rh = (rot === 90 || rot === 270) ? vw : vh;
          var base = (st.fit === "contain") ? Math.min(veCanvas.width / rw, veCanvas.height / rh)
                                            : Math.max(veCanvas.width / rw, veCanvas.height / rh);
          var s = base * st.zoom;
          return { x: Math.max(0, rw * s - veCanvas.width) / 2, y: Math.max(0, rh * s - veCanvas.height) / 2 };
        }
        veCanvas.addEventListener("pointerdown", function (e) {
          if (!veState) return;
          dragging = true; sx = e.clientX; sy = e.clientY;
          sox = veState.st.offsetX; soy = veState.st.offsetY;
          try { veCanvas.setPointerCapture(e.pointerId); } catch (err) {}
        });
        veCanvas.addEventListener("pointermove", function (e) {
          if (!dragging || !veState) return;
          var rect = veCanvas.getBoundingClientRect();
          var k = rect.width ? (veCanvas.width / rect.width) : 1; // 表示px→内部px
          var sl = slackOf();
          var nx = sox + (sl.x ? ((e.clientX - sx) * k) / sl.x : 0);
          var ny = soy + (sl.y ? ((e.clientY - sy) * k) / sl.y : 0);
          veState.st.offsetX = Math.max(-1, Math.min(1, nx));
          veState.st.offsetY = Math.max(-1, Math.min(1, ny));
        });
        function endDrag(e) { dragging = false; try { veCanvas.releasePointerCapture(e.pointerId); } catch (err) {} }
        veCanvas.addEventListener("pointerup", endDrag);
        veCanvas.addEventListener("pointercancel", endDrag);
      }

      // アプリ（Capacitor）では「選ぶ」をカメラ無しのネイティブピッカーに差し替える
      wireNativePickers();

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
        var profileObj = {
          name: name,
          bio: (document.getElementById("pf-bio") || {}).value || "",
          handle: "@" + handle,
          inviteIds: inviteIds,
          image2: pendingImage2 || "",
          pref: document.getElementById("pf-pref").value,
          gender: document.getElementById("pf-gender").value,
          tags: tags,
          image: pendingImage || "",
          videoName: pendingVideoName || ""
        };
        if (BE) { saveProfileToBackend(profileObj); return; }
        saveProfile(profileObj);
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
      if (threadUser) askUnmatch(threadUser);
    });

    // ── 交換の解除確認（はい／いいえ）
    var unmatchOv = document.getElementById("unmatchOverlay");
    var unmatchCancel = document.getElementById("unmatchCancel");
    if (unmatchCancel) unmatchCancel.addEventListener("click", function () {
      pendingUnmatch = null;
      closeOverlay(unmatchOv);
    });
    var unmatchConfirm = document.getElementById("unmatchConfirm");
    if (unmatchConfirm) unmatchConfirm.addEventListener("click", function () {
      var target = pendingUnmatch;
      pendingUnmatch = null;
      closeOverlay(unmatchOv);
      if (target) unmatchThread(target);
    });

    // ── 上限オーバーレイの閉じる
    var limitCancel = document.getElementById("limitCancel");
    if (limitCancel) limitCancel.addEventListener("click", function () {
      closeOverlay(document.getElementById("limitOverlay"));
    });

    // ── プレミアム（加入・解約／しぼり込み／ブースト）
    var subMonth = document.getElementById("subMonthBtn");
    if (subMonth) subMonth.addEventListener("click", function () {
      Purchases.buy("sub_month", null, notifyPurchaseUnavailable);   // 反映は applySubState 経由
    });
    var subCancel = document.getElementById("subCancelBtn");
    if (subCancel) subCancel.addEventListener("click", function () {
      // 実課金：アプリ内で解約はできない → ストアの購読管理画面へ。デモ：即解約。
      if (Purchases.isNative && Purchases.isNative()) { Purchases.manageSubscriptions(); return; }
      applySubState(false);
    });
    var restoreBtn = document.getElementById("restoreBtn");
    if (restoreBtn) restoreBtn.addEventListener("click", function () {
      Purchases.restore(function () { /* 復元結果は applySubState（onSubChange）で反映 */ });
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
      // 購入すると「所持」が1つ増える（付与は grantBoost=onBoostGranted 経由）。使用はスワイプ画面から。
      Purchases.buy("boost", null, notifyPurchaseUnavailable);
    });
    // スワイプ画面のブーストアイコン → 使用ダイアログ
    var swipeBoostBtn = document.getElementById("swipeBoost");
    if (swipeBoostBtn) swipeBoostBtn.addEventListener("click", openBoostDialog);
    var boostUseBtn = document.getElementById("boostUseBtn");
    if (boostUseBtn) boostUseBtn.addEventListener("click", function () {
      if (useBoostItem()) {
        closeOverlay(document.getElementById("boostOverlay"));
        rebuildDeck(); renderSwipeBoost(); renderPremium();
      }
    });
    var boostDlgCancel = document.getElementById("boostDlgCancel");
    if (boostDlgCancel) boostDlgCancel.addEventListener("click", function () {
      closeOverlay(document.getElementById("boostOverlay"));
    });
    // アプリバーの自分アイコン → プロフィールタブ
    var myAvatarBtn = document.getElementById("myAvatar");
    if (myAvatarBtn) myAvatarBtn.addEventListener("click", function () { showView("profile"); });

    // 言語切替（日本語 ⇄ English）
    var langToggle = document.getElementById("langToggle");
    if (langToggle && window.I18N) {
      langToggle.textContent = window.I18N.lang === "ja" ? "English" : "日本語";
      langToggle.addEventListener("click", function () {
        window.I18N.setLang(window.I18N.lang === "ja" ? "en" : "ja");
      });
    }

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
      if (e.key === "Escape") {
        if (veState) { closeVideoEditor(false); } // 動画エディタは後始末してから閉じる
        eachOverlay(function (ov) { if (!ov.hidden) closeOverlay(ov); });
        return;
      }
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

  if (window.I18N) window.I18N.applyStatic(); // 静的HTMLを言語に合わせて翻訳
  localizeRegionSelect();                     // 英語時は都道府県→国名に
  bindControls();
  // 課金の初期化：加入状態と消耗型ブーストの付与をストアの実イベントに結線。
  // Web/デモではプラグインが無いので no-op（購入は buy() 側でデモ動作）。
  Purchases.init({ onSubChange: applySubState, onBoostGranted: grantBoost });
  init();
  setupReveal();

  // 待機（モザイク）相手の残り時間の色更新＆期限切れ掃除を定期実行
  setInterval(function () {
    if (pruneExpiredPending()) updateTabIndicators();
    var chat = document.getElementById("view-chat");
    if (chat && !chat.hidden) renderChat();
    renderSwipeBoost(); // ブーストの期限切れをアイコンに反映
  }, 60000);
})();
