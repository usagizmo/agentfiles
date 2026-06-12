# AGENTS.md

## プラン作成・実装方針

- 最終形に不要なコード（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）は初手から書かない。中間段階で test/lint を通すためだけの一時コードを残さない

## task workflow の使い分け

各 skill は毎回固定で回すパイプラインではなく、状況に応じて単発で使う:

- `codex-consult`: 仕様・設計を深く検討するとき。作業中に湧いた疑問の確認にも使ってよい。聞き先の切り分け: 機能・方針の意思決定（プロダクトの方向性に依存する選択）はユーザー、トップエンジニアがゼロベースで考えれば行き着く実装方法・品質・不具合関連は Codex
- `codex-review-loop`: 変更コード・ファイル数が多い実装のとき（不具合の取りこぼしや、より良い設計が出る可能性があるため）。小さな変更では回さない
- `/tidy` → `/docs` → `/commit`: codex-consult / codex-review-loop を使った機能実装の仕上げに、この順で行う。軽微な変更は通常のコミットのみでよい

## 共通 rules / skills

- エージェント共通の永続ルールは `~/.agents/rules/` を参照する。特に設計判断では `design-principles.md`、コミット前の整理では `boy-scout.md` を確認する
- エージェント共通の task workflow は `~/.agents/skills/` を参照する。Claude / Codex などエージェント固有の入口は、この共通ディレクトリへの symlink として扱う
- Codex の `.rules` は command approval 用の実行ポリシーであり、ここでいう設計・実装 rules とは別物として扱う
