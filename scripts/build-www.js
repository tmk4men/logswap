/**
 * Capacitor 用の www/ を生成するビルドスクリプト。
 *
 * GitHub Pages 用のルート構成（ランディング = index.html）はそのままに、
 * ネイティブアプリ用の配信ディレクトリ www/ をここで組み立てます。
 *
 *   www/index.html   ← app.html（アプリ起動時はスワイプ画面に直行）
 *   www/landing.html ← index.html（アプリ内から見られる紹介ページ）
 *   www/{css,js,assets} ← そのままコピー
 *
 * ページ間リンクはネイティブ側のファイル名に合わせて貼り替えます。
 *   app.html 内の  href="index.html"  → href="landing.html"
 *   index.html 内の href="app.html"   → href="index.html"
 */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "www");

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// fs.cpSync は Windows/OneDrive で segfault することがあるため手動再帰コピー
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

function copyDir(name) {
  const src = path.join(ROOT, name);
  if (!fs.existsSync(src)) return;
  copyRecursive(src, path.join(OUT, name));
}

function readReplaceWrite(srcName, outName, replacers) {
  let html = fs.readFileSync(path.join(ROOT, srcName), "utf8");
  for (const [from, to] of replacers) html = html.split(from).join(to);
  fs.writeFileSync(path.join(OUT, outName), html);
}

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

// 静的アセット
copyDir("css");
copyDir("js");
copyDir("assets");

// 起動画面（スワイプ）= app.html → index.html
readReplaceWrite("app.html", "index.html", [['href="index.html"', 'href="landing.html"']]);

// アプリ内の紹介ページ = index.html → landing.html
readReplaceWrite("index.html", "landing.html", [['href="app.html"', 'href="index.html"']]);

console.log("built www/ (index.html=swipe, landing.html=intro)");
