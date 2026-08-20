#!/bin/bash
# conductor の起床監視。正規化と action が読むものすべての指紋を取る。
#
# **この実装が観測の SSOT。**手順書（`../references/harness.md`）は起動の契約だけを持ち、
# ここと同等物を prose から書き直さない。
#
# **mode は 2 つで排他。**
#   --snapshot <path>  1 回だけ観測して書き出す。**tick の観測入口**
#   --baseline <path>  その file を「前回」として監視する。違ったら exit 0
#
# **baseline を自分で取らない**のが要点。起動時に取り直すと、tick が action を決めるのに使った
# 観測から baseline までの隙間に入った遷移が baseline に吸われ、以後どのラウンドでも差分に
# 出ない（fallback まで盲目になる）。tick が読んだ観測をそのまま渡させることで、「前回」が
# **tick が評価した観測**に一意化され、窓そのものが無くなる。
#
# 終了コード
#   0  --baseline: 起こす（変化を検知した / fallback / 観測不能が続いた） / --snapshot: 書き出した
#   1  --snapshot: 観測に失敗した（--baseline は失敗しても backoff して続けるので返さない）
#   2  起動を止める（引数不足・baseline が読めない・コスト gate 超過）
set -uo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: watch.sh (--snapshot <path> | --baseline <path>)
                --repo <path> --gh-repo <owner/name>
                [--landing <owner/name>:<統合先 ref>:<checkout>]...
                --project-org <org> --project-number <n> --status-field <name>
                --sessions-cmd <cmd> --workspaces-cmd <cmd>
                [--default-branch main] [--interval 60] [--max 1800]
                [--deadline 90] [--cost-limit 20] [--pr-limit 200]

  --snapshot と --baseline はどちらか一方が必須。**baseline を渡さずに監視は始められない**
  （始められると、起床側が自分で baseline を取り、tick の観測との隙間が窓になる）。

  --landing は制御面以外の着地面を面の数だけ渡す。制御面は --repo と --default-branch から
  組み立てるので重ねて渡さない。**渡し忘れた面は観測に出ない**（そこで書き進んでいる課題が
  成果ゼロの周として数えられる）。**checkout を最後に置く**のは `:` を含む path を許すため
  （repo 名と ref には `:` が現れない）
  --sessions-cmd / --workspaces-cmd は multiplexer 依存なので呼び出し側が渡す
  （このスクリプトは multiplexer を知らない）。契約:

    - 整列済みの行を stdout に出す
    - **取得に失敗したら非 0 で終わる**
    - **空になり得ない一覧なら、空のときも非 0 で終わる**（`| grep .` を末尾に付ける等）。
      「exit 0 で空」は実際に起きる。握りつぶすと「全部消えた」に見えて誤起床する
USAGE
  exit 2
}

SNAPSHOT_OUT=''
BASELINE_IN=''
# **dirty の判定を利用者と repo の設定から切り離す。**`status.showUntrackedFiles=no` が効いていると
# 新規ファイルが隠れて `dirty=0` になり、write の解放とローカル merge の gate をそのまま通る。
# `--untracked-files` / `--ignore-submodules` は引数で固定し、観測を変えうる設定は `-c` で潰す
# （同じ理由の一覧は `cycle-mark.py` の冒頭）。
GIT_STATUS_PINS=(-c core.fsmonitor=false -c core.untrackedCache=false
                 -c status.showUntrackedFiles=all -c status.relativePaths=false)

# **外から注入された設定も潰す。**`-c` は global / system と `GIT_CONFIG_COUNT` /
# `GIT_CONFIG_PARAMETERS` を上書きしきれず、`core.excludesFile` を注入されると untracked の
# 成果物が ignore されて `dirty=0` になる（**未コミットの成果を抱えた worktree が clean に見え、
# そのまま merge と削除へ進む**）。`cycle-mark.py` が同じ経路を既に遮断しているので、両方の
# 観測が食い違わないようにここでも同じ形にする。
# **観測に使う git は全部 `GIT_ENV_STRIP` を通す**（network を張るものは下の `git_net`、それ以外は
# `git_clean`）。status だけを sanitize しても、`GIT_DIR` / `GIT_WORK_TREE` が効いていれば
# `-C <checkout>` は無視され、**別の repo を「その面」として観測したままラウンドが成功する**。
# `GIT_CONFIG_COUNT` は空文字だと数値として解釈されて落ちうるので、env から外す。
GIT_ENV_STRIP=(-u GIT_CONFIG -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE
               -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES
               -u GIT_COMMON_DIR -u GIT_CEILING_DIRECTORIES
               -u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS)

