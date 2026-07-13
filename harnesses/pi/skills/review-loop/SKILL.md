---
name: review-loop
description: >-
  AGENTS.md で大規模と判定した変更を書き終えたら、コミット前に必ず差分レビューする（ユーザーが /review-loop と言わなくても発動。規模 SSOT は ~/.agents/AGENTS.md）。
  Claude Code と Codex でレビュー→精査→修正を指摘が消えるまで繰り返す。軽微・中規模では使わない。完了後は tidy → docs → commit へ進む。
---

# レビューループ（Claude / Codex）

**判断主体は Pi**（指摘は命令ではない）。

1. 同ディレクトリの `procedure.md` を Read する（手順 SSOT）
2. 下記の harness 差分で手順 3・4 を実行する

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

## 4. マージ → 精査

1 本に統合（`[Claude+Codex]` / `[Claude]` / `[Codex]`）してから精査。以降は `procedure.md` の手順 4・5。
