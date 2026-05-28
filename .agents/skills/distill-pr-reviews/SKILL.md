---
name: distill-pr-reviews
description: 期間内 merged PR のレビューコメント (AI 自動投稿 + 人間レビュー両方) を集約し、REVIEW.md に追記する価値のある指摘候補を proposals.md として出力する skill。取り込み判定の信号収集はスクリプト、最終的な採否分類とクラスタリングは AI が行う。本 skill は read-only で、REVIEW.md の編集や PR 作成は行わない。
---

# distill-pr-reviews skill

過去 merged PR のレビューコメントから「REVIEW.md に蓄積する価値のある指摘」を抽出する skill。
出力 (`proposals.md`) を後工程 (人間 or 別 skill) が読んで REVIEW.md 編集 PR を作る、という運用を想定している。

**本 skill のスコープは proposals.md 出力で停止する。** REVIEW.md の編集 / commit / push / PR 作成は一切行わない。
状態管理ファイルは持たず、毎回期間引数を渡す方式 (運用がシンプルで監査性が高い)。

## 入力 (任意, caller から prompt 経由で渡される想定)

すべて省略可。省略時の挙動は各項目に記載。

- `OWNER` / `REPO`: 対象リポジトリ。省略時は `gh repo view --json nameWithOwner -q .nameWithOwner` で cwd の git リポジトリから自動推定する。ドッグフーディング時の取り違え防止のため明示推奨。
- `SINCE` / `UNTIL`: merged at で絞る期間 (`YYYY-MM-DD` 形式、UTC)。`SINCE` 省略時は `UNTIL - DAYS`、`UNTIL` 省略時は今日 (UTC) を使う。両方省略時は「過去 `DAYS` 日」になる。
- `DAYS`: `SINCE` 未指定時のフォールバック期間 (日数)。省略時 `7`。`SINCE` が指定されていれば無視される。
- `MAX_PRS`: 期間内 PR 数の上限警告閾値。省略時 `100`。超過しても処理は継続し、proposals.md 冒頭に「対象 PR が多いため信号品質が低下している可能性あり」を明記する。
- `FILTER_AUTHOR`: PR 作成者で絞り込む (例: `dependabot[bot]` を除外したい場合は `-author:dependabot[bot]` 形式で渡す)。省略時はフィルタなし。`gh pr list --search` の検索式にそのまま連結する。
- `FILTER_LABEL`: PR ラベルで絞り込む (例: `label:bug`)。省略時はフィルタなし。同上、`--search` に連結する。
- `INCLUDE_AI_AUTHORED`: `> **[AI 自動投稿]**` プレフィックス付きのコメントを採否候補に含めるか。省略時 `true`。`false` の場合でも信号 (`is_ai_authored`) は付与するが、Phase C で AI が一律 reject に倒す。値は `true` / `false` を推奨するが、scripts/collect-signals.sh では大文字小文字 / 周辺空白を正規化し `1` / `yes` / `y` / `0` / `no` / `n` も受け入れる (それ以外は `exit 2`)。
- `OUTPUT_DIR`: 出力先ディレクトリ。省略時は `/tmp/distill-pr-reviews/{repo}/{timestamp}` (例: `/tmp/distill-pr-reviews/skills/20260524T120000Z`)。caller が明示パスを指定した場合は既存ファイルがあれば上書きする。
  - `{repo}`: `OWNER/REPO` の `REPO` 部分 (取得失敗時は `local`)
  - `{timestamp}`: `date -u +%Y%m%dT%H%M%SZ` の出力

明示的に持たない引数:

- DRY-RUN フラグ: 本 skill はそもそも GitHub 投稿 / PR 作成を一切行わないため不要 (常に dry-run 相当)。
- 状態ファイルパス: 状態管理しない方針なので持たない。
- 出力 PR ブランチ名 / commit message: 本 skill は PR を作らないため不要。

## 既存スキルとの違い / 棲み分け

