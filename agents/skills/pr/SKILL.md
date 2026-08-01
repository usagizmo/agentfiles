---
name: pr
description: PR の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh pr create` を直接実行しない）。
---

PR を作り、**merge 可能な状態まで**持っていく。タイトル先頭に gitmoji。

## フロー

CI が通るまで繰り返す:

1. **先行 PR 待ち + rebase**（毎回の push 直前）
   - **着地の順番が外から与えられている場合はこの待ちを省く**（二重待ちになるため）。rebase は行う
   - 候補: 同一 repo・base が default の open PR のうち、自 `headRefName` 以外
   - **CI 進行中**の SSOT: `gh pr checks <number> --json bucket` のいずれかが `pending`（CheckRun / StatusContext の差は gh が正規化する）
   - **不変条件**: pending を一度でも見た候補は predecessor とし、その PR が `MERGED` または `CLOSED` になるまで待つ（checks が緑に戻っても open のままなら待ち続ける）。停滞・CI 失敗で進まなそうなら無限待ちせずユーザーに報告する
   - 待機は best-effort（他エージェントとの完全排他ではない）。解除後・push 直前に候補を再列挙し、新たな pending があれば同じ不変条件で待つ
   - クリア後（待機の有無に関わらず）: `references/sync-default.md` でローカル default を ff 前進させ、`git rebase "$DEFAULT"`。衝突は解消。tip が変わったら後続 push は `--force-with-lease`
   ```bash
   DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   HEAD=$(git branch --show-current)
   for n in $(gh pr list --base "$DEFAULT" --state open --json number,headRefName \
     | jq -r --arg h "$HEAD" '.[] | select(.headRefName != $h) | .number'); do
     gh pr checks "$n" --json bucket --jq 'any(.[]; .bucket == "pending")' \
       | grep -qx true && echo "predecessor #$n"
   done
   # 解除: gh pr view <n> --json state --jq .state  → MERGED | CLOSED
   ```
2. 未同期なら `git push`（初回は `-u`。rebase 後は `--force-with-lease`）
3. PR が無ければ `gh pr create`、あれば `gh pr edit` で title / body を更新
4. `gh pr checks <number> --watch` で CI 完了までブロック。失敗したらログを見て修正・コミットし 1 に戻る

CI が通ったら完了。**merge はここでしない。**

## Body / Issue 連携

解決した Issue は closing keyword で紐付ける。**キーワードは番号ごとに必要**:

- ✅ `Closes #101, closes #102, closes #103`（1 行 1 keyword に分けても良い）
- ❌ `Closes #101, #102, #103` — 先頭の #101 しかリンクされず、残りは merge 後も open で取り残される

部分対応に留まる Issue は closing keyword を使わず `Refs #101` 等の参照にする。

## タイトル

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。
