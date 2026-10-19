// ===============================================
// ゲームの数値・カードデータ
// ここの数字を書き換えるだけでバランス調整ができます。
// （試遊で詰める前提の「たたき台」です）
// ===============================================

const CONFIG = {
  // 各層のマス数と固定マス（番号は0から、12時の位置から時計回り）
  // 内側が第1層、外側が第3層。第3層の出口から脱出するのが目標。
  layers: [
    { n: 10, fixed: { 0: 'start', 5: 'stairsUp', 8: 'boss' }, sp: 2 },
    { n: 14, fixed: { 7: 'stairsDown', 0: 'stairsUp', 11: 'boss' }, sp: 2 },
    { n: 18, fixed: { 0: 'stairsDown', 9: 'exit', 5: 'boss' }, sp: 2 },
  ],
  // 固定マス以外のマスの割合（合計10）
  squareMix: { monster: 4, treasure: 2, event: 2, trap: 1, empty: 1 },

  // レベル到達に必要な累計経験値（index = レベル）
  xpTable: [0, 0, 2, 4, 7, 11, 16, 22],
  maxLv: 7,
  rareLevels: [3, 5, 7],   // この レベルのドラフトは「通常2枚＋レア1枚」
  specialLevel: 5,         // 必殺技が使えるレベル
  exApMax: 3,              // エクストラAPのストック上限
  asCap: 3,                // AS（アクションスキル）の所持上限

  combatDice: 2,           // 戦闘職が手番の最初に振るダイスの数（出目を見てから移動・行動に割り振る）

  fleeTarget: 4,           // 逃走：🎲この値以上で成功（AP1）
  lockTarget: 5,           // 鍵付き宝箱を素で開ける：🎲この値以上（AP2）
  lockApCost: 2,
  trapHit: 3,              // 罠：🎲この値以下でダメージ
  trapDamage: [2, 3, 4],   // 層ごとの罠ダメージ
  spNeeded: 2,             // 探索職の脱出に必要なSPトレジャー数
  spXp: 2,                 // SPトレジャーを開けたときの経験値
  finalBossLayer: 3,       // 戦闘職はこの層のボスを倒すと出口が開く
};

// ジョブ（初期ステは固定、成長も固定表）
const JOBS = {
  warrior: {
    name: '戦士', kind: '戦闘職',
    hp: 8, atk: 2, ap: 2,
    apRegen: 'full',      // 毎ターンAP全回復
    moveDie: 'full',      // 移動は🎲の出目そのまま
    movesPerTurn: 1,      // ダイスはターン1回（EX APで追加可）
    canFlee: false,
    startPs: 'tousi',
    escape: 'boss',
    growth: { 2: { maxHp: 2 }, 3: { atk: 1 }, 4: { maxHp: 2 }, 5: { maxAp: 1 }, 6: { maxHp: 3 }, 7: { atk: 1 } },
    desc: 'ダイスはターン1回。ATK＋🎲で殴る。第3層のボスを倒すと出口が開く。',
  },
  thief: {
    name: '盗賊', kind: '探索職',
    hp: 6, atk: 0, ap: 3,
    apRegen: 2,           // 毎ターンAP+2（最大値まで）
    moveDie: 'half',      // 移動は🎲の半分（切り上げ）
    canFlee: true,
    startPs: 'kagishi',
    escape: 'sp',
    exploreXp: 1,         // 宝箱・イベント・逃走成功で経験値+1（探索で育つ）
    bossOptional: true,   // ボスマスに止まっても戦わずに通り過ぎられる
    growth: { 2: { maxHp: 2 }, 3: { atk: 1 }, 4: { maxHp: 2 }, 5: { maxAp: 1 }, 6: { maxHp: 2 }, 7: { atk: 1 } },
    desc: 'AP1でダイス1回、APがある限り何度でも動ける。攻撃は🎲のみ。戦闘から逃げられる。宝箱・イベント・逃走成功で経験値+1。ボスは戦わずに通り過ぎられる。SPトレジャー2つで出口が開く。',
  },
};

