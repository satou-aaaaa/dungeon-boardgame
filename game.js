'use strict';
// ===============================================
// ゲーム進行（数値やカードは data.js）
// ===============================================

const COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419'];
const ICONS = { monster: '👹', boss: '💀', treasure: '💰', event: '✨', trap: '⚠️', empty: '', start: '🚩', stairsUp: '⬆️', stairsDown: '⬇️', sp: '👑', exit: '🚪' };
const SQ_NAME = { monster: 'モンスター', boss: 'ボス', treasure: 'トレジャー', event: 'イベント', trap: '罠', empty: '通路', start: 'スタート', stairsUp: '上り階段', stairsDown: '下り階段', sp: 'SPトレジャー（鍵付き）', exit: '出口' };
const SPECIAL_STOP = new Set(['stairsUp', 'stairsDown', 'boss', 'sp', 'exit']);
const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const STAT_LABEL = { maxHp: '最大HP', atk: 'ATK', maxAp: '最大AP' };
const SAVE_KEY = 'dungeon-bg-save-v2'; // v2: ダイスの割り振りと鼓動デッキ

let S = null;      // ゲーム状態
let busy = false;  // 処理中は操作を受け付けない

const $ = (s) => document.querySelector(s);
const rnd = (n) => Math.floor(Math.random() * n);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function makeDeck(counts) { const d = []; for (const [id, n] of Object.entries(counts)) for (let i = 0; i < n; i++) d.push(id); return shuffle(d); }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const cur = () => S.players[S.cur];
const pname = (p) => `<b style="color:${p.color}">${esc(p.name)}</b>`;

// ---------- 状態の生成 ----------
function buildBoard() {
  return CONFIG.layers.map((L) => {
    const arr = Array(L.n).fill(null);
    for (const [i, t] of Object.entries(L.fixed)) arr[i] = { type: t };
    const free = shuffle(arr.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0));
    for (let k = 0; k < L.sp; k++) arr[free.pop()] = { type: 'sp' };
    const pattern = [];
    for (const [t, n] of Object.entries(CONFIG.squareMix)) for (let i = 0; i < n; i++) pattern.push(t);
    let pool = [];
    while (pool.length < free.length) pool.push(...shuffle([...pattern]));
    for (const i of free) arr[i] = { type: pool.pop() };
    return arr;
  });
}

function newGame(setup) {
  const monsterDecks = {}; const monsterDiscards = {};
  MONSTERS.forEach((list, li) => {
    const counts = {}; list.forEach((m, i) => { counts[i] = m.n || 1; });
    monsterDecks['m' + li] = makeDeck(counts); monsterDiscards['m' + li] = [];
  });
  const trCounts = {}; for (const [id, t] of Object.entries(TREASURES)) trCounts[id] = t.n;
  const pulseCounts = {}; for (const [id, c] of Object.entries(PULSE)) pulseCounts[id] = c.n;
  S = {
    players: setup.map((s, i) => {
      const j = JOBS[s.job];
      return {
        name: s.name, job: s.job, color: COLORS[i], lv: 1, xp: 0, hp: j.hp, ap: j.ap, exAp: 0,
        ps: [j.startPs], as: [], layer: 0, pos: 0, pool: [], movesLeft: 0, dash: 0, rest: false,
        bossKills: [], sp: 0, turns: 0,
      };
    }),
    cur: 0, round: 1, board: buildBoard(),
    decks: { ...monsterDecks, tr: makeDeck(trCounts), as: makeDeck(AS_DECK), ps: makeDeck(PS_DECK), psr: makeDeck(PS_RARE_DECK), pulse: makeDeck(pulseCounts) },
    discards: { ...monsterDiscards, tr: [], as: [], pulse: [] },
    log: [], phase: 'action', dests: null, winner: null, lost: false, lastRoll: null,
    pulseFx: {}, pulseCard: null, closeAt: PULSE_CONFIG.closeRound[0] + rnd(PULSE_CONFIG.closeRound[1] - PULSE_CONFIG.closeRound[0] + 1), closeLeft: null,
  };
  log('冒険が始まった。第3層（いちばん外側）の出口から脱出しよう！');
}

function draw(key) {
  const d = S.decks[key];
  if (!d.length && S.discards[key] && S.discards[key].length) { d.push(...shuffle(S.discards[key])); S.discards[key] = []; }
  return d.length ? d.pop() : null;
}

function log(msg) { S.log.unshift({ r: S.round, msg }); if (S.log.length > 300) S.log.length = 300; }
function save() { try { if (S && !S.winner) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) { /* 保存できなくても遊べる */ } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* noop */ } }
function loadSave() { try { const t = localStorage.getItem(SAVE_KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; } }

// ---------- 能力値 ----------
function st(p) {
  const j = JOBS[p.job];
  const s = { maxHp: j.hp, atk: j.atk, maxAp: j.ap, move: 0, asCap: CONFIG.asCap, firstStrike: 0, lockBonus: 0, fleeBonus: 0, regen: 0, hunter: 0, dodge: 0, trapSense: 0, canFlee: j.canFlee ? 1 : 0, treasureAs: 0, specialEarly: 0, specialBonus: 0, lucky: 0, autoLock: 0 };
  for (let l = 2; l <= p.lv; l++) { const g = j.growth[l]; if (g) for (const k in g) s[k] += g[k]; }
  for (const id of p.ps) { const m = PS[id].mod; for (const k in m) s[k] = (s[k] || 0) + m[k]; }
  return s;
}
function roll(p) {
  let r = 1 + rnd(6);
  if (r === 1 && st(p).lucky) { r = 1 + rnd(6); log(`${p.name} の幸運：1を振り直して ${r}`); }
  return r;
}
const canPay = (p, c) => p.ap + p.exAp >= c;
function pay(p, c) {
  if (!canPay(p, c)) return false;
  const a = Math.min(p.ap, c); p.ap -= a;
  const ex = c - a; if (ex) { p.exAp -= ex; log(`${p.name} はエクストラAPを${ex}使った`); }
  return true;
}
const isCombat = (p) => JOBS[p.job].apRegen === 'full';
// ダイスの割り振り：振ったダイスは「手元のダイス」（p.pool）に置き、出目を見てから移動・攻撃・鍵開け・逃走などに使う。
// 戦闘職は手番の最初に2個振る（移動は1手番1回、EX APでダイス+1個と移動+1回）。探索職はAP1ごとに1個振れる。使わなかったダイスは手番の終わりに消える。
function canMove(p) { return p.hp > 0 && p.pool.length > 0 && p.movesLeft > 0; }
function canRoll(p) { if (p.hp <= 0) return false; return isCombat(p) ? p.exAp > 0 : canPay(p, 1); }
function rollText(p) { return isCombat(p) ? 'EX AP1でダイスを1個足す（移動+1回）' : `AP1でダイスを1個振る${p.ap >= 1 ? '' : '（EX AP）'}`; }
function useDie(p, i) { const [v] = p.pool.splice(i, 1); return v; }
const dieBtns = (p, prefix, fmt) => p.pool.map((v, i) => ({ v, i })).filter((d, k, a) => a.findIndex((x) => x.v === d.v) === k).sort((a, b) => b.v - a.v)
  .map((d) => ({ label: fmt(d.v), value: prefix + d.i, cls: 'die' }));
function canSpecial(p) { const s = st(p); return p.lv >= (s.specialEarly ? 3 : CONFIG.specialLevel) && s.maxAp > 0 && p.ap >= s.maxAp; }
function canEscape(p) { return JOBS[p.job].escape === 'boss' ? p.bossKills.includes(CONFIG.finalBossLayer) : p.sp >= CONFIG.spNeeded; }
function escapeText(p) {
  return JOBS[p.job].escape === 'boss'
    ? `第${CONFIG.finalBossLayer}層のボス撃破 ${p.bossKills.includes(CONFIG.finalBossLayer) ? '✅' : '❌'}`
    : `SPトレジャー ${p.sp}/${CONFIG.spNeeded} ${p.sp >= CONFIG.spNeeded ? '✅' : ''}`;
}

// ---------- モーダル / トースト ----------
function modal({ title, html, buttons }) {
  return new Promise((res) => {
    const m = $('#modal');
    m.querySelector('.m-title').innerHTML = title;
    m.querySelector('.m-body').innerHTML = html || '';
    const bt = m.querySelector('.m-buttons'); bt.innerHTML = '';
    for (const b of buttons) {
      const e = document.createElement('button');
      e.className = 'btn ' + (b.cls || ''); e.innerHTML = b.label; e.disabled = !!b.disabled;
      if (b.title) e.title = b.title;
      e.onclick = () => { m.classList.remove('open'); res(b.value); };
      bt.appendChild(e);
    }
    m.classList.add('open');
    const first = bt.querySelector('button:not([disabled])'); if (first) first.focus();
  });
}
const info = (title, html) => modal({ title, html, buttons: [{ label: 'OK', value: true, cls: 'primary' }] });
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.innerHTML = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 2600);
}
const cardBtn = (name, text, extra = '') => `<span class="cname">${esc(name)}${extra}</span><small>${esc(text)}</small>`;

