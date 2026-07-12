---
name: commit
description: >-
  gitmoji 付きコミットメッセージを生成してコミットする。
  ユーザーが「コミットして」と言ったとき、および実装完了の仕上げでコミットすべきときに、指示がなくても実行する。
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
