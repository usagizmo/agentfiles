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

## 既存 Issue の確認

起票の前に、同じ `<repo>` の open Issue から同じ課題を探す。

- `gh issue list --repo <repo> --state open --search "<課題の核になる語>" --limit 20 --json number,title,body,labels` を 1 回だけ引く。`--limit` を外さない。pagination をループしない
- 取得した本文を変えるか追記すれば解決するなら、新規に作らない。本文は取得した本文に差分を足して作り、`gh issue edit <number> --repo <repo> --body-file <body-file>` で置き換える。その Issue の label に対して project 差分が対象行を要求するなら、対象行も更新する。label は変えない。その Issue を控えて終える
- 解決しないときだけ「手順」へ進む

## 手順

1. 「既存 Issue の確認」を通す
2. タイトルを上の形にする
3. 本文を用意する。project 差分が対象行を要求するなら、その形式で置く
4. `gh issue create --repo <repo> --title <title> --body-file <body-file>` をこの入口だけが呼び、作成した Issue を控える
5. project 差分が指定した label を、同じ `<repo>` の作成済み Issue に付ける（`gh issue edit <number> --repo <repo> --add-label <label>`）

## 画像

本文に画像を載せるときは、Issue 番号が確定した後（手順 4 の作成、または既存 Issue の特定）に `<skills root>/issue/scripts/upload-images.sh <repo> <Issue 番号> <file>...` で上げ、出力の URL を本文に貼る（`gh issue edit <number> --repo <repo> --body-file <body-file>`）。置き場・パス・前提は script が SSOT。対象 repo に画像用のブランチ・commit を**作らない**。
