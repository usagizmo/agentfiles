# dotfiles プロジェクト固有の設定

## コミットメッセージ規約

スコープごとに固定の gitmoji を使う。

### 形式

```
{gitmoji} [{scope}] {message}

- {詳細1}
- {詳細2}
```

### スコープと絵文字の対応

| 絵文字 | スコープ       | 説明                                                                                                      |
| ------ | -------------- | --------------------------------------------------------------------------------------------------------- |
| 🐟     | `[fish]`       | Fish シェル設定                                                                                           |
| 🐚     | `[zsh]`        | Zsh シェル設定                                                                                            |
| 🤖     | `[claude]`     | `harnesses/claude` 配下の Claude Code 設定                                                                |
| 🤖     | `[codex]`      | Codex 関連設定（`init.sh` の `~/.codex` 配線等）                                                          |
| 🤖     | `[agents]`     | `agents/` 配下の共通 instructions / skills（`.skill-lock.json` 等）                                       |
| 🤖     | `[grok]`       | `harnesses/grok` / `~/.grok` 配下の Grok 設定                                                             |
| 🖥️     | `[cursor-app]` | `cursor-app` 配下の Cursor IDE 設定                                                                       |
| 📝     | `[nvim]`       | Neovim 設定                                                                                               |
| 👻     | `[ghostty]`    | Ghostty ターミナル設定                                                                                    |
| 🐏     | `[herdr]`      | `herdr/` / `~/.config/herdr` 配下の herdr 設定                                                            |
| 📁     | `[yazi]`       | Yazi ファイルマネージャー設定                                                                             |
| 🔨     | `[mise]`       | mise ランタイムバージョン管理設定                                                                         |
| 🎨     | `[lint]`       | oxlint / oxfmt の設定と commit gate（`package.json` / `.oxlintrc.json` / `.oxfmtrc.json` / `.githooks/`） |
| 🔧     | `[複数]`       | 複数スコープにまたがる設定変更（例: `[fish][zsh]`）                                                       |

### 補足ルール

- スコープに該当しない全体的な変更は、適切な汎用 gitmoji を使用（新機能: ✨、バグ修正: 🐛、削除: 🔥、リファクタリング: ♻️）

### コミット例

```
🐟 [fish] claude コマンドの短縮 abbreviation c を追加

- `abbr -a c claude` を追加し、より素早く Claude を起動できるように改善
```

```
🔧 [fish][zsh] LM Studio CLI パス設定を追加

- 両シェルで LM Studio の CLI ツールを使用可能に
```

```
🤖 [claude] ボーイスカウトルールの記述を統合し重複を削除

- AGENTS.md とスキル内の重複した記述を整理
```

## agent 設定の配置方針

- `./AGENTS.md` はこの dotfiles repo 自体の instructions とし、`./.claude/CLAUDE.md` は Claude 互換入口として `../AGENTS.md` へ symlink する
- `./agents/` は agent 共通 instructions / skills の SSOT とする
- `./agents/docs/` は人が全体を把握・監査するための資料。**agent へは投影しない**（`lib/inventory.sh` に載せない）。規約の本体は置かず、skills から導出した図と索引だけを持つ
- `./harnesses/<agent>/` は agent 固有の tracked overlay のみを置く。runtime / cache / auth / logs / generated files は置かない
- harness ごとの instructions 入口（`~/.claude/CLAUDE.md` / `~/.codex/AGENTS.md` 等）は、harness 固有ルールがある場合は `harnesses/<agent>/` の overlay ファイル（固有ルール + 共通 `~/.agents/AGENTS.md` への参照。Claude は `@~/.agents/AGENTS.md` import）への symlink とし、固有ルールが無い間は共通 `agents/AGENTS.md` への直接 symlink のままにする（空 overlay を先回りで作らない）
- 共通 `agents/AGENTS.md` に書けるのは、**その機能が無い harness でも代替手段で成立するルール**まで（例: 判断材料を Artifact にする → 作れない harness では応答に出す）。**機能が無いと成立しないルール**（harness 名・モデル名を前提にするもの）は該当 harness の overlay へ移す。共通 skills も同じ
- **harness home（`~/.claude` / `~/.codex` 等）は実ディレクトリにし、tracked な葉だけを `init.sh` で symlink する**（harness が cache / auth / vendor を同居させるため）。どこに何を張るかの一覧は `lib/inventory.sh`
- **tracked ファイルに絶対 home パス（`/Users/...` `/home/...`）を書かない。**`$HOME` / `~` を使う（別環境で壊れる）。`doctor.sh` が repo 全体の tracked ファイルを検査する。symlink 先に使う絶対パスは `$DOTFILES_DIR` 展開であって、リテラルの絶対パスではない

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

