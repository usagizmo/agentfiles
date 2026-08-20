#!/bin/sh
# ensure-integration-ref.sh の述語を一時 git repo で固定する。
#
# **ネットワークに出ない。**origin は local bare。`git remote set-head` は fixture の準備に
# だけ使い、script 側が呼ばないことを「origin/HEAD が無い fixture で止まる」で見る。

set -u

# commit hook が GIT_DIR を渡す。残ると -C しても本番の repo へ書く。
# （`git push origin HEAD:main` が origin/main へ届く。）
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_PREFIX GIT_COMMON_DIR

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
ENSURE="$DIR/ensure-integration-ref.sh"
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

fails=0
pass=0

check() {
  want=$1
  got=$2
  name=$3
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fails=$((fails + 1))
    echo "FAIL: ${name} — exit ${got} (expected ${want})" >&2
  fi
}

eq() {
  want=$1
  got=$2
  name=$3
  if [ "$got" = "$want" ]; then
    pass=$((pass + 1))
  else
    fails=$((fails + 1))
    echo "FAIL: ${name} — got ${got} (expected ${want})" >&2
  fi
}

git_fix() {
  git -c user.name=t -c user.email=t@t "$@"
}

# origin/HEAD が main を指す、clean な live checkout を 1 つ作る。
make_live() {
  dest=$1
  bare=$TMP/${dest}.git
  work=$TMP/$dest
  git init --bare "$bare" >/dev/null
  git -C "$bare" symbolic-ref HEAD refs/heads/main
  git init -b main "$work" >/dev/null
  git_fix -C "$work" commit --allow-empty -m init >/dev/null
  git -C "$work" remote add origin "$bare"
  git -C "$work" push -u origin HEAD:main >/dev/null 2>&1
  git -C "$work" remote set-head origin main
  printf '%s' "$work"
}

sh "$ENSURE" >/dev/null 2>&1
check 2 $? "引数が無いと 2"

sh "$ENSURE" /no/such/dir refs/heads/temp >/dev/null 2>&1
check 2 $? "checkout が無いと 2"

work=$(make_live args)
sh "$ENSURE" "$work" origin/main >/dev/null 2>&1
check 2 $? "origin/main は受けない（PR を使う面の統合先）"

sh "$ENSURE" "$work" temp >/dev/null 2>&1
check 2 $? "short name だけでは受けない"

# 無い → origin/HEAD から作り、clean / default / HEAD 一致なら switch
work=$(make_live create)
sha=$(git -C "$work" rev-parse origin/HEAD)
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
check 0 $? "無い ref は origin/HEAD から作る"
eq "$sha" "$(git -C "$work" rev-parse refs/heads/temp)" "作った temp は origin/HEAD"
eq "temp" "$(git -C "$work" symbolic-ref --short HEAD)" "条件を満たせば switch する"
eq "" "$(git -C "$TMP/create.git" show-ref --heads temp 2>/dev/null || true)" "origin へ push しない"

# 在る（tip が違う）→ 動かない。switch もしない（HEAD が temp と違う）
work=$(make_live keep)
git_fix -C "$work" commit --allow-empty -m extra >/dev/null
git -C "$work" push origin HEAD:main >/dev/null 2>&1
old=$(git -C "$work" rev-parse HEAD)
git -C "$work" branch temp "$old"
git_fix -C "$work" commit --allow-empty -m newer >/dev/null
git -C "$work" push origin HEAD:main >/dev/null 2>&1
git -C "$work" remote set-head origin main
newer=$(git -C "$work" rev-parse HEAD)
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
check 0 $? "在る ref は成功（no-op）"
eq "$old" "$(git -C "$work" rev-parse refs/heads/temp)" "在る temp は tip が違っても動かない"
eq "main" "$(git -C "$work" symbolic-ref --short HEAD)" "HEAD が temp と違うので switch しない"
eq "$newer" "$(git -C "$work" rev-parse HEAD)" "live の HEAD も動かない"

# origin/HEAD が無い → 作らず非 0
work=$(make_live nohead)
git -C "$work" remote set-head origin --delete
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
check 1 $? "origin/HEAD が無いと作らず止まる"
if git -C "$work" show-ref --verify --quiet refs/heads/temp; then
  fails=$((fails + 1))
  echo "FAIL: origin/HEAD 無しなのに temp が生まれた" >&2
else
  pass=$((pass + 1))
fi
eq "main" "$(git -C "$work" symbolic-ref --short HEAD)" "origin/HEAD 無しでは switch しない"

# live が dirty → 作るが switch しない
work=$(make_live dirty)
printf 'x\n' >"$work/dirty.txt"
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
check 0 $? "dirty でも ref は作れる"
eq "$(git -C "$work" rev-parse origin/HEAD)" "$(git -C "$work" rev-parse refs/heads/temp)" \
  "dirty でも origin/HEAD から作る"
eq "main" "$(git -C "$work" symbolic-ref --short HEAD)" "dirty なら switch しない"

# default 以外に居る → 作るが switch しない
work=$(make_live other)
git -C "$work" switch -c other >/dev/null 2>&1
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
check 0 $? "default 以外でも ref は作れる"
eq "other" "$(git -C "$work" symbolic-ref --short HEAD)" "default 以外なら switch しない"

# 作業 branch 述語を使わない: 既存の作業 branch があっても、それを checkout しない
work=$(make_live workbranch)
git -C "$work" branch chore/1-x
sh "$ENSURE" "$work" refs/heads/temp >/dev/null 2>&1
eq "temp" "$(git -C "$work" symbolic-ref --short HEAD)" "条件を満たすとき switch 先は統合先"
if git -C "$work" show-ref --verify --quiet refs/heads/chore/1-x; then
  pass=$((pass + 1))
else
  fails=$((fails + 1))
  echo "FAIL: 作業 branch を消した" >&2
fi

echo "ensure-integration-ref.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
