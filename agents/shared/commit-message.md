# コミットメッセージ

1 つ前のコミットの言語に合わせ、先頭に gitmoji を付ける（`gitmoji.md`）。

```
{gitmoji} {message}

- {詳細1}
- {詳細2}
```

```bash
git commit -m "🔥 不要な生成コマンドを削除" -m "- 使われていない生成スクリプトを削除
- package scripts から関連コマンドを削除"
```

`Co-authored-by` 等の trailer を付けない。
