# CLAUDE.md

GitHub 上の HTML をローカルでプレビューする Chrome 拡張機能（Manifest V3 / TypeScript + Vite）。

## ビルドと読み込み

```bash
npm install
npm run build          # dist/ に出力（tsc --noEmit && vite build）
npm run dev            # HMR 付き開発ビルド
```

Chrome での確認は `chrome://extensions` →「デベロッパーモード」ON →「パッケージ化されていない拡張機能を読み込む」で `dist/` を選択。
**ソースを変更したら `npm run build` で再ビルドし、拡張機能を再読み込みすること**（dist が更新されないと古い挙動のままになる）。

## プレビューのレンダリング構成

ソース表示を差し替えて、3 段ネストした iframe でレンダリングする。

1. **overlay iframe**（`src/content/overlay.ts`）: github.com のページに挿入。`content-height` メッセージを受けて `style.height` を設定する。
2. **sandbox ページ**（`src/sandbox/`）: 拡張機能所有・permissive CSP。`html,body,iframe` すべて `height:100%` の素通し。HTML の書き換え（`resolveHtml.ts`）と中継を担う。
3. **inner srcdoc iframe**: `allow-same-origin` なしの隔離 iframe。プレビュー対象 HTML を実行する。

## 実機での動作確認方法（Playwright + ヘッドレス Chromium）

レンダリングやレイアウト・高さ計測など**ブラウザのレイアウトに依存する挙動**を変更したら、
jsdom ではなく実ブラウザで検証する（jsdom はレイアウトしないので `scrollHeight` 等が常に 0 で無意味）。
本リポジトリ外の一時ディレクトリで実施してよい。

### セットアップ

```bash
cd /tmp
npm i playwright-core
npx playwright-core install chromium   # /opt/pw-browsers 等に DL される
```

### 実行のコツ

- 実行時は `PLAYWRIGHT_BROWSERS_PATH` を DL 先に合わせる
  （例: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node harness.mjs`）。
- `playwright-core` は CommonJS なので ESM からは `import pkg from '.../index.js'; const { chromium } = pkg;` で読み込む。
- 検証対象のコードは**真実の源（`src/`）から抽出して**ハーネスに流すと、手書きコピーによるズレを防げる。
- 検証用 HTML は `iframe` の `srcdoc` で読み込み、レイアウト完了を待ってから（一定時間 wait / `load` 待ち）
  実際の DOM 寸法やメッセージ等を `page.evaluate` で観測する。
