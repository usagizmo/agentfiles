---
name: ship
description: PR の merge は理由・きっかけを問わず必ずこの skill を経由する（`gh pr merge` を直接実行しない）。
---

CI が通った PR を merge し、後始末まで見る。

## 前提

- CI が通っている（`gh pr checks <number>` に pending / failure が無い）
- 配信してよい（判断基準は project 差分。既定は「その変更の検証を終えている」）

満たさないなら merge せず、満たしていない側を報告する。

## フロー

1. auto-merge を有効化する:
   ```
   gh pr merge --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{箇条書き body または空}"
   ```
   auto-merge が使えない環境では `--auto` なしで同じコマンドを実行する
2. `gh pr view <number> --json state --jq .state` を 5 秒間隔で確認し、`MERGED` を待つ。2 分超えたら auto-merge 不成立として原因を報告する
3. `references/sync-default.md`（`../pr/references/sync-default.md`）でローカル default を最新化し、マージした PR と変更の要点を報告する
4. closing keyword で紐付けた Issue が実際に `CLOSED` になったか確認する（`gh issue view <n> --json state`）。open のまま残っていたら閉じる

## マージコミット

```
{gitmoji} {変更内容を凝縮した説明} (#N)
```

gitmoji は `../commit/references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。
body はコミット群の箇条書き。不要なら `--body ""`。
