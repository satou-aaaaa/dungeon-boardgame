// 遊ぶ人向けの「更新情報」ページ（changes.html）を、マージされたプルリクエストの題から作る。
// CI（.github/workflows/changes.yml）が gh api で取った PR の一覧（JSON）を渡して動かす。Claude は使わない。
// 使い方: node tools/make-changes.mjs <prs.json> <アプリ名> [載せるPR番号の一覧ファイル] > changes.html
//   番号の一覧を渡すと、そこに無い PR（検査や CI だけを変えたもの）は載せない。
import { readFileSync } from "node:fs";

const [file, appName = "アプリ", onlyFile] = process.argv.slice(2);
const only = onlyFile ? new Set(readFileSync(onlyFile, "utf8").split(/\s+/).filter(Boolean).map(Number)) : null;
const prs = JSON.parse(readFileSync(file, "utf8"));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (iso) => new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });

// 依存の自動更新など、遊ぶ人に関係しないものは載せない
const items = prs
  .filter((p) => p.merged_at && (!only || only.has(p.number)) && !/\[bot\]$/.test(p.user?.login || "") && !/^(chore|ci|build)(\(|:)/i.test(p.title))
  .sort((a, b) => b.merged_at.localeCompare(a.merged_at))
  .slice(0, 40);

const groups = new Map();
for (const p of items) { const d = day(p.merged_at); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(p.title); }

let list = "";
for (const [d, titles] of groups) list += `<section><h2>${esc(d)}</h2><ul>${titles.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></section>\n`;
if (!list) list = "<p>まだ更新はありません。</p>";

process.stdout.write(`<!doctype html>
<html lang="ja"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>更新情報 | ${esc(appName)}</title>
<style>
:root{--bg:#faf8f3;--text:#1f1d1a;--muted:#6d6a63;--line:#e5e1d8}
@media (prefers-color-scheme:dark){:root{--bg:#171614;--text:#ece9e2;--muted:#a19d94;--line:#34322d}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.7 system-ui,"Hiragino Sans","Noto Sans JP",sans-serif}
main{max-width:720px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:22px;margin:0 0 4px} .sub{color:var(--muted);font-size:13px;margin:0 0 20px}
h2{font-size:15px;margin:20px 0 6px;color:var(--muted)} ul{margin:0;padding-left:1.2em} li{margin:4px 0;overflow-wrap:anywhere}
section{border-top:1px solid var(--line)} a{color:inherit}
</style>
</head><body><main>
<h1>更新情報</h1>
<p class="sub">${esc(appName)} の最近の変更です（自動で作っています）。<a href="./">← もどる</a></p>
${list}</main></body></html>
`);
