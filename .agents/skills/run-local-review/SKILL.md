---
name: run-local-review
description: 現在のローカルブランチを対象に、PR を作る前段階で AI レビューを行う thin orchestrator。`compose-review` (sub-agent) でレビュー本文を生成し、結果をチャットと markdown ファイルの両方に出力する。GitHub への投稿は行わない (post-pr-review / resolve-pr-threads は呼ばない)。
---

# run-local-review skill

PR 作成前のローカルブランチに対して AI レビューを行うための thin orchestrator skill。レビュー方針は `run-pr-review` と揃え、出力先のみ「GitHub Review 投稿」ではなく「チャット表示 + markdown ファイル出力」に差し替えたバリエーション。

## 入力 (任意, caller から prompt 経由で渡される想定)

すべて省略可。

- `BASE_BRANCH`: 比較対象のベースブランチ。`compose-review` にそのまま転送する。本 skill / `compose-review` は `git fetch` を走らせないため、ローカルのベースが古いと古い基準で diff が出る。最新で比較したい場合は caller 側で fetch するか、`BASE_BRANCH=origin/main` のようにリモート追跡参照を明示する。
- `MAX_INLINE_COMMENTS`: インライン指摘の総数上限。正の整数または `unlimited`。`compose-review` にそのまま転送する。
- `OUTPUT_PATH`: markdown 出力先パス。省略時は `/tmp/run-local-review/{repo}/{timestamp}-{branch}.md` (例: `/tmp/run-local-review/skills/20260507T123456Z-claude-unique-review-filenames-tpIhG.md`)。caller が明示パスを指定した場合は既存ファイルがあれば上書きする。プレースホルダの組み立て規則:
  - `{repo}`: `git remote get-url origin` の URL 末尾セグメント (`.git` を除く、取得失敗時は `local`)
  - `{timestamp}`: `date -u +%Y%m%dT%H%M%SZ` の出力
  - `{branch}`: 現在ブランチ名の英数記号以外 (`/` 等) を `-` に置換

caller プロジェクト固有の方針は **プロジェクト指示ファイル** に置く運用。読み込み手順は `compose-review` skill 側に集約しているため、本 skill では扱わない。

## 手順

### Step 1. `compose-review` (sub-agent) でレビュー本文を生成する

dispatch 手順 (Task ツール / `general-purpose` / Skill ツール経由起動 / 生 JSON 返却) と戻り値 parse 判定の順序は **`compose-review` skill の「caller 向け呼び出し契約」節** に従う (本 skill には再掲しない — 出力契約変更時の二重管理を避けるため)。本 skill 固有の点は以下。

#### 渡す引数 (prompt テンプレート)

```
pr-review プラグインの compose-review skill を呼び出すための subagent。
Skill ツール (`skill: "compose-review"`) で compose-review skill を起動し、
以下を引数として渡せ。skill の出力 (JSON) を最終メッセージとして verbatim に返せ。
最終メッセージは前置きも fenced ブロックもなしの生 JSON 1 つだけ。

MODE=local
BASE_BRANCH=<値>
MAX_INLINE_COMMENTS=<値>
```

#### parse 判定の各ケースで取るアクション (正典の 4 ケースに対応)

非 success の 3 ケースはいずれも **擬似結果を組み立てて Step 2 (markdown 出力) を必ず実行** する (markdown ファイルは差分が空でも必ず生成する、という本 skill「守ること」の不変条件と整合させる)。擬似結果の共通部は `comments=[]` / `base_branch="<unknown>"` / `diff_mode="none"` / `commit_count=0`、`body` のみケースで差し替える:

1. **parse 失敗** → `body="compose-review 失敗 (parse error)。Task ツール戻り値を JSON として解釈できませんでした。"` で Step 2 を実行し、Step 3 で同旨を caller に報告する。
2. **`error` あり** → `body="compose-review エラー: <error message>"` で Step 2 を実行する。
3. **`mode` が `"local"` でない** → `body="compose-review モード不整合 (期待: local、実際: <mode>)。"` で Step 2 を実行する。
4. **success** → `base_branch` / `diff_mode` / `commit_count` / `body` / `comments` を Step 2 に渡し、**Step 2 → Step 3 を順に必ず実行する**。

### Step 2. 結果を出力する (チャット + markdown ファイル)

markdown ファイルが完全版、チャットは要約版で、両者は内容そのものは同じだが粒度が異なる (チャットへの全文ダンプは後続コンテキストを圧迫するため避ける)。

#### 2-1. markdown ファイル

`OUTPUT_PATH` (省略時の組み立て規則は「入力」セクションの `OUTPUT_PATH` 説明を参照) に `Write` ツールで書き出す。

`Write` ツールは中間ディレクトリの自動作成を保証していないため、書き出し前に `Bash` ツールで `mkdir -p "$(dirname "<OUTPUT_PATH>")"` を実行して親ディレクトリを作成する (`<OUTPUT_PATH>` をダブルクォートで囲むことでスペース入りパスも安全に動く)。caller が明示パスを指定したケースも同様。

