# agentfiles プロジェクト固有の設定

## この repo は public

private な案件の repo 名・Issue / PR 番号・社内固有の文言を、tracked ファイルにも commit message にも**書かない**。由来を残したいときは、何を直したかだけを書く。

**リンクの曖昧さを完全修飾で解こうとしない** —— `#123` を `org/private-repo#123` へ直すと、曖昧さの代わりに repo 名が公開される。

## 着地までの権限

commit も merge もエージェントが行う。**push だけは人が行う。**

**配布は merge では起きない。**`~/.agents` の symlink 先はこの repo の working tree なので、この checkout でファイルを書いた瞬間に全 project の全工程へ配布される。

- 配布を止めたいなら、別の worktree で作業する（gate は merge ではなくそちら側にある）
- 共通 `merge` skill の手順と検査（dirty・HEAD・祖先関係・失敗したら止まる）は**そのまま適用する**

## 統合

GitHub Issues は無効。統合は `temp` へ積んで `main` へ落とす。形は `merge` skill。

## 層契約

層契約は `agents/AGENTS.md`。「特定 harness の設定側」はこの repo では `harnesses/<agent>/`。

## dotfiles への依存

配線 primitive と inventory API は dotfiles の `lib/links.sh` が SSOT。`lib/bootstrap.sh` が読み込み、在処は `DOTFILES_REPO` > 兄弟ディレクトリ の順に解決する。**見つからなければ止まる。**

参照方向は agentfiles → dotfiles の一方通行。dotfiles 側は agentfiles を**知らない**。

**次の規約は dotfiles の `AGENTS.md` が SSOT で、ここには写さない** —— symlink の貼り方、配布先に既に何かある場合の扱い、コレクション配線のルール、外部コマンド実行のルール、tracked ファイルに絶対 home パスを書かないこと。

## コミットメッセージ規約

絵文字は変更の性質を、スコープは触った場所を表す。絵文字の一覧は `commit` skill の `references/gitmoji.md`。
**一覧にない**のは 🤖 だけで、agent の判断基準・発火条件を変えるときに使う。

### 形式

```
{gitmoji} [{scope}] {message}

- {詳細1}
- {詳細2}
```

### スコープ

| スコープ         | 対象                                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `[agents]`       | `agents/` 配下の共通 instructions / skills（`.skill-lock.json` 等）                                       |
| `[claude]`       | `harnesses/claude` / `~/.claude` 配下の Claude Code 設定                                                  |
| `[codex]`        | `harnesses/codex` / `~/.codex` 配下の Codex 設定                                                          |
| `[grok]`         | `harnesses/grok` / `~/.grok` 配下の Grok 設定                                                             |
| `[opencode]`     | `harnesses/opencode` / `~/.config/opencode` 配下の opencode 設定                                          |
| `[command-code]` | `harnesses/command-code` / `~/.commandcode` 配下の Command Code 設定                                      |
| `[pi]`           | `harnesses/pi` / `~/.pi/agent` 配下の pi 設定                                                             |
| `[lint]`         | oxlint / oxfmt の設定と commit gate（`package.json` / `.oxlintrc.json` / `.oxfmtrc.json` / `.githooks/`） |

複数スコープにまたがるときは並べる（例: `[agents][claude]`）。どのスコープにも入らない変更はスコープを省く。

### コミット例

```
🤖 [agents] consult のループを双方の未解決が無くなるまで回す

- 同じ agent に採否と修正の要約を送り返し、全員 rc=0 で指摘なしの巡でだけ打ち切る
```

## agent 設定の配置方針

- `./AGENTS.md` はこの repo 自体の instructions とし、`./.claude/CLAUDE.md` は Claude 互換入口として `../AGENTS.md` へ symlink する
- `./agents/` は agent 共通 instructions / skills の SSOT とする
- **`SKILL.md` 以外は、モデルがそのファイルに何をするかで置き場が決まる**（読む → `references/`、実行する → `scripts/`、成果物に使う → `assets/`）。大きさでは分けない。何を `references/` へ出すかの判断は `docs` skill の品質基準
- `./test/` は `bun test` の gate。skills の `scripts/` `assets/`・`.githooks/`・共通 `AGENTS.md`・tracked ファイルのコメントを検査する。agent へは**投影しない**（`lib/inventory.sh` に載せない）
- `./harnesses/<agent>/` は agent 固有の tracked overlay のみを置く。runtime / cache / auth / logs / generated files は**置かない**
- harness ごとの instructions 入口（`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` 等）は、harness 固有ルールがある場合は `harnesses/<agent>/` の overlay ファイルへの symlink とし、固有ルールが無い間は共通 `agents/AGENTS.md` への直接 symlink のままにする（**空 overlay を先回りで作らない**）
- **harness home（`~/.claude` / `~/.codex` 等）は実ディレクトリにし、tracked な葉だけを `init.sh` で symlink する**（harness が cache / auth / vendor を同居させるため）。一覧は `lib/inventory.sh`

