# agentfiles プロジェクト固有の設定

## この repo は public

private な案件の repo 名・Issue / PR 番号・社内固有の文言を、tracked ファイルにも commit message にも書か**ない**。由来を残したいときは、何を直したかだけを書く。

**リンクの曖昧さを完全修飾で解こうとしない** —— `#123` を `org/private-repo#123` へ直すと、曖昧さの代わりに repo 名が公開される。

## 着地までの権限

commit も merge もエージェントが行う。**push だけは人が行う。**

**配布は merge では起きない。**`~/.agents` の symlink 先はこの repo の working tree なので、この checkout でファイルを書いた瞬間に全 project の全工程へ配布される。

- 配布を止めたいなら、別の worktree で作業する（gate は merge ではなくそちら側にある）
- 共通 `merge` skill の手順と検査（dirty・HEAD・祖先関係・失敗したら止まる）は**そのまま適用する**

## 切り出しの受け皿

**この repo は受け皿を持たない**（GitHub Issues は無効）。`~/.agents/AGENTS.md`「作業単位」の「切り出すと決めたものは受け皿へ置く」は、ここでは成立しない。

気づいたものは現在のブランチで直しきる。直しきれないものだけ、行き先の決定を人へ返す。**まとめに書いて終わりにしない。**

統合は `temp` へ `--no-ff` で積んで `main` へ落とす。待ち行列では**ない**。

受け皿を持つ project では、その project の AGENTS.md が置き場と最優先の位置を定める。

## dotfiles への依存

配線 primitive と inventory API は dotfiles の `lib/links.sh` が SSOT。`lib/bootstrap.sh` が読み込み、在処は `DOTFILES_REPO` > 兄弟ディレクトリ の順に解決する。**見つからなければ止まる。**

参照方向は agentfiles → dotfiles の一方通行。dotfiles 側は agentfiles を知ら**ない**。

**次の規約は dotfiles の `AGENTS.md` が SSOT で、ここには写さない** —— symlink の貼り方、配布先に既に何かある場合の扱い、コレクション配線のルール、外部コマンド実行のルール、tracked ファイルに絶対 home パスを書かないこと。

## コミットメッセージ規約

スコープごとに固定の gitmoji を使う。

### 形式

```
{gitmoji} [{scope}] {message}

- {詳細1}
- {詳細2}
```

### スコープと絵文字の対応

| 絵文字 | スコープ   | 説明                                                                                                      |
| ------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| 🤖     | `[agents]` | `agents/` 配下の共通 instructions / skills（`.skill-lock.json` 等）                                       |
| 🤖     | `[claude]` | `harnesses/claude` 配下の Claude Code 設定                                                                |
| 🤖     | `[codex]`  | `harnesses/codex` / `~/.codex` 配下の Codex 設定                                                          |
| 🤖     | `[grok]`   | `harnesses/grok` / `~/.grok` 配下の Grok 設定                                                             |
| 🎨     | `[lint]`   | oxlint / oxfmt の設定と commit gate（`package.json` / `.oxlintrc.json` / `.oxfmtrc.json` / `.githooks/`） |
| 🔧     | `[複数]`   | 複数スコープにまたがる変更（例: `[agents][claude]`）                                                      |

スコープに該当しない全体的な変更は、汎用 gitmoji を使う（新機能: ✨、バグ修正: 🐛、削除: 🔥、リファクタリング: ♻️）。

### コミット例

```
🤖 [agents] conductor の tick に成果ゼロの周の上限を足す

- 実行器を回しても成果物が動かない周が続いたら選出対象外へ退避する
```

## agent 設定の配置方針

- `./AGENTS.md` はこの repo 自体の instructions とし、`./.claude/CLAUDE.md` は Claude 互換入口として `../AGENTS.md` へ symlink する
- `./agents/` は agent 共通 instructions / skills の SSOT とする
- `./agents/docs/` は人が全体を把握・監査するための資料。**agent へは投影しない**（`lib/inventory.sh` に載せない）。規約の本体は置かず、skills から導出した図と索引だけを持つ
- `./harnesses/<agent>/` は agent 固有の tracked overlay のみを置く。runtime / cache / auth / logs / generated files は置か**ない**
- harness ごとの instructions 入口（`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` 等）は、harness 固有ルールがある場合は `harnesses/<agent>/` の overlay ファイルへの symlink とし、固有ルールが無い間は共通 `agents/AGENTS.md` への直接 symlink のままにする（**空 overlay を先回りで作らない**）
- **harness home（`~/.claude` / `~/.codex` 等）は実ディレクトリにし、tracked な葉だけを `init.sh` で symlink する**（harness が cache / auth / vendor を同居させるため）。一覧は `lib/inventory.sh`