git_clean() {
  env "${GIT_ENV_STRIP[@]}" \
      GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_CONFIG_NOSYSTEM=1 \
      GIT_ATTR_NOSYSTEM=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    git "$@"
}

# **network を張る git は、利用者自身の設定を残す。**credential helper は global config に在るので、
# そこを `/dev/null` にすると **HTTPS remote の fetch が認証できず、ユーザー名を対話で聞きにいって
# 落ちる**（実測: 制御面の origin が HTTPS の環境で、snapshot が毎回
# `could not read Username for 'https://github.com'` で失敗し、tick が丸ごと止まった。
# **SSH remote の面だけで試すと再現しない**）。
#
# **潰してよいのは外から注入されうる env だけで、利用者の global / system config ではない。**
# 上の sanitize が防いでいるのは、親プロセスが立てた `GIT_DIR` / `GIT_CONFIG_*` で観測先を
# すり替えられることで、利用者自身の設定は信頼している側に居る（repo-local config も同じ理由で
# 潰せない —— `remote.origin.url` がそこに在る）。面のすり替えは `git_identity_ok` が
# local config の生値で照合して止める。
#
# **`GIT_TERMINAL_PROMPT=0` は両方に置く** —— 認証に失敗したとき、端末があると入力待ちで固まる。
git_net() {
  env "${GIT_ENV_STRIP[@]}" GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 git "$@"
}

git_status() {
  git_clean -C "$1" "${GIT_STATUS_PINS[@]}" status --porcelain=v1 \
    --untracked-files=all --ignore-submodules=none 2>/dev/null
}

# **面の名前と checkout の実体を突き合わせる。**common dir の一致だけでは、面 A の名前に面 B の
# checkout を渡した呼び出しが通り、**本来の面の成果が観測から落ちたまま正常な snapshot になる**。
# 制御面の origin の host。**着地面もここと同じ forge に在ることを要求する** —— path だけを
# 照合すると `git@evil.example:owner/repo` が正しい面として通り、別の repo の branch と dirty を
# その面の観測として受理する。
EXPECTED_HOST=''

git_url_host() {
  local rest=${1%.git}
  case $rest in
    *://*) rest=${rest#*://}; rest=${rest%%/*}; printf '%s' "${rest##*@}" ;;
    *:*)   rest=${rest%%:*}; case $rest in */*) return 1 ;; esac; printf '%s' "${rest##*@}" ;;
    *)     return 1 ;;
  esac
}

# **面を観測不能にするのは 1 箇所から。**フィールドごとに `-` を許すと、**その面は健全に見えるのに
# 一部だけ欠けた半端な観測**になる —— 例えば worktree 一覧だけ欠けると、実際は dirty な worktree が
# snapshot に載らず clean と読まれ、`着地済み` と片付けが未コミットごと通る。**欠けたら全部 `-`。**
plane_unknown() {
  # **呼ぶ前に、その面がすでに書いた行を消しておくこと**（呼び出し側の `${var%...}`）。消さないと
  # 同じ面について実値の行と `-` 行が 2 本 snapshot に並び、読む側がどちらを拾うか決まらない ——
  # ここが塞いでいる半端な観測が、行の重複という別の形で戻る。
  local n=$1
  tips="$tips$n $2 -
"
  branches_local="$branches_local$n - -
"
  live="$live$n - - - -
"
  worktrees="$worktrees$n - - -
"
}

git_identity_ok() {
  local checkout=$1 name=$2 url host
  # **`remote get-url` を使わない。**`url.<base>.insteadOf` が効いていると書き換え後の URL が
  # 返るので、**別の repo 名へ化けた値で照合してしまう**。設定ファイルの生値を読む。
  #
  # **`--get` ではなく `--get-all` で取り、1 件でなければ落とす。**`--get` は複数登録された
  # うち最後の 1 本しか返さないので、先頭に別 repo を足して末尾に期待値を置けば検査を通る
  # （fetch が向く先とは食い違いうる）。
  # **NUL 区切りで数える。**行で数えると、shell が末尾の改行を落とすぶん**正常な URL の後ろに
  # 空の値を足したときに「1 件」に見える**（値が改行を含むときも壊れる）。`-z` は各値を NUL で
  # **終端**するので、NUL の個数がそのまま件数になる。
  local count
  count=$(git_clean -C "$checkout" config --local -z --get-all remote.origin.url 2>/dev/null \
    | tr -dc '\0' | wc -c | tr -d ' ') || return 1
  [ "$count" = 1 ] || return 1
  url=$(git_clean -C "$checkout" config --local --get remote.origin.url 2>/dev/null) || return 1
  # **末尾一致で済ませない。**`.../evil/owner/repo` は末尾 2 段が一致するので通ってしまう。
  # host より後ろが `<owner>/<repo>` と**完全に**一致することを見る（`cycle-mark.py` と同じ形）。
  #
  #   https://github.com/owner/repo(.git)  → scheme を外し、最初の `/` までが host
  #   git@github.com:owner/repo(.git)      → 最初の `:` までが host
  #
  # **host より後ろを取れない形は通さない**（local path の remote 等）。identity を確かめられない
  # ものを「一致した」とは読まない。
  local rest=${url%.git} path
  case $rest in
    *://*)
      rest=${rest#*://}
      path=${rest#*/}
      [ "$path" = "$rest" ] && return 1 ;;   # host しか無い
    *:*) path=${rest#*:} ;;                  # scp 形式（host 側の検査は git_url_host が持つ）
    *) return 1 ;;
  esac
  [ "$path" = "$name" ] || return 1
  host=$(git_url_host "$url") || return 1
  [ -n "$host" ] || return 1
  # 制御面を最初に通すので、そこで期待 host が決まる。
  if [ -z "$EXPECTED_HOST" ]; then
    EXPECTED_HOST=$host
    return 0
  fi
  [ "$host" = "$EXPECTED_HOST" ] && return 0
  return 1
}

