/**
 * LogSwap メディアアップロード Worker（Cloudflare Workers + R2）
 * ---------------------------------------------------------------
 * 役割: 画像・動画の実体を R2 に保存し、公開URLを返す。
 *       R2 は転送量(egress)が無料なので、スワイプで動画を配っても配信費がかからない。
 *       認証/DB は Supabase 側。この Worker は Supabase のアクセストークン(JWT)を
 *       検証して「本人のフォルダ ${userId}/ にだけ」書き込ませる。
 *
 * ルート:
 *   POST   /upload?kind=video|image|image2  本人の動画/画像を種類ごとに1本保存（1人1本）
 *                                        image=プロフィール画像 / image2=サブ画像（別キーで保存）
 *                                        画像は保存前に露出(NSFW)自動判定し、露出なら拒否(422)。
 *   POST   /moderate                  画像1枚の露出判定だけ行う（動画の代表フレーム用）。保存はしない。
 *   DELETE /media                     本人のメディアを全削除（退会時に呼ぶ）
 *   OPTIONS *                         CORS プリフライト
 *
 * 読み取り（スワイプ表示）は R2 バケットの公開URL（PUBLIC_BASE）から直接。
 */

const LIMITS = {
  video: { maxBytes: 3 * 1024 * 1024, types: ["video/webm", "video/mp4"] },      // 圧縮済み3秒想定で3MB上限
  image: { maxBytes: 1 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },   // プロフィール画像（丸アイコン）
  image2: { maxBytes: 1 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },  // サブ画像（image とは別キーに保存）
};
// 画像として中身検査する種類（プロフィール画像・サブ画像）
const IMAGE_KINDS = { image: 1, image2: 1 };
const EXT = {
  "video/webm": "webm", "video/mp4": "mp4",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export default {
  async fetch(request, env) {
    const origin = pickOrigin(request, env);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/upload") {
        return cors(await handleUpload(request, env, url), origin);
      }
      if (request.method === "POST" && url.pathname === "/moderate") {
        return cors(await handleModerate(request, env), origin);
      }
      if (request.method === "DELETE" && url.pathname === "/media") {
        return cors(await handleDelete(request, env), origin);
      }
      return cors(json({ error: "not found" }, 404), origin);
    } catch (e) {
      const status = e.status || 500;
      return cors(json({ error: e.message || "error" }, status), origin);
    }
  },
};

async function handleUpload(request, env, url) {
  const userId = await requireUser(request, env);

  const kind = url.searchParams.get("kind");
  const spec = LIMITS[kind];
  if (!spec) throw httpError(400, "kind は video / image / image2 のいずれか");

  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (spec.types.indexOf(contentType) === -1) throw httpError(415, "対応していない形式です: " + contentType);

  // サイズは本文をバッファする前に Content-Length で弾く（メモリ濫用の防止）
  const clen = parseInt(request.headers.get("content-length") || "0", 10);
  if (clen && clen > spec.maxBytes) throw httpError(413, "ファイルが大きすぎます");

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) throw httpError(400, "本文が空です");
  if (buf.byteLength > spec.maxBytes) throw httpError(413, "ファイルが大きすぎます");
  // content-type ヘッダは送信者が自由に付けられるので、画像は先頭バイト（マジックナンバー）で検査
  if (IMAGE_KINDS[kind] && !imageSniffOk(contentType, new Uint8Array(buf))) {
    throw httpError(415, "ファイルの中身が画像形式と一致しません");
  }
  // 露出（ヌード・性器・性行為）の自動判定。露出と判定されたら保存せず拒否＝最初から誰にも見えない。
  // 判定APIが未設定/不達なら素通り（fail-open：アップロード機能自体は止めない。通報自動隔離が保険）。
  if (IMAGE_KINDS[kind]) {
    const mod = await moderateImage(env, buf, contentType);
    if (mod.explicit) throw httpError(422, "露出の多い画像は登録できません。別の写真を選んでください。");
  }

  // 種類ごとに1本。キーは毎回ユニークにして、更新時にブラウザ/CDNのキャッシュが確実に
  // 差し替わるようにする（固定キー＋immutable だと古い画像が残り続ける）。
  // プロフィール画像(image)とサブ画像(image2)は別プレフィックスなので取り違えない。
  // 例: image のキーは "…/image-xxxx" で始まり、image2 の "…/image2-xxxx" とは前方一致しない。
  const old = await env.MEDIA.list({ prefix: `${userId}/${kind}-` });
  const key = `${userId}/${kind}-${crypto.randomUUID()}.${EXT[contentType]}`;
  await env.MEDIA.put(key, buf, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
  });
  // 同じ種類の古いオブジェクトを掃除（1人1本を維持。account 削除時は prefix 一括削除で全消去）
  if (old.objects.length) await env.MEDIA.delete(old.objects.map((o) => o.key));

  return json({ url: publicUrl(env, key), key });
}