現在ブランチ名は `git rev-parse --abbrev-ref HEAD` で取得する (markdown 見出し用)。

スキーマ:

```markdown
# Local AI Review: <branch> (vs <base_branch>)

- 生成日時: <ISO8601, UTC 秒精度。例: 2026-05-04T12:34:56Z>
- 差分モード: <commit / staged / worktree / none>
- 対象コミット: <ここは `diff_mode="commit"` のとき `<commit_count> 件 (<base_branch>..HEAD)` (例: `3 件 (main..HEAD)`)、それ以外 (`staged` / `worktree` / `none`) のとき `0 件 (コミット未作成)` と固定文字列で書き込む。機械的な置換ではなく `diff_mode` で分岐する>
- インライン指摘: <count> 件

## 総括

<compose-review の `body` を埋め込む。埋め込み時、`body` 内の **行頭 `^## ` を一律 `### ` に機械置換** して h2 を h3 に 1 段下げる (特定見出し名 `## 総合判断` / `## 指摘内訳` / `## 良かった点` への依存を避け、compose-review が将来見出し文言を変えても取りこぼさないため)。h3 以降 (`### ` 等) はそのまま。markdown 親見出し `## 総括` の下に同レベルの h2 が並んで階層が崩れるのを防ぐ変換であり、post-pr-review 投稿時は h2 のままが自然なので本変換は run-local-review でのみ行い、compose-review 自体は h2 を出力する契約のままにする。>

## インライン指摘

### 1. [must] path/to/file.ts:42

<comments[0].body>

### 2. [should] path/to/file.ts:50-55

<comments[1].body>

<以下、指摘ごとに繰り返し。指摘が無ければ「特に指摘なし」とだけ書く。>
```

各インライン指摘の見出しは `### <番号>. <body 先頭の重要度ラベル> <path>:<line>` の形式で揃える。重要度ラベルは `comments[i].body` の先頭にある `[must]` / `[should]` / `[nit]` / `[question]` / `[pre_existing]` のいずれか (正規表現 `^\[[a-z_]+\]` を `body` 冒頭にマッチさせて取り出す)。見出しに使ったラベル文字列は本文側からは削除せず `body` をそのまま掲載する (本文先頭でも重複表示で問題ない)。マッチしない場合は見出しからラベルを省く (`### <番号>. <path>:<line>`)。複数行範囲 (`start_line` / `line` 併用) のコメントは `<path>:<start_line>-<line>` で表記する。

`heredoc` や `cat` リダイレクトは使わず、必ず `Write` ツールで書く。`Write` ツールは既存ファイルがあると事前 `Read` 必須なため、`OUTPUT_PATH` が既存パスの可能性があれば `Read` を 1 回挟んでから `Write` する。

差分なし (`diff_mode: "none"`) で `compose-review` から空 `comments[]` + 「対象差分なし」相当の `body` が返った場合でも、markdown のスキーマ (`## 総括` / `## インライン指摘` 見出し) は保持し、本文は compose-review が返した文言と「特に指摘なし」で埋める (見出し削除や空セクション化はしない)。

「生成日時」は実行時に `date -u +%Y-%m-%dT%H:%M:%SZ` で取得した UTC 秒精度の ISO8601 を採用する。`date` が利用できない環境では caller / 実行環境から提供される現在日時を使い、それも無ければ `<unknown>` と記載する。

#### 2-2. チャット出力

チャットには以下を出力する。markdown ファイル全文をそのままダンプしない (指摘件数や差分が多いケースで後続会話のコンテキストを圧迫するため):

- 冒頭に出力先パス (`OUTPUT_PATH`) を 1 行
- `## 総括` セクションは全文表示
- インライン指摘は「番号. `[label]` `path:line` — 1 行サマリ」のリスト形式に縮約 (本文詳細は markdown 側に任せる)
- 末尾に `詳細は <OUTPUT_PATH> を参照` を 1 行添える

### Step 3. caller への報告

以下を簡潔に caller へ返す:

- レビュー対象のブランチ / `base_branch` / `diff_mode`
- インライン指摘件数
- 出力先 markdown ファイルパス

## 守ること

- 既存資産 (`compose-review`) は **必ず Task ツール (sub-agent) 経由で利用** する。本 skill 内でレビュー本文 (`/pr-review-style-reference` 読み込み / プロジェクト指示ファイル / 差分取得 / 本文生成) を再実装しない。
- GitHub への投稿は行わない。`post-pr-review` / `resolve-pr-threads` skill は呼ばない。`gh pr comment` / `gh pr review` / `gh api .../reviews` も使わない。
- `git fetch` / `git pull` / `git checkout` / `git reset` 等、ワーキングツリーやローカル ref を書き換える操作はしない。読み取り専用 (`git rev-parse` / `git remote get-url`) のみ。
- 差分が空の場合も markdown 出力 + 報告は行う (skip しない)。判定は `compose-review` 側の `diff_mode` に従う。
