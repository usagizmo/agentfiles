#!/bin/sh
# watch.sh の終了コード契約を固定する。
#
# **守っているのは「起動を止める側（2）」と「観測に失敗した側（1）」の切り分け。**
# 2 は呼び出し側が再起動してはいけない形（引数の誤り・baseline が読めない）で、
# 1 は直前に成功した snapshot を渡して張り直す形。ここが混ざると、形状バグを直さないまま
# 起こし直して枠を焼き続けるか、一時的な障害を永久停止として扱うかのどちらかになる。
#
# **引数を文字列へ畳んで渡さない。**`--sessions-cmd "echo s"` が単語分割され、全 case が
# 「知らない option」として 2 を返して素通りする（実際にその形で 1 度書いて、変異させても
# 落ちないテストになった）。必須 option は関数の中で直接並べる。
#
# **ネットワークに出る経路は見ない。**ここで固定するのは引数と baseline の検査まで。

set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
WATCH="$DIR/watch.sh"
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

# 必須 option を揃えて走らせる。追加分だけを引数で渡す。
with_required() {
  sh "$WATCH" "$@" \
    --repo "$TMP" --gh-repo acme/x \
    --project-org acme --project-number 1 --status-field Status \
    --sessions-cmd "echo s" --workspaces-cmd "echo w" >/dev/null 2>&1
}

raw() { sh "$WATCH" "$@" >/dev/null 2>&1; }

with_required
check 2 $? "mode をどちらも渡さないと止まる"

with_required --snapshot "$TMP/a" --baseline "$TMP/b"
check 2 $? "mode を両方渡すと止まる"

with_required --snapshot "$TMP/a" --bogus x
check 2 $? "知らない option で止まる"

raw --snapshot
check 2 $? "option の値が欠けたら止まる（観測失敗の 1 と混ぜない）"

with_required --baseline "$TMP/missing"
check 2 $? "baseline の file が無ければ止まる"

: >"$TMP/empty"
with_required --baseline "$TMP/empty"
check 2 $? "baseline が空なら止まる（自分で取り直さない）"

# **必須 option を 1 つでも落としたら 2。**cli.ts が --sessions-cmd を渡していなかったとき、
# ここが 2 を返していたので観測に 1 度も到達しなかった。
raw --snapshot "$TMP/a" --repo "$TMP" --gh-repo acme/x \
  --project-org acme --project-number 1 --status-field Status --workspaces-cmd "echo w"
check 2 $? "sessions-cmd が無ければ止まる"

raw --snapshot "$TMP/a" --repo "$TMP" --gh-repo acme/x \
  --project-org acme --project-number 1 --status-field Status --sessions-cmd "echo s"
check 2 $? "workspaces-cmd が無ければ止まる"

# **--snapshot は失敗しても既存の file を壊さない。**観測できなかった tick は、
# 直前に成功した snapshot をそのまま baseline として渡す契約がこれに乗っている。
printf 'previous\n' >"$TMP/keep"
raw --snapshot "$TMP/keep" --repo "$TMP/not-a-repo" --gh-repo acme/x \
  --project-org acme --project-number 1 --status-field Status \
  --sessions-cmd "false" --workspaces-cmd "false"
check 1 $? "観測に失敗した --snapshot は 1 を返す"
if [ "$(cat "$TMP/keep")" = "previous" ]; then
  pass=$((pass + 1))
else
  fails=$((fails + 1))
  echo "FAIL: 観測に失敗した --snapshot が既存の file を壊した" >&2
fi

echo "watch.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
