---
name: ship
description: PR の merge は理由・きっかけを問わず必ずこの skill を経由する（`gh pr merge` を直接実行しない）。
---

CI が通った Ready-for-review PR を merge し、後始末まで見る。

## 前提

- **Draft PR ではない**（`gh pr view <number> --json isDraft --jq .isDraft` が `false`）。Draft なら merge せず報告する
- CI が通っている:
  - `gh pr checks <number> --json bucket` に `pending` / `fail` / `cancel` が無い
  - `pass` が 1 つ以上ある。**checks が空、または全部 `skipping` は通っていない**（Draft skip や未起動を緑とみなさない）
- **base が default**（`gh pr view <number> --json baseRefName`）。別 PR の head が base なら積み上げの途中
- 配信してよい（判断基準は project 差分。既定は「その変更の検証を終えている」）
- **人に見せる面（定義は `refine`）を変えたなら、明示の承認がある**。承認なしに merge しない。**沈黙は承認ではない**。承認の置き場と判定手順は project が定める（無ければ、このセッションでの明示承認か PR の人によるレビュー承認）

満たさないなら merge せず、満たしていない側を報告する。

## 分岐の解消と着地

| 目的                         | 手段                                              |
| ---------------------------- | ------------------------------------------------- |
| head を最新 base に載せる    | **rebase**（`pr` の `sync-and-push.sh`）          |
| default へ着地する           | `gh pr merge --merge`（着地用の merge commit）    |

**禁止:** 衝突解消として `git merge origin/<base>`（例: `origin/main`）を PR head へ入れる。ユーザー明示、または repo 方針が rebase / force-push を禁じるときだけ例外。

## フロー

1. head を最新 base に載せる。PR head の worktree で:
   ```
   bash <skills root>/pr/scripts/sync-and-push.sh [<base>]
   ```
   （fetch + `origin/<base>` への rebase + `--force-with-lease`。衝突は rebase 上で解消して再実行。）SHA が動いたら前提の CI を取り直し、通るまで待つ
2. auto-merge を有効化する:
   ```
   gh pr merge <number> --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{箇条書き body または空}"
   ```
   auto-merge が使えない環境では `--auto` なしで同じコマンドを実行する
3. `gh pr view <number> --json state --jq .state` を 5 秒間隔で確認し、`MERGED` を待つ。2 分超えたら auto-merge 不成立として原因を報告する
4. **この PR の head を base にしている open PR があれば `gh pr edit <子> --base "$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"` で張り替える。** head を消す前に張り替える。GitHub の自動付け替えに頼らない
5. `bash <skills root>/ship/scripts/sync-local-default.sh` でローカル default を最新化する。マージした PR と変更の要点を報告する
6. closing keyword で紐付けた Issue が実際に `CLOSED` になったか確認する（`gh issue view <n> --json state`）。open のまま残っていたら閉じる
7. `bash <skills root>/ship/scripts/retire-head.sh <number>` で head の worktree と branch を消す。消す条件は script が持つ。**止まったら消しにいかない** —— script が出した理由と、移動先を促されたならその path へ移ってからの再実行だけで進める

## マージコミット

```
{gitmoji} {変更内容を凝縮した説明} (#N)
```

gitmoji は `references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。body はコミット群の箇条書き。不要なら `--body ""`。