// ---------- ターン進行 ----------
async function startTurn() {
  const p = cur(); const s = st(p); const j = JOBS[p.job];
  p.turns++;
  S.phase = 'action'; S.dests = null; S.lastRoll = null;
  if (p.rest) {
    p.rest = false; p.hp = Math.ceil(s.maxHp / 2); p.pool = []; p.movesLeft = 0;
    log(`${p.name} は休んで回復した（HP ${p.hp}）`);
    render();
    await info(`${pname(p)} のターン`, `<p>前のターンで力尽きたため、このターンは休みです。</p><p>HPが半分（${p.hp}）まで回復しました。</p>`);
    return endTurn();
  }
  p.ap = j.apRegen === 'full' ? s.maxAp : Math.min(s.maxAp, p.ap + j.apRegen);
  if (s.regen && p.hp < s.maxHp) p.hp = Math.min(s.maxHp, p.hp + s.regen);
  p.pool = []; p.movesLeft = isCombat(p) ? 1 : 99;
  if (isCombat(p)) { for (let k = 0; k < CONFIG.combatDice; k++) p.pool.push(roll(p)); log(`${p.name} 🎲${p.pool.join('・')} を振った`); }
  render(); save();
  if (S.players.length > 1) await info('手番交代', `<p>${pname(p)}（${j.name}）のターンです。</p><p class="muted">端末を ${esc(p.name)} さんに渡してください。</p>`);
}

async function endTurn() {
  if (busy || S.winner) return;
  cur().pool = [];
  S.cur = (S.cur + 1) % S.players.length;
  if (S.cur === 0) {
    busy = true;
    try { await pulse(); } finally { busy = false; }
    if (S.winner) { render(); return; }
    S.round++;
  }
  startTurn();
}

// ---------- ダンジョンの鼓動（ラウンドの終わりに1枚） ----------
async function pulse() {
  S.pulseFx = {};
  const id = draw('pulse'); S.discards.pulse.push(id); const c = PULSE[id];
  S.pulseCard = id;
  const notes = [];
  if (c.effect === 'spawn') {
    S.board.forEach((ring, li) => {
      const cand = ring.map((q, i) => ({ q, i })).filter(({ q }) => q.type === 'empty' || ((q.type === 'treasure' || q.type === 'event') && q.used));
      if (!cand.length) return;
      const { q } = cand[rnd(cand.length)]; q.type = 'monster'; delete q.used; notes.push(`第${li + 1}層`);
    });
  } else if (c.effect === 'bossAtk') S.pulseFx.bossAtk = c.value;
  else if (c.effect === 'healAll') S.players.forEach((q) => { if (!q.rest && q.hp > 0) q.hp = Math.min(st(q).maxHp, q.hp + c.value); });
  else if (c.effect === 'refill') {
    S.board.forEach((ring, li) => {
      const cand = ring.filter((q) => q.type === 'treasure' && q.used);
      if (cand.length) { delete cand[rnd(cand.length)].used; notes.push(`第${li + 1}層`); }
    });
  } else if (c.effect === 'fog') S.pulseFx.moveMinus = c.value;
  log(`ダンジョンの鼓動：「${c.name}」${c.text}`);
  let extra = notes.length ? `<p class="muted">（${notes.join('・')}）</p>` : '';
  // 出口が閉じ始める
  if (S.closeLeft === null && S.round >= S.closeAt) {
    S.closeLeft = PULSE_CONFIG.closeCountdown;
    log(`出口が閉じ始めた！ あと${S.closeLeft}ラウンド`);
    extra += `<p class="bad">🚪 出口が閉じ始めた！ あと${S.closeLeft}ラウンドで誰も脱出できなければ、全員の負け。</p>`;
  } else if (S.closeLeft !== null) {
    S.closeLeft--;
    if (S.closeLeft <= 0) {
      S.lost = true; S.winner = '（時間切れ）';
      log('出口が閉ざされた… 誰も脱出できなかった');
      clearSave(); render();
      await showLose();
      return;
    }
    extra += `<p class="bad">🚪 出口が閉じるまで あと${S.closeLeft}ラウンド</p>`;
  }
  render();
  await info(`💓 ダンジョンの鼓動：${esc(c.name)}`, `<p>${esc(c.text)}</p>${extra}`);
}

