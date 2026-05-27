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

ソース表示を差し替えて、3 段ネストした iframe でレンダリングする。高さまわりを触るときはこの段構成を意識する。

1. **overlay iframe**（`src/content/overlay.ts`）: github.com のページに挿入。`content-height` メッセージを受けて `style.height` を設定する。
2. **sandbox ページ**（`src/sandbox/`）: 拡張機能所有・permissive CSP。`html,body,iframe` すべて `height:100%` の素通し。HTML の書き換え（`resolveHtml.ts`）と中継を担う。
3. **inner srcdoc iframe**: `allow-same-origin` なしの隔離 iframe。プレビュー対象 HTML を実行し、`resolveHtml.ts` の `HEIGHT_REPORTER` が自分の高さを計測して上位へ postMessage する。

sandbox 層が `height:100%` の素通しなので、**内側 iframe のビューポート高さ = overlay の高さ**。検証では単一 iframe で等価に再現できる（下記）。

## 高さ計測のフィードバックループに注意

overlay を計測値に合わせて伸ばす → 内側ビューポートが伸びる → 再計測、という経路があるため、
ビューポート充填（`height:100%` / `min-height:100vh`）＋ padding/margin を持つページでは
計測値が毎回増え続け、下部に巨大な空白スクロール領域ができる**無限ループ**に陥りやすい。

対策の原則:
- **高さのみの変化では再計測しない**（overlay が要求どおり伸びただけなので、ループの起点になる）。
- コンテンツ高さが実際に変わりうる要因に限定して再計測する: 幅変化 / DOM 変更（`MutationObserver`）/ サブリソース・フォント読み込み（`load` のキャプチャ段 + `document.fonts.ready`）。

## 実機での動作確認方法（Playwright + ヘッドレス Chromium）

`HEIGHT_REPORTER` などレンダリング・高さ計測を変更したら、**jsdom ではなく実ブラウザ**で検証する
（jsdom はレイアウトしないので `scrollHeight` が常に 0 で無意味）。本リポジトリ外の一時ディレクトリで実施してよい。

### セットアップ

```bash
cd /tmp
npm i playwright-core
npx playwright-core install chromium   # /opt/pw-browsers 等に DL される
```

### ハーネスの考え方

- overlay 相当の iframe を 1 枚用意し、`message` で受けた `content-height` を `iframe.style.height` に反映する
  （= content script の挙動。sandbox 層は素通しなので省略して等価）。
- 内側に検証対象 HTML（`HEIGHT_REPORTER` を注入したもの）を `srcdoc` で読み込む。
- 一定時間待ってから「`content-height` の postMessage 回数（applies）」と「最終 iframe 高さ（finalHeight）」を観測する。
  - **ランナウェイ判定**: `applies` が多数（例 >8）または `finalHeight` が極端に大きい（例 >3000px）ならループしている。
  - **正常**: 多くのケースで `applies=1` 前後に収束する。
- 実行時は `PLAYWRIGHT_BROWSERS_PATH` を DL 先に合わせる（例: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node harness.mjs`）。
- `playwright-core` は CommonJS なので ESM からは `import pkg from '.../index.js'; const { chromium } = pkg;` で読み込む。

### 検証で押さえるべきケース

| ケース | 期待 |
|---|---|
| `body { min-height:100vh; padding:40px }`（content-box 充填＋padding） | 収束（旧コードはランナウェイ） |
| `html,body { height:100% }` ＋ body padding | 収束 |
| `min-height:100vh` ＋ 高コンテンツ（例 1500px） | コンテンツ高さに追従 |
| 通常ドキュメント（短・長） | 正確に追従 |
| flex column `min-height:100vh`（header/main flex:1/footer） | ビューポート高に収束 |
| 非同期で高さが増える（`setTimeout` で要素拡大 = Swagger UI 相当の動的描画） | DOM 変更を検知して追従 |

### 信頼性のコツ

- **真実の源（src）から `HEIGHT_REPORTER` 文字列を抽出して**ハーネスに流すと、手書きコピーのズレを防げる
  （`src/sandbox/resolveHtml.ts` を読み、`const HEIGHT_REPORTER = \`...\`;` を正規表現で取り出す）。
- アスペクト比で拡大される `width:100%` 画像などはテスト側の作為で巨大値になりうる。レポーターのバグと切り分ける。
