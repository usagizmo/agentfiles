# AGENTS.md

## プラン作成・実装方針

- 最終形に不要なコード（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）は初手から書かない。中間段階で test/lint を通すためだけの一時コードを残さない
- 実装完了後は `/tidy` → `/docs` → `/commit` の順で実行する

## 共通 rules / skills

- エージェント共通の永続ルールは `~/.agents/rules/` を参照する。特に設計判断では `design-principles.md`、コミット前の整理では `boy-scout.md` を確認する
- エージェント共通の task workflow は `~/.agents/skills/` を参照する。Claude / Codex などエージェント固有の入口は、この共通ディレクトリへの symlink として扱う
- Codex の `.rules` は command approval 用の実行ポリシーであり、ここでいう設計・実装 rules とは別物として扱う
