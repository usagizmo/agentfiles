# agentfiles プロジェクト固有の設定

## この repo は public

**private な案件の repo 名・Issue / PR 番号・社内固有の文言を、tracked ファイルにも commit message にも書かない。** 由来を残したいときは、何を直したかだけを書く。**リンクの曖昧さを完全修飾で解こうとしない** —— `#123` が自分の repo を指してしまうからと `org/private-repo#123` へ直すと、曖昧さの代わりに repo 名が公開される。

**共通 instructions / skills の変更は、直すと決めた工程が commit も merge も行う。push だけは人が行う。**

**配布は merge では起きない。**`~/.agents` の symlink 先はこの repo の working tree なので、**この checkout でファイルを書いた瞬間に全 project の全工程へ配布される**。merge を人の gate にしても、その前に配布は済んでいる —— 止められるのは「別の worktree で作業したときだけ」で、同じ木で直した変更には一度も掛からない。掛からない gate を置くと、守られているつもりの範囲だけが実態とずれる。

**push が別なのは、取り消しが手元で閉じないから**。他のマシンと公開先へ出た後は、消しても消したことが残る。`git reset` で戻せる範囲に居るあいだは、エージェントが着地まで進めてよい。

**配布を止めたいなら、別の worktree で作業する**（gate は merge ではなくそちら側にある）。

**共通 `merge` skill の「何をいつ入れるかは人が決める」を緩めていない。**あちらが禁じているのは
「課題の着地として自動で走ること」で、決めるのは人という点は変わらない —— ここはその判断を
この repo に対して 1 度だけ据え置いたもの。**手順と検査（dirty・HEAD・祖先関係・失敗したら止まる）は
そのまま適用する。**

## dotfiles への依存

**配線 primitive と inventory API は dotfiles の `lib/links.sh` が SSOT**。`lib/bootstrap.sh` が読み込み、在処は `DOTFILES_REPO` > 兄弟ディレクトリ の順に解決する。**見つからなければ止まる** —— 関数が未定義のまま進むと、どの `inv_*` も no-op になり「成功したのに何も張られていない」で終わる。

**参照方向は agentfiles → dotfiles の一方通行**。dotfiles 側は agentfiles を知らない。

**次の規約は dotfiles の `AGENTS.md` が SSOT で、ここには写さない** —— symlink の貼り方、配布先に既に何かある場合の扱い、コレクション配線のルール、外部コマンド実行のルール、tracked ファイルに絶対 home パスを書かないこと。primitive の実装がそこにあるので、写すと片方だけ古くなる。

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
- `./harnesses/<agent>/` は agent 固有の tracked overlay のみを置く。runtime / cache / auth / logs / generated files は置かない
- harness ごとの instructions 入口（`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` 等）は、harness 固有ルールがある場合は `harnesses/<agent>/` の overlay ファイル（固有ルール + 共通 `~/.agents/AGENTS.md` への参照。Claude は `@~/.agents/AGENTS.md` import）への symlink とし、固有ルールが無い間は共通 `agents/AGENTS.md` への直接 symlink のままにする（空 overlay を先回りで作らない）
- 共通 `agents/AGENTS.md` に書けるのは、**その機能が無い harness でも代替手段で成立するルール**まで（例: 判断材料を Artifact にする → 作れない harness では応答に出す）。**機能が無いと成立しないルール**（harness 名・モデル名を前提にするもの）は該当 harness の overlay へ移す。共通 skills も同じ
- **harness home（`~/.claude` / `~/.codex` 等）は実ディレクトリにし、tracked な葉だけを `init.sh` で symlink する**（harness が cache / auth / vendor を同居させるため）。どこに何を張るかの一覧は `lib/inventory.sh`

### 共通と個別の分け方

| 置く場所             | 対象                                                                           | 判定                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `agents/`            | instructions / skills                                                          | 2 つ以上の harness で同じ意味・手順を使いたい。本文から harness 名・固有 API を消せる。`~/.agents/` にも投影する |
| `harnesses/<agent>/` | overlay instructions / skills / agents / prompts / commands / hooks / settings | 1 harness 専用、またはそのランタイム表面に密着する（同名で agents を上書き可）                                   |

