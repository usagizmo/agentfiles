#!/usr/bin/env bash
# auto-merge を有効化した PR の merge を待つ。BEHIND への追随も持つ。
#
# 使い方: wait-merge.sh <pr-number>
#
# stdout は終端の理由 1 語だけ。終了コードで分岐する:
#   merged 0 / error 1 / closed 3 / behind-limit 4 / timeout 5 / checks-failed 6 / conflict 7
# 追随コマンドの出力と error の原文は stderr。
#
# 時刻は parse しない。追随後の起点は ISO 文字列で持って completedAt と辞書順で比べ、経過は epoch 秒の差で計る。
set -uo pipefail

usage() {
  echo "usage: wait-merge.sh <pr-number>" >&2
  exit 2
}

[ $# -eq 1 ] || usage
pr="$1"

# rate limit（REST・GraphQL とも 5,000 / 時）は同じ user の全 session で共有する。
INTERVAL=30
GRACE=120
MAX_SYNCS=3
MAX_READ_FAILS=3

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

finish() {
  echo "$1"
  exit "$2"
}

say() { echo "wait-merge: $*" >&2; }

ERR=$(mktemp) || finish error 1
trap 'rm -f "$ERR"' EXIT

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
now_s() { date -u +%s; }

# 待機の起点。最後に head を動かした時刻（開始時は開始時刻）。
# 開始時の head は動いていないので、開始前に完了した checks も現 head のもの。completedAt で弾くのは追随の後だけ。
mark_start() {
  start_iso="$1"
  start_s=$(now_s)
  done_s=""
}

# head を PR の base へ追随させる。自分の worktree の PR だけ local を動かし、他 session の local は触らない。
sync_head() {
  local head_ref="$1" base_ref="$2" branch
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$branch" = "$head_ref" ]; then
    "$DIR/sync-and-push.sh" "$base_ref" >&2
  else
    gh pr update-branch "$pr" --rebase >&2
  fi
}

mark_start ""
syncs=0
synced_from=""
view_fails=0
compare_fails=0
checks_fails=0

while :; do
  # 一時失敗はその回を読み飛ばす。連続したら error。
  # 毎回の読み出しは REST。GraphQL の rate limit を pr checks だけに残す。
  if ! view=$(gh api "repos/{owner}/{repo}/pulls/${pr}" \
    --jq '[(if .merged_at then "MERGED" elif .state == "closed" then "CLOSED" else "OPEN" end),
      ((.mergeable_state // "unknown") | ascii_upcase), .head.sha, .head.ref, .base.ref] | @tsv' 2>"$ERR") || [ -z "$view" ]; then
    view_fails=$((view_fails + 1))
    if [ "$view_fails" -ge "$MAX_READ_FAILS" ]; then
      say "PR #${pr} が ${view_fails} 回続けて読めない: $(cat "$ERR")"
      finish error 1
    fi
    sleep "$INTERVAL"
    continue
  fi
  view_fails=0
  IFS=$'\t' read -r state merge_state head_oid head_ref base_ref <<<"$view"

  case "$state" in
  MERGED) finish merged 0 ;;
  CLOSED) finish closed 3 ;;
  esac

  case "$merge_state" in
  DIRTY) finish conflict 7 ;;
  BEHIND)
    # 追随するのは現 head が base の tip より遅れていて、その head からまだ追随していないときだけ。
    # 遅れていない BEHIND は GitHub の再計算待ち、追随元と同じ head の BEHIND は追随の反映待ちで、
    # どちらも起点から GRACE で打ち切る。baseRefOid は head 更新時点の base なので使わない。
    if ! behind=$(gh api "repos/{owner}/{repo}/compare/${base_ref}...${head_oid}" --jq .behind_by 2>"$ERR") ||
      [ -z "$behind" ]; then
      compare_fails=$((compare_fails + 1))
      if [ "$compare_fails" -ge "$MAX_READ_FAILS" ]; then
        say "${base_ref}...${head_oid} の compare が ${compare_fails} 回続けて読めない: $(cat "$ERR")"
        finish error 1
      fi
      sleep "$INTERVAL"
      continue
    fi
    compare_fails=0
    if [ "$behind" -gt 0 ] && [ "$head_oid" != "$synced_from" ]; then
      syncs=$((syncs + 1))
      [ "$syncs" -le "$MAX_SYNCS" ] || finish behind-limit 4
      # 起点の時刻は追随の前に取る。push 直後に完了した check の completedAt が起点より後になる。
      sync_iso=$(now_iso)
      if ! sync_head "$head_ref" "$base_ref"; then
        say "PR #${pr} の追随に失敗した"
        finish error 1
      fi
      synced_from="$head_oid"
      mark_start "$sync_iso"
    elif [ $(($(now_s) - start_s)) -ge "$GRACE" ]; then
      finish timeout 5
    fi
    sleep "$INTERVAL"
    continue
    ;;
  esac

  # gh pr checks は pending / fail / required 無しでも非 0 を返す。終了コードではなく出力で読む。
  # 出力が空で required 無しの文言でもなければ一時失敗として読み飛ばす。
  checks=$(gh pr checks "$pr" --required --json bucket,completedAt \
    --jq '.[] | [.bucket, .completedAt] | @tsv' 2>"$ERR") || true
  if [ -z "$checks" ] && ! grep -Eq 'no (required )?checks reported' "$ERR"; then
    checks_fails=$((checks_fails + 1))
    if [ "$checks_fails" -ge "$MAX_READ_FAILS" ]; then
      say "gh pr checks ${pr} が ${checks_fails} 回続けて読めない: $(cat "$ERR")"
      finish error 1
    fi
    sleep "$INTERVAL"
    continue
  fi
  checks_fails=0

  complete=1
  while IFS=$'\t' read -r bucket completed_at; do
    [ -n "$bucket" ] || continue
    case "$bucket" in
    fail | cancel) finish checks-failed 6 ;;
    skipping) ;;
    pass)
      # 旧 SHA の完了済み checks で計時を始めない。
      [[ "$completed_at" > "$start_iso" ]] || complete=0
      ;;
    *) complete=0 ;;
    esac
  done <<<"$checks"

  if [ "$complete" -eq 1 ]; then
    if [ -z "$checks" ]; then
      done_s="$start_s"
    elif [ -z "$done_s" ]; then
      done_s=$(now_s)
    fi
    [ $(($(now_s) - done_s)) -lt "$GRACE" ] || finish timeout 5
  else
    done_s=""
  fi

  sleep "$INTERVAL"
done