- `run-pr-review` / `post-pr-review` / `resolve-pr-threads` / `run-local-review` はいずれも **単一の進行中 PR ライフサイクル** が対象。本 skill は **過去 merged PR 群** からの横断的な学習材料抽出が対象。
- 依存関係なし: 本 skill から他 skill は呼ばない。他 skill も本 skill に依存しない。
- `/pr-review-style-reference` の severity ラベル定義 (`[must]` / `[should]` / `[nit]` / `[question]` / `[pre_existing]`) は Phase B / C で参照する。本 skill では再掲しない (二重管理を避けるため)。
- 既存 `REVIEW.md` を **読まない** (それは `run-pr-review` Step 3 / `run-local-review` Step 3 の役割)。本 skill は「REVIEW.md を育てるための候補ファイル」を出すだけで、既存内容との重複判定は AI が proposals.md 内に「重複可能性あり」フラグとして残す形に留める。
- 対象は **merged PR のみ**。open / closed unmerged は対象外 (取り込み判定が安定しないため)。

## 設計上の主要トレードオフ

1. **PR 一覧は REST、reviewThreads は GraphQL の混在採用**: `gh pr list --search` がページング込みで便利、reviewThreads は GraphQL でしか取れない。
2. **信号スコア合算を script でなく AI に委ねる**: 信号は文脈依存 (例: `is_outdated=true` 単独は「修正された」か「単に行ズレした」かの判別不能) で、機械合算するとノイズが大きい。`signals.json` には raw のまま付与し、Phase C の AI が総合判断する。
3. **クラスタリングは Phase C (AI)**: 意味類似度判定が bash/jq では困難なため。Phase B では `path` ベースの「同一ファイル指摘」フラグだけ立てる。
4. **採否は三値 (`accept` / `hold` / `reject`)**: 二値だと判断不能ケースが reject に流れて将来の蓄積機会を失う。迷ったら `hold` (`resolve-pr-threads` の保守的ルールと同思想)。
5. **REVIEW.md 既存内容との重複判定は本 skill ではしない**: 後続フロー (REVIEW.md 編集) との責務分離を保つ。AI は proposals.md に「重複可能性あり」フラグだけ立てる。
6. **決定論的な Phase A + B (PR 一覧取得 / GraphQL / commit files / 信号付与) は bash + jq スクリプトに切り出す**: `scripts/collect-signals.sh` が `signals.json` を出力するまでを担い、AI (Phase C+D) は signals.json を読んで `proposals.md` を書き出す責務に集中する。スクリプト化のメリットは挙動の再現性と AI 側プロンプトの圧縮で、デメリットは Step 5 の信号定義を変えたい場合に SKILL.md + スクリプト両方を編集する必要がある点 (signals.json のスキーマを変えると Phase C の AI 解釈もズレるため、両者は本 SKILL.md の `signals.json` スキーマ定義で同期させる)。

## 手順

### Step 1. 信号収集スクリプトを呼ぶ (Phase A + B)

決定論的な処理 (入力正規化 → `gh pr list` → reviewThreads 取得 → commit / files 取得 → 信号付与) は本 skill 配下の `scripts/collect-signals.sh` (bash + jq) に集約してある。本 step では **このスクリプトを Bash ツールから呼ぶだけ**。AI が同等処理を逐次実行しない (差異が出ないように)。

#### 呼び出し方

スクリプトの絶対パスは **本 SKILL.md と同じディレクトリの `scripts/collect-signals.sh`** で解決する。skill 起動時に渡される SKILL.md の絶対パスから dirname を取って `<dirname>/scripts/collect-signals.sh` を組み立てれば、開発時 (`plugins/pr-review/skills/distill-pr-reviews/`)・`/plugin install` 後 (`~/.claude/plugins/cache/.../skills/distill-pr-reviews/`)・`apm install` 後 (`<consumer>/.claude/skills/distill-pr-reviews/`) のいずれの展開先でも一意に解決できる (`compose-review` Step 2 の `style-reference.md` パス解決と同じパターン)。

caller から渡された入力は **環境変数として透過的にスクリプトへ転送する**。スクリプト側で正規化 (`OWNER` / `REPO` 自動推定、`SINCE` / `UNTIL` 計算、`OUTPUT_DIR` 確定) を行うので、本 step では caller 入力をそのまま env に詰めて呼ぶ。

