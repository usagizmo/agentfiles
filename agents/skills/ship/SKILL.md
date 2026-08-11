---
name: ship
description: PR の merge は理由・きっかけを問わず必ずこの skill を経由する（`gh pr merge` を直接実行しない）。
---

CI が通った PR を merge し、後始末まで見る。

## 前提

- CI が通っている（`gh pr checks <number> --json bucket` に pending / failure が無い）
- **base が default**（`gh pr view <number> --json baseRefName`）。別 PR の head が base なら積み上げの途中
- 配信してよい（判断基準は project 差分。既定は「その変更の検証を終えている」）
- **人に見せる面を変えたなら、明示の承認がある** —— UI・公開 API・設計骨格を変えた PR を、承認なしに merge しない。**沈黙は承認ではない**。承認の置き場と判定手順は project が定める（無ければ、このセッションでの明示承認か PR の人によるレビュー承認）

満たさないなら merge せず、満たしていない側を報告する。

**意図の確認だけは variant を問わず必ず見る**。人が 1 件を直接頼んだ課題はキュー管理を通らずにここへ来るので、**ここが最後の砦になる。**

## フロー

1. auto-merge を有効化する:
   ```
   gh pr merge --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{箇条書き body または空}"
   ```
   auto-merge が使えない環境では `--auto` なしで同じコマンドを実行する
2. `gh pr view <number> --json state --jq .state` を 5 秒間隔で確認し、`MERGED` を待つ。2 分超えたら auto-merge 不成立として原因を報告する
3. **この PR の head を base にしている open PR があれば `gh pr edit <子> --base "$DEFAULT"` で張り替える。** head ブランチを消さない運用では GitHub が付け替えないので、放置すると子が merge できないまま残る
4. `references/sync-default.md` でローカル default を最新化し、マージした PR と変更の要点を報告する
5. closing keyword で紐付けた Issue が実際に `CLOSED` になったか確認する（`gh issue view <n> --json state`）。open のまま残っていたら閉じる

## マージコミット

```
{gitmoji} {変更内容を凝縮した説明} (#N)
```

gitmoji は `references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。body はコミット群の箇条書き。不要なら `--body ""`。
