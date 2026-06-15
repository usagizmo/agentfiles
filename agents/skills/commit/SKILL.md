---
name: commit
description: gitmoji 付きコミットメッセージを生成してコミットする。ユーザーが「コミットして」「commit して」と言ったとき、またはコミットが必要になったときに使う。
---

1つ前のコミットの言語に合わせ、先頭に適切な gitmoji を付けてコミットする。

## 実行手順

1. プロジェクトにフォーマッターがあれば実行する（例: `bun format`, `npm run format`, `cargo fmt` など）
2. フォーマット結果を staged に取り込んでからコミットする

## 形式

```
{gitmoji} {message}

- {詳細1}
- {詳細2}
- ...
```

## コマンド例

本文を書くときは `-m` を2回使い、本文はダブルクオート内に実改行を入れる。

```bash
git commit -m "🔥 不要な生成コマンドを削除" -m "- 使われていない生成スクリプトを削除
- package scriptsから関連コマンドを削除
- 生成物向けのlint/format除外設定を整理"
```

## gitmoji

gitmoji の選び方は `references/gitmoji.md` を参照。
