# アドバイザー起動表

候補は Claude / Codex / Grok。**実行中の自分自身を除いた 2 つ**を起動する（再入防止）。自分が候補に無い harness や自分がどれか不確かな場合は Claude | Codex。

一言伝えてから、選んだ 2 ブロックを並列で起動し（モデル / effort 上書きなし）、その 2 つの pid を wait する:

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

grok --prompt-file "$PROMPT" \
  --permission-mode plan \
  --tools "Bash,Read,Grep,Glob" \
  >"$PROMPT.grok.out" 2>"$PROMPT.grok.log" &
grok_pid=$!
```

## 失敗時

片方失敗でも成功側で可。失敗は隠さない。両方失敗なら確認。

## 出典表記

1 本に統合するとき、各論点に使ったアドバイザーの出典タグを付す（例: `[Codex+Grok]` / `[Codex]` / `[Grok]`）
