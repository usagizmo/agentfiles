# アドバイザー起動表（Claude | Codex）

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

## 失敗時

片方失敗でも成功側で可。失敗は隠さない。両方失敗なら確認。

## 指摘の統合

1 本に統合（`[Claude+Codex]` / `[Claude]` / `[Codex]`）してから精査する。
