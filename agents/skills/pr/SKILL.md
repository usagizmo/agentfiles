---
name: pr
description: >-
  PR の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh pr create` を直接実行しない）。
  push は `scripts/sync-and-push.sh` で行い、素の `git push` は使わない。
---

PR を作り、**merge 可能な状態まで**持っていく。タイトル先頭に gitmoji。

## base — 順序はここだけで表す

**他の PR を待たない**。

| その変更は                   | base                                     | 結果                              |
| ---------------------------- | ---------------------------------------- | --------------------------------- |
| 未着地の PR の成果に依存する | **その PR の head ブランチ**（積み上げ） | 下から順にしか merge できない     |
| 依存しない                   | default                                  | 順序は無い。いつ merge してもよい |

**依存しないブランチを他のフィーチャーブランチへ rebase しない**。偽の依存が生まれ、本来不要な直列化を招く。

**base の PR が既に着地しているなら、`gh pr edit <自分> --base "$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"` で張り替えてから rebase する。** 親の head ブランチが残る運用では GitHub は base を付け替えないので、放置すると merge できない。

## 入る条件

呼ぶのは、**CI が通れば merge できる状態になってから**。次が揃う前には呼ば**ない**。

| 揃っているもの            | 確かめ方                                                       |
| ------------------------- | -------------------------------------------------------------- |
| worktree が clean         | `git status`                                                   |
| CI 相当の local gate が緑 | その repo の CI と同じ検査。入口の名前は project 差分          |
| 意図の確認が決着          | 明示承認があるか、不要と判定されている。途中のままでは呼ばない |

揃う前に呼ぶと、push が先に走り、あとから直すたびに CI が回る。その間 PR は「あるが緑でない」まま残り、PR の存在が状態の材料にならない。

local gate の入口が無い repo では、**CI の定義から同じ検査を組んでローカルで通してから**呼ぶ。

## フロー

1. `bash <skills root>/pr/scripts/sync-and-push.sh [<base>]` で push する。衝突が出たら解消して再実行する
2. PR が無ければ `gh pr create --base <base>`、あれば `gh pr edit` で title / body を更新
3. `gh pr checks <number> --watch` で CI 完了までブロック。失敗したらログを見て修正・コミットし 1 に戻る。**ここで落ちてよいのは、local gate が持たない検査だけ**（環境差・flaky）。local gate で再現するものが落ちたら、直す前にその gate を通す手順へ足す

**commit を足したら必ず 1 へ戻る。CI が緑になったあとも同じ。**「もう通ったから push だけ」で追随を飛ばすと、base から離れたまま積み上がり、着地の直前に大きな rebase と衝突が出る。実物を見せて直した後の再 push がいちばん飛ばしやすい。

**CI 起因でない修正は、洗いきってから 1 回で push する。** check は SHA 単位で回り直し、path フィルタは PR base との差分を見るので docs だけの commit でも縮まない。1 つ出たのは洗い切れていない合図なので、その場で push せず同種の残りを先に全部探す。

CI が通ったら完了。**merge はここでしない。**

**CI 進行中の SSOT**: `gh pr checks <number> --json bucket` のいずれかが `pending`（CheckRun / StatusContext の差は gh が正規化する）。素の人間向け出力を読まない。

## Body / Issue 連携

解決した Issue は closing keyword で紐付ける。**キーワードは番号ごとに必要**:

- ✅ `Closes #101, closes #102, closes #103`（1 行 1 keyword に分けても良い）
- ❌ `Closes #101, #102, #103` — 先頭の #101 しかリンクされず、残りは merge 後も open で取り残される

部分対応に留まる Issue は closing keyword を使わず `Refs #101` 等の参照にする。

## タイトル

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji は `references/gitmoji.md`。
