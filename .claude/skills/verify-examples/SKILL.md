---
name: verify-examples
description: ブラウザにインストール済みの本拡張機能を、GitHub 上の examples/ サンプル（basic / relative-assets / swagger / long-content）に対して実機で動作確認する。「動作確認して」「example を検証して」「プレビューが壊れてないか確認して」等のときに使う。
---

# examples 実機動作確認

ブラウザにインストール済みの本拡張機能を、GitHub の `examples/` blob ページで実際に開いて、プレビューが正しく描画されるかを確認する手順。レイアウト/レンダリングに依存するため、jsdom やソース解析ではなく **実機の Chrome** で確認する。

## 前提

- 確認対象の拡張機能が Chrome に読み込み済みであること（`chrome://extensions`）。最新コードを確認するなら先に `npm run build` して再読み込みする。
- Chrome の **View → Developer → Allow JavaScript from Apple Events** が ON であること。OFF だと `execute_javascript` / `get_page_content` が `Chrome is not running` で失敗する（ナビゲーション系 AppleScript は動くのに JS だけ失敗する場合はこれを疑う）。ユーザーに ON を依頼する。
- 使うツール: `mcp__Control_Chrome__*`（navigate / switch_to_tab / execute_javascript / open_url）と、macOS の `screencapture`（Bash）。

## ツールの癖（重要）

- `Control_Chrome` の **tab_id は AppleScript の Chrome tab `id` とは別物**。`screencapture` 用にウィンドウを前面化するときは tab_id ではなく **URL 部分一致** でタブを探す（下記スニペット）。
- `Control_Chrome` には **スクリーンショット機能が無い**。見た目の確認は macOS の `screencapture -x /tmp/xxx.png` → `Read` で行う。対象タブのウィンドウを最前面にしてから撮る。
- プレビュー本体は **opaque origin の srcdoc iframe**（`allow-same-origin` なし）。github.com 側の JS から内側 DOM は読めない。内側の描画確認は「スクリーンショット」と「overlay の高さ」で行う。
- Preview ボタンはロケール依存でテキストが変わる（ja: プレビュー/コード）。**テキストではなく `.ghp-preview-toggle-wrapper button` で選択**する。
- `execute_javascript` は **Promise を await しない**。`setTimeout` で待つコードは戻り値が取れないので、待機は Bash の `sleep` を挟んで別呼び出しで計測する。

## 対象サンプルと合格基準

| サンプル | blob パス | 合格基準 |
| --- | --- | --- |
| basic | `examples/basic.html` | インライン CSS 適用（カード/緑ボタン）、JS の「行を追加する」ボタン表示 |
| relative-assets | `examples/relative-assets/index.html` | `./logo.png`（青→シアンのグラデ 96x96）が表示される＝相対パスが raw URL に解決 |
| swagger | `examples/swagger/index.html` | Swagger UI が描画（タイトル / Servers / pets エンドポイント / Schemas）。CDN の CSS/JS と fetch プロキシ経由の openapi.yaml 取得が成立 |
| long-content | `examples/long-content.html` | 全セクションが描画され、overlay 高さがビューポートを超えて伸びる（高さ追従）。末尾セクションまでスクロールで到達できる |

ブランチは通常 `main`。別ブランチを確認するときは URL の `/blob/<ref>/` を差し替える。

## 手順（各サンプル共通）

1. **開く**: `open_url` で blob ページへ。
   `https://github.com/abeyuya/github-html-preview-chrome-extension/blob/main/examples/<path>`
2. **ボタン注入確認**: `get_current_tab` で tab_id を取得し、`execute_javascript` で
   ```js
   (() => { const b=document.querySelector('.ghp-preview-toggle-wrapper button');
     return JSON.stringify({hasButton:!!b, ready:document.readyState,
       overlay:!!document.querySelector('#ghp-preview-overlay')}); })()
   ```
   `hasButton:false` なら少し待って再試行（content script は document_idle 注入）。
3. **プレビュー起動**: `(() => { const b=document.querySelector('.ghp-preview-toggle-wrapper button'); b.click(); return b.textContent.trim(); })()`
4. **前面化して撮影**（swagger 等 fetch があるものは sleep を長めに）:
   ```bash
   osascript -e 'tell application "Google Chrome"
     activate
     repeat with w in windows
       set t to tabs of w
       repeat with i from 1 to count of t
         if URL of (item i of t) contains "<path-fragment>" then
           set active tab index of w to i
           set index of w to 1
           return "ok"
         end if
       end repeat
     end repeat
     return "not found"
   end tell' && sleep 2 && screencapture -x /tmp/ghp_<name>.png && echo done
   ```
   その後 `Read /tmp/ghp_<name>.png` で目視確認。
5. **高さ確認**: `(() => { const o=document.querySelector('#ghp-preview-overlay');
   return JSON.stringify({h:o&&o.style.height, innerH:window.innerHeight}); })()`
   - 短いページは `innerHeight - 120`（既定ペイン高）で頭打ちになり下部に余白が出るのは既知挙動。
   - long-content は overlay 高さが `innerHeight` を大きく超えれば高さ追従 OK。
6. **トグル復帰**: もう一度 `.ghp-preview-toggle-wrapper button` を click → overlay が DOM から消え、`#read-only-cursor-text-area` の display が復元されることを確認。

## 追加で見ておくと良い回帰ポイント

- **SPA 再注入**: `tree/main/examples` を開いて blob リンクを click（Turbo ナビ）→ ボタンが**重複なく 1 個**再注入されるか（`document.querySelectorAll('.ghp-preview-toggle-wrapper').length === 1`）。
- **元コードの非表示**: プレビュー中は `#read-only-cursor-text-area` が `display:none` になっているか（選択テキストの干渉防止）。

## 結果の扱い

- 各サンプルの合否を表で報告し、崩れ/エラーはスクショと併せて指摘する。
- 明確な機能バグを見つけたら **内容をユーザーに提示して承認を得てから** GitHub issue を起票する（issue 作成は共有状態への書き込みなので勝手に実行しない）。
- 見た目の確認ができない制約（スクショ不可など）に当たったら、推測で「OK」と書かず、確認できなかった旨を明記する。
