# AGENTS.md

<!-- AI エージェント共通の指示（Claude・Codex・Gemini・Copilot などが読む）。CLAUDE.md はこれを取り込むだけ。 -->

ダンジョン脱出ハクスラ（ボードゲームの試遊版）。ビルド不要の静的HTML/JS。数値・カードは `data.js`、進行は `game.js`。

## 準備（最初に一度）

```bash
bash scripts/setup.sh   # Node.js（版は .nvmrc）を確かめ、qa/ の依存とブラウザを入れる。何度実行してもよい（Windows は Git Bash で）
```

Claude Code のクラウドセッションでは `.claude/settings.json` のフックが自動で実行する。

## push する前の確認

```bash
node qa/run.mjs --games 30          # 失敗したゲームは --seed N --games 1 で再現
```

- JS エラー・進まない状態は ❌。誰も脱出しないゲームは ⚠️。
- ジョブごとの勝率・脱出ラウンド数の表が Actions の Summary に出る。`data.js` を変えたら前後で比べる（ボットは単純な打ち方なので目安）。
- 画面やルールを変えて `qa/run.mjs` のボットが動けなくなったら、ボットも合わせて直す。
- 検査を飛ばす・無効にする・テストを消すことで通さない。

## 公開

- main に直接 push しない。ブランチを切って PR を出す（2026-10-15〜）。
- GitHub Pages は `main` のルート（`/`）を公開する。PR の QA が ✅ になると `automerge.yml` が自動でマージする。止めたいときは下書きにするか、ラベル「自動マージしない」を付ける。`.github/` を変える PR は自動マージされない（手でマージ）。
- main の QA が失敗すると、ラベル `ci-failure` の Issue が自動で立つ（成功で自動クローズ）。

## 共通のきまり

- PR の作り方・マージの仕方は satou-aaaaa/shared-workflows の `routines/pr.md`、全体のきまりは `routines/common.md` に従う。
- CI の部品（CI失敗Issue・死活監視・Lighthouse・ブランチ片付け・自動マージ）は shared-workflows の共通部品を呼ぶ。
  リポジトリ側の .github/workflows には呼び出しと設定値だけを書く。
- Claude 以外の AI・人が作業するときは、shared-workflows の `routines/tool-map.md`（道具の置き換え）と `routines/without-claude.md` を読む。