async function showLose() {
  const rows = S.players.map((q) => `<tr><td>${pname(q)}</td><td>${JOBS[q.job].name}</td><td>Lv${q.lv}</td><td>${q.turns}</td><td>${escapeText(q)}</td></tr>`).join('');
  const c = await modal({
    title: '🚪 出口が閉ざされた…',
    html: `<p>${S.round}ラウンド目で出口が閉じ、誰も脱出できませんでした。全員の負けです。</p>
      <table class="result"><tr><th>名前</th><th>ジョブ</th><th>Lv</th><th>手番数</th><th>脱出条件</th></tr>${rows}</table>`,
    buttons: [{ label: '新しいゲーム', value: 'new', cls: 'primary' }, { label: '盤面を見る', value: 'board' }],
  });
  if (c === 'new') showSetup();
}

function afterAction() {
  if (S.winner) { render(); return; }
  const p = cur();
  S.phase = 'action';
  if (p.rest) { render(); endTurn(); return; }
  render(); save();
}

function moveSteps(p, r) {
  const s = st(p);
  const base = JOBS[p.job].moveDie === 'half' ? Math.ceil(r / 2) : r;
  return Math.max(1, base + s.move + p.dash - (S.pulseFx.moveMinus || 0));
}

function actRoll() {
  if (busy || S.phase !== 'action') return;
  const p = cur(); if (!canRoll(p)) return;
  if (isCombat(p)) { p.exAp--; p.movesLeft++; log(`${p.name} はエクストラAPでダイスを1個足した`); } else pay(p, 1);
  const r = roll(p); p.pool.push(r);
  log(`${p.name} 🎲${r} を振った`);
  afterAction();
}

async function actMove(i) {
  if (busy || S.phase !== 'action') return;
  const p = cur(); if (!canMove(p) || i == null || i >= p.pool.length) return;
  const r = useDie(p, i); p.movesLeft--;
  const s = st(p);
  const base = JOBS[p.job].moveDie === 'half' ? Math.ceil(r / 2) : r;
  const steps = moveSteps(p, r);
  const bonus = steps - base;
  p.dash = 0;
  S.lastRoll = { r, steps };
  log(`${p.name} 🎲${r} → ${steps}マス移動${bonus ? `（${bonus > 0 ? '+' : ''}${bonus}）` : ''}`);
  S.dests = computeDests(p, steps);
  S.phase = 'choose';
  render(); save();
}

function computeDests(p, steps) {
  const ring = S.board[p.layer]; const n = ring.length; const out = [];
  for (const dir of [1, -1]) {
    for (let k = 1; k <= steps; k++) {
      const idx = ((p.pos + dir * k) % n + n) % n; const sq = ring[idx];
      const special = SPECIAL_STOP.has(sq.type) && !sq.used;
      if (k === steps || special) {
        if (!out.some((d) => d.idx === idx)) out.push({ idx, k, dir, early: k !== steps });
      }
    }
  }
  return out;
}

async function chooseDest(idx) {
  if (busy || S.phase !== 'choose') return;
  if (!S.dests.some((d) => d.idx === idx)) return;
  busy = true;
  const p = cur(); p.pos = idx; S.dests = null; S.phase = 'resolving';
  render();
  try { await resolveSquare(p); } finally { busy = false; }
  afterAction();
}

async function actStairs(dir) {
  if (busy || S.phase !== 'action') return;
  const p = cur(); if (!canMove(p)) return;
  busy = true;
  // 階段は移動1回分。いちばん小さいダイスを使う
  useDie(p, p.pool.indexOf(Math.min(...p.pool))); p.movesLeft--;
  p.layer += dir;
  p.pos = S.board[p.layer].findIndex((q) => q.type === (dir > 0 ? 'stairsDown' : 'stairsUp'));
  log(`${p.name} は第${p.layer + 1}層へ${dir > 0 ? '上った' : '下りた'}`);
  toast(`${pname(p)} 第${p.layer + 1}層へ`);
  busy = false;
  afterAction();
}

async function actUseAS(i) {
  if (busy || S.phase !== 'action') return;
  const p = cur(); const id = p.as[i]; const def = AS[id];
  if (!def || !(def.when === 'field' || def.when === 'any') || !canPay(p, def.cost)) return;
  pay(p, def.cost); p.as.splice(i, 1); S.discards.as.push(id);
  const s = st(p);
  if (def.effect === 'heal') p.hp = Math.min(s.maxHp, p.hp + 4);
  if (def.effect === 'dash') p.dash += 3;
  if (def.effect === 'apup') p.ap = Math.min(s.maxAp, p.ap + 2);
  log(`${p.name} はAS「${def.name}」を使った`);
  toast(`🃏 ${esc(def.name)}：${esc(def.text)}`);
  afterAction();
}

// ---------- マスの処理 ----------
async function resolveSquare(p) {
  const sq = S.board[p.layer][p.pos];
  switch (sq.type) {
    case 'monster': {
      const key = 'm' + p.layer; const id = draw(key); S.discards[key].push(id);
      await encounter(p, makeMonster(MONSTERS[p.layer][id], p.layer + 1, false));
      break;
    }
    case 'boss': {
      const b = BOSSES[p.layer];
      if (JOBS[p.job].bossOptional) {
        const c = await modal({
          title: `💀 ${esc(b.name)} の部屋`,
          html: `<p>ボスが眠っている。${esc(JOBS[p.job].name)}の脱出にボスは要らない。</p>`,
          buttons: [{ label: '🤫 そっと通り過ぎる', value: 'pass', cls: 'primary' }, { label: '⚔️ 挑む', value: 'fight' }],
        });
        if (c === 'pass') { log(`${p.name} は ${b.name} の横をそっと通り過ぎた`); break; }
      }
      await encounter(p, makeMonster(b, p.layer + 1, true));
      break;
    }
    case 'treasure':
      if (sq.used) { log(`${p.name}：宝箱はもう空だ`); break; }
      sq.used = true; await doTreasure(p); break;
    case 'event':
      if (sq.used) { log(`${p.name}：祭壇の力はもう尽きている`); break; }
      sq.used = true;
      log(`${p.name} は不思議な祭壇を見つけた`);
      await info('✨ イベント', '<p>不思議な祭壇が光っている…</p><p>アクションスキル（AS）を1枚得た。</p>');
      await gainAS(p); exploreXp(p, '祭壇を調べた'); await checkLevel(p); break;
    case 'trap': await doTrap(p); break;
    case 'sp': if (!sq.used) await doChest(p, sq); break;
    case 'exit': await doExit(p); break;
    default: log(`${p.name} は${SQ_NAME[sq.type]}に止まった`);
  }
}

function makeMonster(def, layer, boss) {
  const count = def.count || 1; const atk = def.atk + (boss ? (S.pulseFx.bossAtk || 0) : 0);
  return { name: def.name, layer, boss, xp: def.xp, as: !!def.as, bodies: Array.from({ length: count }, () => ({ hp: def.hp, max: def.hp, atk })) };
}

