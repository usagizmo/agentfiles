#!/bin/sh
# PR を使わない面の統合先 ref を、無ければ origin/HEAD から作る。
#
# **作業 branch の「在れば checkout、無ければ統合先から作る」とは別名。**こちらは統合先
# そのものを作る。
#
# 作成と live の switch は別操作。switch が失敗しても、作った ref は戻さない。
# 在る ref は -f も reset もしない。
#
# usage: ensure-integration-ref.sh <checkout> <integration-ref>
#   <integration-ref> は `refs/heads/<name>`（座標表の値）。`origin/main` は受けない。

set -u

usage() {
  echo "usage: ensure-integration-ref.sh <checkout> <refs/heads/<name>>" >&2
  exit 2
}

[ $# -eq 2 ] || usage
CHECKOUT=$1
REF=$2

case "$REF" in
  refs/heads/*)
    SHORT=${REF#refs/heads/}
    [ -n "$SHORT" ] || usage
    ;;
  *)
    echo "[ensure-integration-ref] integration ref must be refs/heads/<name>: $REF" >&2
    exit 2
    ;;
esac

[ -d "$CHECKOUT" ] || {
  echo "[ensure-integration-ref] checkout is not a directory: $CHECKOUT" >&2
  exit 2
}

# GIT_DIR が効いていると -C が無視され、別の repo を触る。
# **repo-local な変数は git 自身に列挙させる。**手書きの allowlist は git が版で
# 増やすたびに漏れる。`GIT_CEILING_DIRECTORIES` は宣言に無いので合併する。
# **`GIT_AUTHOR_*` / `GIT_COMMITTER_*` は宣言に含まれない** —— ここは commit を作るので
# 落ちると author が変わる。
git_local_env_strip() {
  if [ -z "${GIT_ENV_STRIP:-}" ]; then
    GIT_ENV_STRIP="$(git rev-parse --local-env-vars |
      sed 's/^/-u /' | tr '\n' ' ')-u GIT_CEILING_DIRECTORIES"
  fi
  printf '%s' "$GIT_ENV_STRIP"
}

git_clean() {
  # 分割は意図的（`-u NAME` を並べる）
  # shellcheck disable=SC2086
  env $(git_local_env_strip) \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    GIT_ATTR_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    git "$@"
}

git_status() {
  git_clean -C "$CHECKOUT" \
    -c core.fsmonitor=false -c core.untrackedCache=false \
    -c status.showUntrackedFiles=all -c status.relativePaths=false \
    status --porcelain=v1 --untracked-files=all --ignore-submodules=none
}

origin_head_sha() {
  git_clean -C "$CHECKOUT" rev-parse --verify --quiet origin/HEAD
}

ensure_ref() {
  if git_clean -C "$CHECKOUT" show-ref --verify --quiet "$REF"; then
    echo "[ensure-integration-ref] exists $REF (unchanged)" >&2
    return 0
  fi
  sha=$(origin_head_sha) || {
    echo "[ensure-integration-ref] origin/HEAD is missing; not creating $REF" >&2
    return 1
  }
  # short name。full ref を git branch に渡すと refs/heads/refs/heads/<name> が生える。
  # -f も reset もしない。既存は上の show-ref で no-op。
  if git_clean -C "$CHECKOUT" branch -- "$SHORT" "$sha"; then
    echo "[ensure-integration-ref] created $REF from origin/HEAD $sha" >&2
    return 0
  fi
  # 競合で非 0。在れば成功扱い。無ければ作成失敗。
  if git_clean -C "$CHECKOUT" show-ref --verify --quiet "$REF"; then
    echo "[ensure-integration-ref] exists $REF (unchanged)" >&2
    return 0
  fi
  echo "[ensure-integration-ref] git branch failed; $REF was not created" >&2
  return 1
}

maybe_switch() {
  head_ref=$(git_clean -C "$CHECKOUT" symbolic-ref --quiet HEAD) || {
    echo "[ensure-integration-ref] skip switch: HEAD is detached" >&2
    return 0
  }
  origin_sym=$(git_clean -C "$CHECKOUT" symbolic-ref --quiet refs/remotes/origin/HEAD) || {
    echo "[ensure-integration-ref] skip switch: origin/HEAD is not a symbolic ref" >&2
    return 0
  }
  case "$origin_sym" in
    refs/remotes/origin/*) default_ref=refs/heads/${origin_sym#refs/remotes/origin/} ;;
    *)
      echo "[ensure-integration-ref] skip switch: cannot derive default from $origin_sym" >&2
      return 0
      ;;
  esac
  if [ "$head_ref" != "$default_ref" ]; then
    echo "[ensure-integration-ref] skip switch: HEAD is $head_ref (not $default_ref)" >&2
    return 0
  fi
  porcelain=$(git_status) || {
    echo "[ensure-integration-ref] skip switch: status unreadable" >&2
    return 0
  }
  if [ -n "$porcelain" ]; then
    echo "[ensure-integration-ref] skip switch: dirty" >&2
    return 0
  fi
  head_sha=$(git_clean -C "$CHECKOUT" rev-parse --verify --quiet HEAD) || {
    echo "[ensure-integration-ref] skip switch: HEAD sha unreadable" >&2
    return 0
  }
  ref_sha=$(git_clean -C "$CHECKOUT" rev-parse --verify --quiet "$REF") || {
    echo "[ensure-integration-ref] skip switch: $REF sha unreadable" >&2
    return 0
  }
  if [ "$head_sha" != "$ref_sha" ]; then
    echo "[ensure-integration-ref] skip switch: HEAD $head_sha != $REF $ref_sha" >&2
    return 0
  fi
  if git_clean -C "$CHECKOUT" switch -- "$SHORT"; then
    echo "[ensure-integration-ref] switched to $SHORT" >&2
    return 0
  fi
  echo "[ensure-integration-ref] switch failed; leaving $REF in place" >&2
  return 0
}

ensure_ref || exit 1
maybe_switch
exit 0
