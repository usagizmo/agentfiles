#!/bin/bash
# conductor の起床監視。正規化と action が読むものすべての指紋を取り、前回と違ったら exit 0 する。
#
# **この実装が観測の SSOT。**手順書（`../references/harness.md`）は起動の契約だけを持ち、
# ここと同等物を prose から書き直さない。
#
# 終了コード
#   0  起こす（変化を検知した / fallback / 観測不能が続いた）
#   2  起動を止める（引数不足・コスト gate 超過）
set -uo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: watch.sh --repo <path> --gh-repo <owner/name>
                --project-org <org> --project-number <n> --status-field <name>
                --sessions-cmd <cmd> --workspaces-cmd <cmd>
                [--default-branch main] [--interval 120] [--max 1800]
                [--deadline 90] [--cost-limit 20] [--pr-limit 200]

  --sessions-cmd / --workspaces-cmd は multiplexer 依存なので呼び出し側が渡す
  （このスクリプトは multiplexer を知らない）。契約:

    - 整列済みの行を stdout に出す
    - **取得に失敗したら非 0 で終わる**
    - **空になり得ない一覧なら、空のときも非 0 で終わる**（`| grep .` を末尾に付ける等）。
      「exit 0 で空」は実際に起きる。握りつぶすと「全部消えた」に見えて誤起床する
USAGE
  exit 2
}

REPO=''
GH_REPO=''
ORG=''
NUM=''
STATUS_FIELD=''
SESSIONS_CMD=''
WORKSPACES_CMD=''
DEFAULT_BRANCH=main
INTERVAL=120
MAX=1800
DEADLINE=90
COST_LIMIT=20
PR_LIMIT=200

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO=$2; shift 2 ;;
    --gh-repo) GH_REPO=$2; shift 2 ;;
    --project-org) ORG=$2; shift 2 ;;
    --project-number) NUM=$2; shift 2 ;;
    --status-field) STATUS_FIELD=$2; shift 2 ;;
    --sessions-cmd) SESSIONS_CMD=$2; shift 2 ;;
    --workspaces-cmd) WORKSPACES_CMD=$2; shift 2 ;;
    --default-branch) DEFAULT_BRANCH=$2; shift 2 ;;
    --interval) INTERVAL=$2; shift 2 ;;
    --max) MAX=$2; shift 2 ;;
    --deadline) DEADLINE=$2; shift 2 ;;
    --cost-limit) COST_LIMIT=$2; shift 2 ;;
    --pr-limit) PR_LIMIT=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

for v in REPO GH_REPO ORG NUM STATUS_FIELD SESSIONS_CMD WORKSPACES_CMD; do
  [ -n "${!v}" ] || { echo "missing option for ${v}" >&2; usage; }
done
# 数値引数は先に弾く。文字列が混ざると算術評価が壊れ、**sleep が 0 になって暴走するか、
# fallback の判定が常に偽になって永久に起きない**。
# **0 も弾く。**`--deadline 0` は即 kill、`--pr-limit 0` は常に打ち切り、`--max 0` は毎周 fallback で、
# どれも黙って観測を壊す。
for v in NUM INTERVAL MAX DEADLINE COST_LIMIT PR_LIMIT; do
  case "${!v}" in ''|*[!0-9]*|0) echo "${v} must be a positive integer: ${!v}" >&2; usage ;; esac
done

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
QUERY_FILE="$DIR/project-status.graphql"
[ -f "$QUERY_FILE" ] || { echo "not found: $QUERY_FILE" >&2; exit 2; }

# 起動のたびに使い捨てる。**起動直後に必ず再ベースラインを取る**設計なので、
# 前回の snapshot を残しても比較される前に上書きされる（残すと watcher 起動のたびに散らかる）。
STATE_DIR=$(mktemp -d) || exit 2
PREV="$STATE_DIR/snapshot.prev"
CUR="$STATE_DIR/snapshot.cur"
# 1 周の GraphQL コスト（自分のクエリの申告値。`graphql.used` の差分は並走セッション分が混ざる）。
# **snapshot は background で走らせる**ので、変数では親へ返らない。ファイルで渡す。
COST_FILE="$STATE_DIR/cost"

