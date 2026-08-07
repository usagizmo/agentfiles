---
name: merge
description: >-
  PR を出さずにローカルで `--no-ff` マージするときに必ずこの skill を経由する
  （`git merge` を直接実行しない）。既定の着地は PR 経由で、これは例外経路。
---

指定ブランチを `--no-ff` でマージする。

**通常は使わない**。変更を default へ入れる既定の経路は PR。
この skill は PR を経由せずにローカルで統合すると決めたときだけ発動する。

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
- gitmoji は `references/gitmoji.md`
