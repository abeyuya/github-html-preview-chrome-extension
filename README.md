# GitHub HTML Preview (Local)

GitHub 上の HTML ファイルを、API トークンや GitHub Pages なしで直接プレビューできる Chrome 拡張機能です。
ブラウザに既に表示されているソースコードをそのまま使うため、追加のネットワークリクエストを行いません。

## 特徴

- GitHub の HTML ファイルページ（`https://github.com/{owner}/{repo}/blob/{ref}/**.html`）のツールバーに
  **Preview ボタン**を追加。クリックでソース表示 ↔ レンダリング表示をトグルします。
- **GitHub API 不要**。表示中のソースをそのまま利用します。
- 相対パスの CSS / 画像を **raw.githubusercontent.com** の URL に自動解決します。
- GitHub の CSP を回避するため、**拡張機能所有の sandbox** 内でレンダリングします。
- sandbox 内では **JavaScript の実行を無効化**しています（安全性のため）。
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

## インストール（未パッケージ版）

1. `npm install && npm run build` を実行して `dist/` を生成します。
2. Chrome で `chrome://extensions` を開きます。
3. 右上の「デベロッパーモード」を ON にします。
4. 「パッケージ化されていない拡張機能を読み込む」をクリックし、`dist/` ディレクトリを選択します。

## 使い方

1. GitHub 上で任意の HTML ファイルのページ（blob ページ）を開きます。
2. ツールバーの **Preview** ボタンをクリックすると、レンダリングされた HTML が表示されます。
3. **Code** をクリックするとソース表示に戻ります。

## 制限事項

- 現在のページに表示されていないファイルはプレビューできません。
- ローカル開発サーバーや GitHub Pages の完全な代替ではありません。
- プレビュー内の JavaScript は実行されません。
