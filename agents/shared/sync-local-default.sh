#!/usr/bin/env bash
# ローカル default を origin の同名へ ff する。
#
# 使い方: sync-local-default.sh [<base>]   （省略時は repo の default branch）
# checkout 中の worktree があればその中で ff merge する。
# checkout 中なら `${base}:${base}` 形式の fetch は使わない。
# ff 不可ならローカル更新だけ skip する。
set -euo pipefail

base="${1:-}"
if [ -z "$base" ]; then
  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
fi

git fetch --prune origin

default_wt=$(git worktree list --porcelain |
  awk -v ref="branch refs/heads/${base}" '/^worktree /{wt=substr($0,10)} $0==ref{print wt}')
if [ -n "$default_wt" ]; then
  git -C "$default_wt" merge --ff-only "origin/${base}" >/dev/null 2>&1 ||
    echo "sync-local-default: ローカル ${base} の ff は skip（dirty か分岐）。origin/${base} 基準で続行" >&2
else
  git fetch origin "${base}:${base}" >/dev/null 2>&1 || true
fi
