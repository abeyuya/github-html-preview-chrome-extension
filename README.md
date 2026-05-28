# GitHub HTML Preview (Local)

GitHub 上の HTML ファイルを、API トークンや GitHub Pages なしで直接プレビューできる Chrome 拡張機能です。
ブラウザに既に表示されているソースコードをそのまま使うため、追加のネットワークリクエストを行いません。

## 特徴

- GitHub の HTML ファイルページ（`https://github.com/{owner}/{repo}/blob/{ref}/**.html`）のツールバーに
  **Preview ボタン**を追加。クリックでソース表示 ↔ レンダリング表示をトグルします。
- **GitHub API 不要**。表示中のソースをそのまま利用します。
- 相対パスの CSS / 画像を **raw.githubusercontent.com** の URL に自動解決します。
- GitHub の CSP を回避するため、**拡張機能所有の sandbox** 内でレンダリングします。
- sandbox 内では **JavaScript を実行**します。隔離された sandbox iframe（opaque origin・拡張機能の権限なし・GitHub への同一オリジンアクセス不可）で動くため、GitHub ページや拡張機能本体には触れられません。これにより Swagger UI のような動的ページもプレビューできます。
- プレビューが実行時に **同一リポジトリ・同一 ref の raw アセット**を `fetch` / `XMLHttpRequest` で読み込む場合（例: Swagger UI が OpenAPI 定義を読み込むケース）、そのリクエストを content script 経由でユーザーの GitHub セッションを使って取得します。これにより **private リポジトリでも**そうしたアセットを読み込めます。プレビュー中のファイルと異なる owner / repo / ref へのリクエストは拒否されます。
- ユーザーがアクセスできる **public / private** 両方のリポジトリで動作します。
- **英語 / 日本語**の多言語対応。

## 技術スタック

- Manifest V3
- TypeScript + Vite（`@crxjs/vite-plugin`）

## 開発

```bash
npm install
npm run build   # dist/ にビルド成果物を出力
# 開発時は HMR 付きで:
npm run dev
```

## インストール（Releases からダウンロード）

ビルド済みの zip を [Releases ページ](https://github.com/abeyuya/github-html-preview-chrome-extension/releases) から取得して読み込めます。

1. [Releases ページ](https://github.com/abeyuya/github-html-preview-chrome-extension/releases) を開き、最新リリースの **Assets** から `github-html-preview-local-vX.Y.zip` をダウンロードします。
2. ダウンロードした zip を任意の場所に解凍します（フォルダごと保持してください。削除すると拡張機能が動かなくなります）。
3. Chrome で `chrome://extensions` を開きます。
4. 右上の「デベロッパーモード」を ON にします。
5. 「パッケージ化されていない拡張機能を読み込む」をクリックし、解凍したフォルダを選択します。

> Chrome Web Store には未公開のため、更新は手動で行ってください（新しいリリースの zip を再度ダウンロード → 解凍 → `chrome://extensions` で「更新」または再読み込み）。

## インストール（ソースからビルド）

1. `npm install && npm run build` を実行して `dist/` を生成します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」を ON にします。
4. 「パッケージ化されていない拡張機能を読み込む」をクリックし、`dist/` ディレクトリを選択します。

## 使い方

1. GitHub 上で任意の HTML ファイルのページ（blob ページ）を開きます。
2. ツールバーの **Preview** ボタンをクリックすると、レンダリングされた HTML が表示されます。
3. **Code** をクリックするとソース表示に戻ります。

## 動作確認用サンプル

[`examples/`](./examples/) に、基本描画・相対アセットの解決・Swagger UI など主要機能を
確認できるサンプル HTML を用意しています。各ファイルの blob ページを開いて **Preview** を
押すだけで挙動を確認できます。詳細は [examples/README.md](./examples/README.md) を参照してください。

## 制限事項

- 現在のページに表示されていないファイルはプレビューできません。
- ローカル開発サーバーや GitHub Pages の完全な代替ではありません。
- 実行時の `fetch` / `XMLHttpRequest` で読み込む同一リポジトリの raw アセットには対応していますが、`<script src>` / `<link href>` など **ブラウザが直接読み込む静的アセット**は raw.githubusercontent.com から取得されるため、private リポジトリでは取得できないことがあります（CDN 等の絶対 URL を使うか、`fetch` ベースの読み込みを利用してください）。
