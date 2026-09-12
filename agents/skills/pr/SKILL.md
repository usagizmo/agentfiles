---
name: pr
description: >-
  PR の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh pr create` を直接実行しない）。
  push は `scripts/sync-and-push.sh` で行い、素の `git push` は使わない。
---

PR を作り、呼ぶ側が指定した経路で **Draft PR** で止めるか、Ready-for-review まで持っていく。タイトル先頭に gitmoji。呼ぶ側（`resolve` 等）が経路を決める。`pr` は経路を推測しない。

| 経路         | 終わり                                       |
| ------------ | -------------------------------------------- |
| **Draft PR** | Draft PR を上げて止まる。CI watch しない     |
| **Ready**    | Ready-for-review → CI 緑まで。merge はしない |

## base — 順序はここだけで表す

**他の PR を待たない**。

| その変更は                   | base                                     | 結果                              |
| ---------------------------- | ---------------------------------------- | --------------------------------- |
| 未着地の PR の成果に依存する | **その PR の head ブランチ**（積み上げ） | 下から順にしか merge できない     |
| 依存しない                   | default                                  | 順序は無い。いつ merge してもよい |

**依存しないブランチを他のフィーチャーブランチへ rebase しない**。偽の依存が生まれ、本来不要な直列化を招く。

**base の PR が既に着地しているなら、`gh pr edit <自分> --base "$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)"` で張り替えてから rebase する。** 放置すると merge できない。

**repo 方針が rebase / force-push を禁じるときだけ** `sync-and-push.sh` を使わず、`git merge origin/<base>` で追随して `git push origin HEAD` で送る。

## 共通の入る条件

次が揃う前には呼ばない。

| 揃っているもの            | 確かめ方                                              |
| ------------------------- | ----------------------------------------------------- |
| worktree が clean         | `git status`                                          |
| CI 相当の local gate が緑 | その repo の CI と同じ検査。入口の名前は project 差分 |

揃う前に呼ぶと、push が先に走り、あとから直すたびに CI が回る。

local gate の入口が無い repo では、**CI の定義から同じ検査を組んでローカルで通してから**呼ぶ。

**CI 起因でない修正は、洗いきってから 1 回で push する。** check は SHA 単位で回り直し、path フィルタは PR base との差分を見るので docs だけの commit でも縮まない。

## Draft PR

1. `bash <skills root>/pr/scripts/sync-and-push.sh [<base>]` で push する。衝突が出たら解消して再実行する
2. PR が無ければ `gh pr create --draft --base <base>`。あれば title / body を `gh pr edit` し、Ready なら `gh pr ready --undo` で Draft に戻す
3. body に再開欄を書く: 確認の持ち主 / 未決の問い / 期待結果 / 対象 head SHA / 確認の仕方 / 次の行動
4. **ここで終わる。** `gh pr checks --watch` はしない

**Draft で CI が skip されるかは project 差分。** 共通 skill は skip を前提にしない。skip 契約がある面でも、外部 check は走り得る。

## Ready

**入る条件（共通に加え）:** 意図の確認が決着している（明示承認があるか、不要と判定されている）。

1. `bash <skills root>/pr/scripts/sync-and-push.sh [<base>]` で push する。衝突が出たら解消して再実行する
2. sync 後、ready 前に HEAD の意味を見る。差し戻し基準は `resolve` の承認後表。`finish` / 再検証が要るならこの skill を抜けて呼ぶ側へ戻す（面変化も同時なら呼ぶ側が **要** 行へ進む）。再確認だけが残ったときだけ **Draft PR** 節の 2 以降へ（作成・Draft 化・再開欄を済ませて止まる）
3. PR が無ければ `gh pr create --base <base>`（draft にしない）。あれば title / body を更新する
4. Draft のままなら、**push のあと**に `gh pr ready` する（ready してから push しない）
5. `gh pr checks <number> --watch` で CI 完了までブロック。失敗したらログを見て修正・コミットし 1 に戻る。**ここで落ちてよいのは、local gate が持たない検査だけ**（環境差・flaky）。local gate で再現するものが落ちたら、直す前にその gate を通す手順へ足す

**commit を足したら必ず 1 へ戻る。CI が緑になったあとも同じ。**「もう通ったから push だけ」で追随を飛ばすと、base から離れたまま積み上がり、着地の直前に大きな rebase と衝突が出る。

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