共通 `agents/AGENTS.md` に書けるのは、その機能が無い harness でも代替手段で成立するルールまで（例: 判断材料を Artifact にする → 作れない harness では応答に出す）。**機能が無いと成立しないルール**（harness 名・モデル名を前提にするもの）は該当 harness の overlay へ移す。共通 skills も同じ。

共通 `agents/AGENTS.md` は **10,000 文字を超えない**。grok が 1 ファイルあたりで切る（超過は警告だけで、本文は黙って後半が落ちる）。検査は `bun test`。

### 共通と個別の分け方

| 置く場所             | 対象                                                                           | 判定                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `agents/`            | instructions / skills                                                          | 2 つ以上の harness で同じ意味・手順を使いたい。本文から harness 名・固有 API を消せる。`~/.agents/` にも投影する |
| `harnesses/<agent>/` | overlay instructions / skills / agents / prompts / commands / hooks / settings | 1 harness 専用、またはそのランタイム表面に密着する（同名で agents を上書き可）                                   |

- **意味と手順は共通、起動・配線・フォーマットは個別**。agents / prompts / commands / subagents は形式が harness ごとに違うため、原則 `harnesses/<agent>/` のみに置く（共通フォーマットや codegen は作らない）
- **最初は個別に書き、上表のしきい値に達してから `agents/` へ昇格する**（空の共通抽象を先に作らない）
- 参照方向は常に個別 → 共通の**一方通行**。共通が特定 harness を知ってはいけない
- アドバイザーの起動は `agents/shared/` の単一実体（判断表 + スクリプト）にし、harness ごとの上書きを置か**ない**

### skill 間で実体を共有するとき

`agents/shared/<name>` を SSOT にし、使う skill から相対 symlink を張る。**どの skill にも所有させない。**

**張り先はモデルの扱いで決まる**（拡張子ではない）: 読むものは `references/<name>.md`、実行するものは `scripts/<name>.sh`。

- skill 本文に書くのは自分の相対パス**だけ**。投影先でも repo でも解決できる形にする
- **`shared/` に置く条件は 1 つ**: 2 つ以上の skill が同じものを使っている。契約でも手順でもよい。1 つの skill しか使わないものは、その skill の `references/` に実体で置く
- **ドメインで 2 段に分ける**。`shared/` は普遍（どの project でも意味が通る）、`shared/queue/` はキュー機構専用（Issue・Status・claim・着地面・記録 marker を前提にするもの）
- **`shared/queue/` を張れるのは queue package の構成員だけ**（一覧は `agents/skills/docs/scripts/audit-skills.sh` の `QUEUE_MEMBERS`）
- **軸は skill の rank ではなくドメイン**。rank は将来ずれる代理でしかない
- `~/.agents/shared` への投影は要ら**ない**（skill が相対 symlink で辿るため）
- 実体の一覧は `agents/docs/structure.md`（**導出した索引**。規約は本ファイルが SSOT）

**`shared/` は層検査に当たらない**。参照先が skill でなくなるので、キュー専用の概念が leaf へ流れる経路がここ 1 本だけ開いている。上のドメイン分割がその蓋。

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
2. 上の「スコープと絵文字の対応」に harness の行を追加する
3. `./init.sh` で配線
4. `./doctor.sh` で検査

hooks の tripwire:

- **`harnesses/<agent>/hooks.json`（中身 `{"hooks": {}}`）は「空 overlay を先回りで作らない」の明示的な例外**。空であること自体が基準線なので、中身を埋めたり配線を外したりしない
- 外部ツールによる上書きを 3 経路で検知する —— symlink 経由の in-place 書き込みは repo 側の git diff、unlink して実ファイルで置換は doctor の ❌、別名ファイルの投下は `inv_guard_dir` の ⚠️
- **管理下 symlink 以外の投下を検知したい collection dir に `inv_guard_dir` を張る**（各 harness の hooks dir）。read-only で、自動削除はしない
- 設定が harness home 直下に置かれる場合（codex）は vendor ファイルと同居するため張ら**ない**。symlink check だけで守る