```bash
OWNER="${OWNER:-}" REPO="${REPO:-}" \
SINCE="${SINCE:-}" UNTIL="${UNTIL:-}" DAYS="${DAYS:-7}" \
MAX_PRS="${MAX_PRS:-100}" \
FILTER_AUTHOR="${FILTER_AUTHOR:-}" FILTER_LABEL="${FILTER_LABEL:-}" \
INCLUDE_AI_AUTHORED="${INCLUDE_AI_AUTHORED:-true}" \
OUTPUT_DIR="${OUTPUT_DIR:-}" \
  bash "<SKILL.md と同じディレクトリ>/scripts/collect-signals.sh"
```

スクリプトは進捗を stderr に、`signals.json` の絶対パスを stdout 最終行に出す。非 0 で exit したらエラー停止して caller に報告 (主要原因: `gh` 未認証 / git リポジトリ外実行 / GraphQL ノード上限超過)。期間内 0 件でも exit 0 で `signals.json` (空状態) を出す。

#### スクリプトの責務 (詳細は `scripts/collect-signals.sh` の本体コメント参照)

- **Step 1-1. 入力正規化**: `OWNER` / `REPO` を `gh repo view` で auto-detect、`UNTIL` は今日 (UTC)、`SINCE` は `UNTIL - DAYS` (GNU/BSD `date` 両対応)、`OUTPUT_DIR` を確定し `mkdir -p`。
- **Step 1-2. PR 一覧取得**: `gh pr list --search "merged:${SINCE}..${UNTIL} <filters>" --json ...` で取得し `_pr_list.json` に書き出す。`--state merged` は付けない (`merged:` 検索フィルタと重複するため)。`--limit` は `MAX_PRS + 100` で超過判定できる余裕を持たせる。0 件なら空 `signals.json` を出して即終了。
- **Step 1-3. reviewThreads 取得 (GraphQL)**: PR ごとに外側 `reviewThreads(first: 100, after: $after)` をページングし、初回クエリの内側は `comments(first: 100)` のみ (`$cafter` を初回に持たせると外側全ノードに同 cursor が適用されて壊れるため)。100 件超のスレッドだけ `node(id: $threadId)` + inline fragment の追加クエリで埋める。`reactions(first: 20)` で GraphQL の 500,000 ノード制限を回避 (100 × 100 × 20 = 200,000)。PR 数 > 50 のときは PR 間で 1 秒 sleep。
- **Step 1-4. commits + 各 commit の files 取得**: `gh pr view --json commits` で commit 一覧、`gh api repos/.../commits/<sha>` で `files[].filename` を取得。MAX_PRS=100 規模なら全 commit について先取りで取って Step 1-6 の jq を簡素化。
- **Step 1-5. `prs.json` 組み立て**: 上記をまとめて以下の TypeScript ライクなスキーマで `${OUTPUT_DIR}/prs.json` に書き出す。

  ```ts
  type Collected = {
    meta: {
      owner: string; repo: string;
      since: string;        // YYYY-MM-DD
      until: string;        // YYYY-MM-DD
      collected_at: string; // ISO8601 UTC
      pr_count: number;
      max_prs_exceeded: boolean;
      include_ai_authored: boolean;  // caller 入力 INCLUDE_AI_AUTHORED の値をそのまま転記
    };
    prs: {
      number: number; title: string; author: string;
      merged_at: string; head_sha: string; merge_commit_sha: string | null;
      base_ref: string; head_ref: string; labels: string[]; url: string;
      commits: {
        sha: string; committed_at: string; message_headline: string;
        files: string[];   // sha 毎の全変更ファイル (全 commit について事前取得済み)
      }[];
      review_threads: {
        thread_id: string;
        is_resolved: boolean; is_outdated: boolean;
        comments: {
          id: string;
          author_login: string;
          author_type: "User" | "Bot" | "Unknown";  // GraphQL author.__typename を転記。GitHub App / installation bot は "Bot" (gemini-code-assist / copilot-pull-request-reviewer / coderabbitai / dependabot[bot] 等)、通常アカウントは "User"、author=null (削除済みアカウント) は "Unknown"。ごく稀に User account で運用される AI レビュー bot があり得るため、Phase C の AI は author_type に加えて author_login の文字列パターン (例: `*-code-assist`, `*-reviewer`, `copilot-*`, `coderabbit*`) でも補完判定する
          body: string; created_at: string;
          path: string; line: number | null; original_line: number | null;
          diff_hunk: string; url: string;
          reactions: { content: string }[];
          is_ai_authored: boolean;  // body 先頭 `^> \*\*\[AI 自動投稿\]\*\*` の test 結果
        }[];
      }[];
    }[];
  };
  ```

