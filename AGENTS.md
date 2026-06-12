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
| 🤖 | `[codex]` | `harnesses/codex` 配下の Codex 関連設定 |
| 🤖 | `[devin]` | `harnesses/devin` / `~/.config/devin` 配下の Devin CLI 設定 |
| 🤖 | `[agents]` | `~/.agents` 配下の skill 管理（`.skill-lock.json` 等） |
| 🤖 | `[cursor]` | `harnesses/cursor` 配下の Cursor CLI / Agent 設定 |
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
- プロジェクト共通 instructions は `AGENTS.md` を実体にし、`.claude/CLAUDE.md` は symlink にする
- ハーネス固有の実体ディレクトリは `harnesses/` 配下に置き、root の `claude` / `codex` などは互換 symlink として扱う

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
