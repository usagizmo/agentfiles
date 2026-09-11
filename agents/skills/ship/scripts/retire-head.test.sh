#!/bin/sh
# retire-head.sh の消す条件を固定する。
#
# 消してよいのは origin/<base> の祖先だけ。1 つでも検証が欠けたら何も消さない。
# 対象が既に無い巡は成功で終わる。
#
# ネットワークに出ない。origin は一時 dir の bare repo。gh は PATH の stub。

set -u

# 周りの git 環境を持ち込まない。呼び出し元が GIT_DIR を立てていると、-C を付けても
# 本番の repo へ書く。repo-local な変数は git 自身に列挙させる。
for git_env_var in $(git rev-parse --local-env-vars) GIT_CEILING_DIRECTORIES; do
  unset "$git_env_var"
done

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SCRIPT="$DIR/retire-head.sh"
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

export GIT_CONFIG_GLOBAL="$TMP/gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test
export GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test
export GIT_COMMITTER_EMAIL=test@example.com
export GIT_TERMINAL_PROMPT=0
git config --global user.name test
git config --global user.email test@example.com
git config --global init.defaultBranch main

# gh は呼ばせない。PR の姿は環境変数で渡す。
mkdir -p "$TMP/bin"
cat >"$TMP/bin/gh" <<'STUB'
#!/bin/sh
case "$1 $2" in
"pr view") printf '%s\t%s\t%s\t%s\n' "$GH_STATE" "$GH_HEAD" "$GH_BASE" "$GH_HEAD_REPO" ;;
"repo view") printf '%s\n' "$GH_ORIGIN_REPO" ;;
*)
  echo "gh stub: 想定外の呼び出し: $*" >&2
  exit 1
  ;;
esac
STUB
chmod +x "$TMP/bin/gh"

# herdr も呼ばせない。紐づく workspace は環境変数で渡し、閉じた id はファイルへ残す。
cat >"$TMP/bin/herdr" <<'STUB'
#!/bin/sh
case "$1 $2" in
"worktree list")
  [ -z "${HERDR_LIST_FAILS:-}" ] || exit 1
  case "${HERDR_LIST_BROKEN:-}" in
  null)
    printf '{"result":null}\n'
    exit 0
    ;;
  object)
    printf '{"result":{"worktrees":{}}}\n'
    exit 0
    ;;
  numid)
    printf '{"result":{"worktrees":[{"path":"%s","is_linked_worktree":true,"open_workspace_id":7}]}}\n' \
      "${HERDR_WT_PATH:-}"
    exit 0
    ;;
  esac
  if [ -n "${HERDR_WT_PATH:-}" ] && [ -d "$HERDR_WT_PATH" ]; then
    printf '{"result":{"worktrees":[{"path":"%s","is_linked_worktree":true,"open_workspace_id":"%s"}]}}\n' \
      "$HERDR_WT_PATH" "${HERDR_WT_WS:-}"
  else
    printf '{"result":{"worktrees":[]}}\n'
  fi
  ;;
"workspace close")
  [ -z "${HERDR_CLOSE_FAILS:-}" ] || exit 1
  printf '%s\n' "$3" >>"$HERDR_CLOSED"
  ;;
*)
  echo "herdr stub: 想定外の呼び出し: $*" >&2
  exit 1
  ;;
esac
STUB
chmod +x "$TMP/bin/herdr"

PATH="$TMP/bin:$PATH"
export PATH
export GH_STATE=MERGED GH_HEAD=feat GH_BASE=main GH_HEAD_REPO=o/r GH_ORIGIN_REPO=o/r
export HERDR_CLOSED="$TMP/closed"
: >"$HERDR_CLOSED"
unset HERDR_WORKSPACE_ID

fails=0
pass=0

fail() {
  fails=$((fails + 1))
  echo "FAIL: $1" >&2
}

ok() {
  pass=$((pass + 1))
}

# 1 ケース 1 sandbox。$1 はケース名。
# work が main worktree（main）、wt が linked worktree（feat）。origin/main は feat を含む。
sandbox() {
  case="$1"
  root="$TMP/$case"
  mkdir -p "$root"
  git init --bare -b main "$root/origin.git" >/dev/null
  git clone "$root/origin.git" "$root/work" >/dev/null 2>&1
  git -C "$root/work" checkout -b main >/dev/null 2>&1
  printf 'base\n' >"$root/work/README"
  git -C "$root/work" add README
  git -C "$root/work" commit -m init >/dev/null
  git -C "$root/work" push -u origin main >/dev/null 2>&1
  git -C "$root/work" worktree add -b feat "$root/wt" >/dev/null 2>&1
  printf 'feat\n' >>"$root/wt/README"
  git -C "$root/wt" add README
  git -C "$root/wt" commit -m feat >/dev/null
  git -C "$root/wt" push -u origin feat >/dev/null 2>&1
  git -C "$root/work" merge --no-ff feat -m merge >/dev/null
  git -C "$root/work" push origin main >/dev/null 2>&1
}

