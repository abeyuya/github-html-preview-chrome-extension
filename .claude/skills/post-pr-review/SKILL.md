---
name: post-pr-review
description: PR レビュー結果を1回の API コールで1つの Review として GitHub に投稿する。複数のインライン指摘や総括コメントを含むレビューを投稿する場合は必ずこの skill を使うこと。`gh pr comment` や `gh pr review` を使った個別投稿は禁止。
---

# post-pr-review skill

PR レビュー結果を **1回の API コールで「1つの Review」として投稿** する手順を提供する skill。
人間レビュアーの "Submit Review" と同じ構造で投稿する。

## 守ること

- レビュー結果は **必ず1回の API コール** で投稿する。
- 個別投稿系のツール (`mcp__github_inline_comment__create_inline_comment`、`gh pr comment` 等) は **使わない**。
- `event` は **常に `COMMENT`**。`APPROVE` / `REQUEST_CHANGES` は使わない (Bot がマージブロックや承認権を持つことを避けるため)。
- インラインコメントの本文フォーマット (重要度ラベル等) は **caller のレビュー方針に従う**。本 skill は手続きのみを担い、レビュー文面の規約は規定しない。
- 総括 `body` の先頭には **AI 自動投稿マーカーを必ず付与する** (詳細は「手順 1」参照)。認証主体が人間 PAT でも投稿内容は AI 生成であることを明示するため。caller 側で事前に付与する必要はなく、本 skill が一律に prepend する。エージェント名 (Claude Code / Codex / Cursor 等) はマーカーに含めない (本 skill は複数の AI エージェントから呼ばれうる前提)。

## Public Payload Interface

本 skill は「レビュー本文を受け取って GitHub Review として投稿するだけ」の純粋な投稿 skill。レビュー自体をどう生成するか (どの skill / どのエージェント / どんな観点で書くか) には関与しない。

下記の Payload スキーマと呼び出し経路は **本 skill の公開インターフェース** として扱う。`run-pr-review` 等の上流 skill 経由でも、人手 / 外部システムから直接呼ぶ場合でも、同一の Payload を受け付ける。後方互換性に注意して変更すること (キー追加は可、既存キーの削除 / 型変更 / 必須化はインターフェース変更扱い)。

### 識別情報 (必須)

- `OWNER` / `REPO` / `PR_NUMBER`: 対象 PR を一意に決める 3 値。Skill 自身は PR を自動推定せず、caller が必ず渡す。

### Payload スキーマ

caller が渡す Payload (TypeScript ライクに表記。マーカー prepend 前の生本文):

```ts
type ReviewPayload = {
  body: string;                // 必須。総括コメント本文 (Markdown 可)。AI 自動投稿マーカーは skill 側で自動 prepend するため caller は付けない。指摘なし時も「特に指摘なし」相当の本文を入れる。
  event: "COMMENT";            // 必須。リテラル固定。"APPROVE" / "REQUEST_CHANGES" は禁止。
  comments: ReviewComment[];   // 必須。空配列 ([]) 可。
  commit_id?: string;          // 任意。head commit の SHA。force-push / rebase での行ズレ防止に推奨。省略時は GitHub 側で最新 commit を採用。
};

type ReviewComment =
  | {                          // 単一行コメント
      path: string;            // 必須。リポジトリ root からの相対パス。
      line: number;            // 必須。1-based。
      side: "RIGHT" | "LEFT";  // 必須。新ファイル側 (RIGHT) / 旧ファイル側 (LEFT)。通常 "RIGHT"。
      body: string;            // 必須。本文 (重要度ラベル等は caller の方針に従う)。
    }
  | {                          // 複数行範囲コメント
      path: string;
      start_line: number;      // 必須。範囲開始行。`line` より前の行であること。
      start_side: "RIGHT" | "LEFT"; // 必須。
      line: number;            // 必須。範囲終了行。
      side: "RIGHT" | "LEFT";  // 必須。
      body: string;            // 必須。
    };
```

`commit_id` は caller 側で `gh pr view ... --json headRefOid` の `headRefOid` (= head SHA) を取得して渡すと、force-push / rebase で行ズレが起きた際の誤コメントを防げる (`run-pr-review` Step 2 で取得済みの `headRefOid` を流用する想定)。

### 契約の前提 (Payload 設計上の制約)