- **Step 1-6. 信号付与 → `signals.json`**: `prs.json` の各コメントオブジェクトに `signals` フィールドを追加した同形 JSON を `${OUTPUT_DIR}/signals.json` に書き出す。**機械的なスコア合算はしない**。各信号は文脈依存で、Phase C の AI が組み合わせを見て総合判断するため。

  各信号の意味 (`signals` フィールド配下):

  - `thread_resolved`: 親スレッドの `is_resolved`
  - `thread_outdated`: 親スレッドの `is_outdated`
  - `file_changed_after_comment`: 当該コメントの `created_at` 以降に committed された commit のうち `files[]` に `comment.path` を含むものがあるか (boolean)
  - `author_replied_affirmative`: 同一スレッドの後続コメントのうち `author_login == PR.author` のものが **肯定キーワード (`fixed` / `対応` / `修正` / `反映` / `確かに` / `その通り` / `done` / `addressed`) を body に含み、かつ否定キーワード (`対応しません` / `対応しない` / `対応せず` / `修正しません` / `修正しない` / `修正せず` / `反映しません` / `反映しない` / `反映せず` / `現状維持` / `不採用` / `不要です` / `wontfix` / `wont fix` / `not addressed` / `not fixed`) を body に含まない** か。否定キーワードは「動詞 + 否定形」または慣用句で十分な長さを持たせ、肯定キーワード (`対応` 等) との部分文字列ぶつかりと、肯定文脈で偶発的に出現する語 (例: `そのまま` 単独) との衝突を回避する。残る誤検出は許容 (Phase C の AI が body 全文を見て最終判断)
  - `severity_label`: body 内の `[must]` / `[should]` / `[nit]` / `[question]` / `[pre_existing]` を正規表現で抽出 (**body の引用行 (`> ` で始まる行) を除いた残りに対する最初のマッチを採用する仕様**、なければ `null`)。引用行を除外することで他コメントの再掲や post-pr-review マーカー直後の引用 quote で誤って severity を拾うのを防ぐ。AI 自動投稿マーカー `> **[AI 自動投稿]**` 自体は capture group の選択肢に無いため自然に skip される。body 内に複数のラベルが書かれているケース (例:「これは本来 `[must]` レベルだが本 PR では `[should]` に留める」) では最初に出てきたラベルが拾われるため、Phase C の AI は判定根拠に severity を使う際に body 全文も読んで矛盾検知すること
  - `is_ai_authored`: コメント本体の `is_ai_authored` フラグをそのまま転記
  - `author_type`: コメント本体の `author_type` (`User` / `Bot` / `Unknown`) をそのまま転記。`is_ai_authored=false` でも `author_type=Bot` なら「post-pr-review 以外の bot 経由 (例: GitHub App として登録された PR レビュー bot)」のシグナル。User account 運用の AI レビュー bot (gemini-code-assist 等) は `User` 側に分類されるため、Phase C の AI が author_login の文字列パターン (例: `*-code-assist`, `*-reviewer`, `copilot-*` 等) で補完判定する
  - `reply_count`: スレッド内コメント数 - 1
  - `reactions_positive`: GraphQL の reaction `THUMBS_UP` / `HEART` / `HOORAY` / `ROCKET` の合計
  - `reactions_negative`: `THUMBS_DOWN` / `CONFUSED` の合計
  - `comment_length`: body の文字数
  - `same_file_in_pr`: 同じ PR 内で **別 thread** に同じ `path` への指摘があるか (boolean)。同一 thread 内の reply は 1 指摘として 1 回だけカウントする (各 thread の冒頭コメントの `path` のみを集計対象にする)

  クラスタリング (PR をまたいだ類似指摘の検出) は Phase C で AI が行うため、本 step では行わない。

#### スクリプト出力の取り扱い