origin_ref() {
  git --git-dir="$1/origin.git" rev-parse --verify --quiet "$2" 2>/dev/null || echo ""
}

# run <cwd> <出力の prefix> [VAR=VAL ...]
run() {
  run_dir="$1"
  run_prefix="$2"
  shift 2
  (cd "$run_dir" && env "$@" bash "$SCRIPT" 1 >"$run_prefix.out" 2>"$run_prefix.err")
}

# --- merged な head は worktree も local も origin も消える ---
sandbox happy
if run "$TMP/happy/work" "$TMP/happy"; then
  ok
else
  fail "happy: 落ちた: $(cat "$TMP/happy.err")"
fi
if [ ! -e "$TMP/happy/wt" ]; then
  ok
else
  fail "happy: worktree が残った"
fi
if [ -z "$(git -C "$TMP/happy/work" rev-parse --verify --quiet refs/heads/feat)" ]; then
  ok
else
  fail "happy: local feat が残った"
fi
if [ -z "$(origin_ref "$TMP/happy" refs/heads/feat)" ]; then
  ok
else
  fail "happy: origin/feat が残った"
fi
if [ -n "$(origin_ref "$TMP/happy" refs/heads/main)" ]; then
  ok
else
  fail "happy: origin/main を消した"
fi

# --- 消し終わったあとの巡は成功で終わる ---
if run "$TMP/happy/work" "$TMP/happy2"; then
  ok
else
  fail "冪等: 2 巡目で落ちた: $(cat "$TMP/happy2.err")"
fi

# --- local だけ先に消えていても、残りを消して終わる ---
sandbox partial
git -C "$TMP/partial/work" worktree remove "$TMP/partial/wt" >/dev/null
git -C "$TMP/partial/work" branch -D feat >/dev/null
if run "$TMP/partial/work" "$TMP/partial"; then
  ok
else
  fail "partial: 落ちた: $(cat "$TMP/partial.err")"
fi
if [ -z "$(origin_ref "$TMP/partial" refs/heads/feat)" ]; then
  ok
else
  fail "partial: origin/feat が残った"
fi

# --- MERGED でなければ何もしない ---
sandbox open
run "$TMP/open/work" "$TMP/open" GH_STATE=OPEN
open_code=$?
if [ "$open_code" -ne 0 ]; then
  ok
else
  fail "open: MERGED でない PR を止めなかった"
fi
if [ -e "$TMP/open/wt" ] && [ -n "$(origin_ref "$TMP/open" refs/heads/feat)" ]; then
  ok
else
  fail "open: 消した"
fi

# --- head が別 repo（fork）なら origin の同名に触らない ---
sandbox fork
run "$TMP/fork/work" "$TMP/fork" GH_HEAD_REPO=someone/r
fork_code=$?
if [ "$fork_code" -eq 0 ]; then
  ok
else
  fail "fork: 落ちた: $(cat "$TMP/fork.err")"
fi
if [ -n "$(origin_ref "$TMP/fork" refs/heads/feat)" ] && [ -e "$TMP/fork/wt" ]; then
  ok
else
  fail "fork: origin の同名 branch を消した"
fi

# --- merge のあとに origin/feat だけが進んでいたら何も消さない ---
# local からは観測できない commit なので、別 clone から push して作る。
sandbox ahead
git clone "$TMP/ahead/origin.git" "$TMP/ahead/other" >/dev/null 2>&1
git -C "$TMP/ahead/other" checkout feat >/dev/null 2>&1
git -C "$TMP/ahead/other" commit --allow-empty -m after >/dev/null
git -C "$TMP/ahead/other" push origin feat >/dev/null 2>&1
run "$TMP/ahead/work" "$TMP/ahead"
ahead_code=$?
if [ "$ahead_code" -ne 0 ]; then
  ok
else
  fail "ahead: 未統合の origin/feat を消した"
fi
if [ -n "$(origin_ref "$TMP/ahead" refs/heads/feat)" ] && [ -e "$TMP/ahead/wt" ]; then
  ok
else
  fail "ahead: 消した"
fi
if grep -q "origin/feat" "$TMP/ahead.err"; then
  ok
else
  fail "ahead: 止めた理由が origin/feat を指していない: $(cat "$TMP/ahead.err")"
fi