共通 `agents/AGENTS.md` に書けるのは、その機能が無い harness でも代替手段で成立するルールまで（例: Plan Mode で提示する → 無い harness では構造化 Markdown + 明示 GO）。**機能が無いと成立しないルール**（harness 名・モデル名を前提にするもの）は該当 harness の overlay へ移す。共通 skills も同じ。

共通 `agents/AGENTS.md` には文字数の上限がある。値・単位・理由・検査は `test/agents-md.test.ts`。

### 共通と個別の分け方

| 置く場所             | 対象                                                                           | 判定                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `agents/`            | instructions / skills                                                          | 2 つ以上の harness で同じ意味・手順を使いたい。本文から harness 名・固有 API を消せる。`~/.agents/` にも投影する |
| `harnesses/<agent>/` | overlay instructions / skills / agents / prompts / commands / hooks / settings | 1 harness 専用、またはそのランタイム表面に密着する（同名で agents を上書き可）                                   |

- **意味と手順は共通、起動・配線・フォーマットは個別**。agents / prompts / commands / subagents は形式が harness ごとに違うため、原則 `harnesses/<agent>/` のみに置く（共通フォーマットや codegen は作らない）
- **最初は個別に書き、上表のしきい値に達してから `agents/` へ昇格する**（空の共通抽象を先に作らない）
- 参照方向は常に個別 → 共通の**一方通行**。共通が特定 harness を知ってはいけない
- アドバイザーの起動は `consult` skill の単一実体（`references/advisors.md` + `scripts/advisors.ts` + `scripts/advisors.sh`）にし、harness ごとの上書きも project **差分も置かない**。kind と起動 args の表とその解釈は `agents/shared/roster.toml` / `roster.ts`（`advisors` = consult の相談役、`resolve` = resolve の実装役）

### skill 間で実体を共有するとき

`agents/shared/<name>` を SSOT にし、使う skill から相対 symlink を張る。**どの skill にも所有させない。**

**張り先も同じ規則で決まる**（拡張子ではない）。symlink は実体と同名にし、`../../../shared/<同名>` を指す。

- skill 本文に書くのは**自分の相対パスだけ**。投影先でも repo でも解決できる形にする
- **`shared/` に置く条件は 1 つ**: 2 つ以上の skill が同じものを使っている。1 つの skill しか使わないものは、その skill 側の対応する dir に実体で置く
- 参照先は **`shared/` だけ**。skill が別の skill の `references/` を覗く形を作らない
- `~/.agents/shared` への投影は**要らない**（skill が相対 symlink で辿るため）

### 配線の SSOT（スケール用）

| パス               | 役割                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `lib/inventory.sh` | **この repo が何を配線するかの唯一の正**。harness / symlink / skills union の追加はここだけ               |
| `lib/bootstrap.sh` | dotfiles の `lib/links.sh`（primitive と `inv_*` の実装）を解決して読む                                   |
| `./init.sh`        | `run_inventory apply` + `core.hooksPath` の設定 + 開発依存のインストール                                  |
| `./up.sh`          | 外部 skills の更新 + herdr skill の生成 + 配線の再適用 + 開発依存の更新                                   |
| `./doctor.sh`      | `run_inventory check` + commit gate 検査 + tracked ファイルの絶対 home パス検査（read-only。修復は init） |

**ランタイム（bun / mise）はこの repo が入れない**。dotfiles の `./init.sh` が供給する。欠けていたら開発依存のインストールをスキップして ⚠️ に留める。

新しい harness を足す手順:

1. `lib/inventory.sh` の `inventory_define` に 1 ブロック追加（`inv_home` / `inv_symlink` / `inv_harness_skills` 等）
2. 上の「スコープ」に harness の行を追加する
3. `./init.sh` で配線
4. `./doctor.sh` で検査

hooks の tripwire:

- `harnesses/<agent>/` 配下の空の `hooks.json`（中身 `{"hooks": {}}`）は「空 overlay を先回りで作らない」の明示的な例外。中身を埋めたり配線を外したりしない
- 外部ツールによる上書きを 3 経路で検知する —— symlink 経由の in-place 書き込みは repo 側の git diff、unlink して実ファイルで置換は doctor の ❌、別名ファイルの投下は `inv_guard_dir` の ⚠️
- **管理下 symlink 以外の投下を検知したい collection dir に `inv_guard_dir` を張る**（各 harness の hooks dir）。read-only で、自動削除はしない
- 設定が harness home 直下に置かれる場合（codex）は vendor ファイルと同居するため**張らない**。symlink check だけで守る
