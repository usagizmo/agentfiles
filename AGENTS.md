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
- `~/.claude` / `~/.codex` / `~/.copilot` / `~/.cursor` / `~/.config/devin` / `~/.agents` は実ディレクトリにし、必要なファイル・サブディレクトリだけ `init.sh` で symlink する

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
