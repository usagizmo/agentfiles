# CLAUDE.md

## プラン作成・実装方針

- 最終形に不要なコード（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）は初手から書かない。中間段階で test/lint を通すためだけの一時コードを残さない
- 実装完了後は `/tidy` → `/docs` → `/commit` の順で実行する
