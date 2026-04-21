---
name: pr
description: PR を作成する。タイトルの先頭に gitmoji を付ける以外はデフォルトの `gh pr create` フローに従う。ユーザーが「PR を作成して」「pr 出して」と言ったときに使う。
---

PR を作成して。タイトルの先頭には適切な gitmoji を付ける。それ以外はデフォルトの PR 作成フローに従う。

## タイトル形式

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji の選び方は `../commit/references/gitmoji.md` を参照。