REPO=''
GH_REPO=''
# **配列で持つ。**文字列へ連結して単語分割すると、空白を含む checkout path で面が割れ、
# **ラウンドは成功したまま**別の面として観測される（誤パースは fail-open）。
LANDINGS=()
ORG=''
NUM=''
STATUS_FIELD=''
SESSIONS_CMD=''
WORKSPACES_CMD=''
DEFAULT_BRANCH=main
INTERVAL=60
MAX=1800
DEADLINE=90
COST_LIMIT=20
PR_LIMIT=200

while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot|--baseline|--repo|--gh-repo|--project-org|--project-number|--status-field) ;;
    --landing) ;;
    --sessions-cmd|--workspaces-cmd|--default-branch|--interval|--max|--deadline) ;;
    --cost-limit|--pr-limit) ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
  # **既知の option はすべて値を 1 つ取る。**欠落はここで弾く —— 各 arm に `$2` を読ませると
  # `set -u` が exit 1 で落とし、`--snapshot` の観測失敗と同じ終了コードになる。呼び出し側は
  # 引数の誤りを「観測できなかった」と読み、直せば済むものを障害として扱う。
  [ $# -ge 2 ] || { echo "missing value for $1" >&2; usage; }
  case "$1" in
    --snapshot) SNAPSHOT_OUT=$2 ;;
    --baseline) BASELINE_IN=$2 ;;
    --repo) REPO=$2 ;;
    --landing) LANDINGS+=("$2") ;;
    --gh-repo) GH_REPO=$2 ;;
    --project-org) ORG=$2 ;;
    --project-number) NUM=$2 ;;
    --status-field) STATUS_FIELD=$2 ;;
    --sessions-cmd) SESSIONS_CMD=$2 ;;
    --workspaces-cmd) WORKSPACES_CMD=$2 ;;
    --default-branch) DEFAULT_BRANCH=$2 ;;
    --interval) INTERVAL=$2 ;;
    --max) MAX=$2 ;;
    --deadline) DEADLINE=$2 ;;
    --cost-limit) COST_LIMIT=$2 ;;
    --pr-limit) PR_LIMIT=$2 ;;
  esac
  shift 2
done

for v in REPO GH_REPO ORG NUM STATUS_FIELD SESSIONS_CMD WORKSPACES_CMD; do
  [ -n "${!v}" ] || { echo "missing option for ${v}" >&2; usage; }
done

