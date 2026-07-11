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

| 絵文字 | スコープ | 説明 |
|-------|---------|------|
| 🐟 | `[fish]` | Fish シェル設定 |
| 🐚 | `[zsh]` | Zsh シェル設定 |
| 🤖 | `[claude]` | `harnesses/claude` 配下の Claude Code 設定 |
| 🤖 | `[codex]` | Codex 関連設定（`init.sh` の `~/.codex` 配線等） |
| 🤖 | `[devin]` | `harnesses/devin` / `~/.config/devin` 配下の Devin CLI 設定 |
| 🤖 | `[agents]` | `agents/` 配下の共通 instructions / rules / skills（`.skill-lock.json` 等） |
| 🤖 | `[cursor]` | Cursor CLI / Agent 設定（`init.sh` の `~/.cursor` 配線等） |
| 🖥️ | `[cursor-app]` | `cursor-app` 配下の Cursor IDE 設定 |
| 🐙 | `[copilot]` | `harnesses/copilot` 配下の GitHub Copilot 設定 |
| 📝 | `[nvim]` | Neovim 設定 |
| 👻 | `[ghostty]` | Ghostty ターミナル設定 |
| 🖥️ | `[tmux]` | tmux 設定 |
| 📁 | `[yazi]` | Yazi ファイルマネージャー設定 |
| 🔨 | `[mise]` | mise ランタイムバージョン管理設定 |
| 🔧 | `[複数]` | 複数スコープにまたがる設定変更（例: `[fish][zsh]`） |

### 補足ルール

- スコープに該当しない全体的な変更は、適切な汎用 gitmoji を使用（新機能: ✨、バグ修正: 🐛、削除: 🔥、リファクタリング: ♻️）

## agent 設定の配置方針

- `./AGENTS.md` はこの dotfiles repo 自体の instructions とし、`./.claude/CLAUDE.md` は Claude 互換入口として `../AGENTS.md` へ symlink する
- `./agents/` は agent 共通 instructions / rules / skills の SSOT とする
- `./harnesses/<agent>/` は agent 固有の tracked overlay のみを置く。runtime / cache / auth / logs / generated files は置かない
- harness ごとの instructions 入口（`~/.claude/CLAUDE.md` / `~/.cursor/AGENTS.md` 等）は、harness 固有ルールがある場合は `harnesses/<agent>/` の overlay ファイル（固有ルール + 共通 `~/.agents/AGENTS.md` への参照。Claude は `@~/.agents/AGENTS.md` import）への symlink とし、固有ルールが無い間は共通 `agents/AGENTS.md` への直接 symlink のままにする（空 overlay を先回りで作らない）
- 共通 `agents/AGENTS.md` / `agents/rules/` には harness 名や harness 固有の機能（モデル名・subagent 機構等）に依存するルールを書かない。書きたくなったら該当 harness の overlay へ移す
- `~/.claude` / `~/.codex` / `~/.copilot` / `~/.cursor` / `~/.config/devin` / `~/.grok` / `~/.agents` は実ディレクトリにし、必要なファイル・サブディレクトリだけ `init.sh` で symlink する

### 共通と個別の分け方

| 置く場所 | 対象 | 判定 |
|---------|------|------|
| `agents/` | instructions / rules / skills | 2 つ以上の harness で同じ意味・手順を使いたい。本文から harness 名・固有 API を消せる |
| `harnesses/<agent>/` | overlay instructions / skills / agents / prompts / commands / hooks / settings | 1 harness 専用、またはそのランタイム表面に密着する |

- **意味と手順は共通、起動・配線・フォーマットは個別**。agents / prompts / commands / subagents は形式が harness ごとに違うため、原則 `harnesses/<agent>/` のみに置く（共通フォーマットや codegen は作らない）
- 最初は個別に書き、**2 つ目の harness が同じ中身を必要にした時点で** `agents/` へ昇格する（空の共通抽象を先に作らない）
- 参照方向は常に **個別 → 共通** の一方通行。共通が特定 harness を知ってはいけない
- `codex-consult` のように「他 harness から Codex を呼ぶ」手順は共通 skill に置いてよいが、**Codex 自身の home には配らない**（`init.sh` の `--exclude`）

### symlink の貼り方

home 側は harness が cache / auth / vendor を同居させるため **実ディレクトリ** とし、tracked な葉だけを repo へ symlink する。

| パターン | 対象 | 例 |
|---------|------|-----|
| 単一ファイル | instructions / hooks / 設定 1 枚 | `agents/AGENTS.md` → `~/.claude/CLAUDE.md` |
| ディレクトリ丸ごと | union 不要な SSOT 投影 | `agents/rules` → `~/.agents/rules`、`agents/skills` → `~/.agents/skills` |
| 実 dir + 項目ごと symlink（union） | skills / agents 等のコレクション | `~/.claude/skills/<name>` → `agents/skills/<name>` と `harnesses/claude/skills/<name>` |

### 配線の SSOT（スケール用）

| パス | 役割 |
|------|------|
| `lib/inventory.sh` | **配線一覧の唯一の正**。harness / symlink / skills union の追加はここだけ |
| `lib/links.sh` | apply / check の primitive（触らなくてよいことが多い） |
| `./init.sh` | `run_inventory apply` + パッケージ類のインストール副作用 |
| `./doctor.sh` | `run_inventory check`（read-only。修復は init） |

新しい harness や symlink を足す手順:

1. `lib/inventory.sh` の `inventory_define` に 1 ブロック追加（`inv_home` / `inv_symlink` / `inv_harness_skills` 等）
2. `./init.sh` で配線
3. `./doctor.sh` で検査

コレクション配線のルール:

- **source 列は優先度低→高**。後から渡した source が同名を上書きする（harness 固有が共通に勝つ）
- 存在しない source dir はスキップする（`harnesses/<agent>/skills` 等は実体ができてから作る）
- symlink は **絶対パス**（`$DOTFILES_DIR/...`）
- repo 配下を指す管理下 symlink のうち、今回の配布対象に無いもの・壊れたものを削除する
- repo 外を指す link・実ファイル・実ディレクトリ（vendor の `.system` や Grok bundled skills 等）は触らない
- 外部ツールが実体化・書き換えしてくるファイル（Claude `settings.json` 等）だけ `inv_replace` / `link_replace`
- **symlink であるべき箇所が実ディレクトリ / 実ファイルのとき、または `ln` が失敗したときは必ず ⚠️ を出し、件数を集計して非ゼロ終了する**（黙殺しない）。実 dir は自動削除しない

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
