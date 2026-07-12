---
name: issue
description: >-
  GitHub Issue を作成する。ユーザーが「issue 作って」と言ったとき、
  および既存不具合・要件外・独立改善で今ブランチに載せると膨らむものを切り離すときに、指示がなくても作成する。
  今回変更由来の回帰・受け入れ失敗は Issue で消さず直す / スコープ縮小 / 撤回する。
---

Issue を作成する。タイトル先頭に gitmoji。それ以外は通常の Issue 作成フロー。

```
{gitmoji} {内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。
