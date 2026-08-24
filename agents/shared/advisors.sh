#!/bin/sh
# アドバイザーの起動と回収。**同じ run を 2 度使えない形にするのが目的。**
# Herdr の tab 1 + 左右 pane で interactive に立て、思考が見えるようにする。
#
#   advisors.sh start <prompt-file>   run dir を作って起動。run dir を stdout へ
#   advisors.sh collect <run-dir> [wait-seconds]   出揃うまで待って出力。既定 1200 秒
#                                                  1 run 1 回。2 度目は落ちる
#
# 候補は advisors.json（JSONC）。選出は advisors.ts。位置引数で kind を渡さない。
# 不変条件: アドバイザーにコードを変更させない（宣言の args のあとに read-only を足す）。
# Herdr の外では立てない。headless CLI に倒さない。

set -u
LC_ALL=C
export LC_ALL

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

here=$(python3 -c 'import os,sys; print(os.path.dirname(os.path.realpath(sys.argv[1])))' "$0") ||
	fatal "スクリプトの場所が取れない"
roster=$here/advisors.json
select_ts=$here/advisors.ts

json_get() {
	python3 -c '
import json, sys
path = sys.argv[2].split(".")
with open(sys.argv[1], encoding="utf-8") as f:
    v = json.load(f)
for p in path:
    if not isinstance(v, dict):
        sys.exit(1)
    v = v.get(p)
    if v is None:
        sys.exit(1)
if isinstance(v, (dict, list)):
    json.dump(v, sys.stdout)
else:
    sys.stdout.write(str(v))
' "$1" "$2"
}

