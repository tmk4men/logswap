/**
 * LogSwap i18n（日本語 / English）
 * ---------------------------------------------------------------
 * 方式: 日本語の文字列そのものをキーにする（dict[ja] = en）。
 *  - 静的HTML: applyStatic() が textContent / placeholder / aria-label / title / value を走査して翻訳
 *  - 動的JS  : app.js が I18N.t("日本語") で包む
 * 言語判定: localStorage "logswap_lang" > 端末言語(ja なら日本語、それ以外は英語)
 * 切替: I18N.setLang("en"|"ja") → 保存してリロード
 */
(function () {
  "use strict";

  var DICT = {
    // ---- ブランド / タブ / スワイプ ----
    "ログを交換する相手を探す。スワイプして、おたがいOKでログを見せ合おう。": "Find people to swap logs with. Swipe, and when you both say yes, share your logs.",
    "プロフィール": "Profile", "ログ": "Logs", "スワイプ": "Swipe",
    "交換したい": "Swap", "見送る": "Pass", "見送り": "Pass", "詳しく": "Details", "にっこり": "Smile",
    "ブースト": "Boost", "閉じる": "Close", "メインナビ": "Main navigation",
    "あなたをいいねした人数": "People who liked you", "まだトークを送っていない人数": "People you haven't messaged yet",
    "プロフィールを編集": "Edit profile", "ログを詳しく見る": "See log details",
    "プロフィールのプレビュー": "Profile preview", "プロフィール画像を選ぶ": "Choose profile image",
    "サブ画像を選ぶ": "Choose sub image", "ログの動画を選ぶ": "Choose log video",
    "すべて見終わりました": "You've seen everyone",
    "ドラッグでスワイプ／PCは ← → キーでも操作できます": "Drag to swipe. On desktop, use the ← → keys.",

    // ---- プロフィール作成フォーム ----
    "プロフィールを作成": "Create your profile", "プロフィールを編集": "Edit profile",
    "プレビュー": "Preview", "名前": "Name", "名前を入力してください。": "Please enter a name.",
    "自己紹介（20文字まで）": "Bio (up to 20 chars)", "ひとことどうぞ": "Say hi",
    "ハンドルID": "Handle ID", "半角英数字と _ が使えます。": "Letters, numbers and _ only.",
    "あとから変更できません": "can't be changed later", "ハンドルIDは変更できません。": "Your handle ID can't be changed.",
    "Setlogの招待ID（複数可）": "Setlog invite IDs (multiple)", "招待IDを入力": "Enter an invite ID",
    "交換した招待IDは二度と送信されません。": "A swapped invite ID is never sent again.",
    "住んでいる地域（都道府県）": "Region (prefecture)", "選択してください": "Please select",
    "選択しない": "Prefer not to say", "性別": "Gender", "女性": "Female", "男性": "Male",
    "その他": "Other", "回答しない": "Prefer not to say", "他の人には表示されません。": "Not shown to other users.",
    "ハッシュタグ（3つまで選べます）": "Hashtags (up to 3)",
    "プロフィール画像（1枚）": "Profile image (1)", "画像を選ぶ": "Choose image", "画像を変更": "Change image",
    "サブ画像（任意・1枚）": "Sub image (optional)", "ログの動画（3秒まで・1つ）": "Log video (up to 3s, 1)",
    "動画を選ぶ": "Choose video", "動画を変更": "Change video",
    "私は13歳以上です": "I am 13 or older", "13歳以上の方のみ利用できます。": "Only for ages 13 and older.",
    "利用規約": "Terms", "プライバシーポリシー": "Privacy Policy",
    "に同意します。不適切なコンテンツ・迷惑行為は禁止で、違反者は利用できなくなります。": " apply. Inappropriate content and abuse are prohibited; violators will be banned.",
    "同意が必要です。": "You must agree to continue.",
    "はじめる": "Get started", "保存する": "Save", "保存中…": "Saving…",
    "相手に表示されるプロフィール": "How others see your profile",

    // ---- プロフィールタブ ----
    "未設定": "Not set", "地域未設定": "Region not set", "ログの動画：": "Log video: ",
    "設定済み": "Set", "設定済": "Set",
    "LogSwap プレミアム": "LogSwap Premium", "加入中（月額）": "Subscribed (monthly)", "未加入": "Not subscribed",
    "トークできる人数が無制限": "Unlimited chat partners", "スワイプが無制限": "Unlimited swipes",
    "相手の条件でしぼり込み": "Filter by partner", "購入を復元": "Restore purchases",
    "解約する（デモ）": "Cancel (demo)", "アカウントを削除": "Delete account",
    "アカウントを削除しますか？": "Delete your account?",
    "プロフィール・画像・動画・成立した相手などのデータがすべて消去され、元に戻せません。よろしいですか？":
      "Your profile, images, videos, matches and other data will be permanently deleted. This can't be undone. Continue?",
    "削除する": "Delete", "キャンセル": "Cancel",

    // ---- トーク ----
    "定型文やスタンプであいさつしてみましょう。": "Say hello with a preset phrase or a sticker.",
    "この人との交換を解除する": "Unmatch this person", "交換を解除しますか？": "Unmatch?",
    "この人とのトークが消え、トーク枠が1つ空きます。元に戻せません。":
      "Your chat with this person will be deleted and a chat slot frees up. This can't be undone.",
    "はい": "Yes", "いいえ": "No",
    "初めまして！": "Nice to meet you!", "ありがとうございます！": "Thank you!",
    "趣味が合いそう！": "We might click!", "また今度！": "Next time!", "交換しませんか？": "Want to swap?",

    // ---- 通報・ブロック ----
    "通報する": "Report",
    "理由を選んでください。通報された内容は運営が確認し、規約に違反する場合は対応します。通報した相手は今後表示されません。":
      "Choose a reason. Reports are reviewed by us and acted on if they violate the rules. The reported user won't be shown to you again.",
    "不適切・わいせつなコンテンツ": "Inappropriate / explicit content", "ハラスメント・いやがらせ": "Harassment",
    "スパム・宣伝": "Spam / ads", "なりすまし": "Impersonation", "暴力・違法な内容": "Violence / illegal",
    "通報して非表示にする": "Report and hide", "ブロックしますか？": "Block this user?",
    "この人は今後、あなたに表示されなくなります。": "This person will no longer be shown to you.",
    "ブロックする": "Block",

    // ---- 上限・課金・ブースト ----
    "上限に達しました": "Limit reached",
    "ブーストを使う": "Use Boost", "ブースト中": "Boost active", "使用する（30分）": "Use (30 min)",
    "プレミアムに加入": "Subscribe to Premium",

    // ---- 成立 ----
    "keepSwiping": "Keep swiping", "スワイプを続ける": "Keep swiping",
    " さんとログを交換しました！": " — you swapped logs!",

    // ---- 動的（JSレンダリング） ----
    "上の相手をタップするとトークを始められます。": "Tap someone above to start chatting.",
    "ログを交換すると、ここに相手が表示されます。": "When you swap logs, your matches show up here.",
    "トーク中": "Chatting", "ID交換済": "ID swapped",
    " IDを交換しますか？": " Swap IDs?", " IDを公開しました": " Your ID is now shared",
    "IDを交換しますか？": "Swap IDs?", "IDを公開しました": "Your ID is now shared",
    " OK（IDを公開）": " OK (share my ID)", "自分のIDも公開する": "Share my ID too",
    "あなたの招待ID": "Your invite ID", "相手の招待ID": "Their invite ID",
    "往復の上限です。交換するか、解除してください。": "Message limit reached. Swap IDs or unmatch.",
    "公開できる招待IDがありません。ここで追加できます。": "No invite ID to share. You can add one here.",
    "追加": "Add", "解除する": "Unmatch",
    "さんも交換したがっています！": " wants to swap too!",
    "Setlogの招待ID": "Setlog invite ID",
    "あと": "", "回やりとりすると、ID交換できます": " more messages until you can swap IDs",
    "OKすると、あなたの招待IDが1つ相手へ渡されます": "Tap OK to send one of your invite IDs to them.",
    "保存に失敗しました。通信環境を確認して、もう一度お試しください。": "Save failed. Check your connection and try again.",
    "このハンドルIDは既に使われています。別のIDにしてください。": "That handle ID is taken. Please choose another.",
    "上限解放": "Unlock", "プレミアムに加入（": "Subscribe to Premium (", "／月）": "/mo)",
    "ブーストを買う（": "Buy Boost (", "）": ")",
    "ブースト所持：": "Boost owned: ", "個（スワイプ画面の右上から使えます）": " (use it from the top-right of Swipe)",
    "ブースト中（あと約": "Boost active (about ", "分）": " min left)",
    "30分間、あなたが交換されやすくなります。（所持：": "For 30 minutes you're more likely to be swapped. (Owned: ",
    "個）": ")", "あと約": "about ", "分、あなたが交換されやすくなっています。": " min left — you're boosted.",

    // ---- 言語切替 ----
    "English": "English", "日本語": "日本語", "言語": "Language",
    "。": "", "人": ""
  };

  function detectLang() {
    try {
      var saved = localStorage.getItem("logswap_lang");
      if (saved === "ja" || saved === "en") return saved;
    } catch (e) {}
    var n = (navigator.language || navigator.userLanguage || "ja").toLowerCase();
    return n.indexOf("ja") === 0 ? "ja" : "en";
  }

  var lang = detectLang();
  function t(s) {
    if (lang === "ja" || s == null) return s;
    var key = String(s);
    if (DICT[key] != null) return DICT[key];
    var trimmed = key.trim();
    if (trimmed !== key && DICT[trimmed] != null) return key.replace(trimmed, DICT[trimmed]);
    return s; // 未収録はそのまま（日本語）
  }

  // 静的DOMを翻訳（テキストノード＋属性）。ja のときは何もしない。
  function applyStatic(root) {
    if (lang === "ja") return;
    root = root || document.body;
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) {
      var v = node.nodeValue;
      if (!v) return;
      var trimmed = v.trim();
      if (!trimmed) return;
      if (DICT[trimmed] != null) node.nodeValue = v.replace(trimmed, DICT[trimmed]);
    });
    ["placeholder", "aria-label", "title", "alt"].forEach(function (attr) {
      Array.prototype.forEach.call(root.querySelectorAll("[" + attr + "]"), function (el) {
        var v = el.getAttribute(attr); if (v && DICT[v.trim()] != null) el.setAttribute(attr, DICT[v.trim()]);
      });
    });
    // 見出しの <title>
    if (document.title && DICT[document.title.trim()]) document.title = DICT[document.title.trim()];
    document.documentElement.setAttribute("lang", "en");
  }

  function setLang(l) {
    try { localStorage.setItem("logswap_lang", l === "en" ? "en" : "ja"); } catch (e) {}
    location.reload();
  }

  window.I18N = {
    get lang() { return lang; },
    t: t,
    applyStatic: applyStatic,
    setLang: setLang,
    dict: DICT
  };
})();
