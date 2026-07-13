---
name: consult
description: >-
  設計・方針のセカンドオピニオン。短い「これでいい？」から新機能プラン・大きなトレードオフ・設計再検討まで、自分の判断を先に立て Codex と突き合わせる。
  迷ったら使う（ユーザーが明示しなくても発動。短い確認・sanity check 含む）。実装プラン確定時だけユーザー GO を待つ。
  実装へ進んだら完了時は tidy → docs → commit まで。大きい diff の網羅レビューは review-loop。軽微・自明では使わない。
---

# 設計判断の突き合わせ（Codex）

**判断主体は実行中のエージェント（Claude）**。Codex は検証者（Claude 再入を避けるためアドバイザーは Codex のみ）。

1. 同ディレクトリの `procedure.md` を Read する（手順 SSOT）
2. 下記の harness 差分で手順 3・5 を実行する

## 3. Codex に渡す

一言伝えてから（モデル / effort 上書きなし）:

```bash
codex exec -s read-only -o "$PROMPT.out" - < "$PROMPT"
```

失敗時は事実を伝え、Codex なしで進めてよいか確認。

## 5. 承認ゲート

プラン確定時は統合プラン（仕様・変更対象・判断・スコープ外）を提示し、GO まで実装しない。

## 6. 実装完了

実装へ進んだ場合は `tidy` → `docs` → `commit` まで。手順 6 は `procedure.md`。