# --- local feat が進んでいたら何も消さない ---
sandbox ahead-local
git -C "$TMP/ahead-local/wt" commit --allow-empty -m after >/dev/null
run "$TMP/ahead-local/work" "$TMP/ahead-local"
ahead_local_code=$?
if [ "$ahead_local_code" -ne 0 ]; then
  ok
else
  fail "ahead-local: 未統合の local feat を消した"
fi
if [ -n "$(git -C "$TMP/ahead-local/work" rev-parse --verify --quiet refs/heads/feat)" ] &&
  [ -n "$(origin_ref "$TMP/ahead-local" refs/heads/feat)" ] && [ -e "$TMP/ahead-local/wt" ]; then
  ok
else
  fail "ahead-local: 消した"
fi

# --- cwd が対象 worktree の中なら消さず、移動先を出す ---
sandbox inside
run "$TMP/inside/wt" "$TMP/inside"
inside_code=$?
if [ "$inside_code" -ne 0 ]; then
  ok
else
  fail "inside: 自分が立っている worktree を消した"
fi
if [ -e "$TMP/inside/wt" ]; then
  ok
else
  fail "inside: worktree が消えた"
fi
if grep -q "$TMP/inside/work" "$TMP/inside.err"; then
  ok
else
  fail "inside: 移動先の path が出ていない: $(cat "$TMP/inside.err")"
fi

# --- head が main worktree に居るなら何も消さない ---
sandbox mainwt
git -C "$TMP/mainwt/work" worktree remove "$TMP/mainwt/wt" >/dev/null
git -C "$TMP/mainwt/work" checkout feat >/dev/null 2>&1
run "$TMP/mainwt/work" "$TMP/mainwt"
mainwt_code=$?
if [ "$mainwt_code" -ne 0 ]; then
  ok
else
  fail "mainwt: main worktree の branch を消しにいった"
fi
if [ -n "$(git -C "$TMP/mainwt/work" rev-parse --verify --quiet refs/heads/feat)" ] &&
  [ -n "$(origin_ref "$TMP/mainwt" refs/heads/feat)" ]; then
  ok
else
  fail "mainwt: 消した"
fi
# git 自身も main worktree の remove を拒むが、その fatal では移動先を促す文言と紛れる。
if grep -q "main worktree" "$TMP/mainwt.err"; then
  ok
else
  fail "mainwt: 止めた理由が main worktree を指していない: $(cat "$TMP/mainwt.err")"
fi

# --- dirty な worktree は残し、branch も origin も消さない ---
sandbox dirty
printf 'dirty\n' >>"$TMP/dirty/wt/README"
run "$TMP/dirty/work" "$TMP/dirty" HERDR_WT_PATH="$TMP/dirty/wt" HERDR_WT_WS=wZZ
dirty_code=$?
if [ "$dirty_code" -ne 0 ]; then
  ok
else
  fail "dirty: dirty な worktree を消した"
fi
if [ -e "$TMP/dirty/wt" ] &&
  [ -n "$(git -C "$TMP/dirty/work" rev-parse --verify --quiet refs/heads/feat)" ] &&
  [ -n "$(origin_ref "$TMP/dirty" refs/heads/feat)" ]; then
  ok
else
  fail "dirty: worktree remove の失敗より先へ進んだ"
fi
# 消せていない木の workspace を閉じろと言わない
if ! grep -q "herdr workspace close" "$TMP/dirty.err"; then
  ok
else
  fail "dirty: 消せていないのに閉じ方を出した: $(cat "$TMP/dirty.err")"
fi

# --- inventory の構造が壊れていたら、消す前に止まる ---
# 空値の正規化と id の型は、どちらも「該当なし」に化けて削除へ進みうる
for shape in null object numid; do
  sandbox "herdr-broken-$shape"
  run "$TMP/herdr-broken-$shape/work" "$TMP/herdr-broken-$shape" \
    HERDR_LIST_BROKEN="$shape" HERDR_WT_PATH="$TMP/herdr-broken-$shape/wt"
  broken_code=$?
  if [ "$broken_code" -ne 0 ]; then
    ok
  else
    fail "herdr-broken-$shape: 壊れた inventory を workspace なしと扱った"
  fi
  if [ -e "$TMP/herdr-broken-$shape/wt" ] &&
    [ -n "$(origin_ref "$TMP/herdr-broken-$shape" refs/heads/feat)" ]; then
    ok
  else
    fail "herdr-broken-$shape: 消した"
  fi
done

# --- origin/feat が既に消えていても、local と worktree は消す ---
sandbox pruned
git --git-dir="$TMP/pruned/origin.git" branch -D feat >/dev/null
if run "$TMP/pruned/work" "$TMP/pruned"; then
  ok
else
  fail "pruned: 落ちた: $(cat "$TMP/pruned.err")"
