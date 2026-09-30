#!/bin/sh
# どの worktree にも checkout されていない統合先へ、木に触れず ref だけで着地する。
#
# checkout が無ければ、その木を読む者も居ない。switch も merge の作業木も要らない。
# 形は SKILL.md の本数の表と同じ（0 = しない / 1 = ff / 2 以上 = merge commit）。
# merge commit の木は対象の木そのもの（統合先が対象の祖先なので衝突しない）。
# 更新は update-ref の比較更新。読んだあとに統合先が動いていたら書かない。
# commit-tree は hook を走らせない。commit.gpgSign は効く。
#
# usage: land-ref.sh <repo> <refs/heads/<name>> <target> [<message>]
#   <message> は 2 本以上のときだけ必須。1 本以下では渡さない。
#
# exit: 0 = 着地した、または 0 本 / 1 = 前提を満たさない（何も書かない） / 2 = usage

set -u

usage() {
  echo "usage: land-ref.sh <repo> <refs/heads/<name>> <target> [<message>]" >&2
  exit 2
}

[ $# -eq 3 ] || [ $# -eq 4 ] || usage
REPO=$1
REF=$2
TARGET=$3
MESSAGE=${4-}
HAS_MESSAGE=$(($# == 4))

case "$REF" in
  refs/heads/?*) ;;
  *)
    echo "[land-ref] integration ref must be refs/heads/<name>: $REF" >&2
    exit 2
    ;;
esac

# GIT_DIR が効いていると -C が無視され、別の repo を触る（ensure-integration-ref.sh と同じ）。
# `GIT_AUTHOR_*` / `GIT_COMMITTER_*` は宣言に含まれない —— commit を作るので残す。
for git_env_var in $(git rev-parse --local-env-vars) GIT_CEILING_DIRECTORIES; do
  unset "$git_env_var"
done

g() {
  git -C "$REPO" "$@"
}

die() {
  echo "[land-ref] $1" >&2
  exit 1
}

old=$(g rev-parse --verify --quiet "$REF^{commit}") || die "$REF is missing"
new=$(g rev-parse --verify --quiet "$TARGET^{commit}") || die "target is not a commit: $TARGET"

# prunable な entry も checkout に数える。消えた木か判別できないものは読む者が居る側へ倒す。
worktrees=$(g worktree list --porcelain) || die "worktree list failed"
if printf '%s\n' "$worktrees" | grep -Fqx "branch $REF"; then
  die "$REF is checked out; land in that checkout with git merge"
fi

g merge-base --is-ancestor "$old" "$new" || die "$REF is not an ancestor of $TARGET; rebase first"

count=$(g rev-list --count "$old..$new") || die "rev-list failed"

case "$count" in
  0)
    [ "$HAS_MESSAGE" -eq 0 ] || usage
    echo "[land-ref] nothing to land: $REF already contains $TARGET" >&2
    exit 0
    ;;
  1)
    [ "$HAS_MESSAGE" -eq 0 ] || usage
    landed=$new
    ;;
  *)
    if [ "$HAS_MESSAGE" -ne 1 ] || [ -z "$MESSAGE" ]; then usage; fi
    tree=$(g rev-parse --verify --quiet "$new^{tree}") || die "tree unreadable: $TARGET"
    landed=$(printf '%s\n' "$MESSAGE" | g commit-tree "$tree" -p "$old" -p "$new") ||
      die "commit-tree failed"
    ;;
esac

g update-ref -m "land-ref: $TARGET" "$REF" "$landed" "$old" || die "$REF moved; nothing written"
echo "[land-ref] $REF $old -> $landed ($count commit(s))" >&2