function monsterHtml(m) {
  const bodies = m.bodies.map((b, i) => {
    const dead = b.hp <= 0;
    const pct = Math.max(0, b.hp) / b.max * 100;
    return `<div class="mbody ${dead ? 'dead' : ''}"><span>${m.bodies.length > 1 ? `#${i + 1}` : ''} HP ${Math.max(0, b.hp)}/${b.max}・ATK ${b.atk}</span><div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  return `<div class="monster ${m.boss ? 'boss' : ''}"><div class="mname">${m.boss ? '💀' : '👹'} ${esc(m.name)}<span class="muted">（第${m.layer}層${m.bodies.length > 1 ? '・群れ' : ''}・経験値${m.xp}${m.as ? '・AS報酬' : ''}）</span></div>${bodies}</div>`;
}
function playerMini(p) {
  const s = st(p);
  return `<div class="pmini">${pname(p)} HP <b>${p.hp}</b>/${s.maxHp}・AP <b>${p.ap}</b>/${s.maxAp}・EX AP ${p.exAp}・ATK ${s.atk}</div>`;
}

async function encounter(p, m) {
  const s = st(p);
  log(`${p.name} の前に ${m.name} が現れた`);
  if (s.canFlee) {
    const c = await modal({
      title: `${m.boss ? '💀 ボス' : '👹'} ${esc(m.name)} が現れた！`,
      html: monsterHtml(m) + playerMini(p),
      buttons: [
        { label: '⚔️ 戦う', value: 'fight', cls: 'primary' },
        { label: `🏃 逃げる（AP1・🎲${CONFIG.fleeTarget}以上${s.fleeBonus ? `、+${s.fleeBonus}` : ''}）`, value: 'flee', disabled: !canPay(p, 1) },
        ...dieBtns(p, 'fdie', (v) => `🏃 手元の🎲${v}で逃げる（${v + s.fleeBonus >= CONFIG.fleeTarget ? '成功' : '失敗'}）`),
      ],
    });
    if (c === 'flee' || String(c).startsWith('fdie')) {
      let r;
      if (c === 'flee') { pay(p, 1); r = roll(p); } else r = useDie(p, +String(c).slice(4));
      const t = r + s.fleeBonus;
      if (t >= CONFIG.fleeTarget) {
        log(`${p.name} は逃走に成功（🎲${r}）`);
        await info('🏃 逃走成功', `<p class="dice">${DICE[r]}</p><p>${r}${s.fleeBonus ? `+${s.fleeBonus}` : ''} = ${t}。うまく逃げ切った！</p>`);
        exploreXp(p, '逃げ切った'); await checkLevel(p);
        return;
      }
      log(`${p.name} は逃走に失敗（🎲${r}）`);
      await info('逃走失敗…', `<p class="dice">${DICE[r]}</p><p>${r}${s.fleeBonus ? `+${s.fleeBonus}` : ''} = ${t}。回り込まれた！戦闘開始。</p>`);
    }
  }
  await battle(p, m);
}

function hitOne(m, dmg) { const b = m.bodies.find((x) => x.hp > 0); if (b) b.hp -= dmg; }
function hitAll(m, dmg) { m.bodies.forEach((b) => { if (b.hp > 0) b.hp -= dmg; }); }

async function battle(p, m) {
  let first = true; let shield = false; let msg = '';
  for (;;) {
    const s = st(p);
    const fs = first && s.firstStrike ? s.firstStrike : 0;
    const buttons = [{ label: `⚔️ 攻撃（ATK${s.atk}＋🎲${fs ? `＋${fs}` : ''}）`, value: 'atk', cls: 'primary' }];
    buttons.push(...dieBtns(p, 'adie', (v) => `⚔️ 手元の🎲${v}で攻撃（${s.atk + v + fs}ダメージ）`));
    p.as.forEach((id, i) => {
      const d = AS[id];
      if (d.when === 'battle' || d.when === 'any') buttons.push({ label: `🃏 ${esc(d.name)}（AP${d.cost}）<small>${esc(d.text)}</small>`, value: 'as' + i, disabled: !canPay(p, d.cost), cls: 'card' });
    });
    if (canSpecial(p)) buttons.push({ label: `💥 必殺技（AP全消費）<small>敵全体に ATK＋🎲🎲${s.specialBonus ? `＋${s.specialBonus}` : ''}</small>`, value: 'special', cls: 'danger card' });
    if (s.canFlee) {
      buttons.push({ label: `🏃 逃走（AP1・🎲${CONFIG.fleeTarget}以上）`, value: 'flee', disabled: !canPay(p, 1) });
      buttons.push(...dieBtns(p, 'fdie', (v) => `🏃 手元の🎲${v}で逃走（${v + s.fleeBonus >= CONFIG.fleeTarget ? '成功' : '失敗'}）`));
    }

    const c = await modal({ title: `⚔️ 戦闘：${esc(m.name)}`, html: monsterHtml(m) + playerMini(p) + (msg ? `<div class="bmsg">${msg}</div>` : ''), buttons });
    let counter = false; msg = '';

    const cs = String(c);
    if (c === 'atk' || c === 'special' || c === 'flee' || cs.startsWith('adie') || cs.startsWith('fdie')) {
      if (c === 'atk' || cs.startsWith('adie')) {
        const r = c === 'atk' ? roll(p) : useDie(p, +cs.slice(4)); const bonus = first ? s.firstStrike : 0; const dmg = s.atk + r + bonus;
        hitOne(m, dmg); first = false; counter = true;
        msg += `<span class="dice">${DICE[r]}</span> ${s.atk}+${r}${bonus ? `+${bonus}` : ''} = <b>${dmg}ダメージ</b>`;
        log(`${p.name} の攻撃 🎲${r} → ${dmg}ダメージ`);
      } else if (c === 'special') {
        p.ap = 0; const r1 = roll(p); const r2 = roll(p); const dmg = s.atk + r1 + r2 + s.specialBonus;
        hitAll(m, dmg); first = false; counter = true;
        msg += `💥 必殺技！ <span class="dice">${DICE[r1]}${DICE[r2]}</span> 敵全体に <b>${dmg}ダメージ</b>`;
        log(`${p.name} の必殺技！ 敵全体に${dmg}ダメージ`);
      } else {
        let r;
        if (c === 'flee') { pay(p, 1); r = roll(p); } else r = useDie(p, +cs.slice(4));
        const t = r + s.fleeBonus;
        if (t >= CONFIG.fleeTarget) {
          log(`${p.name} は戦闘から逃走した（🎲${r}）`);
          await info('🏃 逃走成功', `<p class="dice">${DICE[r]}</p><p>${t}。なんとか逃げ切った！</p>`);
          exploreXp(p, '逃げ切った'); await checkLevel(p);
          return 'fled';
        }
        msg += `<span class="dice">${DICE[r]}</span> 逃走失敗…`; counter = true;
        log(`${p.name} は逃走に失敗（🎲${r}）`);
      }
    } else if (cs.startsWith('as')) {
      const i = +c.slice(2); const id = p.as[i]; const d = AS[id];
      pay(p, d.cost); p.as.splice(i, 1); S.discards.as.push(id);
      log(`${p.name} はAS「${d.name}」を使った`);
      switch (d.effect) {
        case 'strong': {
          const r = roll(p); const bonus = (first ? s.firstStrike : 0) + 3; const dmg = s.atk + r + bonus;
          hitOne(m, dmg); first = false; counter = true;
          msg += `🃏 強打！ <span class="dice">${DICE[r]}</span> ${s.atk}+${r}+${bonus} = <b>${dmg}ダメージ</b>`; break;
        }
        case 'sweep': hitAll(m, 3); counter = true; msg += '🃏 旋風斬！ 敵全体に <b>3ダメージ</b>'; break;
        case 'heal': p.hp = Math.min(s.maxHp, p.hp + 4); msg += '🃏 回復薬でHP+4'; break;
        case 'apup': p.ap = Math.min(s.maxAp, p.ap + 2); msg += '🃏 気付け薬でAP+2'; break;
        case 'shield': shield = true; msg += '🃏 守りの盾を構えた'; break;
        case 'smoke':
          await info('💨 煙玉', '<p>煙に紛れて戦闘から離脱した。</p>');
          return 'fled';
        default: break;
      }
    }

    if (m.bodies.every((b) => b.hp <= 0)) { await winBattle(p, m, msg); return 'win'; }

    if (counter) {
      let dmg = m.bodies.filter((b) => b.hp > 0).reduce((a, b) => a + b.atk, 0);
      dmg = Math.max(0, dmg - s.dodge);
      if (shield) { dmg = 0; shield = false; msg += '<br>🛡️ 盾で反撃を防いだ！'; }
      else msg += `<br>${esc(m.name)} の反撃：<b class="bad">${dmg}ダメージ</b>${s.dodge ? '（回避-' + s.dodge + '）' : ''}`;
      p.hp -= dmg;
      if (p.hp <= 0) {
        p.hp = 0; p.rest = true; p.ap = 0;
        log(`${p.name} は ${m.name} に倒された… 次のターンは休み`);
        await info('💀 力尽きた…', `<div class="bmsg">${msg}</div><p>${pname(p)} は倒れた。次のターンは休みになり、HP半分で復帰します。</p>`);
        return 'lose';
      }
    }
  }
}

async function winBattle(p, m, msg) {
  const s = st(p);
  const xp = m.xp + (m.boss ? 0 : s.hunter);
  p.xp += xp;
  let extra = '';
  if (m.boss && !p.bossKills.includes(m.layer)) {
    p.bossKills.push(m.layer);
    if (m.layer === CONFIG.finalBossLayer && JOBS[p.job].escape === 'boss') extra = '<p class="good">🔑 出口の鍵を手に入れた！ 出口🚪へ向かおう。</p>';
  }
  log(`${p.name} は ${m.name} を倒した（経験値+${xp}）`);
  await info('🎉 勝利！', `<div class="bmsg">${msg}</div><p>${esc(m.name)} を倒した！ 経験値+${xp}</p>${extra}${m.as ? '<p>報酬：ASを1枚得る</p>' : ''}`);
  if (m.as) await gainAS(p);
  await checkLevel(p);
}

// 探索職は探索でも経験値を得る（JOBS の exploreXp。宝箱・イベント・逃走成功）
function exploreXp(p, why) {
  const n = JOBS[p.job].exploreXp || 0;
  if (!n) return;
  p.xp += n;
  log(`${p.name} は${why}（経験値+${n}）`);
  toast(`✨ ${pname(p)} 経験値+${n}（${why}）`);
}

async function gainAS(p) {
  const id = draw('as');
  if (!id) { log('ASの山が尽きている'); toast('ASの山が尽きている'); return; }
  p.as.push(id);
  log(`${p.name} はAS「${AS[id].name}」を得た`);
  toast(`🃏 ${pname(p)} がAS「${esc(AS[id].name)}」を得た`);
  const cap = st(p).asCap;
  if (p.as.length > cap) {
    const c = await modal({
      title: 'ASが持ちきれない',
      html: `<p>ASは${cap}枚まで。1枚捨ててください（新しく得た「${esc(AS[id].name)}」も選べます）。</p>`,
      buttons: p.as.map((x, i) => ({ label: cardBtn(AS[x].name, AS[x].text), value: i, cls: 'card' })),
    });
    const [d] = p.as.splice(c, 1); S.discards.as.push(d);
    log(`${p.name} はAS「${AS[d].name}」を捨てた`);
  }
}

async function doTreasure(p) {
  const id = draw('tr'); S.discards.tr.push(id); const t = TREASURES[id]; const s = st(p);
  log(`${p.name} はトレジャー「${t.name}」を見つけた`);
  if (t.effect === 'mimic') {
    await info('💰 トレジャー…？', `<p><b>${esc(t.name)}</b></p><p>${esc(t.text)}</p>`);
    const L = p.layer + 1;
    await battle(p, makeMonster({ name: 'ミミック', hp: 3 + L * 2, atk: L + 1, xp: L, as: true }, L, false));
    return;
  }
  await info('💰 トレジャー', `<p><b>${esc(t.name)}</b></p><p>${esc(t.text)}</p>`);
  switch (t.effect) {
    case 'as': await gainAS(p); break;
    case 'heal': p.hp = Math.min(s.maxHp, p.hp + 3); break;
    case 'full': p.hp = s.maxHp; break;
    case 'exap': p.exAp = Math.min(CONFIG.exApMax, p.exAp + 1); break;
    case 'xp': p.xp += 2; break;
    default: break;
  }
  if (s.treasureAs) await gainAS(p);
  exploreXp(p, '宝を見つけた');
  await checkLevel(p);
}

async function doTrap(p) {
  const s = st(p); const dmg = CONFIG.trapDamage[p.layer];
  if (s.trapSense) { log(`${p.name} は罠に気付いて避けた`); toast('⚠️ 罠感知で罠を回避'); return; }
  const idx = p.as.findIndex((id) => AS[id].when === 'trap');
  let r = null;
  if (idx >= 0 || p.pool.length) {
    const buttons = [];
    if (idx >= 0) buttons.push({ label: '🃏 罠解除を使う', value: 'use', cls: 'primary' });
    buttons.push({ label: '🎲 運に任せる', value: 'roll' });
    buttons.push(...dieBtns(p, 'tdie', (v) => `🎲 手元の${v}でかわす（${v <= CONFIG.trapHit ? 'かかる' : 'かわせる'}）`));
    const c = await modal({ title: '⚠️ 罠だ！', html: `<p>このままだと 🎲${CONFIG.trapHit}以下 で ${dmg}ダメージ。</p>`, buttons });
    if (c === 'use') {
      const [id] = p.as.splice(idx, 1); S.discards.as.push(id);
      log(`${p.name} は罠を解除した`); return;
    }
    if (String(c).startsWith('tdie')) r = useDie(p, +String(c).slice(4));
  }
  if (r === null) r = roll(p);
  if (r <= CONFIG.trapHit) {
    p.hp -= dmg;
    log(`${p.name} は罠にかかった（🎲${r}、${dmg}ダメージ）`);
    let extra = '';
    if (p.hp <= 0) { p.hp = 0; p.rest = true; p.ap = 0; extra = '<p class="bad">力尽きた… 次のターンは休み。</p>'; log(`${p.name} は倒れた`); }
    await info('⚠️ 罠！', `<p class="dice">${DICE[r]}</p><p>罠にかかった！ <b class="bad">${dmg}ダメージ</b></p>${extra}`);
  } else {
    log(`${p.name} は罠をかわした（🎲${r}）`);
    await info('⚠️ 罠！', `<p class="dice">${DICE[r]}</p><p>間一髪でかわした！</p>`);
  }
}

async function doChest(p, sq) {
  const s = st(p);
  let opened = false;
  if (s.autoLock) {
    opened = true; log(`${p.name} は宝の嗅覚で宝箱を開けた`);
  } else {
    const idx = p.as.findIndex((id) => AS[id].when === 'lock');
    const buttons = [];
    if (idx >= 0) buttons.push({ label: '🃏 鍵開けASを使う（確実）', value: 'as', cls: 'primary' });
    buttons.push(...dieBtns(p, 'ldie', (v) => `🔓 手元の🎲${v}で開ける（${v + s.lockBonus >= CONFIG.lockTarget ? '開く' : '開かない'}）`));
    buttons.push({ label: `🔓 素で開ける（AP${CONFIG.lockApCost}・🎲${CONFIG.lockTarget}以上${s.lockBonus ? `、+${s.lockBonus}` : ''}）`, value: 'try', disabled: !canPay(p, CONFIG.lockApCost) });
    buttons.push({ label: 'あきらめる', value: 'no' });
    const c = await modal({ title: '👑 鍵付きの宝箱', html: '<p>中にはスペシャルトレジャー（SP）が入っているようだ。</p>', buttons });
    if (c === 'as') { const [id] = p.as.splice(idx, 1); S.discards.as.push(id); opened = true; log(`${p.name} は鍵開けASで宝箱を開けた`); }
    if (c === 'try' || String(c).startsWith('ldie')) {
      let r;
      if (c === 'try') { pay(p, CONFIG.lockApCost); r = roll(p); } else r = useDie(p, +String(c).slice(4));
      const t = r + s.lockBonus;
      if (t >= CONFIG.lockTarget) { opened = true; log(`${p.name} は鍵を開けた（🎲${r}）`); }
      else { log(`${p.name} は鍵開けに失敗（🎲${r}）`); await info('🔒 失敗', `<p class="dice">${DICE[r]}</p><p>${r}${s.lockBonus ? `+${s.lockBonus}` : ''} = ${t}。開かなかった…</p>`); }
    }
  }
  if (!opened) return;
  sq.used = true; p.sp++; p.xp += CONFIG.spXp;
  const forMe = JOBS[p.job].escape === 'sp';
  await info('👑 スペシャルトレジャー！', `<p>SPトレジャーを手に入れた！（${p.sp}個目・経験値+${CONFIG.spXp}）</p>${forMe ? `<p class="good">${escapeText(p)}</p>` : '<p class="muted">（戦闘職の脱出には不要だが、探索職に取られずに済む）</p>'}`);
  if (s.autoLock) await gainAS(p);
  await checkLevel(p);
}

async function doExit(p) {
  if (canEscape(p)) {
    S.winner = p.name;
    log(`${p.name} がダンジョンから脱出した！`);
    clearSave(); render();
    await showWin(p);
  } else {
    log(`${p.name}：出口は固く閉ざされている`);
    await info('🚪 出口', `<p>扉は固く閉ざされている…</p><p>脱出条件：${escapeText(p)}</p>`);
  }
}

async function showWin(p) {
  const rows = S.players.map((q) => `<tr><td>${pname(q)}</td><td>${JOBS[q.job].name}</td><td>Lv${q.lv}</td><td>${q.turns}</td><td>${escapeText(q)}</td></tr>`).join('');
  const c = await modal({
    title: `🎉 ${pname(p)} が脱出した！`,
    html: `<p>${S.round}ラウンド目で ${esc(p.name)}（${JOBS[p.job].name}）が勝利しました。</p>
      <table class="result"><tr><th>名前</th><th>ジョブ</th><th>Lv</th><th>手番数</th><th>脱出条件</th></tr>${rows}</table>
      <p class="muted">試遊メモ：ジョブごとの「脱出までの手番数」を記録しておくと、バランス調整に使えます。</p>`,
    buttons: [{ label: '新しいゲーム', value: 'new', cls: 'primary' }, { label: '盤面を見る', value: 'board' }],
  });
  if (c === 'new') showSetup();
}

async function checkLevel(p) {
  while (p.lv < CONFIG.maxLv && p.xp >= CONFIG.xpTable[p.lv + 1]) {
    const before = p.lv; p.lv++;
    p.exAp = Math.min(CONFIG.exApMax, p.exAp + 1);
    log(`${p.name} は Lv${p.lv} になった！`);
    await draft(p, before);
    p.hp = st(p).maxHp;
  }
}

async function draft(p, before) {
  const rare = CONFIG.rareLevels.includes(p.lv);
  const others = S.players.filter((q) => q !== p);
  const lowest = others.length > 0 && others.every((q) => before < q.lv);
  const nNormal = (rare ? 2 : 3) + (lowest ? 1 : 0);
  const cards = [];
  for (let i = 0; i < nNormal; i++) { const id = S.decks.ps.pop(); if (id) cards.push(id); }
  if (rare) { const id = S.decks.psr.pop(); if (id) cards.push(id); }
  const g = JOBS[p.job].growth[p.lv] || {};
  const gtxt = Object.entries(g).map(([k, v]) => `${STAT_LABEL[k]}+${v}`).join('、');
  const html = `<p>${pname(p)} が <b>Lv${p.lv}</b> になった！</p>
    <ul><li>成長：${gtxt || 'なし'}</li><li>HP全快</li><li>エクストラAP+1（${p.exAp}/${CONFIG.exApMax}）</li>${p.lv === CONFIG.specialLevel ? '<li>💥 必殺技が使えるようになった（AP満タン時、AP全消費）</li>' : ''}</ul>
    <p>パッシブスキル（PS）を1枚選んでください。${rare ? '<span class="rare">レアPS</span>が1枚混ざっています（所持は1枚まで、持っていれば入れ替え）。' : ''}${lowest ? '<br><span class="good">最もレベルが低いので1枚多く引きました。</span>' : ''}</p>`;
  if (!cards.length) { await info('レベルアップ！', html + '<p class="muted">PSの山が尽きている</p>'); return; }
  const c = await modal({
    title: `⬆️ レベルアップ！ Lv${p.lv}`, html,
    buttons: cards.map((id) => ({ label: cardBtn(PS[id].name, PS[id].text, PS[id].rare ? ' ★レア' : ''), value: id, cls: 'card' + (PS[id].rare ? ' rarecard' : '') })),
  });
  let returned = false;
  for (const id of cards) {
    if (id === c && !returned) { returned = true; continue; }
    (PS[id].rare ? S.decks.psr : S.decks.ps).unshift(id);
  }
  if (PS[c].rare) {
    const old = p.ps.findIndex((x) => PS[x].rare);
    if (old >= 0) { const [o] = p.ps.splice(old, 1); S.decks.psr.unshift(o); log(`${p.name} はレアPS「${PS[o].name}」を手放した`); }
  }
  p.ps.push(c);
  shuffle(S.decks.ps); shuffle(S.decks.psr);
  log(`${p.name} はPS「${PS[c].name}」を習得した`);
}

// ---------- 描画 ----------
const CX = 300, CY = 300;
const RINGS = [[78, 138], [142, 206], [210, 290]];
function polar(r, a) { return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; }
function sectorPath(r0, r1, a0, a1) {
  const [x0, y0] = polar(r1, a0), [x1, y1] = polar(r1, a1), [x2, y2] = polar(r0, a1), [x3, y3] = polar(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}
function renderBoard() {
  const p = S.phase === 'choose' ? cur() : null;
  const destSet = new Map((S.dests || []).map((d) => [d.idx, d]));
  let svg = `<circle cx="${CX}" cy="${CY}" r="72" class="core"/><text x="${CX}" y="${CY - 6}" class="corelbl">ダンジョン</text><text x="${CX}" y="${CY + 14}" class="corelbl small">最深部</text>`;
  S.board.forEach((ring, li) => {
    const n = ring.length; const [r0, r1] = RINGS[li];
    ring.forEach((sq, i) => {
      const a0 = (i / n) * 2 * Math.PI - Math.PI / 2; const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
      const isDest = p && li === p.layer && destSet.has(i);
      const cls = `sq t-${sq.type}${sq.used ? ' used' : ''}${isDest ? ' dest' : ''}`;
      const [tx, ty] = polar((r0 + r1) / 2, (a0 + a1) / 2);
      svg += `<g class="${cls}" data-l="${li}" data-i="${i}"><path d="${sectorPath(r0, r1, a0 + 0.004, a1 - 0.004)}"/><text x="${tx}" y="${ty}" class="icon">${sq.used ? '·' : ICONS[sq.type]}</text>`;
      svg += `<title>第${li + 1}層 ${SQ_NAME[sq.type]}${sq.used ? '（使用済み）' : ''}</title></g>`;
    });
  });
  // プレイヤーのコマ
  const groups = {};
  S.players.forEach((q, k) => { const key = q.layer + ':' + q.pos; (groups[key] = groups[key] || []).push(k); });
  for (const [key, ks] of Object.entries(groups)) {
    const [li, i] = key.split(':').map(Number); const n = S.board[li].length; const [r0, r1] = RINGS[li];
    const am = ((i + 0.5) / n) * 2 * Math.PI - Math.PI / 2;
    ks.forEach((k, j) => {
      const q = S.players[k];
      const off = (j - (ks.length - 1) / 2) * 0.09 * (10 / n) * 1.6;
      const [x, y] = polar(r0 + (r1 - r0) * 0.78, am + off);
      svg += `<g class="token${k === S.cur ? ' active' : ''}"><circle cx="${x}" cy="${y}" r="9" fill="${q.color}"/><text x="${x}" y="${y + 4}">${k + 1}</text></g>`;
    });
  }
  const el = $('#board');
  el.innerHTML = svg;
  el.querySelectorAll('g.dest').forEach((g) => { g.addEventListener('click', () => chooseDest(+g.dataset.i)); });
}

function bar(v, max, cls) { const pct = max ? Math.max(0, Math.min(100, (v / max) * 100)) : 0; return `<div class="bar ${cls}"><i style="width:${pct}%"></i></div>`; }

function renderPanel() {
  const p = cur(); const s = st(p); const j = JOBS[p.job];
  const sq = S.board[p.layer][p.pos];
  const nextXp = p.lv < CONFIG.maxLv ? CONFIG.xpTable[p.lv + 1] : null;
  let h = `<div class="phead" style="border-color:${p.color}"><div><span class="dot" style="background:${p.color}"></span><b>${esc(p.name)}</b> <span class="job">${j.kind}・${j.name}</span></div><div class="muted">ラウンド${S.round}</div></div>`;
  h += `<div class="stats">
    <div>HP <b>${p.hp}</b>/${s.maxHp}${bar(p.hp, s.maxHp, 'hp')}</div>
    <div>AP <b>${p.ap}</b>/${s.maxAp}${bar(p.ap, s.maxAp, 'ap')}</div>
    <div>Lv <b>${p.lv}</b>　経験値 ${p.xp}${nextXp ? `/${nextXp}` : '（最大）'}</div>
    <div>EX AP <b>${'◆'.repeat(p.exAp)}${'◇'.repeat(CONFIG.exApMax - p.exAp)}</b></div>
    <div>ATK <b>${s.atk}</b>　移動 ${j.moveDie === 'half' ? '🎲÷2' : '🎲'}${s.move ? `+${s.move}` : ''}${p.dash ? `（次+${p.dash}）` : ''}</div>
    <div>脱出：${escapeText(p)}</div>
  </div>
  <div class="where">現在地：第${p.layer + 1}層・${ICONS[sq.type]} ${SQ_NAME[sq.type]}</div>
  <div class="where">💓 ${S.pulseCard ? `${esc(PULSE[S.pulseCard].name)}：${esc(PULSE[S.pulseCard].text)}` : 'ダンジョンはまだ静かだ'}${S.closeLeft !== null ? `<br><b class="bad">🚪 出口が閉じるまで あと${S.closeLeft}ラウンド</b>` : ''}</div>`;

  // 行動
  h += '<div class="actions">';
  if (S.winner) {
    h += S.lost ? '<p class="bad">出口が閉ざされ、全員の負けです。</p>' : `<p class="good">${esc(S.winner)} が脱出しました。</p>`;
    h += '<button class="btn primary" data-act="new">新しいゲーム</button>';
  } else if (S.phase === 'choose') {
    h += `<p>🎲 <b>${S.lastRoll.r}</b> → <b>${S.lastRoll.steps}マス</b>。行き先を盤面の光っているマスか、下のボタンで選んでください。<br><span class="muted">階段・ボス・宝箱・出口は途中で止まれます。</span></p><div class="dests">`;
    for (const d of S.dests) {
      const q = S.board[p.layer][d.idx];
      h += `<button class="btn" data-dest="${d.idx}">${d.dir > 0 ? '右回り' : '左回り'}${d.k}マス：${ICONS[q.type]} ${SQ_NAME[q.type]}${q.used ? '（使用済）' : ''}</button>`;
    }
    h += '</div>';
  } else {
    const can = canMove(p) && !busy;
    h += `<div class="pool">手元のダイス：${p.pool.length ? p.pool.map((v) => `<span class="pdie">${DICE[v]}</span>`).join('') : '<span class="muted">なし</span>'}<br><span class="muted">${isCombat(p) ? `移動はあと${p.movesLeft}回。` : ''}残ったダイスは戦闘・鍵開け・逃走・罠でも使えます（手番の終わりに消えます）。</span></div>`;
    p.pool.forEach((v, i) => {
      h += `<button class="btn primary" data-act="move" data-die="${i}" ${can ? '' : 'disabled'}>🎲${v}で移動（${moveSteps(p, v)}マス）</button>`;
    });
    if (canRoll(p) || !isCombat(p)) h += `<button class="btn" data-act="roll" ${canRoll(p) && !busy ? '' : 'disabled'}>🎲 ${rollText(p)}</button>`;
    if (sq.type === 'stairsUp') h += `<button class="btn" data-act="up" ${can ? '' : 'disabled'}>⬆️ 第${p.layer + 2}層へ上る（ダイス1個）</button>`;
    if (sq.type === 'stairsDown') h += `<button class="btn" data-act="down" ${can ? '' : 'disabled'}>⬇️ 第${p.layer}層へ下りる（ダイス1個）</button>`;
    h += `<button class="btn" data-act="end">ターン終了</button>`;
  }
  h += '</div>';

  // AS
  h += `<h3>アクションスキル（AS） ${p.as.length}/${s.asCap}</h3><div class="cards">`;
  if (!p.as.length) h += '<p class="muted">なし（イベント✨・トレジャー・一部のモンスターで手に入る）</p>';
  p.as.forEach((id, i) => {
    const d = AS[id]; const usable = S.phase === 'action' && !S.winner && (d.when === 'field' || d.when === 'any') && canPay(p, d.cost);
    const whenTxt = { battle: '戦闘中', field: '手番中', any: 'いつでも', lock: '宝箱の前', trap: '罠のとき' }[d.when];
    h += `<div class="card"><div><b>${esc(d.name)}</b> <span class="muted">AP${d.cost}・${whenTxt}</span><br><small>${esc(d.text)}</small></div>${usable ? `<button class="btn small" data-as="${i}">使う</button>` : ''}</div>`;
  });
  h += '</div>';
  // PS
  h += '<h3>パッシブスキル（PS）</h3><div class="cards">';
  p.ps.forEach((id) => { const d = PS[id]; h += `<div class="card ${d.rare ? 'rarecard' : ''}"><div><b>${esc(d.name)}</b>${d.rare ? ' <span class="rare">★レア</span>' : ''}<br><small>${esc(d.text)}</small></div></div>`; });
  h += '</div>';

  const el = $('#panel'); el.innerHTML = h;
  el.querySelectorAll('[data-dest]').forEach((b) => b.addEventListener('click', () => chooseDest(+b.dataset.dest)));
  el.querySelectorAll('[data-as]').forEach((b) => b.addEventListener('click', () => actUseAS(+b.dataset.as)));
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'move') actMove(+b.dataset.die); else if (a === 'roll') actRoll(); else if (a === 'up') actStairs(1); else if (a === 'down') actStairs(-1);
    else if (a === 'end') endTurn(); else if (a === 'new') showSetup();
  }));
}