- **意味と手順は共通、起動・配線・フォーマットは個別**。agents / prompts / commands / subagents は形式が harness ごとに違うため、原則 `harnesses/<agent>/` のみに置く（共通フォーマットや codegen は作らない）
- **最初は個別に書き、上表のしきい値に達してから `agents/` へ昇格する**（空の共通抽象を先に作らない）
- 参照方向は常に **個別 → 共通** の一方通行。共通が特定 harness を知ってはいけない
- アドバイザーの起動は `agents/shared/` の単一実体（判断表 + スクリプト）にし、harness ごとの上書きを置かない

### skill 間で実体を共有するとき

**`agents/shared/<name>` を SSOT にし、使う skill から相対 symlink を張る**。どの skill にも所有させない。**張り先はモデルの扱いで決まる**（拡張子ではない）: 読むものは `references/<name>.md`、実行するものは `scripts/<name>.sh`。

- **所有者を決めない**のが要点。`review-contract`（tidy / docs）のように主従が無い資産で「どちらを SSOT にするか」を決められず、選定が恣意的になる
- **同層への言及が構造的に消える**。参照先が skill でなくなるので、層契約（同じ層への依存・言及を作らない）を隠さずに満たせる
- **skill 本文は自分の相対パスだけ**。skill が自己完結し、投影先でも repo でも解決できる
- **`shared/` に置く条件は 1 つ**: **2 つ以上の skill が同じものを使っている**。契約でも手順でもよい（`review-contract` は契約、`advisors` は手順）。1 つの skill しか使わないものは、その skill の `references/` に実体で置く
- `~/.agents/shared` への投影は要らない（skill が相対 symlink で辿るため）。skill 以外から参照したくなった時点で足す
- 実体の一覧は `agents/docs/structure.md`（**導出した索引**。規約は本ファイルが SSOT）

### 配線の SSOT（スケール用）

| パス               | 役割                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `lib/inventory.sh` | **この repo が何を配線するかの唯一の正**。harness / symlink / skills union の追加はここだけ               |
| `lib/bootstrap.sh` | dotfiles の `lib/links.sh`（primitive と `inv_*` の実装）を解決して読む                                   |
| `./init.sh`        | `run_inventory apply` + `core.hooksPath` の設定 + 開発依存のインストール                                  |
| `./up.sh`          | 外部 skills の更新 + herdr skill の生成 + 配線の再適用 + 開発依存の更新                                   |
| `./doctor.sh`      | `run_inventory check` + commit gate 検査 + tracked ファイルの絶対 home パス検査（read-only。修復は init） |

**ランタイム（bun / mise）はこの repo が入れない。**dotfiles の `./init.sh` が供給する。欠けていたら開発依存のインストールをスキップして ⚠️ に留める（配線が主目的なので止めない）。

新しい harness を足す手順:

1. `lib/inventory.sh` の `inventory_define` に 1 ブロック追加（`inv_home` / `inv_symlink` / `inv_harness_skills` 等）
2. 上の「スコープと絵文字の対応」に harness の行を追加する
3. `./init.sh` で配線
4. `./doctor.sh` で検査

hooks の tripwire:

- **`harnesses/<agent>/hooks.json`（中身 `{"hooks": {}}`）は「空 overlay を先回りで作らない」の明示的な例外**。外部ツールによる hooks 上書きを 3 経路で検知する — symlink 経由の in-place 書き込みは repo 側の git diff、unlink して実ファイルで置換は doctor の ❌、別名ファイルの投下は `inv_guard_dir` の ⚠️。空であること自体が基準線なので、中身を埋めたり配線を外したりしない
- **管理下 symlink 以外の投下を検知したい collection dir に `inv_guard_dir` を張る**（各 harness の hooks dir）。管理下 symlink と allowlist 以外のエントリを ⚠️ で報告する（read-only。自動削除はしない）。設定が harness home 直下に置かれる場合（codex）は vendor ファイルと同居するため張らず、symlink check だけで守る