async function handleDelete(request, env) {
  const userId = await requireUser(request, env);
  const list = await env.MEDIA.list({ prefix: `${userId}/` });
  const keys = list.objects.map((o) => o.key);
  if (keys.length) await env.MEDIA.delete(keys);
  return json({ deleted: keys.length });
}

// 動画のフレーム画像（クライアントが canvas で抜いた1枚）を露出判定するためのエンドポイント。
// 動画本体は Worker で復号できないので、露出チェックは「代表フレーム画像」で行う。
// 返り: { allowed: bool, checked: bool }。allowed=false ならクライアントはアップロードを中止する。
async function handleModerate(request, env) {
  await requireUser(request, env); // 認証必須（本人のみ）
  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (["image/jpeg", "image/png", "image/webp"].indexOf(contentType) === -1) {
    throw httpError(415, "判定はJPEG/PNG/WebP画像で送ってください");
  }
  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) throw httpError(400, "本文が空です");
  if (buf.byteLength > 2 * 1024 * 1024) throw httpError(413, "フレーム画像が大きすぎます");
  const mod = await moderateImage(env, buf, contentType);
  return json({ allowed: !mod.explicit, checked: !!mod.checked });
}

// バイト列を base64 に（Workers には Buffer が無いので btoa で。1MB程度を分割処理）。
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// 画像を Claude（Haiku 4.5・vision）で露出判定する。構造化出力で {explicit: bool} を強制。
//  - ANTHROPIC_API_KEY 未設定 → checked:false（スキップ＝fail-open）
//  - API不達・想定外レスポンス → checked:false（fail-open。アップロードは止めない）
//  - 露出（性器/女性の乳首の露出・性行為・自慰）と判定 → explicit:true
//    水着・下着・上半身裸などは explicit:false（弾かない）。
async function moderateImage(env, buf, contentType) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return { checked: false };
  let data;
  try {
    const b64 = bytesToBase64(new Uint8Array(buf));
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 20,
        system:
          "あなたは18禁ではない一般向けマッチングアプリの画像モデレーターです。" +
          "画像が露骨な性的コンテンツ（性器や肛門の露出、女性の乳首の露出、性行為、自慰）を含むかを判定します。" +
          "通常の顔写真・自撮り・水着・下着・上半身裸のトルソーは explicit ではありません。",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: contentType, data: b64 } },
            { type: "text", text: "この画像は露骨な性的コンテンツですか？" },
          ],
        }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { explicit: { type: "boolean" } },
              required: ["explicit"],
              additionalProperties: false,
            },
          },
        },
      }),
    });
    if (!r.ok) return { checked: false };
    data = await r.json();
  } catch (e) {
    return { checked: false };
  }
  // 構造化出力なので text ブロックの中身がそのまま JSON。
  try {
    const block = (data && data.content || []).find((b) => b.type === "text");
    const parsed = block ? JSON.parse(block.text) : null;
    if (!parsed || typeof parsed.explicit !== "boolean") return { checked: false };
    return { checked: true, explicit: parsed.explicit };
  } catch (e) {
    return { checked: false };
  }
}

