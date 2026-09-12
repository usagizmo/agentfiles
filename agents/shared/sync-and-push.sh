#!/usr/bin/env bash
# base へ追随してから、origin の同名 branch へ push する。
#
# 使い方: sync-and-push.sh [<base>]   （省略時は repo の default branch）
# 素の `git push` は使わない。宛先は常に origin の refs/heads/<branch>。
# 暗黙の宛先は使わない。base 自身へは送らない。空範囲では push しない。
set -euo pipefail

base="${1:-}"
if [ -z "$base" ]; then
  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
fi

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" = "$base" ]; then
  echo "sync-and-push: base 自身 (${base}) には push しない" >&2
  exit 1
fi

dest="refs/heads/${branch}"

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
"$DIR/sync-local-default.sh" "$base"

before=$(git rev-list --count "HEAD..origin/${base}")
git rebase "origin/${base}"

if [ "$before" -gt 0 ]; then
  echo "sync-and-push: origin/${base} に ${before} commit 遅れていたので追随した"
fi

remote_tip=$(git rev-parse --verify --quiet "refs/remotes/origin/${branch}" || true)
if [ -n "$remote_tip" ] && [ "$(git rev-parse HEAD)" = "$remote_tip" ]; then
  echo "sync-and-push: origin/${branch} と同じなので push しない"
  git branch --set-upstream-to="origin/${branch}"
  exit 0
fi

if [ -n "$remote_tip" ]; then
  lease="${dest}"
else
  lease="${dest}:"
fi

echo "sync-and-push: origin の ${dest} へ push する" >&2
if ! git push --force-with-lease="${lease}" --set-upstream origin "HEAD:${dest}"; then
  echo "sync-and-push: origin の ${dest} への push に失敗した" >&2
  exit 1
fi
