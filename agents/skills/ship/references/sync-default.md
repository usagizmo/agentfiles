# ローカル default の同期

`$DEFAULT:$DEFAULT` 形式の fetch は default が worktree で checkout 中だと拒否されるため、
**default を checkout している worktree の中で ff merge する**:

```bash
DEFAULT=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
git fetch --prune origin
DEFAULT_WT=$(git worktree list --porcelain \
  | awk -v ref="branch refs/heads/$DEFAULT" '/^worktree /{wt=substr($0,10)} $0==ref{print wt}')
if [ -n "$DEFAULT_WT" ]; then
  git -C "$DEFAULT_WT" merge --ff-only "origin/$DEFAULT"
else
  git fetch origin "$DEFAULT:$DEFAULT"
fi
```

ff 不可（default worktree が dirty・分岐）ならローカル更新だけ skip して報告し、
rebase 等は `origin/$DEFAULT` 基準で続行する。