# **`--landing` の形を起動時に弾く。**観測の途中で崩れると、その面だけが黙って落ちる
# （ラウンドは成功したように見えるので、誰も気づけない）。**3 成分すべての非空を見る** ——
# `owner/repo::path` は形だけなら通り、空の ref が「解決できない面」ではなく「別の面」として
# 観測されてしまう。
for spec in ${LANDINGS+"${LANDINGS[@]}"}; do
  _name=${spec%%:*}
  _rest=${spec#*:}
  _ref=${_rest%%:*}
  _checkout=${_rest#*:}
  if [ "$spec" = "$_name" ] || [ "$_rest" = "$_ref" ] ||
     [ -z "$_name" ] || [ -z "$_ref" ] || [ -z "$_checkout" ]; then
    echo "--landing は <owner/name>:<ref>:<checkout> の形で、3 成分とも非空: $spec" >&2; usage
  fi
  case $_name in
    "$GH_REPO") echo "--landing に制御面を重ねて渡さない: $spec" >&2; usage ;;
  esac
done
# **重複は面の名前だけで見る。**spec の同一性で弾くと、**まったく同じ `--landing` を 2 回渡した
# ときに検出できず**、同じ worktree が snapshot へ二重に載る（容量も面ごとの観測も二重計上）。
_seen=''
for spec in ${LANDINGS+"${LANDINGS[@]}"}; do
  _name=${spec%%:*}
  case " $_seen " in
    *" $_name "*) echo "--landing の面が重複している: $_name" >&2; usage ;;
  esac
  _seen="$_seen $_name"
done
unset _name _rest _ref _checkout _seen

# **mode は排他で、どちらか一方が必須。**両方を許すと「観測しながら監視する」形が生まれ、
# どちらの時点が baseline なのかが呼び出し側から見えなくなる。
if [ -n "$SNAPSHOT_OUT" ] && [ -n "$BASELINE_IN" ]; then
  echo "--snapshot and --baseline are exclusive" >&2; usage
fi
if [ -z "$SNAPSHOT_OUT" ] && [ -z "$BASELINE_IN" ]; then
  echo "one of --snapshot / --baseline is required" >&2; usage
fi

MODE=snapshot
if [ -n "$BASELINE_IN" ]; then
  MODE=watch
  # **読めない・空の baseline は起動を止める。**自分で取り直す側へ倒すと、tick の観測との
  # 隙間が窓になる（mode を分けているのはこのため）。止まれば応答に出る。
  [ -f "$BASELINE_IN" ] || { echo "baseline not found: $BASELINE_IN" >&2; exit 2; }
  [ -s "$BASELINE_IN" ] || { echo "baseline is empty: $BASELINE_IN" >&2; exit 2; }
fi

# 数値引数は先に弾く。文字列が混ざると算術評価が壊れ、**sleep が 0 になって暴走するか、
# fallback の判定が常に偽になって永久に起きない**。
# **0 も弾く。**`--deadline 0` は即 kill、`--pr-limit 0` は常に打ち切り、`--max 0` は毎周 fallback で、
# どれも黙って観測を壊す。
for v in NUM INTERVAL MAX DEADLINE COST_LIMIT PR_LIMIT; do
  case "${!v}" in ''|*[!0-9]*|0) echo "${v} must be a positive integer: ${!v}" >&2; usage ;; esac
done

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
QUERY_FILE="$DIR/project-status.graphql"
RESTRICT="$DIR/restrict-to-board.awk"
COMMENT_FP="$DIR/comment-fingerprint.jq"
ISSUE_FP="$DIR/issue-fingerprint.py"
[ -f "$QUERY_FILE" ] || { echo "not found: $QUERY_FILE" >&2; exit 2; }
[ -f "$DIR/pr-list.jq" ] || { echo "not found: $DIR/pr-list.jq" >&2; exit 2; }
[ -f "$RESTRICT" ] || { echo "not found: $RESTRICT" >&2; exit 2; }
[ -f "$COMMENT_FP" ] || { echo "not found: $COMMENT_FP" >&2; exit 2; }
[ -f "$ISSUE_FP" ] || { echo "not found: $ISSUE_FP" >&2; exit 2; }