- 中間ファイル (`_pr_list.json` / `_threads.jsonl` / `_commits.jsonl` / `_commit_files.json` / `prs.json`) は `${OUTPUT_DIR}` に残す。Phase C で AI が判定をやり直したい場合の入力として再利用できる。
- 後段 (Step 2) で AI が読むのは `signals.json` のみ。中間ファイルは AI からは触らない。
- 0 PR の場合の `signals.json` は `meta.pr_count = 0` / `prs: []` の空状態。Step 2 / Step 3 で「該当なし」分岐に倒す。

### Step 2. AI による採否判定 (Phase C)

`signals.json` を読み、各コメントを `accept` / `hold` / `reject` に分類し、採用候補には REVIEW.md に書く提案文を作る。判定は AI 自身が行う (本セクションは AI への指示)。

#### 2-1. 採否判断軸

以下を総合して判定する:

1. **一般化可能性**
   - `accept`: ライブラリ / 言語機能 / 設計パターン / セキュリティ / テスト方針など他 PR にも応用できる指針。
   - `reject`: この PR 限定のロジック誤り、特定 issue のリグレッション、ファイル固有の名前付け修正など一回限りの話。

2. **取り込みステータス**
   - `thread_resolved=true` かつ `file_changed_after_comment=true`: 強い「取り込まれた」シグナル → accept 寄り。
   - `thread_resolved=true` のみ: 中 (resolve が「対応」とは限らないため)。
   - `thread_outdated=true` のみ: 弱 (行ズレの可能性)。
   - `author_replied_affirmative=true`: 加点。
   - どれも該当せず未 resolved: 「不明」→ `hold`。

3. **severity**
   - `[must]` / `[should]`: 採用優先。
   - `[nit]` / `[question]`: 基本棄却。ただし複数 PR で同じ nit が繰り返し出ているならクラスタとして再評価する。
   - `[pre_existing]`: 棄却 (本 PR の指針というより別 issue 化推奨)。
   - severity ラベルなし: body の内容から severity を推定 (推定ラベルは `severity_suggestion` に明示)。

4. **AI / bot 由来コメントの扱い**
   本 skill の `is_ai_authored=true` は **post-pr-review skill 経由で投稿された (`> **[AI 自動投稿]**` マーカー付き) コメント** のみを指す。それ以外の bot や外部 AI レビュー bot (gemini-code-assist / copilot-pull-request-reviewer / dependabot[bot] 等) は本フラグでは識別されないため、以下の補完信号を組み合わせて判定する:

   - `is_ai_authored=true`: post-pr-review 由来の AI 投稿。`thread_resolved=true` + `file_changed_after_comment=true` なら強信号で accept 寄り。未 resolved / `thread_outdated` のみなら弱信号で reject 寄り (ただし内容が明らかに一般化可能なら `hold`)。
   - `author_type="Bot"` (`is_ai_authored=false`): GitHub App / installation 形式の bot 由来。主要な外部 AI レビュー bot (`gemini-code-assist`, `copilot-pull-request-reviewer`, `coderabbitai`) や `dependabot[bot]` はここに分類される。レビュー指摘である保証はないため body の内容で判定する。AI レビュー bot の指摘が `thread_resolved=true` + `file_changed_after_comment=true` ならやはり強信号で accept 寄り、未 resolved なら reject 寄り、という post-pr-review 由来 (`is_ai_authored=true`) と同じ評価軸を適用する。
   - `author_type="User"` だが `author_login` が AI レビュー bot のパターン (例: `*-code-assist`, `*-reviewer`, `copilot-*`, `coderabbit*`): ごく稀に User account として運用されている AI レビュー bot の可能性。指摘内容の妥当性を AI が body で判断する。
   - **`INCLUDE_AI_AUTHORED=false` の場合は `is_ai_authored=true` のコメントのみを一律 `reject`** (棄却理由に「AI 自動投稿を対象外として除外」と明示)。本値は `signals.json` の `meta.include_ai_authored` から取得する。**外部 AI レビュー bot 由来 (author_type=Bot / login パターン一致) のコメントはこのフラグでは除外されない** (制御対象は本 skill のスコープ内である post-pr-review 由来のみ、という設計)。caller が外部 bot も一括除外したい場合は `FILTER_AUTHOR=-author:...` を `gh pr list` 側で渡す運用にする。