// パッシブスキル（PS）。mod の数値が能力に加算されます。
const PS = {
  // 初期PS
  tousi:     { name: '闘志',   text: '戦闘で最初の攻撃のダメージ+2', mod: { firstStrike: 2 } },
  kagishi:   { name: '鍵師',   text: '素の鍵開け判定+2、逃走判定+1', mod: { lockBonus: 2, fleeBonus: 1 } },
  // 通常
  tanren:    { name: '鍛錬',   text: 'ATK+1', mod: { atk: 1 } },
  ganjou:    { name: '頑丈',   text: '最大HP+3', mod: { maxHp: 3 } },
  shunsoku:  { name: '俊足',   text: '移動のマス数+1', mod: { move: 1 } },
  shuchu:    { name: '集中',   text: '最大AP+1', mod: { maxAp: 1 } },
  saisei:    { name: '再生',   text: 'ターン開始時にHP+1', mod: { regen: 1 } },
  karyudo:   { name: '狩人',   text: 'モンスター撃破時の経験値+1', mod: { hunter: 1 } },
  kaihi:     { name: '回避',   text: '敵の反撃ダメージ-1', mod: { dodge: 1 } },
  wanakanchi:{ name: '罠感知', text: '罠のダメージを受けない', mod: { trapSense: 1 } },
  nigeashi:  { name: '逃げ足', text: '戦闘から逃走できる（戦闘職も）。逃走判定+1', mod: { canFlee: 1, fleeBonus: 1 } },
  shushuka:  { name: '収集家', text: 'ASの所持上限+1', mod: { asCap: 1 } },
  mekiki:    { name: '目利き', text: 'トレジャーを得るたびにASを1枚引く', mod: { treasureAs: 1 } },
  // レア（所持は1枚まで）
  gouriki:   { name: '剛力',     rare: true, text: 'ATK+2', mod: { atk: 2 } },
  fukutsu:   { name: '不屈',     rare: true, text: '最大HP+5', mod: { maxHp: 5 } },
  sippu:     { name: '疾風',     rare: true, text: '移動のマス数+2', mod: { move: 2 } },
  eiyu:      { name: '英雄の血', rare: true, text: '必殺技をLv3から使える。必殺技のダメージ+3', mod: { specialEarly: 1, specialBonus: 3 } },
  kouun:     { name: '幸運',     rare: true, text: 'ダイスで1が出たら自動で振り直す', mod: { lucky: 1 } },
  kyuukaku:  { name: '宝の嗅覚', rare: true, text: '鍵付き宝箱を必ず開けられ、開けるとASを1枚引く', mod: { autoLock: 1 } },
};
// 山の構成（枚数）
const PS_DECK = { tanren: 2, ganjou: 2, shunsoku: 2, shuchu: 2, saisei: 2, karyudo: 2, kaihi: 2, wanakanchi: 1, kagishi: 1, tousi: 1, nigeashi: 1, shushuka: 1, mekiki: 1 };
const PS_RARE_DECK = { gouriki: 1, fukutsu: 1, sippu: 1, eiyu: 1, kouun: 1, kyuukaku: 1 };

// アクションスキル（AS）。使い捨て。cost はAP。
// when: battle=戦闘中 / field=自分の手番中 / any=どちらでも / lock=宝箱の前 / trap=罠にかかったとき
const AS = {
  kyouda:    { name: '強打',     cost: 1, when: 'battle', effect: 'strong', text: '攻撃する。ダメージ+3' },
  senpu:     { name: '旋風斬',   cost: 1, when: 'battle', effect: 'sweep',  text: '敵全体に3ダメージ（全体攻撃）' },
  kaifuku:   { name: '回復薬',   cost: 1, when: 'any',    effect: 'heal',   text: 'HP+4' },
  shissou:   { name: '疾走',     cost: 1, when: 'field',  effect: 'dash',   text: '次の移動のマス数+3' },
  kitsuke:   { name: '気付け薬', cost: 0, when: 'any',    effect: 'apup',   text: 'AP+2（最大値まで）' },
  kagiake:   { name: '鍵開け',   cost: 0, when: 'lock',   effect: 'unlock', text: '鍵付き宝箱を確実に開ける' },
  wanakaijo: { name: '罠解除',   cost: 0, when: 'trap',   effect: 'disarm', text: '罠を無効にする' },
  kemuri:    { name: '煙玉',     cost: 1, when: 'battle', effect: 'smoke',  text: '戦闘から確実に逃げる（ボスからも）' },
  tate:      { name: '守りの盾', cost: 1, when: 'battle', effect: 'shield', text: '次の敵の反撃を0にする' },
};
const AS_DECK = { kyouda: 4, senpu: 3, kaifuku: 4, shissou: 2, kitsuke: 2, kagiake: 2, wanakaijo: 2, kemuri: 2, tate: 1 };

