#!/bin/sh
# complete-rest-list.sh の件数照合を固定する。
#
# **守っているのは「`--paginate` の exit 0 を全件の証拠にしない」こと。**
# 件数は probe 側の Link / 1 ページ長から取り、生配列長と照合する。
set -u

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
HELPER="$DIR/complete-rest-list.sh"
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"
mkdir -p "$BIN" || exit 2

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

install_gh() {
  cat >"$BIN/gh" <<'EOF'
#!/bin/sh
set -eu
include=0
paginate=0
path=""
for a in "$@"; do
  case $a in
    --include|-i) include=1 ;;
    --paginate) paginate=1 ;;
    repos/*) path=$a ;;
  esac
done
if [ "${GH_FAIL_INCLUDE:-}" = 1 ] && [ "$include" = 1 ]; then
  echo "include failed" >&2
  exit 1
fi
if [ "${GH_FAIL_PAGINATE:-}" = 1 ] && [ "$paginate" = 1 ]; then
  echo "paginate failed" >&2
  exit 1
fi
if [ -n "${GH_INCLUDE_JSON:-}" ]; then
  body=$GH_INCLUDE_JSON
else
  body='[{"n":1}]'
fi
if [ "$include" = 1 ]; then
  if [ "${GH_NEXT_ONLY:-}" = 1 ]; then
    printf 'HTTP/2.0 200 OK\nLink: <https://api.github.com/%s&page=2>; rel="next"\nContent-Type: application/json\n\n%s\n' "$path" "$body"
    exit 0
  fi
  if [ -n "${GH_LAST_PAGE:-}" ]; then
    printf 'HTTP/2.0 200 OK\nLink: <https://api.github.com/%s&page=2>; rel="next", <https://api.github.com/%s&page=%s>; rel="last"\nContent-Type: application/json\n\n%s\n' "$path" "$path" "$GH_LAST_PAGE" "$body"
    exit 0
  fi
  printf 'HTTP/2.0 200 OK\nContent-Type: application/json\n\n%s\n' "$body"
  exit 0
fi
if [ -n "${GH_LIST_JSON:-}" ]; then
  printf '%s\n' "$GH_LIST_JSON"
else
  printf '%s\n' '[{"n":1}]'
fi
EOF
  chmod +x "$BIN/gh"
}

PATH="$BIN:$PATH"
export PATH
install_gh

bash "$HELPER" >/dev/null 2>&1
check 2 $? "api-path が無ければ止まる"

GH_LAST_PAGE=3 GH_LIST_JSON='[{"n":1}]'
export GH_LAST_PAGE GH_LIST_JSON
bash "$HELPER" "repos/o/r/issues?state=all&per_page=100" >/dev/null 2>&1
check 1 $? "件数が足りない一覧は失敗する"
unset GH_LAST_PAGE GH_LIST_JSON

GH_LAST_PAGE=2 GH_LIST_JSON='[{"n":1},{"n":2}]'
export GH_LAST_PAGE GH_LIST_JSON
out=$(bash "$HELPER" "repos/o/r/issues?state=all&per_page=100")
check 0 $? "件数どおりなら受理する"
printf '%s' "$out" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); raise SystemExit(0 if d==[{"n":1},{"n":2}] else 1)'
check 0 $? "件数どおりの一覧をそのまま出す"
unset GH_LAST_PAGE GH_LIST_JSON

GH_LAST_PAGE=2 GH_LIST_JSON='[{"n":1},{"n":2},{"n":3}]'
export GH_LAST_PAGE GH_LIST_JSON
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 0 $? "len が count 以上なら受理する"
unset GH_LAST_PAGE GH_LIST_JSON

GH_NEXT_ONLY=1 GH_LIST_JSON='[{"n":1}]'
export GH_NEXT_ONLY GH_LIST_JSON
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 1 $? "rel=next だけで rel=last が無ければ失敗する"
unset GH_NEXT_ONLY GH_LIST_JSON

GH_INCLUDE_JSON='[{"n":1}]' GH_LIST_JSON='[{"n":1}]'
export GH_INCLUDE_JSON GH_LIST_JSON
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 0 $? "Link が無ければその 1 ページの長さを件数にする"
unset GH_INCLUDE_JSON GH_LIST_JSON

GH_INCLUDE_JSON='[]' GH_LIST_JSON='[]'
export GH_INCLUDE_JSON GH_LIST_JSON
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 0 $? "空の一覧は受理する"
unset GH_INCLUDE_JSON GH_LIST_JSON

GH_FAIL_INCLUDE=1
export GH_FAIL_INCLUDE
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 1 $? "件数 probe の失敗は失敗する"
unset GH_FAIL_INCLUDE

GH_FAIL_PAGINATE=1
export GH_FAIL_PAGINATE
bash "$HELPER" "repos/o/r/issues?per_page=100" >/dev/null 2>&1
check 1 $? "paginate の失敗は失敗する"
unset GH_FAIL_PAGINATE

echo "complete-rest-list.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