5. **クラスタリング (PR 横断)**
   - 類似テーマが複数 PR で出ていたら 1 つの proposal にまとめ、`sources[]` に PR URL を集約する。
   - クラスタ ID は連番 (`cluster-001` / `cluster-002` ...) で振る。
   - 単独指摘は `cluster_id=null`。
   - 出現頻度が高いほど accept 寄り (3 PR 以上の同主旨は強い採用根拠)。

6. **REVIEW.md 既存内容との重複可能性**
   - 本 skill は REVIEW.md を読まない。「これは一般に当たり前のルールで、おそらく既存 REVIEW.md に既出かも」と AI が判断したものは `reason` に「[既存方針と重複可能性]」とフラグを立て、`hold` に倒す。

7. **迷ったら `hold`**
   - `resolve-pr-threads` の「迷ったら resolve しない」と同じ保守的ルール。`reject` に倒すと将来の蓄積機会を失う。

#### 2-2. 各 proposal の属性

各 proposal は以下の属性を持つ:

| 属性 | 説明 |
|---|---|
| `verdict` | `accept` / `hold` / `reject` |
| `reason` | 採否の理由 (1〜2 文)。重複可能性 / 一般化不能などのフラグもここに含める。 |
| `proposal_text` | REVIEW.md に書くなら何と書くか (Markdown bullet point 1〜3 行)。`reject` の場合は null。 |
| `severity_suggestion` | REVIEW.md に載せる場合の severity ラベル (`[must]` / `[should]` / `[nit]`)。元コメントの severity を踏襲、なければ推定。 |
| `sources` | 出典 PR / comment URL のリスト + body 引用 (200 文字超は先頭 200 文字 + `...`)。クラスタリングされていれば複数 PR 分。 |
| `cluster_id` | クラスタリングしたなら `cluster-NNN`、単独なら null。 |
| `signals_summary` | 判定根拠になった主要信号 3〜5 個 (raw signals 全部ではなく抜粋)。例: `thread_resolved=true, file_changed_after_comment=true, severity=[should]`。 |

### Step 3. proposals.md を出力する (Phase D)

`${OUTPUT_DIR}/proposals.md` に `Write` ツールで書き出す。`Write` ツールは中間ディレクトリの自動作成を保証しないが、`${OUTPUT_DIR}` は Step 1 のスクリプト実行時に `mkdir -p` 済みなので追加の `mkdir` は不要。`Write` ツールは「同一セッション中に `Read` されていない既存ファイルへの上書き」を拒否する仕様のため、`OUTPUT_DIR` が caller 明示指定で既存 proposals.md が残っている可能性があれば `Read` を 1 回挟んでから `Write` する。`heredoc` や `cat` リダイレクトは使わない。

スキーマ:

```markdown
# REVIEW.md 候補案 (proposals.md)

- 期間: <SINCE> 〜 <UNTIL> (UTC)
- 対象リポジトリ: <OWNER>/<REPO>
- 対象 PR 数: <N> 件 (max_prs=<MAX_PRS> <超過時のみ「超過: 信号品質低下の可能性あり」を追記>)
- 抽出コメント総数: <M> 件 (うち AI 自動投稿 <A> 件 / 人間 <H> 件)
- 採用候補: <X> 件 (クラスタ: <C> 個 / 単独: <S> 件)
- 保留: <Y> 件
- 棄却: <Z> 件
- 生成日時: <ISO8601 UTC 秒精度>

## 後続フロー

1. 本ファイルを人間または別 skill が読み、「採用候補」セクションの提案文を REVIEW.md へ追記する PR を作成する
2. 「保留」セクションは個別判断 (採用 / 棄却 / 文面修正の上で採用 のどれにするか)
3. 「棄却」セクションは記録のみ。同じ指摘が次回も繰り返し棄却されないよう判断履歴として残す

中間ファイル `prs.json` / `signals.json` は再判定時の入力として ${OUTPUT_DIR} に残してある。

---

## 採用候補

### 1. [cluster-001] [should] <一般化したルールのタイトル>

**提案文 (REVIEW.md 追記想定)**:

> - <REVIEW.md にそのまま書く想定の bullet。1〜3 行。>

**判定根拠**: <reason 本文。クラスタの場合は出現 PR 数 / 取り込み率を併記。>

**信号**: <signals_summary>

**出典**:
- https://github.com/<OWNER>/<REPO>/pull/<N>#discussion_r... (人間レビュー / AI 自動投稿 の別を併記)
  > <body 引用、200 文字超は省略>
- https://github.com/<OWNER>/<REPO>/pull/<N+5>#discussion_r... (AI 自動投稿)
  > <body 引用>

### 2. <以下、採用候補ごとに繰り返し>

---

## 保留

### H1. [should] <タイトル>

**判定保留理由**: <reason>

**信号**: <signals_summary>

**出典**:
- https://github.com/<OWNER>/<REPO>/pull/<N>#discussion_r...
  > <body 引用>

### H2. <以下、保留ごとに繰り返し>

---

## 棄却

| # | severity | 理由 | 出典 |
|---|---|---|---|
| R1 | [nit] | 好み寄り / 一般化不能 | https://github.com/<OWNER>/<REPO>/pull/<N>#discussion_r... |
| R2 | [must] | この PR 固有のロジック誤り | https://github.com/<OWNER>/<REPO>/pull/<N>#discussion_r... |
| R3 | [should] | AI 自動投稿で行ズレのみ (取り込まれていない) | https://github.com/<OWNER>/<REPO>/pull/<N>#discussion_r... |
```

