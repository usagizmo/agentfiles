---
name: issue
description: >-
  GitHub Issue の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh issue create` を直接実行しない）。
---

Issue を作成する。タイトル先頭に gitmoji。それ以外は通常の Issue 作成フロー。

available skills に `issue-project` があれば先に invoke し、本 skill への project 差分として適用する。project 側は `issue-project` 固定名で置き、単体では invoke しない。

```
{gitmoji} {内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。