- `body` 先頭の **AI 自動投稿マーカー** は本 skill が自動 prepend する。caller は付けない (詳細は「手順 1」のマーカー文言を参照)。
- `event` は **常に `COMMENT`** (Bot がマージブロック / 承認権を持つことを避けるため、`APPROVE` / `REQUEST_CHANGES` は禁止)。
- `comments[].body` の本文フォーマット (`[must]` / `[should]` 等の重要度ラベル等) は **caller のレビュー方針** に従う。本 skill は手続きのみを担う。
- `comments[].body` には Review 本体側のマーカーで帰属が示されるため **個別マーカーを付けない**。

### 呼び出し経路

#### (a) 上流 skill から Skill ツール経由で呼ぶ場合

`run-pr-review` Step 4 のように、上流 skill が `OWNER` / `REPO` / `PR_NUMBER` と Payload (`body` / `event` / `comments[]` / 任意で `commit_id`) を組み立てて Skill ツールの引数として渡す。本 skill 側で `/tmp/review.json` への `Write` と `gh api .../reviews --input` を実行する。caller 側で先回りして JSON を書き出す必要はない。

#### (b) 人手 / 外部システムから prompt 経由で呼ぶ場合

prompt の中に上記スキーマに沿った Payload を埋め込んで本 skill を起動する。最小例:

```
post-pr-review skill を呼んでください。

OWNER: octocat
REPO: hello-world
PR_NUMBER: 42
COMMIT_ID: 9f8e7d6c1a2b3c4d5e6f7890abcdef1234567890

body: |
  ## 総合判断
  概ね問題なし。下記 1 点のみ確認お願いします。

event: COMMENT
comments:
  - path: src/example.ts
    line: 42
    side: RIGHT
    body: "[should] ここの処理は null チェックが抜けています。"
```

caller (人 / 外部システム) は Payload を渡すだけで、`/tmp/review.json` の Write や `gh api` 実行は本 skill が行う。

## 手順

### 1. `body` 先頭に AI 自動投稿マーカーを付与し、`/tmp/review.json` を `Write` ツールで書き出す

`heredoc` や `cat` リダイレクトは使わず、必ず `Write` ツールで書く。

caller から渡された総括本文 (Markdown 可) はマーカーと区切り線 (`---`) の後ろに連結する。指摘なしの場合 (`comments` が `[]`) も同じマーカーを付ける。

マーカー文言 (エージェント非依存・固定):

```markdown
> **[AI 自動投稿]** このレビューは AI エージェントによって自動生成されました。レビュー内容の判断は AI が行っています。

---

<caller から渡された総括本文 (指摘なし時は「特に指摘なし」相当)>
```

スキーマは以下のとおり (`body` は上記マーカー込みの文字列):

```json
{
  "commit_id": "9f8e7d6c1a2b3c4d5e6f7890abcdef1234567890",
  "body": "> **[AI 自動投稿]** このレビューは AI エージェントによって自動生成されました。レビュー内容の判断は AI が行っています。\n\n---\n\n総括コメント本文 (Markdown可)",
  "event": "COMMENT",
  "comments": [
    {
      "path": "src/example.ts",
      "line": 42,
      "side": "RIGHT",
      "body": "[should] ここの処理は..."
    },
    {
      "path": "src/example.ts",
      "start_line": 50,
      "start_side": "RIGHT",
      "line": 55,
      "side": "RIGHT",
      "body": "[must] この複数行ブロックは..."
    }
  ]
}
```

- 単一行コメントは `path` / `line` / `side` を指定する。
- 複数行範囲のコメントは上記に加えて `start_line` / `start_side` を併用する (`start_line` は `line` より前の行)。
- `commit_id` は caller から `COMMIT_ID` が渡された場合のみ含める (詳細は「Public Payload Interface」セクションの「Payload スキーマ」参照)。
- 指摘がない場合: `body` はマーカー + 区切り線 + 「特に指摘なし」相当の文言、`comments` は `[]`、`event` は `COMMENT` で投稿する。
- インラインコメント (`comments[].body`) には個別マーカーを付けない (Review 本文側のマーカーで帰属は十分であり、`[must]` 等の重要度ラベルとの衝突や冗長さも避けるため)。

### 2. `gh api` を1回だけ実行して投稿する

```bash
gh api \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  /repos/<OWNER>/<REPO>/pulls/<PR_NUMBER>/reviews \
  --input /tmp/review.json
```

`<OWNER>/<REPO>` と `<PR_NUMBER>` は caller から渡された値で置き換える。
