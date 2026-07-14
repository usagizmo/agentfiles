# アドバイザー起動表（Codex のみ）

実行中のエージェントが Claude のため、再入を避けアドバイザーは Codex のみ。

一言伝えてから（モデル / effort 上書きなし）:

```bash
codex exec -s read-only -o "$PROMPT.out" - < "$PROMPT"
```

## 失敗時

失敗時は事実を伝え、Codex なしで進めてよいか確認。
