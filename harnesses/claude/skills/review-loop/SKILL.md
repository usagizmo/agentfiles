---
name: review-loop
description: >-
  AGENTS.md で大規模と判定した変更を書き終えたら、コミット前に必ず差分レビューする（ユーザーが /review-loop と言わなくても発動。規模 SSOT は ~/.agents/AGENTS.md）。
  Codex でレビュー→精査→修正を指摘が消えるまで繰り返す。軽微・中規模では使わない。完了後は tidy → docs → commit へ進む。
---

# レビューループ（Codex）

**判断主体は実行中のエージェント（Claude）**（Claude 再入を避けるためアドバイザーは Codex のみ）。

1. 同ディレクトリの `procedure.md` を Read する（手順 SSOT）
2. 下記の harness 差分で手順 3 を実行する

## 3. Codex

一言伝えてから（モデル / effort 上書きなし）:

```bash
codex exec -s read-only -o "$PROMPT.out" - < "$PROMPT"
```

失敗時は事実を伝え、Codex なしで進めてよいか確認。「指摘なし」なら完走。
