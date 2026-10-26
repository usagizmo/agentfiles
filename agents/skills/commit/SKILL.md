---
name: commit
description: コミットは理由・きっかけを問わず必ずこの skill を経由する（`git commit` を直接実行しない）。
---

メッセージの形式は `references/commit-message.md`。

## 手順

1. プロジェクトにフォーマッターがあれば実行し、結果を staged に含める
2. 独立した論理単位が複数あれば単位ごとに分割する。1 ファイル内で混在するときは hunk 単位で staged を作る
3. 各コミットを作る
