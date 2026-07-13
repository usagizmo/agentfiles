---
name: consult
description: >-
  設計・方針のセカンドオピニオン。短い「これでいい？」から新機能プラン・大きなトレードオフ・設計再検討まで、自分の判断を先に立て Claude Code と Codex と突き合わせる。
  迷ったら使う（ユーザーが明示しなくても発動。短い確認・sanity check 含む）。実装プラン確定時だけ承認ゲートで GO を待つ。
  大きい diff の網羅レビューは review-loop。軽微・自明では使わない。
---

# 設計判断の突き合わせ（Claude / Codex）

**判断主体は実行中のエージェント**。アドバイザーは検証者。

1. 同ディレクトリの `procedure.md` を Read する（手順 SSOT）
2. 下記の harness 差分で手順 3・5 を実行する

## 3. Claude ∥ Codex

一言伝えてから並列（モデル / effort 上書きなし）:

```bash
codex exec -s read-only -o "$PROMPT.codex.out" - < "$PROMPT" \
  >"$PROMPT.codex.log" 2>&1 &
codex_pid=$!

claude -p \
  --permission-mode plan \
  --tools "Bash,Read,Grep,Glob" \
  --output-format text \
  < "$PROMPT" \
  >"$PROMPT.claude.out" 2>"$PROMPT.claude.log" &
claude_pid=$!

wait "$codex_pid"; codex_ec=$?
wait "$claude_pid"; claude_ec=$?
```

片方失敗でも成功側で可。失敗は隠さない。両方失敗なら確認。

## 5. 承認ゲート

プラン確定時は統合プラン（仕様・変更対象・判断・スコープ外・検証）を提示し、GO まで実装しない。
Plan Mode がある harness はそれを使う（例: `enter_plan_mode` → プラン文書 → 承認 UI）。無ければ構造化 Markdown + 明示 GO。
