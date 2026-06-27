/**
 * デモ用のモックデータ。
 * 実際のバックエンドはなく、すべてブラウザ内で完結します。
 *
 * 各ユーザーは「セットログ（その日の断片ログ）」を持っています。
 * Setlog の世界観に合わせ、ログは「時刻 + その時間の1コマ写真 + ひとこと」の集合です。
 *
 * 画像は picsum.photos から webp で読み込みます（リポジトリを軽く保つため外部参照）。
 * photo / log[].seed は画像を一意に決めるためのシード文字列です。
 *
 * likesBack: true のユーザーは、あなたが交換したいを出すと成立します（デモ用の擬似マッチング）。
 */
window.MOCK_USERS = [
  {
    id: "u_aoi", name: "あおい", handle: "@aoi_log",
    vibe: "朝活とカフェ巡り",
    bio: "平日の朝がいちばん好き。淡いトーンのログを撮ってます。",
    photo: "logswap-aoi-morning",
    tags: ["朝活", "カフェ", "フィルムっぽい"],
    likesBack: true,
    log: [
      { t: "07:00", seed: "aoi-sunrise", note: "起きてカーテンを開けた" },
      { t: "08:00", seed: "aoi-latte", note: "近所のカフェでラテ" },
      { t: "12:00", seed: "aoi-park", note: "公園でサンドイッチ" },
      { t: "17:00", seed: "aoi-books", note: "図書館で読書" },
      { t: "21:00", seed: "aoi-bath", note: "湯船であったまる" }
    ]
  },
  {
    id: "u_haru", name: "はる", handle: "@haru_days",
    vibe: "音楽とレコ屋",
    bio: "ディグった日のログが多め。おすすめ交換しよ。",
    photo: "logswap-haru-records",
    tags: ["音楽", "レコード", "散歩"],
    likesBack: true,
    log: [
      { t: "10:00", seed: "haru-vinyl", note: "新譜チェック" },
      { t: "13:00", seed: "haru-ramen", note: "二郎系で腹ごしらえ" },
      { t: "15:00", seed: "haru-shop", note: "中古レコ屋でディグ" },
      { t: "19:00", seed: "haru-river", note: "夕暮れの川沿い" },
      { t: "23:00", seed: "haru-keys", note: "宅録ちょっとだけ" }
    ]
  },
  {
    id: "u_rin", name: "りん", handle: "@rin_camera",
    vibe: "写真と散歩",
    bio: "気になった景色をひたすら撮る人。無加工派です。",
    photo: "logswap-rin-street",
    tags: ["写真", "散歩", "無加工"],
    likesBack: false,
    log: [
      { t: "09:00", seed: "rin-arcade", note: "朝の商店街" },
      { t: "11:00", seed: "rin-cat", note: "猫をみつけた" },
      { t: "14:00", seed: "rin-green", note: "緑道をぶらぶら" },
      { t: "18:00", seed: "rin-magic", note: "マジックアワー" },
      { t: "20:00", seed: "rin-onigiri", note: "コンビニで一息" }
    ]
  },
  {
    id: "u_sora", name: "そら", handle: "@sora_gym",
    vibe: "筋トレと自炊",
    bio: "整える系の一日。レシピ交換したいです。",
    photo: "logswap-sora-gym",
    tags: ["筋トレ", "自炊", "サウナ"],
    likesBack: true,
    log: [
      { t: "06:30", seed: "sora-run", note: "朝ラン5km" },
      { t: "08:00", seed: "sora-egg", note: "卵多めの朝食" },
      { t: "12:30", seed: "sora-bento", note: "作り置き弁当" },
      { t: "19:00", seed: "sora-weights", note: "ジムで脚の日" },
      { t: "21:30", seed: "sora-sauna", note: "サウナでととのう" }
    ]
  },
  {
    id: "u_nagi", name: "なぎ", handle: "@nagi_book",
    vibe: "読書と喫茶店",
    bio: "静かな一日のログばかり。栞がわりに交換しませんか。",
    photo: "logswap-nagi-cafe",
    tags: ["読書", "喫茶店", "文具"],
    likesBack: false,
    log: [
      { t: "10:30", seed: "nagi-train", note: "電車で一章" },
      { t: "12:00", seed: "nagi-napolitan", note: "喫茶のナポリタン" },
      { t: "15:00", seed: "nagi-note", note: "ノートに感想" },
      { t: "17:30", seed: "nagi-stationery", note: "文具店で寄り道" },
      { t: "22:00", seed: "nagi-lamp", note: "間接照明で読書" }
    ]
  },
  {
    id: "u_kai", name: "かい", handle: "@kai_trip",
    vibe: "旅と地図",
    bio: "週末はだいたいどこかにいます。移動のログ多め。",
    photo: "logswap-kai-travel",
    tags: ["旅", "電車", "ローカル飯"],
    likesBack: true,
    log: [
      { t: "07:30", seed: "kai-shinkansen", note: "始発で出発" },
      { t: "11:00", seed: "kai-shrine", note: "知らない街の神社" },
      { t: "13:30", seed: "kai-seafood", note: "港町で海鮮丼" },
      { t: "16:00", seed: "kai-alley", note: "路地裏さんぽ" },
      { t: "20:30", seed: "kai-onsen", note: "日帰り温泉" }
    ]
  },
  {
    id: "u_mio", name: "みお", handle: "@mio_cook",
    vibe: "おやつと手づくり",
    bio: "甘いものを作った日のログ。レシピ交換歓迎です。",
    photo: "logswap-mio-bake",
    tags: ["お菓子", "手づくり", "おうち"],
    likesBack: true,
    log: [
      { t: "09:30", seed: "mio-dough", note: "生地づくり" },
      { t: "11:00", seed: "mio-cookies", note: "クッキー焼けた" },
      { t: "14:00", seed: "mio-tea", note: "おやつタイム" },
      { t: "18:00", seed: "mio-hotpot", note: "夜は鍋" },
      { t: "21:00", seed: "mio-movie", note: "映画みながら" }
    ]
  },
  {
    id: "u_yuki", name: "ゆき", handle: "@yuki_night",
    vibe: "夜更かしと作業",
    bio: "夜型の一日。深夜のログが中心です。",
    photo: "logswap-yuki-night",
    tags: ["夜型", "作業", "ゲーム"],
    likesBack: false,
    log: [
      { t: "13:00", seed: "yuki-wake", note: "ゆっくり起床" },
      { t: "16:00", seed: "yuki-desk", note: "作業開始" },
      { t: "20:00", seed: "yuki-ramen", note: "夜のラーメン" },
      { t: "24:00", seed: "yuki-game", note: "深夜ゲーム" },
      { t: "03:00", seed: "yuki-balcony", note: "ベランダで夜風" }
    ]
  }
];
