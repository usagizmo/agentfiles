---
name: issue
description: >-
  GitHub Issue の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh issue create` を直接実行しない）。
  ユーザーが「issue 作って」と言ったとき、「issue にすべき？」等の問いかけから作成すると判断したとき、
  および既存不具合・要件外・独立改善で今ブランチに載せると膨らむものを切り離すときは、指示がなくても作成する。
  今回変更由来の回帰・受け入れ失敗は Issue で消さず直す / スコープ縮小 / 撤回する。
---

Issue を作成する。タイトル先頭に gitmoji。それ以外は通常の Issue 作成フロー。

```
{gitmoji} {内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。
