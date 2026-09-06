#!/bin/bash
# REST 一覧を全件として受理する前に、完全性の照合を済ませる。
#
# **`--paginate` の exit 0 は全件の証拠にしない。**page 番号方式は `rel=last` の件数と
# 生配列長を照合する。`len >= count` なら受理。cursor 方式（`rel=next` に `after=`）は
# Link を辿り、終端ページを観測する。`rel=next` があり `after=` も `rel=last` も無いときは
# 件数不明として失敗。照合はフィルタ前の生配列に対して行う。
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

# gh --include の封筒を 1 箇所で剥く。probe と cursor walk が同じ形を見る。
read_include() {
  python3 -c "$(
    cat <<'PY'
import json, re, sys

label = sys.argv[1]
raw = sys.stdin.read()
if "\r\n\r\n" in raw:
    header, body = raw.split("\r\n\r\n", 1)
elif "\n\n" in raw:
    header, body = raw.split("\n\n", 1)
else:
    sys.stderr.write(f"{label}に本文が無い\n")
    sys.exit(1)

status_ok = True
link = ""
for line in header.splitlines():
    if line.startswith("HTTP/"):
        status_ok = " 200" in line
    if line.lower().startswith("link:"):
        link += line.split(":", 1)[1].strip()
if not status_ok:
    sys.stderr.write(f"{label}の HTTP が 200 でない\n")
    sys.exit(1)

try:
    data = json.loads(body)
except json.JSONDecodeError as error:
    sys.stderr.write(f"{label}の JSON を読めない: {error}\n")
    sys.exit(1)
if not isinstance(data, list):
    sys.stderr.write(f"{label}が配列でない\n")
    sys.exit(1)

rels = {rel: url for url, rel in re.findall(r'<([^>]+)>\s*;\s*rel="([^"]+)"', link)}
json.dump({"data": data, "rels": rels}, sys.stdout)
PY
  )" "$1"
}

PROBE=$(probe_path "$PATH_SPEC")

include_out=$(gh api --include "$PROBE") || {
  echo "REST 件数 probe が失敗した: $PROBE" >&2
  exit 1
}

parsed=$(printf '%s' "$include_out" | read_include "REST 件数 probe") || exit 1

count=$(
  printf '%s' "$parsed" | python3 -c "$(
    cat <<'PY'
import json, re, sys

parsed = json.load(sys.stdin)
rels = parsed["rels"]
if "next" in rels and re.search(r"[?&]after=", rels["next"]):
    print("cursor")
    sys.exit(0)
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
print(len(parsed["data"]))
PY
  )"
) || exit 1

if [ "$count" = "cursor" ]; then
  acc_file=$(mktemp) || exit 1
  trap 'rm -f "$acc_file"' EXIT
  printf '%s' '[]' >"$acc_file"
  current=$PATH_SPEC
  pages=0
  while :; do
    pages=$((pages + 1))
    if [ "$pages" -gt 10000 ]; then
      echo "REST 一覧が打ち切られた: ページ上限" >&2
      exit 1
    fi
    include_out=$(gh api --include "$current") || {
      echo "REST 一覧の取得が失敗した: $current" >&2
      exit 1
    }
    parsed=$(printf '%s' "$include_out" | read_include "REST 一覧") || exit 1
    next=$(
      printf '%s' "$parsed" | python3 -c "$(
        cat <<'PY'
import json, sys

acc_path = sys.argv[1]
current = sys.argv[2]
parsed = json.load(sys.stdin)
data = parsed["data"]

with open(acc_path) as handle:
    acc = json.load(handle)
if not isinstance(acc, list):
    sys.stderr.write("REST 一覧の蓄積が配列でない\n")
    sys.exit(1)
acc.extend(data)
with open(acc_path, "w") as handle:
    json.dump(acc, handle)

nxt = parsed["rels"].get("next", "")
if nxt == "":
    sys.exit(0)

path = nxt
for prefix in ("https://api.github.com/", "http://api.github.com/"):
    if path.startswith(prefix):
        path = path[len(prefix) :]
        break
if path == current:
    sys.stderr.write("REST 一覧の next が進まない\n")
    sys.exit(1)
sys.stdout.write(path)
PY
      )" "$acc_file" "$current"
    ) || exit 1
    if [ -z "$next" ]; then
      cat "$acc_file"
      exit 0
    fi
    current=$next
  done
fi

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
