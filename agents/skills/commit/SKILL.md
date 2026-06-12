---
name: commit
description: gitmoji 付きコミットメッセージを生成してコミットする。ユーザーが「コミットして」「commit して」と言ったとき、または実装完了後のコミットで使う。
---

commit して。言語は1つ前のコミットを参考にして、先頭には適切な gitmoji をつけて。

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

本文を書くときは `-m` を2回使う。

```bash
git commit -m "🔥 不要な生成コマンドを削除" -m $'- 使われていない生成スクリプトを削除
- package scriptsから関連コマンドを削除
- 生成物向けのlint/format除外設定を整理'
```

## gitmoji

gitmoji の選び方は `references/gitmoji.md` を参照。
