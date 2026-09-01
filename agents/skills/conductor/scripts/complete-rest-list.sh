#!/bin/bash
# REST 一覧を全件として受理する前に、件数照合を済ませる。
#
# **`--paginate` の exit 0 は全件の証拠にしない。**同じ打ち切り経路を通らない件数と
# 生配列長を照合する。`len >= count` なら受理。`rel=next` があるのに `rel=last` が
# 無いときは件数不明として失敗。照合はフィルタ前の生配列に対して行う。
set -euo pipefail

usage() {
  echo "usage: complete-rest-list.sh <api-path>" >&2
  exit 2
}

[ "${1:-}" != "" ] && [ $# -eq 1 ] || usage
PATH_SPEC=$1

probe_path() {
  local path=$1
  case $path in
    *per_page=*) printf '%s' "$path" | sed 's/per_page=[0-9]*/per_page=1/' ;;
    *\?*) printf '%s&per_page=1' "$path" ;;
    *) printf '%s?per_page=1' "$path" ;;
  esac
}

PROBE=$(probe_path "$PATH_SPEC")

include_out=$(gh api --include "$PROBE") || {
  echo "REST 件数 probe が失敗した: $PROBE" >&2
  exit 1
}

count=$(
  printf '%s' "$include_out" | python3 -c "$(
    cat <<'PY'
import json, re, sys

raw = sys.stdin.read()
if "\r\n\r\n" in raw:
    header, body = raw.split("\r\n\r\n", 1)
elif "\n\n" in raw:
    header, body = raw.split("\n\n", 1)
else:
    sys.stderr.write("REST 件数 probe に本文が無い\n")
    sys.exit(1)

status_ok = True
link = ""
for line in header.splitlines():
    if line.startswith("HTTP/"):
        status_ok = " 200" in line
    if line.lower().startswith("link:"):
        link += line.split(":", 1)[1].strip()
if not status_ok:
    sys.stderr.write("REST 件数 probe の HTTP が 200 でない\n")
    sys.exit(1)

rels = {rel: url for url, rel in re.findall(r'<([^>]+)>\s*;\s*rel="([^"]+)"', link)}
if "next" in rels and "last" not in rels:
    sys.stderr.write("REST 件数不明: rel=next はあるが rel=last が無い\n")
    sys.exit(1)
if "last" in rels:
    match = re.search(r"[?&]page=(\d+)", rels["last"])
    if match is None:
        sys.stderr.write("REST 件数不明: rel=last に page が無い\n")
        sys.exit(1)
    print(match.group(1))
    sys.exit(0)
try:
    data = json.loads(body)
except json.JSONDecodeError as error:
    sys.stderr.write(f"REST 件数 probe の JSON を読めない: {error}\n")
    sys.exit(1)
if not isinstance(data, list):
    sys.stderr.write("REST 件数 probe が配列でない\n")
    sys.exit(1)
print(len(data))
PY
  )"
) || exit 1

list_out=$(gh api --paginate "$PATH_SPEC") || {
  echo "REST 一覧の取得が失敗した: $PATH_SPEC" >&2
  exit 1
}

printf '%s' "$list_out" | python3 -c "$(
  cat <<'PY'
import json, sys

count = int(sys.argv[1])
raw = sys.stdin.read()
try:
    data = json.loads(raw)
except json.JSONDecodeError as error:
    sys.stderr.write(f"REST 一覧の JSON を読めない: {error}\n")
    sys.exit(1)
if not isinstance(data, list):
    sys.stderr.write("REST 一覧が配列でない\n")
    sys.exit(1)
if len(data) < count:
    sys.stderr.write(f"REST 一覧が短い: {len(data)} < {count}\n")
    sys.exit(1)
sys.stdout.write(raw)
PY
)" "$count"
