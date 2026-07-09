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
    "ログの動画（1つだけ・3秒まで）": "Log video (only 1, up to 3s)",
    "動画を選ぶ": "Choose video", "動画を変更": "Change video", "動画を処理中…": "Processing video…",
    "動画の見せ方を調整": "Adjust how your video looks",
    "ドラッグで位置、スライダーで拡大。横向きの動画もそのまま載せられます。": "Drag to reposition, slide to zoom. Landscape videos work too.",
    "全体を表示": "Fit whole", "切り抜き": "Crop to fill", "向きを回転": "Rotate", "拡大": "Zoom", "決定": "Done",
    "動画のプレビュー": "Video preview",
    "動画を選ぶと": "Once you pick a video,", "ここに大きく表示されます": "it will show here, large",
    "動画は3秒までです（選んだ動画は約": "Videos can be up to 3s (this one is about ", "秒）。": "s).",
    "この動画を読み込めませんでした。別の動画をお試しください。": "Couldn't load this video. Please try another one.",
    "わいせつ・暴力・違法・他者を傷つける内容の投稿は禁止です。": "Obscene, violent, illegal, or otherwise harmful content is prohibited.",
    "私は18歳以上です。": "I am 18 or older", "18歳以上の方のみ利用できます。": "Only for ages 18 and older.",
    "利用規約": "Terms", "プライバシーポリシー": "Privacy Policy",
    "お問い合わせ・不適切な内容の報告": "Contact / report inappropriate content",
    "いま購入を開始できません": "Purchase can't start right now",
    "時間をおいて、もう一度お試しください。解決しない場合は下記までご連絡ください。": "Please try again in a little while. If it keeps happening, contact us below.",
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
    "今日のスワイプは終わりです": "You're out of swipes for today",
    "／月": "/mo", "登録する": "Subscribe", "広告を見る": "Watch ad",
    "今日はこれ以上増やせません": "You can't add any more today",
    "月額の自動更新サブスクです。解約しない限り自動更新され、解約は各ストアの購読管理から行えます。":
      "Auto-renewing monthly subscription. It renews automatically unless canceled; manage or cancel it anytime in your store account.",
    "プライバシー": "Privacy", "サブスクを管理": "Manage subscription",
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
    "相手をしぼり込む": "Filter partners", "この機能はプレミアム会員のみ利用できます。": "This feature is for Premium members only.",
    "こだわらない": "Any", "住んでいる地域": "Region", "この条件で表示": "Apply filter",

    // ---- ハッシュタグ（値。#接頭辞は走査で自動付与） ----
    "朝活": "Morning", "カフェ": "Cafe", "音楽": "Music", "映画": "Movies", "読書": "Reading",
    "写真": "Photography", "散歩": "Walking", "筋トレ": "Workout", "自炊": "Cooking", "ゲーム": "Gaming",
    "旅": "Travel", "お菓子": "Sweets", "アニメ": "Anime", "ファッション": "Fashion",
    "アウトドア": "Outdoors", "サウナ": "Sauna",

    // ---- 都道府県 ----
    "北海道": "Hokkaido", "青森県": "Aomori", "岩手県": "Iwate", "宮城県": "Miyagi", "秋田県": "Akita",
    "山形県": "Yamagata", "福島県": "Fukushima", "茨城県": "Ibaraki", "栃木県": "Tochigi", "群馬県": "Gunma",
    "埼玉県": "Saitama", "千葉県": "Chiba", "東京都": "Tokyo", "神奈川県": "Kanagawa", "新潟県": "Niigata",
    "富山県": "Toyama", "石川県": "Ishikawa", "福井県": "Fukui", "山梨県": "Yamanashi", "長野県": "Nagano",
    "岐阜県": "Gifu", "静岡県": "Shizuoka", "愛知県": "Aichi", "三重県": "Mie", "滋賀県": "Shiga",
    "京都府": "Kyoto", "大阪府": "Osaka", "兵庫県": "Hyogo", "奈良県": "Nara", "和歌山県": "Wakayama",
    "鳥取県": "Tottori", "島根県": "Shimane", "岡山県": "Okayama", "広島県": "Hiroshima", "山口県": "Yamaguchi",
    "徳島県": "Tokushima", "香川県": "Kagawa", "愛媛県": "Ehime", "高知県": "Kochi", "福岡県": "Fukuoka",
    "佐賀県": "Saga", "長崎県": "Nagasaki", "熊本県": "Kumamoto", "大分県": "Oita", "宮崎県": "Miyazaki",
    "鹿児島県": "Kagoshima", "沖縄県": "Okinawa",

    "。": "", "人": "",

    // ---- 長文（規約・プライバシー本文）: data-i18n-html で innerHTML ごと差し替え ----
    "privacyBody": `<p>This Privacy Policy explains how this app ("the Service") handles your personal information.</p><h3>1. Information we collect</h3><p>Name, bio, handle ID, region (prefecture or country), gender, hashtags, profile image, log video, and Setlog invite IDs. We also collect an anonymous account ID issued automatically for using the Service, and records of your likes, matches, chats, and blocks/reports. Your gender is not shown to other users.</p><h3>2. Purpose of use</h3><p>We use the information to create and display profiles, provide the log-exchange features (matching, chat, ID exchange), respond to abuse, and operate and improve the Service. We do not use it beyond these purposes.</p><h3>3. Storage and external services</h3><p>Your information is stored on external cloud services used by the Service. Profile and chat data are stored on Supabase (database and authentication), and images and videos on Cloudflare R2, transmitted over encrypted (HTTPS) connections. These servers may be located outside Japan.</p><h3>4. Sharing and processors</h3><p>Except as required by law, we do not provide your information to third parties without your consent. When a log exchange is matched, the information shown on your profile and any Setlog invite ID you disclose are shared with the matched partner. We also entrust data handling to Supabase Inc. and Cloudflare, Inc. for the storage and operation described above.</p><h3>5. Advertising</h3><p>The Service offers some free features (such as extra swipes and extra chat slots) in exchange for viewing rewarded video ads. Ads are delivered via Google AdMob. To show, optimize, and measure ads, your device's advertising ID, approximate location, and usage data may be collected and used by Google LLC. See Google's Privacy Policy (policies.google.com/privacy) for details. You can turn off ad personalization in your device settings.</p><h3>6. Deleting your account and data</h3><p>You can delete your account and all related data (profile, images, videos, matches, chats, blocks/reports, etc.), including data on our servers, at any time from "Delete account" in the Profile tab. Deletion is permanent.</p><h3>7. Age requirement</h3><p>The Service is only for users aged 18 and older.</p><h3>8. Contact</h3><p>For inquiries about the handling of personal information, contact the operator at tomokiskriiiabc@gmail.com.</p>`,
    "termsBody": `<p>These Terms set out the conditions for using the Service. Please read them before use. By using the Service, you are deemed to have agreed to these Terms.</p><h3>1. The Service</h3><p>The Service provides only the "matching" that helps users find exchange partners. The operator is not involved in and bears no responsibility for the IDs or contact details that users exchange or disclose after matching, or for any subsequent interactions, transactions, or meetings between users.</p><h3>2. Eligibility and age</h3><p>The Service is only for users aged 18 and older. Registration information must be accurate, and each person may hold one account. False declarations and impersonation are prohibited.</p><h3>3. Prohibited conduct (zero tolerance)</h3><p>The following are strictly prohibited. If a violation is confirmed, we may remove content, suspend use, or delete the account without prior notice.</p><p>&bull; Obscene content, sexual content involving minors, or explicit sexual content<br>&bull; Violent, discriminatory, threatening, insulting, or harassing content<br>&bull; Illegal acts or content that promotes crime<br>&bull; Impersonation or posting personal information without consent<br>&bull; Solicitation for dating or compensated relationships, or use for sexual purposes<br>&bull; Spam or ads steering users to external contacts (LINE, Instagram, etc.), and anything else the operator deems inappropriate</p><h3>4. Reporting, blocking, and handling of inappropriate content</h3><p>The Service has zero tolerance for abuse and inappropriate content. Users can report or block inappropriate content or users from each profile. Blocked users are no longer shown to you. The operator reviews reports and responds promptly to violations.</p><h3>5. User content</h3><p>Users warrant that they hold the necessary rights to the profile, images, and videos they post and that they do not infringe the rights of third parties. Users grant the operator a license to use such content to the extent necessary to provide and display the Service.</p><h3>6. Paid services (Premium and items)</h3><p>Premium is an auto-renewing monthly subscription. Billing, renewal, and cancellation are handled from your account settings in the store where you purchased (App Store / Google Play). It renews automatically unless canceled. Cancellation must be made a certain time before the next renewal date (per each store's rules). Refunds are not provided in principle, except as required by law or by each store's refund policy. Single-use items such as Boost cannot be refunded after use. Prices and contents may change; continued use after a change constitutes agreement to it.</p><h3>7. Changes, suspension, and termination</h3><p>The operator may change, suspend, or terminate all or part of the Service at any time, with or without prior notice. To the extent permitted by law, the operator is not liable for any resulting damages. Upon termination, user data stored on servers may be deleted.</p><h3>8. Disclaimer</h3><p>The Service is provided as is, and the operator makes no warranties as to fitness for a particular purpose or the outcome of interactions between users. To the extent permitted by law, the operator is not liable for any damages arising from use of the Service.</p><h3>9. Changes to these Terms</h3><p>The operator may change these Terms when it deems necessary. Continued use after a change constitutes agreement to the changed Terms.</p>`
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
      if (DICT[trimmed] != null) { node.nodeValue = v.replace(trimmed, DICT[trimmed]); return; }
      // "#タグ" → "#Tag"
      if (trimmed.charAt(0) === "#" && DICT[trimmed.slice(1)] != null) {
        node.nodeValue = v.replace(trimmed, "#" + DICT[trimmed.slice(1)]);
      }
    });
    // 長文（インラインタグ入り）は data-i18n-html="キー" で innerHTML ごと差し替え
    Array.prototype.forEach.call(root.querySelectorAll("[data-i18n-html]"), function (el) {
      var k = el.getAttribute("data-i18n-html");
      if (DICT[k] != null) el.innerHTML = DICT[k];
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
