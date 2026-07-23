---
name: commit
description: コミットは理由・きっかけを問わず必ずこの skill を経由する（`git commit` を直接実行しない）。
---

1つ前のコミットの言語に合わせ、先頭に gitmoji を付けてコミットする。

## 手順

1. プロジェクトにフォーマッターがあれば実行し、結果を staged に含める
2. 次の形式でコミットする

```
{gitmoji} {message}

- {詳細1}
- {詳細2}
```

```bash
git commit -m "🔥 不要な生成コマンドを削除" -m "- 使われていない生成スクリプトを削除
- package scripts から関連コマンドを削除"
```

gitmoji は `references/gitmoji.md`。
