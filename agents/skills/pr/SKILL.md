---
name: pr
description: >-
  ブランチの実装・検証完了後に PR を作成し auto-merge まで面倒を見る。
  ユーザーが「PR を作成して」と言ったとき、および仕上げが済み積み残しが無いときに実行する。
  他 PR の CI が回っていればマージ待ち → ローカル default を最新化して rebase のあと push する。
  マージ後はセッションまとめ（作成 Issue・積み残し・改善点）を出力する。
---

PR を作成し、auto-merge でマージされるまで面倒を見る。タイトル先頭に gitmoji。

## 事前確認

`/commit` まで完了した段階で、当初課題に対する積み残しを確認する。同スコープは追加実装。今回変更由来の回帰は Issue で消さず直す / スコープ縮小 / 撤回。Issue 切り離しは既存不具合・要件外・独立改善のみ。

ユーザー GO 後に PR 作成。内容確認済みで作成だけ指示されている場合は省略可。

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
5. 自 PR の CI を待つ。失敗したらログを見て修正・コミットし 1 に戻る

## マージ後

1. `git fetch --prune origin "$DEFAULT:$DEFAULT"` でローカル default を最新化（マージコミットを取り込む）
2. セッションまとめを出力する。含めるもの:
   - マージした PR と変更の要点
   - このセッションで作成した Issue（番号 + 一言）
   - 積み残し・懸念点（Issue 化していないものはその旨を明示）
   - 今後の改善につながる気づき（設計・運用・rules / skills への graduate 候補）

## タイトル / マージコミット

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji は `../commit/references/gitmoji.md`。`--subject` に `(#N)` を必ず付ける。body はコミット群の箇条書き。不要なら `--body ""`。

auto-merge が使えない場合は CI pass 後に `--auto` なしで同じコマンドを実行する。