close_tab() {
	c_tab=$1
	[ -n "$c_tab" ] || return 0
	herdr tab close "$c_tab" >/dev/null 2>&1 || true
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors.sh start <prompt-file> | collect <run-dir> [秒]"
shift

case "$cmd" in
start)
	[ "${HERDR_ENV:-}" = 1 ] || fatal "Herdr の外ではアドバイザーを立てない"
	command -v herdr >/dev/null 2>&1 || fatal "herdr が PATH に無い"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	[ -n "${HERDR_WORKSPACE_ID:-}" ] || fatal "HERDR_WORKSPACE_ID が無い"
	[ -f "$roster" ] || fatal "候補表が無い: $roster"
	[ -f "$select_ts" ] || fatal "選出スクリプトが無い: $select_ts"

	prompt=${1:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	case $prompt in
	/*) ;;
	*) prompt=$(CDPATH= cd -P -- "$(dirname "$prompt")" && pwd)/$(basename "$prompt") ;;
	esac
	[ $# -eq 1 ] || fatal "advisor の位置引数は渡さない"

	run=$(mktemp -d "${TMPDIR:-/tmp}/advisors.XXXXXX") || fatal "run dir を作れない"
	rid=$(basename "$run")
	rid=${rid#advisors.}
	rid=$(printf '%s' "$rid" | tr 'A-Z' 'a-z')
	cp "$prompt" "$run/prompt" || fatal "prompt を配れない"
	cp "$roster" "$run/roster.json" || fatal "候補表を配れない"
	marker=ADVISOR-DONE-$rid
	printf '%s\n' "$marker" >"$run/marker" || fatal "marker を書けない"
	printf '\n\n応答の最後の行に %s をそのまま書け。この指令行は書かない。\n' "$marker" >>"$run/prompt" ||
		fatal "marker を prompt へ追記できない"

	if ! herdr pane current --current >"$run/self.json" 2>>"$run/select.log"; then
		cat "$run/select.log" >&2 || true
		rm -rf "$run"
		fatal "自己 kind が取れない"
	fi
	self=$(python3 -c '
import json, sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
print(((d.get("result") or {}).get("pane") or {}).get("agent") or "")
' "$run/self.json") || {
		rm -rf "$run"
		fatal "自己 kind が読めない"
	}
	[ -n "$self" ] || {
		rm -rf "$run"
		fatal "自己 kind が空"
	}
	printf '%s\n' "$self" >"$run/self"

	if ! bun "$select_ts" select --roster "$run/roster.json" --self "$self" \
		>"$run/selected.json" 2>"$run/select.err"; then
		cat "$run/select.err" >&2
		rm -rf "$run"
		fatal "選出できない"
	fi
	cat "$run/select.err" >&2 || true
	python3 -c '
import json, sys
for s in json.load(open(sys.argv[1], encoding="utf-8")):
    print(s["kind"])
' "$run/selected.json" >"$run/advisors" || fatal "選出結果が読めない"
	[ -s "$run/advisors" ] || fatal "選出結果が空"

	tab_json=$run/tab.json
	if ! herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" \
		--label "advisor-$rid" --no-focus >"$tab_json"; then
		fatal "tab を作れない"
	fi
	tab_id=$(json_get "$tab_json" result.tab.tab_id) ||
		fatal "tab_id が取れない: $tab_json"
	printf '%s\n' "$tab_id" >"$run/tab_id"

	root=$(json_get "$tab_json" result.root_pane.pane_id) || root=""
	if [ -z "$root" ]; then
		list_json=$run/panes.json
		herdr pane list --workspace "$HERDR_WORKSPACE_ID" >"$list_json" || {
			close_tab "$tab_id"
			fatal "pane list が取れない"
		}
		root=$(python3 -c '
import json, sys
tab = sys.argv[2]
data = json.load(open(sys.argv[1], encoding="utf-8"))
panes = data.get("result", {}).get("panes") or []
for p in panes:
    if p.get("tab_id") == tab:
        print(p.get("pane_id", ""))
        break
' "$list_json" "$tab_id") || root=""
	fi
	[ -n "$root" ] || {
		close_tab "$tab_id"
		fatal "root pane が取れない"
	}

	set --
	while IFS= read -r a; do
		[ -n "$a" ] && set -- "$@" "$a"
	done <"$run/advisors"
	[ $# -ge 1 ] || {
		close_tab "$tab_id"
		fatal "選出した advisor が無い"
	}

	left=$root
	right=""
	if [ $# -eq 2 ]; then
		split_json=$run/split.json
		if ! herdr pane split "$root" --direction right --cwd "$PWD" --no-focus >"$split_json"; then
			close_tab "$tab_id"
			fatal "pane を分割できない"
		fi
		right=$(json_get "$split_json" result.pane.pane_id) || {
			close_tab "$tab_id"
			fatal "右 pane が取れない"
		}
	fi

	started=0
	i=0
	for a in "$@"; do
		i=$((i + 1))
		mkdir -p "$run/$a" || {
			close_tab "$tab_id"
			fatal "$run/$a を作れない"
		}
		python3 -c '
import json, sys
kind = sys.argv[2]
for s in json.load(open(sys.argv[1], encoding="utf-8")):
    if s["kind"] == kind:
        json.dump(s, open(sys.argv[3], "w", encoding="utf-8"))
        break
else:
    sys.exit(1)
' "$run/selected.json" "$a" "$run/$a/slot.json" || {
			close_tab "$tab_id"
			fatal "$a の枠が取れない"
		}
		if [ "$i" -eq 1 ]; then
			pane=$left
		else
			pane=$right
		fi
		name=a-$a-$rid
		printf '%s\n' "$name" >"$run/$a/name"
		printf '%s\n' "$pane" >"$run/$a/pane"
		if ! bun "$select_ts" start-argv --slot "$run/$a/slot.json" --name "$name" --pane "$pane" \
			>"$run/$a/argv.json" 2>>"$run/$a/log"; then
			close_tab "$tab_id"
			fatal "$a の argv が組めない"
		fi
		# pane が interactive shell になる前に start すると agent_pane_busy になる
		n=0
		started_one=0
		while [ "$n" -lt 20 ]; do
			if python3 -c '
import json, subprocess, sys
argv = json.load(open(sys.argv[1], encoding="utf-8"))
raise SystemExit(subprocess.run(argv, stdout=open(sys.argv[2], "w", encoding="utf-8")).returncode)
' "$run/$a/argv.json" "$run/$a/start.json" 2>>"$run/$a/log"; then
				started_one=1
				break
			fi
			n=$((n + 1))
			sleep 1
		done
		if [ "$started_one" -eq 1 ] && herdr agent prompt "$name" \
			"次のファイルを読む。コードは変更しない。判断だけを応答に出す。consult を起動しない。agent を start しない。

$run/prompt" >>"$run/$a/log" 2>&1; then
			# working への遷移は観測できれば十分。15 秒で見えなくても prompt は届いている
			herdr agent wait "$name" --until working --timeout 15000 >>"$run/$a/log" 2>&1 || true
			started=$((started + 1))
			printf '%s\n' 0 >"$run/$a/start.rc"
		else
			printf '%s\n' 1 >"$run/$a/start.rc"
			printf 'agent start / prompt に失敗\n' >>"$run/$a/log"
		fi
	done

	if [ "$started" -eq 0 ]; then
		for a in "$@"; do
			printf '=== %s start 失敗 ===\n' "$a" >&2
			tail -n 20 "$run/$a/log" 2>/dev/null >&2
		done
		close_tab "$tab_id"
		fatal "アドバイザーを 1 つも起こせなかった"
	fi
	printf '%s\n' "$run"
	;;

collect)
	[ "${HERDR_ENV:-}" = 1 ] || fatal "Herdr の外では回収できない"
	run=${1:-}
	[ -n "$run" ] && [ -d "$run" ] && [ -f "$run/advisors" ] || fatal "run dir が不正: ${run:-未指定}"
	[ -f "$run/collected" ] && fatal "この run は回収済み: $run（start からやり直す）"
	wait_s=${2:-1200}
	case $wait_s in
	'' | *[!0-9]*) fatal "待ち秒数が数値でない: $wait_s" ;;
	esac
	set --
	while IFS= read -r a; do
		[ -n "$a" ] && set -- "$@" "$a"
	done <"$run/advisors"
	tab_id=""
	[ -f "$run/tab_id" ] && tab_id=$(cat "$run/tab_id")
	deadline=$(($(date +%s) + wait_s))

	incomplete=0
	for a in "$@"; do
		name=""
		reason=""
		[ -f "$run/$a/name" ] && name=$(cat "$run/$a/name")
		start_rc=$(cat "$run/$a/start.rc" 2>/dev/null) || start_rc=1
		if [ -z "$name" ] || [ "$start_rc" != 0 ]; then
			printf '%s\n' 1 >"$run/$a/rc"
			: >"$run/$a/reason"
			incomplete=$((incomplete + 1))
			continue
		fi
		remain=$((deadline - $(date +%s)))
		[ "$remain" -lt 1 ] && remain=1
		# blocked は承認待ちであって完了ではない
		if ! herdr agent wait "$name" --until idle --until done --timeout "$((remain * 1000))" \
			>>"$run/$a/log" 2>&1; then
			reason=timeout
		fi
		herdr agent read "$name" --source recent-unwrapped --lines 400 \
			>"$run/$a/out" 2>>"$run/$a/log" || true
		if [ -z "$reason" ]; then
			if [ ! -f "$select_ts" ] || [ ! -f "$run/marker" ]; then
				reason=predicate欠落
			elif ! command -v bun >/dev/null 2>&1; then
				reason=bun失敗
			else
				marker=$(cat "$run/marker")
				complete_json=$run/$a/complete.json
				bun "$select_ts" complete --output "$run/$a/out" --marker "$marker" \
					>"$complete_json" 2>>"$run/$a/log"
				complete_rc=$?
				if [ "$complete_rc" -eq 0 ]; then
					reason=""
				elif [ "$complete_rc" -eq 2 ]; then
					reason=predicate欠落
				else
					reason=$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(1)
r = d.get("reason")
if isinstance(r, str) and r:
    print(r)
else:
    sys.exit(1)
' "$complete_json") || reason=bun失敗
				fi
			fi
		fi
		if [ -n "$reason" ]; then
			printf '%s\n' 1 >"$run/$a/rc"
			printf '%s\n' "$reason" >"$run/$a/reason"
			incomplete=$((incomplete + 1))
		else
			printf '%s\n' 0 >"$run/$a/rc"
			: >"$run/$a/reason"
		fi
	done

	for a in "$@"; do
		rc=$(cat "$run/$a/rc" 2>/dev/null) || rc=1
		reason=$(cat "$run/$a/reason" 2>/dev/null) || reason=""
		if [ -n "$reason" ]; then
			printf '=== %s (rc=%s %s) ===\n' "$a" "$rc" "$reason"
		else
			printf '=== %s (rc=%s) ===\n' "$a" "$rc"
		fi
		[ -s "$run/$a/out" ] && cat "$run/$a/out"
		if [ "$rc" != 0 ] || [ ! -s "$run/$a/out" ]; then
			printf '(log の末尾)\n'
			tail -n 20 "$run/$a/log" 2>/dev/null
		fi
		printf '\n'
	done

	: >"$run/collected"
	if [ -n "$tab_id" ] && ! herdr tab close "$tab_id" >/dev/null 2>&1; then
		printf 'WARN\ttab を閉じられない: %s\n' "$tab_id" >&2
		exit 1
	fi
	[ "$incomplete" -gt 0 ] && exit 1
	exit 0
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
