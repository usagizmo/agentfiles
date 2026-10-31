---
name: commit
description: コミットは理由・きっかけを問わず必ずこの skill を経由する（`git commit` を直接実行しない）。
---

メッセージの形式は `references/commit-message.md`。

## 手順

1. プロジェクトにフォーマッターがあれば実行し、結果を staged に含める
2. 独立した論理単位が複数あれば単位ごとに分割する。1 ファイル内で混在するときは hunk 単位で staged を作る
3. 各コミットを作る

## 畳む

project の規則が課題ごとに 1 commit を求めるとき、追加の直しは `<skills root>/commit/scripts/fold.sh <課題の起点> [--message-file <file>]` で既存の commit に畳む（`git commit --amend` / `git reset --soft` を直接使わない）。直前に、範囲の commit が在りうる remote を fetch する。畳める範囲と拒否する条件は script が持つ。message を変えないなら `--message-file` は渡さない。