# **ラウンドの有効判定は「各取得の成功可否」。**「非空 = 成功」にすると、正当に空になる一覧
# （open PR が無い等）を毎回失敗と読む。ただし**空になり得ない一覧が空で返るのは失敗**で、
# これは exit 0 で起きるため成功可否だけでは捕まらない。両方要る。
#
# 非空を要求するのは**構造的に空になり得ないもの**だけ —— Project の item、default の SHA、
# remote branch、worktree。**issue とコメントには要求しない**（新しい repo では正当に 0 件で、
# そこで失敗にすると watcher が永久に起きない。**盲目になる方が誤受理より重い**）。
require_nonempty() {
  [ -n "$2" ] && return 0
  echo "[watch] section '$1' came back empty (must never be): treating the round as failed" >&2
  return 1
}

snapshot() {
  local proj_json proj issues comments sessions workspaces prs pr_count
  local default branches wt_raw worktrees page_cost

  proj_json=$(gh api graphql --paginate \
    -F org="$ORG" -F num="$NUM" -F status="$STATUS_FIELD" \
    -f query="$(cat "$QUERY_FILE")") || return 1

  page_cost=$(printf '%s' "$proj_json" | jq -s '[.[].data.rateLimit.cost] | add // 0') || return 1
  printf '%s\n' "$page_cost" > "$COST_FILE"

  # **ボード上の並び順が選出の tiebreaker** なので、番号で sort し直さず API の返却順に index を振る。
  proj=$(printf '%s' "$proj_json" | jq -r '
      .data.organization.projectV2.items.nodes[]
      | select(.content.number != null)
      | "\(.content.number) \(.fieldValueByName.name // "-")"' | nl -ba -w1 -s' ') || return 1
  require_nonempty "project status" "$proj" || return 1

  # REST（0 pt）。`gh issue list --limit N` は N を超えると**不完全なまま非 0 件で返る**ので使わない。
  # REST の issues は PR も返すため `.pull_request` で落とす。
  issues=$(gh api "repos/$GH_REPO/issues?state=all&per_page=100" --paginate --jq '
      .[] | select(.pull_request == null)
      | "\(.number) \(.state) \(.updated_at) \([.assignees[].login] | sort | join(","))"') || return 1
  issues=$(printf '%s\n' "$issues" | sort -n)

  # marker コメントの変化で起床する。upsert は必ず `updated_at` を更新するので、
  # `sort=updated` の窓に必ず入る。marker 名まで指紋に入れる（新設・消滅がそのまま digest に出る）。
  comments=$(gh api "repos/$GH_REPO/issues/comments?sort=updated&direction=desc&per_page=100" --jq '
      .[] | "\(.id) \(.updated_at) \([.body | scan("<!-- (plan|claim|wait|retry|ready) -->")] | flatten | join(","))"') || return 1
  comments=$(printf '%s\n' "$comments" | sort)

  sessions=$(eval "$SESSIONS_CMD") || return 1
  workspaces=$(eval "$WORKSPACES_CMD") || return 1

  # open PR は正当に 0 件になりうるので非空を要求しない。ただし**打ち切ったラウンドは失敗にする** ——
  # 上限外の PR の checks 変化は指紋に出ず、`提出中` → `着地待ち` が永久に起きない。
  # 不完全な一覧を baseline として受理する方が、ラウンドを捨てるより重い。
  prs=$(gh pr list --repo "$GH_REPO" --state open --limit "$PR_LIMIT" \
    --json number,headRefName,state,isDraft,statusCheckRollup --jq '
      .[] | "\(.number) \(.headRefName) \(.state) draft=\(.isDraft) checks=\([.statusCheckRollup[]? | (.conclusion // .state)] | sort | join(","))"') || return 1
  pr_count=$(printf '%s' "$prs" | grep -c . || true)
  if [ "$pr_count" -ge "$PR_LIMIT" ]; then
    echo "[watch] open PR が --pr-limit ${PR_LIMIT} に達した: 一覧が不完全なのでこのラウンドを捨てる" >&2
    return 1
  fi
  prs=$(printf '%s\n' "$prs" | sort -n)

  # **fetch の失敗でラウンドを無効にする。**握りつぶすと古い origin/<default> を有効な観測として使う。
  git -C "$REPO" fetch origin --prune --quiet || return 1
  default=$(git -C "$REPO" rev-parse "origin/$DEFAULT_BRANCH") || return 1
  require_nonempty default "$default" || return 1
  branches=$(git -C "$REPO" branch -r --list 'origin/*' | sed 's/^ *//' | sort) || return 1
  require_nonempty branches "$branches" || return 1

  wt_raw=$(git -C "$REPO" worktree list --porcelain) || return 1
  # path は空白を含みうるので `awk '{print $2}'` で切らない。
  # 個々の worktree が壊れていてもラウンドを無効にせず `-` を出す —— 恒久的に壊れた checkout 1 つで
  # **全 tick を盲目にする**方が重い。値が変わるので conductor は 1 度起きて異常を見られる。
  worktrees=$(printf '%s\n' "$wt_raw" | sed -n 's/^worktree //p' | sort | while IFS= read -r p; do
      d=0
      [ -n "$(git -C "$p" status --porcelain=v1 2>/dev/null | head -1)" ] && d=1
      h=$(git -C "$p" rev-parse HEAD 2>/dev/null) || h='-'
      printf '%s %s %s\n' "$p" "$d" "${h:--}"
    done)
  require_nonempty worktrees "$worktrees" || return 1

  cat <<SNAP
--- default ---
$default
--- remote branches ---
$branches
--- worktrees + dirty(0/1) ---
$worktrees
--- sessions ---
$sessions
--- workspaces ---
$workspaces
--- project status (board order) ---
$proj
--- issues ---
$issues
--- recent issue comments ---
$comments
--- PRs ---
$prs
SNAP
}

# **外部コマンドがハングしたら観測失敗として扱う。**deadline が無いと、`gh` や `git fetch` が
# 固まった瞬間に fallback 起床の判定にも到達せず、**永久に起きない**（起床漏れが最も重い障害）。
#
# **process group ごと落とす。**`pkill -P` は直下の子しか殺さないので、command substitution や
# pipeline の下にいる `gh` / `git` が孫として孤児化し、lock や接続を握ったまま残る。
# `set -m` で background job を group leader にし、`kill -- -$pid` で group 全体へ送る。
#
# **deadline を `--max` の残り時間で頭打ちにしない。**そうすると境界のラウンドが健全でも殺され、
# 「観測不能・backoff 中」と誤って報告される（状況ボードに嘘の異常が出る）。
# fallback が最大 `--deadline` だけ遅れるのは許容する（1800 秒に対する 90 秒）。
CHILD_PGID=''

# **自分が死ぬときも子 group を道連れにする。**deadline を見張っている親が消えると、
# 孫の `gh` / `git` が永久に残る（conductor が tick 間に watcher を止めるのは通常運用）。
kill_child_group() {
  [ -n "$CHILD_PGID" ] || return 0
  kill -TERM -- "-$CHILD_PGID" 2>/dev/null
  sleep 1
  kill -KILL -- "-$CHILD_PGID" 2>/dev/null
  CHILD_PGID=''
}
cleanup() {
  kill_child_group
  [ -n "$STATE_DIR" ] && rm -rf "$STATE_DIR"
}
trap 'cleanup; exit 143' TERM INT HUP
trap cleanup EXIT

snapshot_bounded() {
  local pid waited=0 limit=$1 rc
  : > "$CUR"
  set -m
  snapshot > "$CUR" &
  pid=$!
  set +m
  CHILD_PGID=$pid
  while kill -0 "$pid" 2>/dev/null; do
    # **起床上限を per-round の deadline より先に見る。**逆にすると `--deadline >= --max` の
    # 設定で deadline 側が先に成立し、健全なラウンドを切っただけなのに「観測不能」と報告される。
    # 上限に達したという事実の方が権威なので、両方成立したら常にこちらが勝つ。
    if [ $(( $(date +%s) - start )) -ge "$MAX" ]; then
      kill_child_group
      wait "$pid" 2>/dev/null
      return 2
    fi
    if [ "$waited" -ge "$limit" ]; then
      echo "[watch] snapshot exceeded deadline ${limit}s: killing process group" >&2
      kill_child_group
      wait "$pid" 2>/dev/null
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"
  rc=$?
  CHILD_PGID=''
  return "$rc"
}

# コストは**指紋に入れない**（毎周変わるので全部ノイズになる）。stderr へ出す。
report_cost() {
  local cost
  cost=$(cat "$COST_FILE" 2>/dev/null) || cost=0
  case "$cost" in ''|*[!0-9]*) cost=0 ;; esac
  echo "[watch] graphql cost this round: ${cost} pt (self-reported; gh pr list は別途 1 pt、REST は 0 pt)" >&2
  if [ "$cost" -gt "$COST_LIMIT" ]; then
    echo "[watch] cost ${cost} pt exceeds --cost-limit ${COST_LIMIT}: クエリの形状を疑う。起動を止める" >&2
    return 1
  fi
}

start=$(date +%s)
fails=0
have_base=0

# **起動直後に必ず再ベースラインを取る**（conductor は直前に tick を終えている）。
# 観測が失敗し続けても、下の fallback 判定を必ず通る形にしておく
# —— ここで握りつぶして次の周へ送ると、rate limit 中に盲目のまま永久に起きない。
while :; do
  # **fallback の判定はラウンドの前。**後ろに置くと、`--max` を過ぎた直後にもう 1 周
  # 走らせてしまい、起床が最大 `--deadline` 分だけ余計に遅れる。
  # 観測が一度も成功していなくてもここを通る —— 盲目のまま黙り続けないため。
  if [ $(( $(date +%s) - start )) -ge "$MAX" ]; then
    if [ "$fails" -gt 0 ]; then
      echo "=== conductor: GitHub 観測不能・backoff 中（連続 ${fails} 回失敗） ==="
    else
      echo "=== conductor: no change for ${MAX}s (fallback wake) ==="
    fi
    exit 0
  fi

  rm -f "$COST_FILE"
  snapshot_bounded "$DEADLINE"
  case $? in
    0)
      report_cost || exit 2
      fails=0
      if [ "$have_base" -eq 0 ]; then
        cp "$CUR" "$PREV"
        have_base=1
      elif ! cmp -s "$CUR" "$PREV"; then
        echo "=== conductor: state changed ==="
        diff "$PREV" "$CUR" | head -60
        cp "$CUR" "$PREV"
        exit 0
      fi
      ;;
    2)
      # ラウンドの途中で `--max` に達した。観測不能ではない。
      echo "=== conductor: no change for ${MAX}s (fallback wake) ==="
      exit 0
      ;;
    *)
      fails=$((fails + 1))
      echo "[watch] observation failed (${fails} in a row)" >&2
      ;;
  esac

  elapsed=$(( $(date +%s) - start ))
  # 失敗時だけ backoff する。**観測項目は間引かない**（項目を落とすと遷移が止まる）。
  # **残り時間で頭打ちにする** —— しないと backoff が `--max` を追い越して fallback が遅れる。
  if [ "$fails" -gt 0 ]; then
    nap=$((INTERVAL * (1 << (fails < 4 ? fails : 4))))
  else
    nap=$INTERVAL
  fi
  remaining=$((MAX - elapsed))
  [ "$nap" -gt "$remaining" ] && nap=$remaining
  [ "$nap" -lt 1 ] && nap=1
  sleep "$nap"
done
