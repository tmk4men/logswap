/**
 * LogSwap バックエンド接続層（Supabase + Cloudflare R2 Worker）
 * ---------------------------------------------------------------
 * app.js はデータ操作をここ経由で行う。CONFIG.BACKEND が false のときは
 * enabled=false になり、app.js は従来どおり mock/localStorage で動く。
 *
 * 依存: グローバル supabase-js（CDN で window.supabase を読み込み済み）
 *       window.LOGSWAP_CONFIG（SUPABASE_URL / SUPABASE_ANON_KEY / WORKER_URL / BACKEND）
 *
 * DBスキーマは server/schema.sql / migrations を参照。
 */
(function () {
  "use strict";

  var CFG = (typeof window !== "undefined" && window.LOGSWAP_CONFIG) || {};
  var sbLib = (typeof window !== "undefined" && window.supabase) || null;
  var ENABLED = !!(CFG.BACKEND && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && sbLib);

  var sb = null;      // supabase client
  var meId = null;    // 自分の user id（匿名）

  // ---------- 起動：匿名ログイン（セッションは localStorage に永続） ----------
  function init() {
    if (!ENABLED) return Promise.resolve(null);
    sb = sbLib.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "logswap_sb" }
    });
    // Realtime は既定で anon 権限。RLS(to authenticated) を通すため、トークン更新のたびに
    // 認証済みトークンへ差し替える（これが無いと postgres_changes が届かない）。
    sb.auth.onAuthStateChange(function (_e, session) {
      if (session) { try { sb.realtime.setAuth(session.access_token); } catch (e) {} }
    });
    return sb.auth.getSession().then(function (r) {
      var session = r.data && r.data.session;
      if (session) return session;
      return sb.auth.signInAnonymously().then(function (r2) {
        if (r2.error) throw r2.error;
        return r2.data.session;
      });
    }).then(function (session) {
      meId = session.user.id;
      try { sb.realtime.setAuth(session.access_token); } catch (e) {}
      return meId;
    });
  }

  function token() {
    return sb.auth.getSession().then(function (r) {
      return r.data && r.data.session ? r.data.session.access_token : "";
    });
  }

  // ---------- メディア（画像・動画）を Worker 経由で R2 へ ----------
  function dataUrlToBlob(dataUrl) {
    var parts = String(dataUrl).split(",");
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || "application/octet-stream";
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  // kind: "image" | "video"。blobOrDataUrl は Blob か dataURL 文字列。返り値: 公開URL
  function uploadMedia(kind, blobOrDataUrl) {
    if (!CFG.WORKER_URL) return Promise.reject(new Error("WORKER_URL 未設定"));
    var blob = (typeof blobOrDataUrl === "string") ? dataUrlToBlob(blobOrDataUrl) : blobOrDataUrl;
    return token().then(function (t) {
      return fetch(CFG.WORKER_URL + "/upload?kind=" + kind, {
        method: "POST",
        headers: { authorization: "Bearer " + t, "content-type": blob.type || "application/octet-stream" },
        body: blob
      });
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || ("upload failed " + res.status));
        return body.url;
      });
    });
  }
  function deleteAllMedia() {
    if (!CFG.WORKER_URL) return Promise.resolve({ deleted: 0 });
    return token().then(function (t) {
      return fetch(CFG.WORKER_URL + "/media", { method: "DELETE", headers: { authorization: "Bearer " + t } });
    }).then(function (r) { return r.ok ? r.json() : { deleted: 0 }; });
  }

  // ---------- プロフィール ----------
  // DB行 → app のプロフィール形へ
  function rowToProfile(pub, priv) {
    if (!pub) return null;
    return {
      name: pub.name || "",
      bio: pub.bio || "",
      handle: pub.handle || "",
      pref: pub.pref || "",
      tags: pub.tags || [],
      image: pub.image_path || "",
      image2: pub.image2_path || "",
      video: pub.video_path || "",
      videoName: pub.video_name || "",
      gender: (priv && priv.gender) || "",
      inviteIds: (priv && priv.invite_ids) || []
    };
  }
  function getMyProfile() {
    if (!ENABLED) return Promise.resolve(null);
    return Promise.all([
      sb.from("profiles").select("*").eq("id", meId).maybeSingle(),
      sb.from("private_profiles").select("*").eq("id", meId).maybeSingle()
    ]).then(function (rs) {
      var pub = rs[0].data, priv = rs[1].data;
      return rowToProfile(pub, priv);
    });
  }
  // p: app のプロフィール形。media は {image, image2, video} で Blob か dataURL（省略可＝据置）
  function saveProfile(p, media) {
    media = media || {};
    var jobs = [];
    var out = { image_path: undefined, image2_path: undefined, video_path: undefined };
    if (media.image) jobs.push(uploadMedia("image", media.image).then(function (u) { out.image_path = u; }));
    if (media.image2) jobs.push(uploadMedia("image", media.image2).then(function (u) { out.image2_path = u; }));
    if (media.video) jobs.push(uploadMedia("video", media.video).then(function (u) { out.video_path = u; }));

    return Promise.all(jobs).then(function () {
      var pub = {
        id: meId,
        name: p.name,
        bio: p.bio || null,
        handle: p.handle || null,
        pref: p.pref || null,
        tags: p.tags || [],
        video_name: p.videoName || null,
        updated_at: new Date().toISOString()
      };
      // アップロードした分だけ path を更新（未指定は据置＝既存値を壊さない）
      if (out.image_path !== undefined) pub.image_path = out.image_path;
      if (out.image2_path !== undefined) pub.image2_path = out.image2_path;
      if (out.video_path !== undefined) pub.video_path = out.video_path;

      var priv = { id: meId, gender: p.gender || null, invite_ids: p.inviteIds || [] };
      return Promise.all([
        sb.from("profiles").upsert(pub).select().single(),
        sb.from("private_profiles").upsert(priv).select().single()
      ]);
    }).then(function (rs) {
      if (rs[0].error) throw rs[0].error;
      if (rs[1].error) throw rs[1].error;
      return rowToProfile(rs[0].data, rs[1].data);
    });
  }

  // ---------- スワイプ配信 ----------
  function mapUser(row) {
    return {
      id: row.id,
      name: row.name,
      bio: row.bio || "",
      handle: row.handle || "",
      pref: row.pref || "",
      tags: row.tags || [],
      photo: row.image_path || ("u_" + row.id),   // 実URL。未設定でもユーザーごとに別のフォールバック画像
      created_at: row.created_at,
      image2: row.image2_path || "",
      video: row.video_path || "",   // 実URL
      likesBack: false               // 実データでは相手の意思は不明
    };
  }
  function getProfileById(id) {
    return sb.from("profiles").select("*").eq("id", id).maybeSingle()
      .then(function (r) { return r.data ? mapUser(r.data) : null; });
  }
  function getSwipeQueue(max) {
    if (!ENABLED) return Promise.resolve([]);
    return sb.rpc("get_swipe_queue", { max_count: max || 30 }).then(function (r) {
      if (r.error) throw r.error;
      return (r.data || []).map(mapUser);
    });
  }

  // ---------- いいね・成立 ----------
  // like を入れ、相互成立していれば {matched:true, matchId} を返す
  function like(otherId) {
    if (!ENABLED) return Promise.resolve({ matched: false });
    return sb.from("likes").insert({ liker: meId, likee: otherId }).then(function (r) {
      if (r.error && r.error.code !== "23505") throw r.error; // 23505=重複いいねは無視
      return findMatch(otherId);
    });
  }
  function pairKey(a, b) { return a < b ? [a, b] : [b, a]; }
  function findMatch(otherId) {
    var k = pairKey(meId, otherId);
    return sb.from("matches").select("id").eq("user_a", k[0]).eq("user_b", k[1]).maybeSingle()
      .then(function (r) { return { matched: !!(r.data), matchId: r.data ? r.data.id : null }; });
  }
  // 成立相手一覧（相手プロフィール＋match_id）
  function listMatches() {
    if (!ENABLED) return Promise.resolve([]);
    return sb.from("matches").select("*").or("user_a.eq." + meId + ",user_b.eq." + meId)
      .then(function (r) {
        if (r.error) throw r.error;
        var rows = r.data || [];
        var others = rows.map(function (m) { return m.user_a === meId ? m.user_b : m.user_a; });
        if (!others.length) return [];
        return sb.from("profiles").select("*").in("id", others).then(function (pr) {
          var byId = {};
          (pr.data || []).forEach(function (p) { byId[p.id] = p; });
          return rows.map(function (m) {
            var oid = m.user_a === meId ? m.user_b : m.user_a;
            var u = mapUser(byId[oid] || { id: oid, name: "(不明)" });
            u.matchId = m.id;
            return u;
          });
        });
      });
  }

  // ---------- メッセージ（トーク） ----------
  function listMessages(matchId) {
    return sb.from("messages").select("*").eq("match_id", matchId).order("created_at", { ascending: true })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function sendMessage(matchId, kind, body) {
    return sb.from("messages").insert({ match_id: matchId, sender: meId, kind: kind || "text", body: body })
      .then(function (r) { if (r.error) throw r.error; });
  }
  // 新しい成立の購読（両者に届く。RLSで自分が当事者の行だけ受信）。cb(matchRow)。
  function subscribeMatches(cb) {
    var ch = sb.channel("matches")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "matches" },
        function (payload) { cb(payload.new); })
      .subscribe();
    return function () { sb.removeChannel(ch); };
  }
  // 新着メッセージの購読。cb(row) が呼ばれる。unsubscribe 関数を返す。
  function subscribeMessages(matchId, cb) {
    var ch = sb.channel("msg:" + matchId)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "match_id=eq." + matchId },
        function (payload) { cb(payload.new); })
      .subscribe();
    return function () { sb.removeChannel(ch); };
  }

  // ---------- ID交換（使い切りの招待コード公開） ----------
  function revealInvite(matchId, code) {
    return sb.from("exchanges").insert({ match_id: matchId, giver: meId, invite_code: code })
      .then(function (r) { if (r.error) throw r.error; });
  }
  // その成立で公開されたコード一覧（自分の＋相手の）。{mine, theirs}
  function getReveals(matchId) {
    return sb.from("exchanges").select("*").eq("match_id", matchId).then(function (r) {
      if (r.error) throw r.error;
      var mine = null, theirs = null;
      (r.data || []).forEach(function (x) {
        if (x.giver === meId) mine = x.invite_code; else theirs = x.invite_code;
      });
      return { mine: mine, theirs: theirs };
    });
  }

  // ---------- 安全機能・退会 ----------
  // 成立を解除（削除）。当事者のみ可（RLS）。messages/exchanges は cascade で消える。
  function deleteMatch(matchId) {
    return sb.from("matches").delete().eq("id", matchId)
      .then(function (r) { if (r.error) throw r.error; });
  }
  function block(otherId) {
    return sb.from("blocks").insert({ blocker: meId, blocked: otherId })
      .then(function (r) { if (r.error && r.error.code !== "23505") throw r.error; });
  }
  function report(otherId, reason) {
    return sb.from("reports").insert({ reporter: meId, reported: otherId, reason: reason || "その他" })
      .then(function (r) { if (r.error) throw r.error; });
  }
  function deleteAccount() {
    // メディア削除 → delete_me()（auth ユーザーを消して全テーブルを cascade 削除）→ サインアウト。
    // profiles だけ消しても他テーブルは auth.users 参照なので残る。だから RPC で確実に全消去する。
    return deleteAllMedia()
      .then(function () { return sb.rpc("delete_me"); })
      .then(function (r) { if (r && r.error) throw r.error; return sb.auth.signOut(); });
  }

  window.LogSwapBackend = {
    get enabled() { return ENABLED; },
    get userId() { return meId; },
    init: init,
    getMyProfile: getMyProfile,
    saveProfile: saveProfile,
    getSwipeQueue: getSwipeQueue,
    getProfileById: getProfileById,
    like: like,
    findMatch: findMatch,
    listMatches: listMatches,
    subscribeMatches: subscribeMatches,
    listMessages: listMessages,
    sendMessage: sendMessage,
    subscribeMessages: subscribeMessages,
    revealInvite: revealInvite,
    getReveals: getReveals,
    deleteMatch: deleteMatch,
    block: block,
    report: report,
    uploadMedia: uploadMedia,
    deleteAccount: deleteAccount,
    // テスト用に内部を差し込めるフック（本番は未使用）
    _setClient: function (c, id) { sb = c; meId = id; }
  };
})();