**`agents/shared/<name>` を SSOT にし、使う skill から相対 symlink を張る**。どの skill にも所有させない。
**張り先はモデルの扱いで決まる**（拡張子ではない）: 読むものは `references/<name>.md`、実行するものは `scripts/<name>.sh`。

- **所有者を決めない**のが要点。`review-contract`（tidy / docs）のように主従が無い資産で「どちらを SSOT にするか」を決められず、選定が恣意的になる
- **同層への言及が構造的に消える**。参照先が skill でなくなるので、層契約（同じ層への依存・言及を作らない）を隠さずに満たせる
- **skill 本文は自分の相対パスだけ**。skill が自己完結し、投影先でも repo でも解決できる
- **`shared/` に置く条件は 1 つ**: **2 つ以上の skill が同じものを使っている**。契約でも手順でもよい（`review-contract` は契約、`advisors` は手順）。1 つの skill しか使わないものは、その skill の `references/` に実体で置く
- `~/.agents/shared` への投影は要らない（skill が相対 symlink で辿るため）。skill 以外から参照したくなった時点で足す
- 実体の一覧は `agents/docs/structure.md`（**導出した索引**。規約は本ファイルが SSOT）

### symlink の貼り方

home 側は harness が cache / auth / vendor を同居させるため **実ディレクトリ** とし、tracked な葉だけを repo へ symlink する。

| パターン                           | 対象                             | 例                                                                                |
| ---------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| 単一ファイル                       | instructions / hooks / 設定 1 枚 | `agents/AGENTS.md` → `~/.claude/CLAUDE.md`                                        |
| ディレクトリ丸ごと                 | union 不要な SSOT 投影           | `agents/skills` → `~/.agents/skills`                                              |
| 実 dir + 項目ごと symlink（union） | skills / agents 等のコレクション | `~/.claude/skills/<name>` ← `agents/skills` + `harnesses/claude/skills`（後勝ち） |

### 配線の SSOT（スケール用）

| パス               | 役割                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `lib/inventory.sh` | **配線一覧の唯一の正**。harness / symlink / skills union の追加はここだけ                                 |
| `lib/links.sh`     | apply / check の primitive（触らなくてよいことが多い）                                                    |
| `./init.sh`        | `run_inventory apply` + `core.hooksPath` の設定 + パッケージ類のインストール副作用                        |
| `./up.sh`          | 外部依存（agent skills / mise tools / yazi plugins）の更新 + 配線の再適用                                 |
| `./doctor.sh`      | `run_inventory check` + commit gate 検査 + tracked ファイルの絶対 home パス検査（read-only。修復は init） |

新しい harness や symlink を足す手順:

1. `lib/inventory.sh` の `inventory_define` に 1 ブロック追加（`inv_home` / `inv_symlink` / `inv_harness_skills` 等）
2. 上の「スコープと絵文字の対応」に harness の行を追加する
3. `./init.sh` で配線
4. `./doctor.sh` で検査

外部コマンド実行のルール（インストール・更新の副作用）:

- パッケージ / プラグインのインストールは `init.sh` の `install_step "<助詞まで含む文節>" <cmd...>` で実行する（例: `install_step "tpm を" git clone ...`）。成否を握りつぶさず、失敗は件数を集計して summary で非ゼロ終了する
- **ツール欠落の扱いは、欠いたまま完走したときにそのスクリプトの主目的が達成できるかで決まる**。達成できるならスキップして ⚠️ に留め、できないなら失敗に数える（`init.sh` は配線が主目的でインストールは全て付随物なのでスキップ、`up.sh` は skills 更新が主目的なので `bunx` 欠落は失敗・`ya` は付随物なのでスキップ）
- **更新の対象そのものが入っていない場合はスキップ**（生成元が無いので更新できないが、既にあるものを壊しもしない）。道具の欠落と区別する — `up.sh` の `bunx` は道具なので失敗、`herdr` は対象なのでスキップ
- 実行を試みて失敗した場合は、上によらず数える
- **生成物を直接リダイレクトで上書きしない。**`>` はコマンド起動の前にファイルを 0 バイトへ切り詰めるので、生成に失敗すると既存の成果物が消える。temp へ出し、成功かつ非空を確かめてから `mv` する

コレクション配線のルール:

- **source 列は優先度低→高**。後から渡した source が同名を上書きする（harness skills: `agents/skills` < `harnesses/<agent>/skills`）
- **`~/.agents/skills` をネイティブに読む harness（Codex 等）には `agents/skills` の union を張らない**（重複配布で衝突警告になる）。union は harness 固有 overlay の分のみ（`inv_collection "$HOME/.codex/skills" harnesses/codex/skills` 等）
- 存在しない source dir はスキップする（`harnesses/<agent>/skills` 等は実体ができてから作る）
- symlink は **絶対パス**（`$DOTFILES_DIR/...`）

配布先に既に何かある場合の扱いは、経路で違う:

| 配布先の状態            | 単一ファイル（`inv_symlink`）                                                | コレクション項目（`inv_collection` / `inv_harness_skills`） |
| ----------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| repo 配下を指す symlink | 付け替える                                                                   | 付け替える                                                  |
| repo 外を指す symlink   | ⚠️ 触らない                                                                  | 付け替える                                                  |
| 実ファイル              | 内容を repo へ取り込んでから symlink 化（差分は git で確認・discard できる） | ⚠️ 拒否                                                     |
| 実ディレクトリ          | ⚠️ 触らない                                                                  | ⚠️ 触らない                                                 |

- **⚠️ は必ず出し、件数を集計して非ゼロ終了する**（黙殺しない）。`ln` の失敗も同じ。実ディレクトリは自動削除しない
- prune で消すのは **repo 配下を指す管理下 symlink のうち、配布対象に無いもの・壊れたもの**だけ。repo 外を指す link・実ファイル・実ディレクトリ（vendor の `.system` や Grok bundled skills 等）は触らない
- doctor は実ファイル / 実ディレクトリを ❌ にする（read-only。修復は `init.sh`）

hooks の tripwire:

- **`harnesses/<agent>/hooks.json`（中身 `{"hooks": {}}`）は「空 overlay を先回りで作らない」の明示的な例外**。外部ツールによる hooks 上書きを 3 経路で検知する — symlink 経由の in-place 書き込みは repo 側の git diff、unlink して実ファイルで置換は doctor の ❌、別名ファイルの投下は `inv_guard_dir` の ⚠️。空であること自体が基準線なので、中身を埋めたり配線を外したりしない
- **管理下 symlink 以外の投下を検知したい collection dir に `inv_guard_dir` を張る**（各 harness の hooks dir）。管理下 symlink と allowlist 以外のエントリを ⚠️ で報告する（read-only。自動削除はしない）。設定が harness home 直下に置かれる場合（codex）は vendor ファイルと同居するため張らず、symlink check だけで守る
