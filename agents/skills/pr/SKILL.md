---
name: pr
description: PR の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh pr create` を直接実行しない）。
---

PR を作り、**merge 可能な状態まで**持っていく。タイトル先頭に gitmoji。

## base — 順序はここだけで表す

**他の PR を待たない。**順序が要るなら base に書き、要らないなら順序は無い。

| その変更は | base | 結果 |
| --- | --- | --- |
| 未着地の PR の成果に依存する | **その PR の head ブランチ**（積み上げ） | 下から順にしか merge できない |
| 依存しない | default | 順序は無い。いつ merge してもよい |

**依存しないブランチを他のフィーチャーブランチへ rebase しない。**偽の依存が生まれ、
本来不要な直列化を招く。

**base の PR が既に着地しているなら、`gh pr edit <自分> --base "$DEFAULT"` で張り替えてから rebase する。**
親の head ブランチが残る運用では GitHub は base を付け替えないので、放置すると merge できない。

## フロー

CI が通るまで繰り返す:

1. **base へ rebase**（毎回の push 直前）。base が default なら `references/sync-default.md` で
   ローカル default を ff 前進させてから `git rebase "$DEFAULT"`。積み上げなら親の head へ rebase する。
   衝突は解消。tip が変わったら後続 push は `--force-with-lease`
2. 未同期なら `git push`（初回は `-u`。rebase 後は `--force-with-lease`）
3. PR が無ければ `gh pr create --base <base>`、あれば `gh pr edit` で title / body を更新
4. `gh pr checks <number> --watch` で CI 完了までブロック。失敗したらログを見て修正・コミットし 1 に戻る

CI が通ったら完了。**merge はここでしない。**

**CI 進行中の SSOT**: `gh pr checks <number> --json bucket` のいずれかが `pending`
（CheckRun / StatusContext の差は gh が正規化する）。素の人間向け出力を読まない。

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
