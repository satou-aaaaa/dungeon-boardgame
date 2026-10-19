// ジョブごとのバランスを見る（Claude を使わず CI の balance.yml で週1回）。qa/run.mjs が書いた results.json を読み、
// 次のどれかに当たれば終了コード 3 で知らせる（ワークフローがラベル balance の Issue にまとめ、issue 自動対応が data.js を直す）。
//   - あるジョブの「公平度」（勝ち数 ÷ 公平なら取れる勝ち数。1人用は1、n人戦は1/n ずつ数える）が他のジョブの RATIO 分の1 を下回る
//     （1人用の脱出率と、対戦での勝ちの取りやすさを1つの数にまとめたもの。100% が公平）
//   - 誰も脱出しなかったゲームが STUCK 割より多い
// ボットは単純な打ち方なので、ここでの数字は「前より大きくずれたら見直す」目安。
// 使い方: node qa/balance.mjs <qa-report> [--ratio 2] [--stuck 0.25]
import { readFileSync, writeFileSync } from 'node:fs';

const dir = process.argv[2] || 'qa-report';
const opt = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? +process.argv[i + 1] : d; };
const RATIO = opt('ratio', 2); const STUCK = opt('stuck', 0.25);
const { warns, results } = JSON.parse(readFileSync(`${dir}/results.json`, 'utf8'));
const JOBNAME = { warrior: '戦士', thief: '盗賊' };

// ジョブごとに、勝ち数・公平なら取れる勝ち数（Σ 1/人数）・1人用の脱出率を数える
const st = {};
for (const x of results) {
  const n = x.players.length; const w = x.winner && x.players.find((p) => p.name === x.winner);
  for (const p of x.players) {
    const j = (st[p.job] ||= { job: JOBNAME[p.job] || p.job, wins: 0, fair: 0, solo: 0, soloWins: 0 });
    j.fair += 1 / n;
    if (n === 1) { j.solo++; if (w) j.soloWins++; }
  }
  if (w) st[w.job].wins++;
}
const rates = Object.values(st).map((j) => ({ ...j, rate: j.fair ? (100 * j.wins) / j.fair : 0 }));
rates.sort((a, b) => b.rate - a.rate);
const problems = [];
if (rates.length >= 2) {
  const hi = rates[0]; const lo = rates[rates.length - 1];
  if (lo.rate * RATIO < hi.rate) problems.push(`ジョブの強さの差が大きい（公平度 ${hi.job} ${hi.rate.toFixed(0)}% ／ ${lo.job} ${lo.rate.toFixed(0)}%。100% が公平、${RATIO}倍までを許容）`);
}
const stuckRate = results.length ? warns.length / results.length : 0;
if (stuckRate > STUCK) problems.push(`誰も脱出しなかったゲームが ${(100 * stuckRate).toFixed(0)}%（${warns.length}/${results.length}、許容 ${(100 * STUCK).toFixed(0)}% まで）`);

let md = `## バランスの点検（${results.length}ゲーム）\n\n`;
md += problems.length ? `### ⚠️ 見直しが要りそうなところ\n\n${problems.map((p) => `- ${p}`).join('\n')}\n\n` : '✅ 目安の範囲内\n\n';
md += '| ジョブ | 勝ち数 | 公平なら | 公平度 | 1人用の脱出 |\n|---|---|---|---|---|\n' + rates.map((r) => `| ${r.job} | ${r.wins} | ${r.fair.toFixed(1)} | ${r.rate.toFixed(0)}% | ${r.soloWins}/${r.solo} |`).join('\n') + '\n';
md += `\n誰も脱出しなかったゲーム: ${warns.length}/${results.length}\n\n数値は data.js を変えて調整する。ボットは出目を見て選ぶ単純な打ち方なので、人の試遊の感想も合わせて判断する。技（スキル）はボットが2割しか使わないので、技に頼るジョブは低めに出やすい。\n`;
writeFileSync(`${dir}/balance.md`, md);
console.log(md);
process.exit(problems.length ? 3 : 0);
