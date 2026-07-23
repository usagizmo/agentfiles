---
name: pr
description: PR の作成は理由・きっかけを問わず必ずこの skill を経由する（`gh pr create` を直接実行しない）。
---

PR を作成し、auto-merge でマージされるまで面倒を見る。タイトル先頭に gitmoji。

## フロー

マージまで繰り返す:

1. **先行 PR 待ち + rebase**（毎回の push 直前）
   - 候補: 同一 repo・base が default の open PR のうち、自 `headRefName` 以外
   - **CI 進行中**の SSOT: `gh pr checks <number> --json bucket` のいずれかが `pending`（CheckRun / StatusContext の差は gh が正規化する）
   - **不変条件**: pending を一度でも見た候補は predecessor とし、その PR が `MERGED` または `CLOSED` になるまで待つ（checks が緑に戻っても open のままなら待ち続ける）。停滞・CI 失敗で進まなそうなら無限待ちせずユーザーに報告する
   - 待機は best-effort（他エージェントとの完全排他ではない）。解除後・push 直前に候補を再列挙し、新たな pending があれば同じ不変条件で待つ
   - クリア後（待機の有無に関わらず）: `git fetch --prune origin "$DEFAULT:$DEFAULT"` でローカル default も ff 前進させ（他 worktree で checkout 中など ff 不可ならローカル更新だけ skip して報告し、rebase は `origin/$DEFAULT` 基準）→ `git rebase "$DEFAULT"`。衝突は解消。tip が変わったら後続 push は `--force-with-lease`
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
4. auto-merge を有効化:
   ```
   gh pr merge --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{箇条書き body または空}"
   ```
5. `gh pr checks <number> --watch` で CI 完了までブロック。失敗したらログを見て修正・コミットし 1 に戻る
6. `gh pr view <number> --json state --jq .state` を 5 秒間隔で確認し、`MERGED` になったらマージ後へ。2 分超えたら auto-merge 不成立として原因を報告する

## マージ後

`git fetch --prune origin "$DEFAULT:$DEFAULT"` でローカル default を最新化し（マージコミットを取り込む）、マージした PR と変更の要点を報告する。

## タイトル / マージコミット

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。body はコミット群の箇条書き。不要なら `--body ""`。

auto-merge が使えない場合は CI pass 後に `--auto` なしで同じコマンドを実行する。