fi
if [ ! -e "$TMP/pruned/wt" ] &&
  [ -z "$(git -C "$TMP/pruned/work" rev-parse --verify --quiet refs/heads/feat)" ]; then
  ok
else
  fail "pruned: local 側が残った"
fi
if ! grep -q "origin/feat を消した" "$TMP/pruned.err"; then
  ok
else
  fail "pruned: 消していない origin/feat を消したと言った"
fi

# --- herdr の workspace に紐づく木は、消したあと workspace も閉じる ---
sandbox herdr
run "$TMP/herdr/work" "$TMP/herdr" HERDR_WT_PATH="$TMP/herdr/wt" HERDR_WT_WS=wZZ HERDR_WORKSPACE_ID=w1
herdr_code=$?
if [ "$herdr_code" -eq 0 ]; then
  ok
else
  fail "herdr: 落ちた: $(cat "$TMP/herdr.err")"
fi
if [ ! -e "$TMP/herdr/wt" ]; then
  ok
else
  fail "herdr: worktree が残った"
fi
if grep -q '^wZZ$' "$HERDR_CLOSED"; then
  ok
else
  fail "herdr: workspace を閉じていない"
fi

# --- 自分が居る workspace も閉じる ---
: >"$HERDR_CLOSED"
sandbox herdr-self
run "$TMP/herdr-self/work" "$TMP/herdr-self" \
  HERDR_WT_PATH="$TMP/herdr-self/wt" HERDR_WT_WS=wZZ HERDR_WORKSPACE_ID=wZZ
herdr_self_code=$?
if [ "$herdr_self_code" -eq 0 ]; then
  ok
else
  fail "herdr-self: 落ちた: $(cat "$TMP/herdr-self.err")"
fi
if grep -q '^wZZ$' "$HERDR_CLOSED"; then
  ok
else
  fail "herdr-self: 自分が居る workspace を閉じていない"
fi

# --- workspace を閉じられなかったら、閉じ方を出して止まる ---
: >"$HERDR_CLOSED"
sandbox herdr-stuck
run "$TMP/herdr-stuck/work" "$TMP/herdr-stuck" \
  HERDR_WT_PATH="$TMP/herdr-stuck/wt" HERDR_WT_WS=wZZ HERDR_CLOSE_FAILS=1
herdr_stuck_code=$?
if [ "$herdr_stuck_code" -ne 0 ]; then
  ok
else
  fail "herdr-stuck: 閉じられなかったのに成功で終えた"
fi
if grep -q "herdr workspace close wZZ" "$TMP/herdr-stuck.err"; then
  ok
else
  fail "herdr-stuck: 閉じ方を出していない: $(cat "$TMP/herdr-stuck.err")"
fi
# 例外の意味は「workspace だけ残る」。git 側まで残ると、止まる位置が変わっている
if [ ! -e "$TMP/herdr-stuck/wt" ] &&
  [ -z "$(git -C "$TMP/herdr-stuck/work" rev-parse --verify --quiet refs/heads/feat)" ] &&
  [ -z "$(origin_ref "$TMP/herdr-stuck" refs/heads/feat)" ]; then
  ok
else
  fail "herdr-stuck: git 側が消え切っていない"
fi

# --- herdr の inventory を引けないなら、消す前に止まる ---
sandbox herdr-blind
run "$TMP/herdr-blind/work" "$TMP/herdr-blind" HERDR_LIST_FAILS=1
herdr_blind_code=$?
if [ "$herdr_blind_code" -ne 0 ]; then
  ok
else
  fail "herdr-blind: 紐づきを判定できないのに消した"
fi
if [ -e "$TMP/herdr-blind/wt" ] && [ -n "$(origin_ref "$TMP/herdr-blind" refs/heads/feat)" ]; then
  ok
else
  fail "herdr-blind: 消した"
fi

# --- remote 削除に失敗しても、閉じ方は既にログへ出ている ---
sandbox herdr-push-fail
git --git-dir="$TMP/herdr-push-fail/origin.git" config receive.denyDeletes true
run "$TMP/herdr-push-fail/work" "$TMP/herdr-push-fail" \
  HERDR_WT_PATH="$TMP/herdr-push-fail/wt" HERDR_WT_WS=wZZ
push_fail_code=$?
if [ "$push_fail_code" -ne 0 ]; then
  ok
else
  fail "herdr-push-fail: remote 削除の失敗を成功で終えた"
fi
if grep -q "herdr workspace close wZZ" "$TMP/herdr-push-fail.err"; then
  ok
else
  fail "herdr-push-fail: 閉じ方が出ていない: $(cat "$TMP/herdr-push-fail.err")"
fi

echo "retire-head.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