# 起動のたびに使い捨てる。**外へ残すのは `--snapshot` で明示的に指定された path だけ**
# （呼び出し側がその file の寿命を持ち、次の起動で baseline として渡す）。
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
  local proj_json proj issues comments sessions workspaces prs prs_json pr_count
  local default branches wt_raw worktrees page_cost board_nums
  local tips checkout ref name tip wt spec branches_local lb live live_branch live_dirty live_out live_ahead live_behind rest

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
  # issues 行は `$ISSUE_FP`。コメントの upsert で Issue が動いても起きない。
  issues_json=$(gh api "repos/$GH_REPO/issues?state=all&per_page=100" --paginate) || return 1
  issues=$(printf '%s' "$issues_json" | python3 "$ISSUE_FP") || return 1
  issues=$(printf '%s\n' "$issues" | sort -n)
  # ページは最後まで取る。絞るのは出力であって打ち切りではない。
  board_nums=$(printf '%s\n' "$proj" | awk '{print $2}')
  printf '%s\n' "$board_nums" > "$STATE_DIR/board_nums"
  issues=$(printf '%s\n' "$issues" | awk -f "$RESTRICT" "$STATE_DIR/board_nums" -) || return 1

  # コメント指紋は `$COMMENT_FP`。ページは最後まで取る。直近 100 件の窓は使わない。
  comments_json=$(gh api "repos/$GH_REPO/issues/comments?per_page=100" --paginate) || return 1
  comments=$(printf '%s' "$comments_json" | jq -r -f "$COMMENT_FP" --arg board "$board_nums") || return 1
  comments=$(printf '%s\n' "$comments" | sort)

  sessions=$(eval "$SESSIONS_CMD") || return 1
  workspaces=$(eval "$WORKSPACES_CMD") || return 1

  # open PR は正当に 0 件になりうるので非空を要求しない。ただし**打ち切ったラウンドは失敗にする** ——
  # 上限外の PR の checks 変化は指紋に出ず、`提出中` → `着地待ち` が永久に起きない。
  # 不完全な一覧を baseline として受理する方が、ラウンドを捨てるより重い。
  #
  # **追跡していない PR の `checks` は固定文字列へ置く。**checks が遷移を駆動するのは PR が Issue に
  # 紐づくときだけで、紐づけの唯一の手段が branch 名の番号。番号を持たない PR の checks は定義上
  # どの `progress` も動かせないので、人が自分のブランチで CI を回すたびに conductor が起きる。
  # **field は削らない** —— 落とすと「追跡していない」と「checks が無い」が区別できなくなる。
  # 判定は**形だけ**（`<prefix>/<番号>-`）。prefix の集合は project が変えてよいと規約が明示して
  # いるので、`feat|fix|chore` のような allowlist を焼き込まない —— project が prefix を 1 つ足した
  # 瞬間、その課題だけ `提出中` → `着地待ち` が永久に起きなくなる。
  # **判定できないものは残す側（fail-open）へ倒す** —— `headRefName` が取れないときは追跡中として
  # 扱い、checks をそのまま指紋へ入れる。
  # **畳みと分類は `src/checks.ts`。**ここは identity と status を落とさずに出す。
  # CheckRun の実行中は `status` を読まないと空になり、pending が消える。
  prs_json=$(gh pr list --repo "$GH_REPO" --state open --limit "$PR_LIMIT" \
    --json number,headRefName,state,isDraft,statusCheckRollup) || return 1
  prs=$(printf '%s' "$prs_json" | jq -r -f "$DIR/pr-list.jq") || return 1
  pr_count=$(printf '%s' "$prs" | grep -c . || true)
  if [ "$pr_count" -ge "$PR_LIMIT" ]; then
    echo "[watch] open PR が --pr-limit ${PR_LIMIT} に達した: 一覧が不完全なのでこのラウンドを捨てる" >&2
    return 1
  fi
  prs=$(printf '%s\n' "$prs" | sort -n)

  # **fetch の失敗でラウンドを無効にする。**握りつぶすと古い origin/<default> を有効な観測として使う。
  # **どの段で落ちたかを名指しする** —— 認証や網の障害はここでしか出ず、`snapshot failed` だけでは
  # 観測の欠陥と環境の障害を切り分けられない。
  if ! git_net -C "$REPO" fetch origin --prune --quiet; then
    echo "[watch] 制御面の fetch に失敗した: $REPO" >&2
    return 1
  fi
  default=$(git_clean -C "$REPO" rev-parse "origin/$DEFAULT_BRANCH") || return 1
  require_nonempty default "$default" || return 1
  branches=$(git_clean -C "$REPO" branch -r --list 'origin/*' | sed 's/^ *//' | sort) || return 1
  require_nonempty branches "$branches" || return 1

  # **着地面ごとに統合先と worktree を撮る。**制御面だけを見ると、成果物が別 repo にある課題の
  # 実体が丸ごと観測から消え、書き進んでいる周と止まっている周が同じ観測になる。
  # 制御面は `--repo` + `origin/$DEFAULT_BRANCH` として先頭に置き、`--landing` はそれ以外の面だけ。
  #
  # **面は配列のまま回す。文字列へ連結しない。**`|` も `:` も path に現れうるので、区切り文字で
  # 面を表した瞬間、**誤分割してもラウンドは成功したまま別の面として観測される**（fail-open）。
  # 制御面は先頭に置き、`--landing` はそれ以外の面だけ。
  # **制御面を先頭に置く。**`git_identity_ok` は最初に見た面から期待 host を決めるので、順序を
  # 変えると着地面がそれを決めてしまい、別 forge の面が基準になる。
  local -a plane_names plane_refs plane_checkouts
  plane_names=("$GH_REPO"); plane_refs=("origin/$DEFAULT_BRANCH"); plane_checkouts=("$REPO")
  for spec in ${LANDINGS+"${LANDINGS[@]}"}; do
    rest=${spec#*:}
    plane_names+=("${spec%%:*}")
    plane_refs+=("${rest%%:*}")
    plane_checkouts+=("${rest#*:}")
  done

  tips=''
  branches_local=''
  worktrees=''
  live=''
  local i
  for ((i = 0; i < ${#plane_names[@]}; i++)); do
    name=${plane_names[$i]}
    ref=${plane_refs[$i]}
    checkout=${plane_checkouts[$i]}
    # **空の面をスキップしない。**`continue` で飛ばすと、渡した面が観測に出ないまま
    # ラウンドが成功する（起動時の検証と二重化しておく）。
    if [ -z "$name" ] || [ -z "$ref" ] || [ -z "$checkout" ]; then
      echo "[watch] landing の成分が空: name='$name' ref='$ref' checkout='$checkout'" >&2
      return 1
    fi
    # **名前と checkout の実体が一致することを確かめる。**取り違えても snapshot は正常に見えるので、
    # 本来の面の成果が観測から落ちたまま気づけない。
    if ! git_identity_ok "$checkout" "$name"; then
      echo "[watch] checkout が面 '$name' のものではない: $checkout" >&2
      [ "$checkout" = "$REPO" ] && return 1
      plane_unknown "$name" "$ref"
      continue
    fi
    # **`[ "$checkout" = "$REPO" ] && return 1` を、以下のどの失敗経路からも落とさない。**制御面は
    # 正規化そのものの入力なので、そこを `-` にすると全課題が観測不能になる。
    # **面ごとの失敗は、その面だけを `-` にする。**ラウンドごと捨てると、**その面を着地面に持たない
    # 課題まで観測不能になって止まる**（座標表の全着地面を毎周渡すので、使っていない repo の障害が
    # キュー全体を巻き込む）。`-` は「観測できなかった」で、clean や不在とは別の値 —— 読む側は
    # その面を持つ課題だけを `Conflict` にする。**制御面だけは別**で、正規化そのものが成り立たない
    # のでラウンドを無効にする（下の default / branches / issues と同じ扱い）。
    if [ "$checkout" != "$REPO" ]; then
      if ! git_net -C "$checkout" fetch origin --prune --quiet; then
        plane_unknown "$name" "$ref"
        continue
      fi
    fi
    # **統合先はローカル ref でもよい**（着地面は push を要求しない）。解決できない面は
    # **identity / fetch の失敗と同じく丸ごと `-`** にする —— tip だけを `-` にして残りを実測値の
    # まま出すと、**その面は健全に見えるのに終端の判定だけができない**という半端な観測になり、
    # 読む側が「空 range」へ倒せば `準備済み` で固定される（直している欠陥の入口そのもの）。
    if ! tip=$(git_clean -C "$checkout" rev-parse --verify --quiet "$ref") || [ -z "$tip" ]; then
      [ "$checkout" = "$REPO" ] && return 1
      plane_unknown "$name" "$ref"
      continue
    fi
    tips="$tips$name $ref $tip
"

    # **ローカル branch の tip も撮る。**着地面の branch は push しないので `origin/*` に出ない。
    # worktree を消した後にこれが無いと、まだ統合先へ入っていない commit が観測から消え、
    # `実装中` の課題が `準備済み` へ退行する。
    if ! lb=$(git_clean -C "$checkout" for-each-ref --format="$name %(refname:short) %(objectname)" refs/heads); then
      [ "$checkout" = "$REPO" ] && return 1
      # ローカル branch は、worktree を消した後に `統合先..branch` を引く主材料。ここが欠けた面で
      # 終端や `実装中` を出さない。
      tips=${tips%"$name $ref $tip
"}
      plane_unknown "$name" "$ref"
      continue
    fi
    branches_local="$branches_local$lb
"

    # **live checkout の姿勢も撮る。**dirty / いまの branch / 分岐は材料として出す。異常か
    # どうかの判定は merge の検査が持つ。材料が無いと述語だけがあって誰も判定できない。
    # **`--short` にしない。**統合先は `refs/heads/temp` のような full ref で渡ってくる。
    # 両側を full ref に揃える（読む側で正規化させない）。
    live_branch=$(git_clean -C "$checkout" symbolic-ref --quiet HEAD) || live_branch='-'
    # **`status` の失敗を clean へ畳まない。**畳むと壊れた checkout が dirty=0 になる。
    # 読めないことは `-` で出す。
    if live_out=$(git_status "$checkout"); then
      live_dirty=0
      [ -n "$(printf '%s' "$live_out" | head -1)" ] && live_dirty=1
    else
      live_dirty='-'
    fi
    live_ahead=$(git_clean -C "$checkout" rev-list --count "$ref..HEAD" 2>/dev/null) || live_ahead='-'
    live_behind=$(git_clean -C "$checkout" rev-list --count "HEAD..$ref" 2>/dev/null) || live_behind='-'
    live="$live$name $live_branch $live_dirty $live_ahead $live_behind
"

    if ! wt_raw=$(git_clean -C "$checkout" worktree list --porcelain); then
      [ "$checkout" = "$REPO" ] && return 1
      # **dirty が欠けた面を「clean」と読ませない。**`progress` は worktree の有無を見ず dirty だけを
      # 見るので、一覧が落ちると `着地済み` の「全面 dirty でない」まで通り、片付けが未コミットごと消す。
      tips=${tips%"$name $ref $tip
"}
      branches_local=${branches_local%"$lb
"}
      live=${live%"$name $live_branch $live_dirty $live_ahead $live_behind
"}
      plane_unknown "$name" "$ref"
      continue
    fi
    # path は空白を含みうるので `awk '{print $2}'` で切らない。
    # 個々の worktree が壊れていてもラウンドを無効にせず `-` を出す —— 恒久的に壊れた checkout 1 つで
    # **全 tick を盲目にする**方が重い。値が変わるので conductor は 1 度起きて異常を見られる。
    # **この pipeline も終了ステータスを見る**（`pipefail` が効くので、途中の失敗が拾える）。
    wt=$(printf '%s\n' "$wt_raw" | sed -n 's/^worktree //p' | sort | while IFS= read -r p; do
        # **HEAD と同じく、読めなければ `-`。**`0`（clean）へ畳むと、壊れた checkout の
        # 未コミットの変更が観測から消え、`着地待ち` と write の解放が通る。
        if out=$(git_status "$p"); then
          d=0
          [ -n "$(printf '%s' "$out" | head -1)" ] && d=1
        else
          d='-'
        fi
        h=$(git_clean -C "$p" rev-parse HEAD 2>/dev/null) || h='-'
        # **path は最後に置く。**空白を含む path で `<面> <path> <dirty> <head>` にすると、
        # フィールド境界が消えて別の worktree / dirty 値として読める（snapshot は tick の
        # 正規化入力なので、境界の曖昧さがそのまま誤判定になる）。前 3 つは空白を含まない。
        printf '%s %s %s %s\n' "$name" "$d" "${h:--}" "$p"
      done) || {
      [ "$checkout" = "$REPO" ] && return 1
      wt=''
    }
    if [ -z "$wt" ]; then
      tips=${tips%"$name $ref $tip
"}
      branches_local=${branches_local%"$lb
"}
      live=${live%"$name $live_branch $live_dirty $live_ahead $live_behind
"}
      plane_unknown "$name" "$ref"
      continue
    fi   # 面ごとの空は `-`（ラウンドは捨てない）
    worktrees="$worktrees$wt
"
  done

  # **整列の失敗もラウンドの失敗にする。**`sort` が途中まで出して落ちると、**部分的な snapshot が
  # 正常な観測として通る**（面や dirty な worktree が黙って落ちる）。`set -e` は使っていないので、
  # command substitution ごとに明示して見る。
  tips=$(printf '%s' "$tips" | sort) || return 1
  branches_local=$(printf '%s' "$branches_local" | sort) || return 1
  live=$(printf '%s' "$live" | sort) || return 1
  worktrees=$(printf '%s' "$worktrees" | sort) || return 1
  require_nonempty tips "$tips" || return 1
  require_nonempty branches_local "$branches_local" || return 1
  require_nonempty live "$live" || return 1
  require_nonempty worktrees "$worktrees" || return 1

  # **節の集合と並びは実質 API。**読む側（`src/decode.ts`）が節の欠落を fail-closed で
  # 弾けるよう版数を先頭に置く。**節を足す・消す・名前を変えたら上げる。行の形を変えたときも上げる** ——
  # 上げずに変えると、読む側は古い形のつもりで新しい出力を解釈し、欠けた節を「値が無い」と読む。
  # baseline との比較は全文の digest なので、定数行が 1 本増えても差分の意味は変わらない。
  cat <<SNAP
--- schema ---
4
--- default ---
$default
--- landing tips ---
$tips
--- landing local branches ---
$branches_local
--- live checkout (面 branch dirty(0/1/-) ahead behind) ---
$live
--- remote branches ---
$branches
--- worktrees (面 dirty(0/1/-) head path) ---
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
# 「観測不能・backoff 中」と誤って報告される（応答に嘘の異常が出る）。
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
    #
    # **`--snapshot` には起床上限が無い。**あれは「変化が無いまま何秒経ったら起こすか」で、
    # 1 回きりの観測には意味を持たない。掛けると `--deadline` より短い `--max` を渡しただけで
    # 健全な観測が切られ、tick が観測できなくなる。
    if [ "$MODE" = watch ] && [ $(( $(date +%s) - start )) -ge "$MAX" ]; then
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

# コストは**指紋に入れない**。1 周ごとの申告は `--snapshot` だけ出す。`--baseline` では
# 出さない（モニターを起こす出力にしない）。超過はどちらの mode でも出す。
report_cost() {
  local cost
  cost=$(cat "$COST_FILE" 2>/dev/null) || cost=0
  case "$cost" in ''|*[!0-9]*) cost=0 ;; esac
  if [ "$MODE" = snapshot ]; then
    echo "[watch] graphql cost this round: ${cost} pt (self-reported; gh pr list は別途 1 pt、REST は 0 pt)" >&2
  fi
  if [ "$cost" -gt "$COST_LIMIT" ]; then
    echo "[watch] cost ${cost} pt exceeds --cost-limit ${COST_LIMIT}: クエリの形状を疑う。起動を止める" >&2
    return 1
  fi
}

start=$(date +%s)
fails=0

# --snapshot: 1 回だけ観測して書き出す。tick はこの出力を観測に使い、**同じ file を次の
# --baseline として渡す**。監視と同じ実装が作った同じ形なので、baseline と「tick が action を
# 決めるのに使った観測」が定義上おなじ実体になる（近い時刻ではなく、同じもの）。
if [ "$MODE" = snapshot ]; then
  snapshot_bounded "$DEADLINE"
  case $? in
    0) report_cost || exit 2 ;;
    *) echo "[watch] snapshot failed" >&2; exit 1 ;;
  esac
  [ -s "$CUR" ] || { echo "[watch] snapshot came back empty" >&2; exit 1; }

  # **渡してから置き換える。**この順序が「置いてある snapshot は tick が受け取った観測」を保つ。
  # 逆にすると、stdout へ渡す前に死んだ場合に**誰も評価していない観測**が固定 path に残り、
  # 観測できなかった tick がそれを `--baseline` として渡す —— tick が最後に評価した観測から
  # そこまでの遷移が baseline に吸われる。**baseline を取り直すのと同じ形**なので、順序で閉じる。
  cat "$CUR" || { echo "[watch] failed to hand the snapshot to the caller" >&2; exit 1; }

  # **生成物を直接上書きしない。**temp へ置いてから mv する。
  #
  # **失敗しても既存の snapshot を壊さないことが、観測できなかった tick の復帰経路そのもの。**
  # 呼び出し側は直前に成功した観測をそのまま `--baseline` に渡して監視を続けられる（古い観測は
  # 差分が余計に出るだけで、見逃しは増えない）。ここで `>` を使って 0 バイトにすると、渡せる
  # baseline が消えて誰も conductor を起こせなくなる ―― 起床漏れが最も重い障害。
  cp "$CUR" "$SNAPSHOT_OUT.part" || exit 1
  mv "$SNAPSHOT_OUT.part" "$SNAPSHOT_OUT" || exit 1
  exit 0
fi

# --baseline: 渡された観測を「前回」として始める。**自分では取り直さない。**
cp "$BASELINE_IN" "$PREV" || exit 2

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
      if ! cmp -s "$CUR" "$PREV"; then
        echo "=== conductor: state changed ==="
        diff "$PREV" "$CUR" | head -60
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
