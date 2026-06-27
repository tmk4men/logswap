/**
 * デモ用のモックデータ。
 * 実際のバックエンドはなく、すべてブラウザ内で完結します。
 *
 * 各ユーザーは「セットログ（その日の断片ログ）」を持っています。
 * Setlog の世界観に合わせ、ログは「時刻 + 2秒クリップを表す絵文字 + ひとこと」の集合です。
 *
 * likesBack: true のユーザーは、あなたが◯を出すと交換が成立します（デモ用の擬似マッチング）。
 */
window.MOCK_USERS = [
  {
    id: "u_aoi",
    name: "あおい",
    handle: "@aoi_log",
    vibe: "朝活とカフェ巡り",
    bio: "平日の朝がいちばん好き。淡いトーンのログを撮ってます。",
    color: ["#ffd1ff", "#fad0c4"],
    emoji: "🌸",
    tags: ["朝活", "カフェ", "フィルムっぽい"],
    likesBack: true,
    log: [
      { t: "07:00", clip: "☀️", note: "起きてカーテン開けた" },
      { t: "08:00", clip: "☕️", note: "近所のカフェでラテ" },
      { t: "12:00", clip: "🥪", note: "公園でサンドイッチ" },
      { t: "17:00", clip: "📚", note: "図書館で読書" },
      { t: "21:00", clip: "🛁", note: "湯船であったまる" }
    ]
  },
  {
    id: "u_haru",
    name: "はる",
    handle: "@haru_days",
    vibe: "音楽とレコ屋",
    bio: "ディグった日のログが多め。おすすめ交換しよ。",
    color: ["#a1c4fd", "#c2e9fb"],
    emoji: "🎧",
    tags: ["音楽", "レコード", "散歩"],
    likesBack: true,
    log: [
      { t: "10:00", clip: "🎶", note: "新譜チェック" },
      { t: "13:00", clip: "🍜", note: "二郎系で腹ごしらえ" },
      { t: "15:00", clip: "💿", note: "中古レコ屋でディグ" },
      { t: "19:00", clip: "🌆", note: "夕暮れの川沿い" },
      { t: "23:00", clip: "🎹", note: "宅録ちょっとだけ" }
    ]
  },
  {
    id: "u_rin",
    name: "りん",
    handle: "@rin_camera",
    vibe: "写真と散歩",
    bio: "気になった景色をひたすら撮る人。無加工派。",
    color: ["#d4fc79", "#96e6a1"],
    emoji: "📷",
    tags: ["写真", "散歩", "無加工"],
    likesBack: false,
    log: [
      { t: "09:00", clip: "🚶", note: "朝の商店街" },
      { t: "11:00", clip: "🐈", note: "猫みつけた" },
      { t: "14:00", clip: "🌳", note: "緑道をぶらぶら" },
      { t: "18:00", clip: "🌇", note: "マジックアワー" },
      { t: "20:00", clip: "🍙", note: "コンビニで一息" }
    ]
  },
  {
    id: "u_sora",
    name: "そら",
    handle: "@sora_gym",
    vibe: "筋トレと自炊",
    bio: "整える系の一日。プロテインレシピ交換したい。",
    color: ["#84fab0", "#8fd3f4"],
    emoji: "💪",
    tags: ["筋トレ", "自炊", "サウナ"],
    likesBack: true,
    log: [
      { t: "06:30", clip: "🏃", note: "朝ラン5km" },
      { t: "08:00", clip: "🥚", note: "卵多めの朝食" },
      { t: "12:30", clip: "🍱", note: "作り置き弁当" },
      { t: "19:00", clip: "🏋️", note: "ジムで脚の日" },
      { t: "21:30", clip: "🧖", note: "サウナでととのう" }
    ]
  },
  {
    id: "u_nagi",
    name: "なぎ",
    handle: "@nagi_book",
    vibe: "読書と喫茶店",
    bio: "静かな一日のログばかり。栞がわりに交換しませんか。",
    color: ["#fbc2eb", "#a6c1ee"],
    emoji: "📖",
    tags: ["読書", "喫茶店", "文具"],
    likesBack: false,
    log: [
      { t: "10:30", clip: "🚃", note: "電車で一章" },
      { t: "12:00", clip: "🍝", note: "喫茶のナポリタン" },
      { t: "15:00", clip: "✍️", note: "ノートに感想" },
      { t: "17:30", clip: "🛍️", note: "文具店で寄り道" },
      { t: "22:00", clip: "🕯️", note: "間接照明で読書" }
    ]
  },
  {
    id: "u_kai",
    name: "かい",
    handle: "@kai_trip",
    vibe: "旅と地図",
    bio: "週末はだいたいどこかにいます。移動のログ多め。",
    color: ["#ff9a9e", "#fecfef"],
    emoji: "🧭",
    tags: ["旅", "電車", "ローカル飯"],
    likesBack: true,
    log: [
      { t: "07:30", clip: "🚄", note: "始発で出発" },
      { t: "11:00", clip: "⛩️", note: "知らない街の神社" },
      { t: "13:30", clip: "🍣", note: "港町で海鮮丼" },
      { t: "16:00", clip: "🗺️", note: "路地裏さんぽ" },
      { t: "20:30", clip: "♨️", note: "日帰り温泉" }
    ]
  },
  {
    id: "u_mio",
    name: "みお",
    handle: "@mio_cook",
    vibe: "おやつと手づくり",
    bio: "甘いものを作った日のログ。レシピ交換歓迎。",
    color: ["#f6d365", "#fda085"],
    emoji: "🧁",
    tags: ["お菓子", "手づくり", "おうち"],
    likesBack: true,
    log: [
      { t: "09:30", clip: "🥣", note: "生地づくり" },
      { t: "11:00", clip: "🍪", note: "クッキー焼けた" },
      { t: "14:00", clip: "🍰", note: "おやつタイム" },
      { t: "18:00", clip: "🍲", note: "夜は鍋" },
      { t: "21:00", clip: "📺", note: "映画みながら" }
    ]
  },
  {
    id: "u_yuki",
    name: "ゆき",
    handle: "@yuki_night",
    vibe: "夜更かしと作業",
    bio: "夜型の一日。深夜のログが中心です。",
    color: ["#30cfd0", "#330867"],
    emoji: "🌙",
    tags: ["夜型", "作業", "ゲーム"],
    likesBack: false,
    log: [
      { t: "13:00", clip: "🛌", note: "ゆっくり起床" },
      { t: "16:00", clip: "💻", note: "作業開始" },
      { t: "20:00", clip: "🍜", note: "夜のラーメン" },
      { t: "24:00", clip: "🎮", note: "深夜ゲーム" },
      { t: "03:00", clip: "🌌", note: "ベランダで夜風" }
    ]
  }
];
