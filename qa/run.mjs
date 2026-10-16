// 試遊版の自動検査（Claude を使わず CI で回す）。
// ブラウザで index.html を開き、簡単なボットに最後まで遊ばせて、次を見る。
//   ❌ 失敗にするもの: JS のエラー（pageerror / console.error）、操作できるものが無くて止まる、同じ状態のまま進まない
//   ⚠️ 知らせるだけ: 手数の上限までに誰も脱出しなかったゲーム
//   📊 報告: ジョブごとの勝ち数と、脱出までのラウンド数・手番数（バランス調整用。README「脱出までのターン数をジョブごとに測る」）
// 使い方: node qa/run.mjs [--games 40] [--out qa-report]
//   乱数は種で固定するので、失敗したゲームは同じ種で再現できる（--seed 123 --games 1）。
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => s.trim().split(/\s+/)));
const GAMES = +(args.games || 40);
const SEED0 = +(args.seed || 1);
const OUT = args.out || 'qa-report';
const MAX_STEPS = 4000; // 1ゲームのクリック数の上限
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(resolve(root, 'index.html')).href;

// 人数とジョブの組み合わせ（全部の人数・両ジョブを回す）
const SETUPS = [
  ['warrior'], ['thief'],
  ['warrior', 'thief'], ['thief', 'warrior'],
  ['warrior', 'thief', 'warrior'],
  ['warrior', 'thief', 'warrior', 'thief'],
];

// ページの中で動くボット。モーダルが出ていればボタンを選び、なければ 上り階段 > 手元のダイスで移動 > ダイスを振る > ターン終了 の順に押す。
async function botPlay(maxSteps) {
  const sleep = () => new Promise((r) => setTimeout(r, 0));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const enabled = (sel) => [...document.querySelectorAll(sel)].filter((b) => !b.disabled && b.offsetParent !== null);
  let same = 0; let last = '';
  for (let step = 0; step < maxSteps; step++) {
    await sleep();
    if (S.winner) return { ok: true, steps: step };
    const modal = document.querySelector('#modal.open');
    let btn = null;
    if (modal) {
      const bs = enabled('#modal .m-buttons button');
      // 7割は先頭（たいてい「攻撃」「OK」など前に進むもの）、3割はランダム
      btn = bs.length ? (Math.random() < 0.7 ? bs[0] : pick(bs)) : null;
    } else {
      const dests = enabled('#panel [data-dest]');
      if (dests.length) btn = pick(dests);
      else {
        const as = enabled('#panel [data-as]');
        const up = enabled('#panel [data-act="up"]');
        const mv = enabled('#panel [data-act="move"]');
        const rl = enabled('#panel [data-act="roll"]');
        const end = enabled('#panel [data-act="end"]');
        if (as.length && Math.random() < 0.2) btn = pick(as);
        else btn = up[0] || mv[0] || rl[0] || end[0] || null;
      }
    }
    if (!btn) {
      if (typeof busy !== 'undefined' && busy) { same++; if (same > 2000) return { ok: false, steps: step, why: '処理中（busy）のまま進まない' }; continue; }
      return { ok: false, steps: step, why: '押せるボタンが無い', html: document.querySelector('#panel')?.innerText.slice(0, 300) };
    }
    btn.click();
    const sig = JSON.stringify([S.cur, S.round, S.phase, S.players.map((p) => [p.layer, p.pos, p.hp, p.ap, p.xp, p.as.length])]) + (document.querySelector('#modal.open .m-title')?.textContent || '');
    if (sig === last) { same++; if (same > 300) return { ok: false, steps: step, why: '同じ状態のまま300回進まない', html: (document.querySelector('#modal.open') || document.querySelector('#panel'))?.innerText.slice(0, 300) }; } else { same = 0; last = sig; }
  }
  return { ok: true, steps: maxSteps, capped: true };
}

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const failures = []; const warns = []; const results = [];
for (let g = 0; g < GAMES; g++) {
  const seed = SEED0 + g; const setup = SETUPS[g % SETUPS.length];
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  // 乱数を種で固定（mulberry32）
  await page.addInitScript((s) => {
    let a = s >>> 0;
    Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    try { localStorage.clear(); } catch (e) { /* file:// で使えなくてもよい */ }
  }, seed);
  await page.goto(url);
  if (g === 0) {
    // ルールの表示と閉じる
    await page.click('[data-rules]');
    await page.click('#rules-close');
  }
  await page.selectOption('#pcount', String(setup.length));
  const rows = page.locator('#prows .srow select');
  for (let i = 0; i < setup.length; i++) await rows.nth(i).selectOption(setup[i]);
  await page.click('#start');
  let r;
  try { r = await page.evaluate(botPlay, MAX_STEPS); } catch (e) { r = { ok: false, why: `検査の実行エラー: ${e.message.split('\n')[0]}` }; }
  const st = await page.evaluate(() => ({ winner: S.winner, lost: !!S.lost, round: S.round, players: S.players.map((p) => ({ name: p.name, job: p.job, lv: p.lv, turns: p.turns, layer: p.layer })) })).catch(() => null);
  const tag = `ゲーム${g + 1}（種 ${seed}・${setup.join('/')}）`;
  if (errors.length) failures.push(`${tag}: ${[...new Set(errors)].slice(0, 3).join(' / ')}`);
  if (!r.ok) failures.push(`${tag}: ${r.why}${r.html ? `\n    画面: ${r.html.replace(/\s+/g, ' ')}` : ''}`);
  else if (r.capped) warns.push(`${tag}: ${MAX_STEPS}手で誰も脱出しなかった（ラウンド${st?.round}）`);
  if (st) results.push({ seed, setup, ...st, ok: r.ok && !r.capped });
  await page.close();
}
await browser.close();

