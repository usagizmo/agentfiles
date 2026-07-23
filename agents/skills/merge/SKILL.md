---
name: merge
description: ローカルブランチのマージは理由・きっかけを問わず必ずこの skill を経由する（`git merge` を直接実行しない）。
---

指定ブランチを `--no-ff` でマージする。

1. 対象ブランチ名を取得する
2. `git log --oneline HEAD..<branch>` と `git diff HEAD...<branch>` で変更を把握する
3. `git log -1 --format="%s%n%n%b"` で直前コミットの言語・スタイルを合わせる
4. 変更の性質で gitmoji を1つ選び、マージする

```
git merge --no-ff <branch> -m "{gitmoji} {変更の本質}

- {サマリー1}
- {サマリー2}"
```

- タイトルは `Merge branch '...'` にしない
- gitmoji は `../commit/references/gitmoji.md`
