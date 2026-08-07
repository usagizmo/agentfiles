#!/usr/bin/env bash
# base へ追随してから push する。
#
# **素の `git push` を使わない理由**: 追随は「毎回の push 直前」に要るが、手順として書くと
# 飛ばせてしまう。とくに CI が緑になったあとの追加 commit で飛びやすい（もう終わったつもりになる）。
# 飛ばすと base から離れたまま積み上がり、着地直前に大きな rebase と衝突が出る。
#
# 使い方: sync-and-push.sh [<base>]   （省略時は repo の default branch）
set -euo pipefail

base="${1:-}"
if [ -z "$base" ]; then
  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "$base" ]; then
  echo "sync-and-push: base 自身（$base）には push しない" >&2
  exit 1
fi

git fetch --prune origin

before=$(git rev-list --count "HEAD..origin/$base")

# default が別 worktree で checkout 中だと `$base:$base` 形式の fetch は拒否されるので、
# その worktree の中で ff merge する。
default_wt=$(git worktree list --porcelain |
  awk -v ref="branch refs/heads/$base" '/^worktree /{wt=substr($0,10)} $0==ref{print wt}')
if [ -n "$default_wt" ]; then
  git -C "$default_wt" merge --ff-only "origin/$base" >/dev/null 2>&1 ||
    echo "sync-and-push: ローカル $base の ff は skip（dirty か分岐）。origin/$base 基準で続行" >&2
else
  git fetch origin "$base:$base" >/dev/null 2>&1 || true
fi

git rebase "origin/$base"

if [ "$before" -gt 0 ]; then
  echo "sync-and-push: origin/$base に $before commit 遅れていたので追随した"
fi

# rebase で tip が書き換わりうるので、upstream があるなら常に --force-with-lease。
# 他人の push を黙って潰さないための lease であって、強制上書きではない。
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
  # **差が無いなら push しない。**push 範囲が空だと pre-push hook が範囲を取れずに
  # fail-closed する repo があり、「追随だけしたい」ときに毎回落ちる。
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse '@{upstream}')" ]; then
    echo "sync-and-push: upstream と同じなので push しない"
    exit 0
  fi
  git push --force-with-lease
else
  git push -u origin "$branch"
fi