// モンスター（層ごと）。count が2以上なら「群れ」（1体ずつ倒す。全体攻撃が有効）
// as: true なら撃破時にASを1枚引く
const MONSTERS = [
  [ // 第1層
    { name: 'スライム',         hp: 3, atk: 1, xp: 1, n: 2 },
    { name: 'ゴブリン',         hp: 4, atk: 2, xp: 1, as: true, n: 2 },
    { name: 'コウモリの群れ',   hp: 2, atk: 1, count: 2, xp: 1, n: 2 },
    { name: '骸骨兵',           hp: 5, atk: 2, xp: 2, n: 1 },
    { name: '毒グモ',           hp: 4, atk: 2, xp: 1, as: true, n: 1 },
  ],
  [ // 第2層
    { name: 'オーク',           hp: 7, atk: 3, xp: 2, as: true, n: 2 },
    { name: 'ゴブリンの群れ',   hp: 3, atk: 1, count: 3, xp: 2, n: 2 },
    { name: '狼の群れ',         hp: 4, atk: 2, count: 2, xp: 2, n: 1 },
    { name: 'リザードマン',     hp: 8, atk: 3, xp: 3, n: 1 },
    { name: '呪術師',           hp: 6, atk: 4, xp: 2, as: true, n: 2 },
  ],
  [ // 第3層
    { name: 'トロル',           hp: 11, atk: 4, xp: 3, n: 2 },
    { name: '骸骨騎士',         hp: 10, atk: 4, xp: 3, as: true, n: 2 },
    { name: '悪魔の群れ',       hp: 4, atk: 2, count: 3, xp: 3, n: 2 },
    { name: '闇の魔導士',       hp: 8, atk: 5, xp: 3, as: true, n: 1 },
    { name: 'ガーゴイル',       hp: 12, atk: 3, xp: 4, n: 1 },
  ],
];

// ボス（各層1体。倒されても次の挑戦者のために復活する）
const BOSSES = [
  { name: 'ゴブリンキング', hp: 10, atk: 3, xp: 3, as: true },
  { name: 'ミノタウロス',   hp: 15, atk: 4, xp: 4, as: true },
  { name: '古竜',           hp: 22, atk: 5, xp: 5 },
];

// トレジャー（共通の山）
const TREASURES = {
  as1:     { name: '古びた巻物',   effect: 'as',     text: 'ASを1枚引く', n: 6 },
  yakusou: { name: '薬草',         effect: 'heal',   text: 'HP+3', n: 4 },
  sho:     { name: '経験の書',     effect: 'xp',     text: '経験値+2', n: 3 },
  kakera:  { name: '力の欠片',     effect: 'exap',   text: 'エクストラAP+1', n: 3 },
  hiyaku:  { name: '秘薬',         effect: 'full',   text: 'HP全快', n: 2 },
  mimic:   { name: 'ミミック！',   effect: 'mimic',  text: '宝箱は化け物だった。戦闘！', n: 2 },
};

// ダンジョンの鼓動（ラウンドの終わりに1枚めくる。全員に効く）
const PULSE = {
  zouen:     { name: '増援',         effect: 'spawn',   text: '各層の通路（または空になった部屋）1マスにモンスターが住みつく', n: 3 },
  mezame:    { name: 'ボスの目覚め', effect: 'bossAtk', value: 1, text: '次の鼓動まで、ボスのATK+1', n: 2 },
  izumi:     { name: '癒しの泉',     effect: 'healAll', value: 2, text: '全員HP+2', n: 2 },
  takara:    { name: '宝の再生',     effect: 'refill',  text: '各層の空になった宝箱1つに宝が戻る', n: 2 },
  kiri:      { name: '濃い霧',       effect: 'fog',     value: 1, text: '次の鼓動まで、移動のマス数-1（最低1）', n: 2 },
  seijaku:   { name: '静寂',         effect: 'none',    text: '何も起きない', n: 2 },
  oikaze:    { name: '追い風',       effect: 'catchup', value: 2, text: 'いちばんレベルが低い人（全員同じなら誰も）が経験値+2', n: 2 },
};
// 出口が閉じ始めるラウンド（この範囲のどこか。山札の後半に「出口が閉じ始める」を混ぜるのと同じ）と、閉じるまでのラウンド数
const PULSE_CONFIG = { closeRound: [20, 24], closeCountdown: 3 };
