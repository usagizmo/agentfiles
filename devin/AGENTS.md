# Devin グローバルルール

ユーザー全体の共通ルールは `~/.claude/CLAUDE.md` を参照（Devin は起動時に自動で読み込む）。本ファイルには Devin 固有のルールのみを記載する。

## コミットメッセージ

- コミットメッセージに Devin の attribution / trailer を **付けない**。具体的には以下を出力しない:
  - `Generated with [Devin](https://cli.devin.ai/docs)`
  - `Co-Authored-By: Devin <...@users.noreply.github.com>`
- コミットメッセージは変更内容のみを記述し、生成ツールに関する行・co-authored-by 行は一切含めない。
