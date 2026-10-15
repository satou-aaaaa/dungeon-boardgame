# CLAUDE.md

ダンジョン脱出ハクスラ（ボードゲームの試遊版）。ビルド不要の静的HTML/JS。数値・カードは `data.js`、進行は `game.js`。

## 変更の出し方（2026-10-15〜）

- main に直接 push しない。ブランチを切ってドラフトPRを出す。
- PR では QA（`.github/workflows/qa.yml`）が自動対戦の検査を回す。✅ になったらドラフトを外せば、`automerge.yml` が自動でマージし GitHub Pages を公開し直す。
- 自動でマージしたくない PR にはラベル「自動マージしない」を付ける。`.github/` を変える PR は自動マージされない（手でマージ）。
- 検査を飛ばす・無効にする・テストを消すことで通さない。

## 検査

```bash
cd qa && npm ci && npx playwright install chromium && cd ..
node qa/run.mjs --games 30          # 失敗したゲームは --seed N --games 1 で再現
```

- JS エラー・進まない状態は ❌。誰も脱出しないゲームは ⚠️。
- ジョブごとの勝率・脱出ラウンド数の表が Actions の Summary に出る。`data.js` を変えたら前後で比べる（ボットは単純な打ち方なので目安）。
- 画面やルールを変えて `qa/run.mjs` のボットが動けなくなったら、ボットも合わせて直す。
- main の QA が失敗すると、ラベル `ci-failure` の Issue が自動で立つ（成功で自動クローズ）。
