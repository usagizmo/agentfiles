#!/usr/bin/env bash
# merged PR の head を後始末する。
#
# 使い方: retire-head.sh <pr-number>
#
# 消すのは worktree と local branch と origin の head branch。消す条件はこの script が持つ。
# 検証を全部通してから消す。1 つでも欠けたら何も消さない。
#
# 木に herdr の workspace が紐づいていたら、消したあとその workspace も閉じる。
# 自分が立っている worktree は消さない。cwd が宙に浮く。
#
# 例外は木を消したあとの失敗。workspace の id を引き直せないので呼び直しでは回収できず、
# 閉じ方は木を消した直後にログへ出す。
#
# 対象が既に無い巡は rc=0 で終わる。片方だけ消えた状態から呼び直せる。
set -euo pipefail

usage() {
  echo "usage: retire-head.sh <pr-number>" >&2
  exit 2
}

[ $# -eq 1 ] || usage
pr="$1"

say() { echo "retire-head: $*" >&2; }

fields=$(gh pr view "$pr" --json state,headRefName,baseRefName,headRepositoryOwner,headRepository \
  --jq '[.state, .headRefName, .baseRefName, (.headRepositoryOwner.login + "/" + .headRepository.name)] | @tsv')
IFS=$'\t' read -r state head base head_repo <<EOF
${fields}
EOF

if [ "$state" != "MERGED" ]; then
  say "PR #${pr} は ${state}。MERGED ではないので何もしない"
  exit 1
fi

origin_repo=$(gh repo view --json owner,name --jq '.owner.login + "/" + .name')
if [ "$head_repo" != "$origin_repo" ]; then
  say "PR #${pr} の head は ${head_repo}。origin (${origin_repo}) に消す対象は無い"
  exit 0
fi

if [ "$head" = "$base" ]; then
  say "head と base が同じ (${head})。消さない"
  exit 1
fi

git fetch --prune origin

# 消してよいのは origin/<base> の祖先だけ。local と origin/<head> は別々に見る。
# merge のあとに origin/<head> へ載った commit は、local からは観測できない。
merged_into_base() {
  git merge-base --is-ancestor "$1" "refs/remotes/origin/${base}"
}

# 消す木に herdr の workspace が紐づいていたら、その id を返す。
# 在処は herdr 自身の inventory に聞く。env の有無や自己申告では判定しない。
# 返り値: 0 = 見つかった（id を stdout へ）、1 = 紐づく workspace が無い、2 = 引けない。
herdr_workspace_of() {
  command -v herdr >/dev/null 2>&1 || return 1
  inventory=$(herdr worktree list --cwd "$2" 2>/dev/null) || return 2
  printf '%s' "$inventory" | python3 -c '
import json, os, sys
target = os.path.realpath(sys.argv[1])
found = ""
try:
    worktrees = json.load(sys.stdin)["result"]["worktrees"]
    if worktrees is None:
        worktrees = []
    if not isinstance(worktrees, list):
        raise TypeError(worktrees)
    for wt in worktrees:
        if not wt.get("is_linked_worktree"):
            continue
        if os.path.realpath(os.path.expanduser(wt.get("path") or "")) != target:
            continue
        ws = wt.get("open_workspace_id")
        if ws is None:
            continue
        if not isinstance(ws, str) or not ws:
            raise TypeError(ws)
        found = ws
        break
except Exception:
    sys.exit(2)
if not found:
    sys.exit(1)
sys.stdout.write(found)
' "$1"
}

close_workspace() {
  if herdr workspace close "$1" >/dev/null 2>&1; then
    say "workspace $1 を閉じた"
  else
    say "workspace $1 を閉じられなかった。herdr workspace close $1 を手で通す"
    exit 1
  fi
}

local_tip=$(git rev-parse --verify --quiet "refs/heads/${head}" || true)
remote_tip=$(git rev-parse --verify --quiet "refs/remotes/origin/${head}" || true)

if [ -n "$local_tip" ] && ! merged_into_base "$local_tip"; then
  say "local ${head} が origin/${base} の祖先でない。消さない"
  exit 1
fi
if [ -n "$remote_tip" ] && ! merged_into_base "$remote_tip"; then
  say "origin/${head} が origin/${base} の祖先でない。消さない"
  exit 1
fi

# 1 つの木は `worktree <path>` で始まり、その中に `branch <ref>` が来る。
worktree_of_head=$(git worktree list --porcelain |
  awk -v ref="branch refs/heads/${head}" '/^worktree /{wt=substr($0,10)} $0==ref{found=wt} END{print found}')
main_worktree=$(git worktree list --porcelain | awk '/^worktree /{if (!m) m=substr($0,10)} END{print m}')

if [ -n "$worktree_of_head" ]; then
  if [ "$worktree_of_head" = "$main_worktree" ]; then
    say "${head} は main worktree (${worktree_of_head}) に checkout されている。消さない"
    exit 1
  fi
  cwd=$(pwd -P)
  case "${cwd}/" in
    "${worktree_of_head}"/*)
      say "cwd が ${worktree_of_head} の中にある。消すと cwd が宙に浮く"
      say "${main_worktree} へ移ってから呼び直す"
      exit 1
      ;;
  esac
fi

if [ -z "$worktree_of_head" ] && [ -z "$local_tip" ] && [ -z "$remote_tip" ]; then
  say "PR #${pr} の head (${head}) に消す対象は無い"
  exit 0
fi

if [ -n "$worktree_of_head" ]; then
  # id は消す前に取る。消えた木は herdr の inventory から外れる。
  workspace=$(herdr_workspace_of "$worktree_of_head" "$main_worktree") && lookup_rc=0 || lookup_rc=$?
  case $lookup_rc in
  0) ;;
  1) workspace="" ;;
  *)
    say "herdr の inventory を引けない。workspace の紐づきを判定できないので消さない"
    exit 1
    ;;
  esac
  # --force を渡さない。dirty な木は残す。
  git worktree remove "$worktree_of_head"
  say "worktree ${worktree_of_head} を消した"
  # 消したあとは id を引き直せない。ここから先の異常終了に備えて復旧コマンドを出す。
  if [ -n "$workspace" ]; then
    say "閉じる workspace は ${workspace}。異常終了したら herdr workspace close ${workspace} を手で通す"
  fi
fi

if [ -n "$local_tip" ]; then
  # -D は HEAD と upstream に依存しない。祖先判定は上で済ませてある。
  git branch -D "$head" >/dev/null
  say "local ${head} を消した"
fi

if [ -n "$remote_tip" ]; then
  git push --force-with-lease="refs/heads/${head}:${remote_tip}" origin ":refs/heads/${head}"
  say "origin/${head} を消した"
fi

# 自分の workspace でも閉じる。
if [ -n "${workspace:-}" ]; then
  close_workspace "$workspace"
fi
