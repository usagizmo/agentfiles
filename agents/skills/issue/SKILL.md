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

起票先は課題を置く repo。その制御面 checkout の `.agents/skills/issue-project/` を、cwd で引かずに読む。無ければ差分は無い。あれば手順の前に読む。

## 手順

1. タイトルを上の形にする
2. 本文を用意する。project 差分が対象行を要求するなら、その形式で置く
3. `gh issue create` をこの入口だけが呼ぶ
4. project 差分が指定した label を付ける
