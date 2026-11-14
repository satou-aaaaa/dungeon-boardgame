// AIプレイヤー。画面のボタンを読んで選び、人と同じ操作（クリック）で動かす。
// qa/run.mjs のボットも同じ aiChoose() を使う（ここを直せば検査も追従する）。
// 席ごとに「人 / AI」を選べる（開始画面）。AIの手番は少し間を置いて進めるので、見て追える。
const AI_DELAY = { modal: 1300, act: 750 };

// 次に押すボタンを1つ選んで返す（押せるものが無ければ null）。
//   モーダル: 成功する出目（「成功」「開く」「かわせる」）・ボスの素通り・罠解除/鍵開けAS・必殺技があれば選ぶ。手元の🎲が4以上ならそれで攻撃。
//             それ以外は 85% で先頭（たいてい「攻撃」「OK」）、15% でランダム。
//   盤面:   盗賊は未開封のSP宝箱、戦士はLv5以上なら第3層のボス、脱出できるなら出口、上り階段を狙う。必要ないボスマスは避ける。
//           ボタンは 上り階段 > いちばん遠くへ行けるダイスで移動 > ダイスを振る > ターン終了 の順に押す。
function aiChoose() {
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const enabled = (sel) => [...document.querySelectorAll(sel)].filter((b) => !b.disabled && b.offsetParent !== null);
  if (document.querySelector('#modal.open')) {
    const bs = enabled('#modal .m-buttons button');
    const txt = (b) => b.textContent;
    const good = bs.find((b) => /（成功）|（開く）|（かわせる）|そっと通り過ぎる|罠解除を使う|鍵開けASを使う/.test(txt(b)));
    const dieAtk = bs.filter((b) => /手元の🎲\d+で攻撃/.test(txt(b))).sort((a, b) => +txt(b).match(/(\d+)ダメージ/)[1] - +txt(a).match(/(\d+)ダメージ/)[1]);
    const special = bs.find((b) => /必殺技/.test(txt(b)));
    if (good) return good;
    if (special) return special;
    if (dieAtk.length && +txt(dieAtk[0]).match(/🎲(\d+)/)[1] >= 4) return dieAtk[0];
    return bs.length ? (Math.random() < 0.85 ? bs[0] : pick(bs)) : null;
  }
  if (typeof busy !== 'undefined' && busy) return null;
  const dests = enabled('#panel [data-dest]');
  const P = S.players[S.cur]; const thief = P.job === 'thief';
  const sqOf = (d) => S.board[P.layer][+d.dataset.dest];
  const bossTime = !thief && P.layer === 2 && P.lv >= 5;
  const want = (d) => { const q = sqOf(d); return (thief && q.type === 'sp' && !q.used) || (q.type === 'exit' && canEscape(P)) || (q.type === 'boss' && bossTime) || q.type === 'stairsUp'; };
  if (dests.length) {
    const safe = dests.filter((d) => sqOf(d).type !== 'boss' || bossTime);
    return dests.find(want) || pick(safe.length ? safe : dests);
  }
  const as = enabled('#panel [data-as]');
  if (as.length && Math.random() < 0.2) return pick(as);
  const up = enabled('#panel [data-act="up"]');
  const mv = enabled('#panel [data-act="move"]');
  const rl = enabled('#panel [data-act="roll"]');
  const end = enabled('#panel [data-act="end"]');
  const far = (b) => +(b.textContent.match(/(\d+)マス/) || [0, 0])[1];
  const mvBest = [...mv].sort((a, b) => far(b) - far(a))[0];
  return up[0] || mvBest || rl[0] || end[0] || null;
}

// AIの手番のあいだ、間を置いて1手ずつ進める（人の手番では何もしない）
function aiLoop() {
  let wait = AI_DELAY.act;
  try {
    if (typeof S !== 'undefined' && S && !S.winner && !document.querySelector('#game').hidden && S.players[S.cur].ai) {
      const modalOpen = !!document.querySelector('#modal.open');
      wait = modalOpen ? AI_DELAY.modal : AI_DELAY.act;
      const b = aiChoose();
      if (b) b.click();
    }
  } catch (e) { console.error(e); }
  setTimeout(aiLoop, wait);
}
window.addEventListener('DOMContentLoaded', () => setTimeout(aiLoop, AI_DELAY.act));
