---
name: issue
description: >-
  GitHub Issue の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh issue create` を直接実行しない）。
---

# Issue 作成

タイトル先頭に gitmoji。gitmoji は `references/gitmoji.md`。

課題を分割・切り出すかの判断はここでは扱わない（呼び出し元の責務）。

```
{gitmoji} {内容を凝縮した説明}
```

## project 差分

起票先の `<repo>` を確定し、その checkout の `.agents/skills/issue-project/` を手順の前に読む。cwd の repo と同一とは限らない。差分が無ければ共通手順で進める。

## 手順

1. タイトルを上の形にする
2. 本文を用意する。project 差分が対象行を要求するなら、その形式で置く
3. `gh issue create --repo <repo> --title <title> --body-file <body-file>` をこの入口だけが呼び、作成した Issue を控える
4. project 差分が指定した label を、同じ `<repo>` の作成済み Issue に付ける（`gh issue edit <number> --repo <repo> --add-label <label>`）
