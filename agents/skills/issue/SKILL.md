---
name: issue
description: >-
  GitHub Issue を作成する（タイトル先頭に gitmoji）。ユーザーが「issue 作って」と言ったとき、
  および既存不具合・要件外・独立改善で今ブランチに載せると膨らむものを切り離すときに、指示がなくても作成する。
  今回変更由来の回帰・受け入れ失敗は Issue で消さず PR blocker として直す / スコープ縮小 / 撤回する。
---

Issue を作成する。タイトルの先頭には適切な gitmoji を付ける。それ以外はデフォルトの Issue 作成フローに従う。

## タイトル形式

```
{gitmoji} {内容を凝縮した説明}
```

gitmoji の選び方は `../commit/references/gitmoji.md` を参照。
