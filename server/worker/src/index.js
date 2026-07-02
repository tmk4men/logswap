/**
 * LogSwap メディアアップロード Worker（Cloudflare Workers + R2）
 * ---------------------------------------------------------------
 * 役割: 画像・動画の実体を R2 に保存し、公開URLを返す。
 *       R2 は転送量(egress)が無料なので、スワイプで動画を配っても配信費がかからない。
 *       認証/DB は Supabase 側。この Worker は Supabase のアクセストークン(JWT)を
 *       検証して「本人のフォルダ ${userId}/ にだけ」書き込ませる。
 *
 * ルート:
 *   POST   /upload?kind=video|image   本人の動画/画像を1本保存（上書き。1人1本）
 *   DELETE /media                     本人のメディアを全削除（退会時に呼ぶ）
 *   OPTIONS *                         CORS プリフライト
 *
 * 読み取り（スワイプ表示）は R2 バケットの公開URL（PUBLIC_BASE）から直接。
 */

const LIMITS = {
  video: { maxBytes: 3 * 1024 * 1024, types: ["video/webm", "video/mp4"] },      // 圧縮済み3秒想定で3MB上限
  image: { maxBytes: 1 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp"] },
};
const EXT = {
  "video/webm": "webm", "video/mp4": "mp4",
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), origin);

    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/upload") {
        return cors(await handleUpload(request, env, url), origin);
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
  if (!spec) throw httpError(400, "kind は video か image");

  const contentType = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (spec.types.indexOf(contentType) === -1) throw httpError(415, "対応していない形式です: " + contentType);

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) throw httpError(400, "本文が空です");
  if (buf.byteLength > spec.maxBytes) throw httpError(413, "ファイルが大きすぎます");

  // 1人1本。固定キーで上書き（＝古いものは自動で置き換わる）
  const key = `${userId}/${kind}.${EXT[contentType]}`;
  await env.MEDIA.put(key, buf, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
  });

  return json({ url: publicUrl(env, key), key });
}

async function handleDelete(request, env) {
  const userId = await requireUser(request, env);
  const list = await env.MEDIA.list({ prefix: `${userId}/` });
  const keys = list.objects.map((o) => o.key);
  if (keys.length) await env.MEDIA.delete(keys);
  return json({ deleted: keys.length });
}

// ---------- 認証（Supabase の access_token / HS256 JWT を検証） ----------
async function requireUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw httpError(401, "ログインが必要です");
  const payload = await verifyJwtHS256(token, env.SUPABASE_JWT_SECRET);
  if (!payload.sub) throw httpError(401, "無効なトークン");
  return payload.sub;
}

async function verifyJwtHS256(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw httpError(401, "トークン形式が不正");
  const [h, p, s] = parts;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw httpError(401, "署名検証に失敗");
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  if (payload.exp && payload.exp * 1000 < Date.now()) throw httpError(401, "トークン期限切れ");
  return payload;
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
function cors(res, origin) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", origin);
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
