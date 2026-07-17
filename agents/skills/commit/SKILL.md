---
name: commit
description: >-
  コミットは理由・きっかけを問わず必ずこの skill を経由する（`git commit` を直接実行しない）。
  gitmoji 付きコミットメッセージを生成してコミットする。
  ユーザーが「コミットして」と言ったとき、および実装完了の仕上げでコミットすべきときに、指示がなくても実行する。
---

1つ前のコミットの言語に合わせ、先頭に gitmoji を付けてコミットする。

## 手順

1. 変更に agent-facing（AGENTS / rules / skills / prompts / references 等）が含まれるのに `docs`（品質パス）未実施なら、先に `docs` を実行する。自己判定前に commit しない
2. プロジェクトにフォーマッターがあれば実行し、結果を staged に含める
3. 次の形式でコミットする

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
