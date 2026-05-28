# 動作確認用サンプル

GitHub HTML Preview 拡張機能の挙動を、このリポジトリ上でそのまま確認するためのサンプル集です。

## 使い方

1. 拡張機能をインストールします（リポジトリ直下の [README](../README.md) を参照）。
2. 下記の各サンプルファイルの **blob ページ**（このページのリンクから開けます）を GitHub で開きます。
3. ツールバーの **Preview** ボタンをクリックすると、レンダリング結果が表示されます。

## サンプル一覧

| サンプル | 確認できること |
| --- | --- |
| [basic.html](./basic.html) | インライン CSS/JS のみの基本描画。ボタン操作で行を増やすと、プレビューの高さが自動で追従します。 |
| [relative-assets/index.html](./relative-assets/index.html) | 相対パスの画像 (`./logo.png`) が `raw.githubusercontent.com` の URL に自動解決され、表示されます。（`<link>`/`<script src>` の CSS・JS は raw の `text/plain` + `nosniff` によりブラウザが適用を拒否するため、相対解決の確認には画像を用いています。） |
| [swagger/index.html](./swagger/index.html) | Swagger UI を CDN から読み込み、同一リポジトリの [`openapi.yaml`](./swagger/openapi.yaml) を相対パスで `fetch` して API ドキュメントを描画します。spec の取得は content script 経由のプロキシで行われるため、private リポジトリでも動作します。 |

> リンクはこの README と同じブランチの blob ページに解決されるので、そのまま Preview を試せます。
