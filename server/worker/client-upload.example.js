/**
 * クライアント側のメディアアップロード雛形（参考）。
 * app.js を本番のバックエンド接続に差し替えるときに使う。
 * 動画は app.js の compressVideo が作った pendingVideoBlob をそのまま渡せる。
 */

// js/config.js の値を使う想定
// window.LOGSWAP_CONFIG = { WORKER_URL: "https://logswap-media.<account>.workers.dev", ... }

async function uploadMedia(kind, blob, accessToken, workerUrl) {
  const res = await fetch(`${workerUrl}/upload?kind=${kind}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`, // Supabase の session.access_token
      "Content-Type": blob.type,               // video/webm など
    },
    body: blob,
  });
  if (!res.ok) throw new Error("アップロードに失敗しました: " + res.status);
  const { url } = await res.json();
  return url; // これを profiles.video_path / image_path に保存する（＝R2の公開URL）
}

async function deleteMyMedia(accessToken, workerUrl) {
  await fetch(`${workerUrl}/media`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/*
// プロフィール保存時の使い方（Supabase と組み合わせ）
const { data: { session } } = await sb.auth.getSession();
const token = session.access_token;

let videoUrl = null, imageUrl = null;
if (pendingVideoBlob) videoUrl = await uploadMedia("video", pendingVideoBlob, token, CONFIG.WORKER_URL);
if (pendingImageBlob) imageUrl = await uploadMedia("image", pendingImageBlob, token, CONFIG.WORKER_URL);

await sb.from("profiles").upsert({
  id: session.user.id,
  name, pref, tags,
  video_path: videoUrl,   // R2の公開URL。app.js はこれを <video src> にそのまま使える
  image_path: imageUrl,
});
await sb.from("private_profiles").upsert({ id: session.user.id, gender });

// 退会時（アカウント削除）
await deleteMyMedia(token, CONFIG.WORKER_URL);
await sb.from("profiles").delete().eq("id", session.user.id); // cascade で likes/matches/messages も消える
*/