// 集計（ジョブごと）
const jobs = {};
for (const x of results) {
  for (const p of x.players) { const j = (jobs[p.job] ||= { played: 0, wins: 0, rounds: [], turns: [] }); j.played++; }
  const w = x.winner && x.players.find((p) => p.name === x.winner);
  if (w) { const j = jobs[w.job]; j.wins++; j.rounds.push(x.round); j.turns.push(w.turns); }
}
const avg = (a) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : '-');
const med = (a) => { if (!a.length) return '-'; const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const JOBNAME = { warrior: '戦士', thief: '盗賊' };
let md = `## 自動対戦の検査（${GAMES}ゲーム・種 ${SEED0}〜${SEED0 + GAMES - 1}）\n\n`;
md += failures.length ? `### ❌ 失敗 ${failures.length}件\n\n${failures.map((f) => `- ${f}`).join('\n')}\n\n` : '✅ エラー・止まりなし\n\n';
const lost = results.filter((x) => x.lost).length;
md += `出口が閉じて全員の負け（時間切れ）: ${lost}/${results.length}\n\n`;
if (warns.length) md += `### ⚠️ 誰も脱出しなかったゲーム ${warns.length}件\n\n${warns.map((f) => `- ${f}`).join('\n')}\n\n`;
md += '### 📊 ジョブごとの結果（ボットの対戦。バランスの目安）\n\n| ジョブ | 参加 | 脱出（勝ち） | 勝率 | 脱出時ラウンド 平均/中央 | 脱出した人の手番数 平均 |\n|---|---|---|---|---|---|\n';
for (const [k, j] of Object.entries(jobs)) md += `| ${JOBNAME[k] || k} | ${j.played} | ${j.wins} | ${Math.round((100 * j.wins) / j.played)}% | ${avg(j.rounds)} / ${med(j.rounds)} | ${avg(j.turns)} |\n`;
md += '\n※ ボットは「上り階段 > ダイス > ターン終了」の単純な打ち方です。人の試遊とは数字がずれるので、data.js を変えたときの前後比べに使ってください。\n';

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/report.md`, md);
writeFileSync(`${OUT}/results.json`, JSON.stringify({ failures, warns, jobs, results }, null, 1));
console.log(md);
process.exit(failures.length ? 1 : 0);