// ---------- 認証（Supabase の access_token を検証） ----------
// 新しめの Supabase はユーザートークンを ES256(非対称・JWKS公開)で署名する。
// 旧 HS256(共有シークレット)にも対応（header.alg で分岐）。
let JWKS_CACHE = { url: null, at: 0, keys: null };

async function requireUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw httpError(401, "ログインが必要です");
  const payload = await verifyJwt(token, env);
  if (!payload.sub) throw httpError(401, "無効なトークン");
  return payload.sub;
}

async function verifyJwt(token, env) {
  const parts = token.split(".");
  if (parts.length !== 3) throw httpError(401, "トークン形式が不正");
  const [h, p, s] = parts;
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = b64urlToBytes(s);

  let ok = false;
  if (header.alg === "ES256") {
    const jwk = await getJwk(env, header.kid);
    if (!jwk) throw httpError(401, "署名鍵が見つかりません");
    const key = await crypto.subtle.importKey(
      "jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
    );
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
  } else if (header.alg === "HS256") {
    if (!env.SUPABASE_JWT_SECRET) throw httpError(401, "HS256秘密が未設定");
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    ok = await crypto.subtle.verify("HMAC", key, sig, data);
  } else {
    throw httpError(401, "未対応の署名方式: " + header.alg);
  }
  if (!ok) throw httpError(401, "署名検証に失敗");

  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (payload.exp && payload.exp * 1000 < Date.now()) throw httpError(401, "トークン期限切れ");
  // ユーザートークンだけ受け付ける（他種のSupabase発行トークンを拒否）
  if (payload.aud && payload.aud !== "authenticated") throw httpError(401, "対象外のトークン");
  return payload;
}

// 画像の先頭バイト検査（PNG/JPEG/WebP）。動画はサイズ制限のみで信頼する。
function imageSniffOk(ct, b) {
  if (ct === "image/png") return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (ct === "image/jpeg") return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ct === "image/webp") return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;
  return false;
}

// JWKS を取得（10分メモリキャッシュ・kidミス時は1回だけ強制リフレッシュ＝鍵ローテ対応）
async function getJwk(env, kid) {
  const base = (env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) throw httpError(500, "SUPABASE_URL 未設定");
  const url = base + "/auth/v1/.well-known/jwks.json";
  const now = Date.now();
  const fresh = JWKS_CACHE.url === url && JWKS_CACHE.keys && now - JWKS_CACHE.at < 600000;
  if (!fresh) {
    const r = await fetch(url);
    if (!r.ok) throw httpError(401, "JWKS取得失敗");
    JWKS_CACHE = { url, at: now, keys: (await r.json()).keys || [] };
  }
  let k = JWKS_CACHE.keys.find((x) => x.kid === kid);
  if (!k && kid && fresh) {
    const r = await fetch(url);
    if (r.ok) { JWKS_CACHE = { url, at: now, keys: (await r.json()).keys || [] }; k = JWKS_CACHE.keys.find((x) => x.kid === kid); }
  }
  return k;
}

function b64urlToBytes(b64url) {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---------- helpers ----------
function publicUrl(env, key) {
  const base = (env.PUBLIC_BASE || "").replace(/\/+$/, "");
  return `${base}/${key}`;
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
// 許可オリジンを決める。ALLOWED_ORIGINS（カンマ区切り）に一致すればそのオリジンを返す。
// "*" が含まれていればリクエストのオリジンをそのまま反映（全許可）。
function pickOrigin(request, env) {
  const list = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "*")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const reqOrigin = request.headers.get("Origin") || "";
  if (list.indexOf("*") !== -1) return reqOrigin || "*";
  if (reqOrigin && list.indexOf(reqOrigin) !== -1) return reqOrigin;
  return list[0] || "*"; // 非許可オリジンには一致しない値を返す＝ブラウザがブロック
}
function cors(res, origin) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
  h.set("Vary", "Origin");
  h.set("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "authorization, content-type");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(res.body, { status: res.status, headers: h });
}
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