期間内 0 PR でも proposals.md は空状態 (採用 0 / 保留 0 / 棄却 0、各セクションは「該当なし」と明示) で出力する (skip しない)。

「生成日時」は実行時に `date -u +%Y-%m-%dT%H:%M:%SZ` で取得する。`date` が利用できなければ caller / 実行環境から提供される現在日時を使い、それも無ければ `<unknown>` と記載する。

### Step 4. caller への報告

以下を簡潔に caller へ返す:

- 対象期間 (`SINCE`..`UNTIL`) / 対象リポジトリ
- 対象 PR 数 / 抽出コメント数 / 採用・保留・棄却の内訳件数
- 出力先パス (`OUTPUT_DIR/proposals.md` / `prs.json` / `signals.json`)
- `MAX_PRS` 超過時はその旨を 1 行で追記

チャットに proposals.md 全文をダンプしない (件数が多いケースで後続会話のコンテキストを圧迫するため)。出力先パスと冒頭メタ + 件数内訳のみをチャットに出し、詳細は markdown ファイルを参照させる。

## 守ること

- READ-ONLY: GitHub 投稿 / PR 作成 / commit / push / `git fetch` / `git checkout` などローカル ref を書き換える操作は一切しない。`gh pr comment` / `gh pr review` / `gh api .../reviews` / `gh pr create` も使わない。
- `post-pr-review` / `resolve-pr-threads` / `run-pr-review` / `run-local-review` skill は呼ばない (独立 skill)。
- 既存資産 `/pr-review-style-reference` の severity ラベル定義は **slash command 経由でのみ利用** し、本 skill 内で再掲・再実装しない (二重管理を避けるため)。
- **Phase A + B (PR 一覧 / GraphQL / commit files / 信号付与) は `scripts/collect-signals.sh` に集約してある**。AI 側でこれらを `gh` / `jq` 直叩きで再実装してはならない (差異が出てスクリプトとプロンプトの責務分割が崩れるため)。信号定義を変えたい場合はスクリプトと本 SKILL.md の `signals` フィールド定義をセットで更新する。
- **機械的なスコア合算は禁止**。信号は `signals.json` に raw のまま付与し、Phase C の AI が総合判断する。理由は信号の文脈依存性 (例: `outdated` 単独は行ズレ可能性)。
- 対象は **merged PR のみ**。open / closed unmerged は対象外 (取り込み判定が安定しないため)。
- 期間内 0 PR でも proposals.md は空状態で出力する (skip しない)。
- 判定に迷ったら `hold` に倒す (`resolve-pr-threads` の「迷ったら resolve しない」と同思想)。`reject` に倒すと将来の蓄積機会を失う。
- proposals.md は **本 skill のスコープの終点**。REVIEW.md 編集 / PR 作成は別工程で行うことを caller に明示する。
