---
name: review-loop
description: >-
  AGENTS.md で大規模と判定した変更を書き終えたら、コミット前に必ず差分レビューする（ユーザーが /review-loop と言わなくても発動。規模 SSOT は ~/.agents/AGENTS.md）。
  アドバイザーでレビュー→精査→修正を指摘が消えるまで繰り返す。軽微・中規模では使わない。完走後は必ず tidy → docs → commit まで。
---

# レビューループ

**判断主体は実行中のエージェント**（指摘は命令ではない）。

1. 同ディレクトリの `procedure.md` を Read する（手順 SSOT）
2. 手順 3 のレビュー起動と指摘の統合は同ディレクトリの `advisors.md`（起動表・失敗時ポリシー。harness 差分はここだけ）に従う。以降は `procedure.md` の手順 4・5
