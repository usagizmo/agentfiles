---
name: pr
description: >-
  ブランチの実装・検証完了後に PR を作成し auto-merge まで面倒を見る。
  ユーザーが「PR を作成して」と言ったとき、および仕上げが済み積み残しが無いときに実行する。
  他 PR の CI が回っていればマージ待ち → default へ rebase のあと push する。
---

PR を作成し、auto-merge でマージされるまで面倒を見る。タイトル先頭に gitmoji。

## 事前確認

`/commit` まで完了した段階で、当初課題に対する積み残しを確認する。同スコープは追加実装。今回変更由来の回帰は Issue で消さず直す / スコープ縮小 / 撤回。Issue 切り離しは既存不具合・要件外・独立改善のみ。

ユーザー GO 後に PR 作成。内容確認済みで作成だけ指示されている場合は省略可。

## フロー

マージまで繰り返す:

1. **先行 PR 待ち + rebase**（毎回の push 直前）
   - 対象: 同一 repo・base が default の open PR のうち、自 `headRefName` 以外
   - CI 進行中 = `statusCheckRollup[].status` が `IN_PROGRESS` / `QUEUED` / `PENDING` のいずれか
   - 進行中の PR があれば、それが `MERGED` または `CLOSED` になるまで待つ。停滞・CI 失敗で進まなそうなら無限待ちせずユーザーに報告する
   - クリア後（待機の有無に関わらず）: `git fetch origin` → `git rebase origin/<default>`。衝突は解消。tip が変わったら後続 push は `--force-with-lease`
   ```bash
   DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
   HEAD=$(git branch --show-current)
   gh pr list --base "$DEFAULT" --state open --json number,headRefName,statusCheckRollup \
     | jq --arg h "$HEAD" '.[] | select(.headRefName != $h)'
   # 詳細: gh pr view <number> --json state,statusCheckRollup
   ```
2. 未同期なら `git push`（初回は `-u`。rebase 後は `--force-with-lease`）
3. PR が無ければ `gh pr create`、あれば `gh pr edit` で title / body を更新
4. auto-merge を有効化:
   ```
   gh pr merge --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{箇条書き body または空}"
   ```
5. 自 PR の CI を待つ。失敗したらログを見て修正・コミットし 1 に戻る

## タイトル / マージコミット

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。body はコミット群の箇条書き。不要なら `--body ""`。

auto-merge が使えない場合は CI pass 後に `--auto` なしで同じコマンドを実行する。