function renderPlayers() {
  $('#players').innerHTML = S.players.map((q, k) => {
    const s = st(q);
    return `<div class="prow ${k === S.cur ? 'active' : ''}"><span class="dot" style="background:${q.color}">${k + 1}</span><b>${esc(q.name)}</b> <span class="muted">${JOBS[q.job].name} Lv${q.lv}</span> HP${q.hp}/${s.maxHp} AS${q.as.length} 第${q.layer + 1}層 ${q.rest ? '💤' : ''}<br><small>${escapeText(q)}</small></div>`;
  }).join('');
}
function renderLog() { $('#log').innerHTML = S.log.slice(0, 60).map((l) => `<li><span class="muted">R${l.r}</span> ${esc(l.msg)}</li>`).join(''); }
function render() { renderBoard(); renderPanel(); renderPlayers(); renderLog(); }

// ---------- 開始画面 ----------
function showSetup() {
  $('#game').hidden = true; $('#setup').hidden = false;
  const saved = loadSave();
  $('#resume').hidden = !saved;
  renderSetupRows();
}
function renderSetupRows() {
  const n = +$('#pcount').value;
  const rows = $('#prows'); const prev = [...rows.querySelectorAll('.srow')].map((r) => ({ name: r.querySelector('input').value, job: r.querySelector('select').value }));
  let h = '';
  for (let i = 0; i < n; i++) {
    const pv = prev[i] || { name: `プレイヤー${i + 1}`, job: i % 2 ? 'thief' : 'warrior' };
    h += `<div class="srow"><span class="dot" style="background:${COLORS[i]}">${i + 1}</span><input value="${esc(pv.name)}" maxlength="12" aria-label="名前"><select aria-label="ジョブ">${Object.entries(JOBS).map(([k, j]) => `<option value="${k}" ${k === pv.job ? 'selected' : ''}>${j.name}（${j.kind}）</option>`).join('')}</select></div>`;
  }
  rows.innerHTML = h;
}
function startFromSetup() {
  const setup = [...$('#prows').querySelectorAll('.srow')].map((r, i) => ({ name: r.querySelector('input').value.trim() || `プレイヤー${i + 1}`, job: r.querySelector('select').value }));
  newGame(setup);
  $('#setup').hidden = true; $('#game').hidden = false;
  startTurn();
}
function resumeGame() {
  const saved = loadSave(); if (!saved) return;
  S = saved; busy = false;
  if (S.phase === 'resolving') S.phase = 'action';
  $('#setup').hidden = true; $('#game').hidden = false;
  render();
}

function showRules() { $('#rules').classList.add('open'); }

window.addEventListener('DOMContentLoaded', () => {
  $('#pcount').addEventListener('change', renderSetupRows);
  $('#start').addEventListener('click', startFromSetup);
  $('#resume').addEventListener('click', resumeGame);
  document.querySelectorAll('[data-rules]').forEach((b) => b.addEventListener('click', showRules));
  $('#rules-close').addEventListener('click', () => $('#rules').classList.remove('open'));
  $('#to-title').addEventListener('click', async () => {
    if (busy) return;
    const c = await modal({ title: 'タイトルに戻る', html: '<p>ゲームは自動保存されています。タイトルの「続きから」で再開できます。</p>', buttons: [{ label: '戻る', value: true, cls: 'primary' }, { label: 'キャンセル', value: false }] });
    if (c) { save(); showSetup(); }
  });
  showSetup();
});
