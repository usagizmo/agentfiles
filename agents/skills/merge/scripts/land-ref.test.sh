#!/bin/sh
# land-ref.sh の書く条件と形を固定する。
#
# 書いてよいのは、統合先がどの worktree にも checkout されておらず、対象の祖先であるときだけ。
# 形は本数で決まる。前提を 1 つでも欠いたら ref も木も動かさない。
#
# ネットワークに出ない。repo は一時 dir。

set -u

# 周りの git 環境を持ち込まない。呼び出し元が GIT_DIR を立てていると、-C を付けても
# 本番の repo へ書く。repo-local な変数は git 自身に列挙させる。
for git_env_var in $(git rev-parse --local-env-vars) GIT_CEILING_DIRECTORIES; do
  unset "$git_env_var"
done

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SCRIPT="$DIR/land-ref.sh"
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

fails=0
pass=0

fail() {
  fails=$((fails + 1))
  echo "FAIL: $1" >&2
}

ok() {
  pass=$((pass + 1))
}

# 1 ケース 1 sandbox。$1 はケース名、$2 は temp に積む本数。
# work は temp を checkout し、main はどこにも checkout されていない。
sandbox() {
  case="$1"
  root="$TMP/$case"
  repo="$root/work"
  mkdir -p "$root"
  git init -q -b main "$repo"
  printf 'base\n' >"$repo/README"
  git -C "$repo" add README
  git -C "$repo" commit -qm init
  git -C "$repo" switch -qc temp
  i=0
  while [ "$i" -lt "$2" ]; do
    i=$((i + 1))
    printf '%s\n' "$i" >>"$repo/README"
    git -C "$repo" commit -qam "c$i"
  done
}

sha() {
  git -C "$repo" rev-parse "$1"
}

run() {
  sh "$SCRIPT" "$@" >"$root/out" 2>&1
  echo $?
}

expect_eq() {
  if [ "$2" = "$3" ]; then ok; else fail "$case: $1: expected [$3], got [$2] $(cat "$root/out" 2>/dev/null)"; fi
}

# 2 本以上は merge commit。第 1 親が旧統合先、第 2 親が対象、木は対象と同一。
sandbox no-ff 2
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp "🔀 land")" 0
expect_eq parents "$(git -C "$repo" rev-parse main^1 main^2)" "$(printf '%s\n%s' "$old" "$(sha temp)")"
expect_eq tree "$(sha 'main^{tree}')" "$(sha 'temp^{tree}')"
expect_eq message "$(git -C "$repo" log -1 --format=%s main)" "🔀 land"
expect_eq head "$(git -C "$repo" symbolic-ref HEAD)" refs/heads/temp
expect_eq clean "$(git -C "$repo" status --porcelain)" ""

# 1 本は ff。merge commit を作らない。
sandbox ff 1
expect_eq exit "$(run "$repo" refs/heads/main temp)" 0
expect_eq ff "$(sha main)" "$(sha temp)"

# 0 本は何もしない。
sandbox zero 0
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp)" 0
expect_eq unchanged "$(sha main)" "$old"

# 形とメッセージの有無が食い違えば usage。
sandbox ff-with-message 1
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp "msg")" 2
expect_eq unchanged "$(sha main)" "$old"

sandbox no-ff-without-message 2
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp)" 2
expect_eq unchanged "$(sha main)" "$old"

# 統合先が checkout されていれば書かない（linked worktree でも）。
sandbox checked-out 2
git -C "$repo" worktree add -q "$root/main-wt" main
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp "msg")" 1
expect_eq unchanged "$(sha main)" "$old"

# 祖先でなければ書かない。
sandbox diverged 2
git -C "$repo" switch -q main
printf 'other\n' >"$repo/OTHER"
git -C "$repo" add OTHER
git -C "$repo" commit -qm other
git -C "$repo" switch -q temp
old=$(sha main)
expect_eq exit "$(run "$repo" refs/heads/main temp "msg")" 1
expect_eq unchanged "$(sha main)" "$old"

# 統合先が無ければ書かない（作るのは ensure-integration-ref.sh）。
sandbox missing 1
expect_eq exit "$(run "$repo" refs/heads/release temp)" 1
if git -C "$repo" show-ref --verify --quiet refs/heads/release; then fail "$case: release was created"; else ok; fi

# 読んだあとに統合先が動いたら書かない。update-ref の直前に別の書き手を割り込ませる。
sandbox raced 2
other=$(git -C "$repo" commit-tree "$(sha 'main^{tree}')" -p main -m other)
mkdir -p "$root/bin"
real_git=$(command -v git)
cat >"$root/bin/git" <<STUB
#!/bin/sh
for a in "\$@"; do
  if [ "\$a" = update-ref ]; then "$real_git" -C "$repo" update-ref refs/heads/main "$other"; break; fi
done
exec "$real_git" "\$@"
STUB
chmod +x "$root/bin/git"
expect_eq exit "$(PATH="$root/bin:$PATH" run "$repo" refs/heads/main temp "msg")" 1
expect_eq kept "$(sha main)" "$other"

# full ref でなければ usage。
sandbox short-ref 1
old=$(sha main)
expect_eq exit "$(run "$repo" main temp)" 2
expect_eq unchanged "$(sha main)" "$old"

echo "$pass pass, $fails fail"
[ "$fails" -eq 0 ]
