#!/bin/sh
# アドバイザーの起動と回収。**同じ run を 2 度使えない形にするのが目的。**
# Herdr の tab 1 + 左右 pane で interactive に立て、思考が見えるようにする。
#
#   advisors.sh start <prompt-file> <advisor>...   run dir を作って起動。run dir を stdout へ
#   advisors.sh collect <run-dir> [wait-seconds]   出揃うまで待って出力。既定 1200 秒
#                                                  1 run 1 回。2 度目は落ちる
#
# advisor は codex / claude / grok。**実行中の自分自身を除いた 2 つ**を呼び出し側が選ぶ。
# 不変条件: アドバイザーにコードを変更させない（codex は -s read-only、他は --permission-mode plan）。
# Herdr の外では立てない。headless CLI に倒さない。

set -u
LC_ALL=C
export LC_ALL

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

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

kind_args() {
	case $1 in
	codex) printf '%s\n' -s read-only ;;
	claude | grok) printf '%s\n' --permission-mode plan ;;
	*) fatal "未知の advisor: $1" ;;
	esac
}

close_tab() {
	c_tab=$1
	[ -n "$c_tab" ] || return 0
	herdr tab close "$c_tab" >/dev/null 2>&1 || true
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors.sh start <prompt-file> <advisor>... | collect <run-dir> [秒]"
shift

case "$cmd" in
start)
	[ "${HERDR_ENV:-}" = 1 ] || fatal "Herdr の外ではアドバイザーを立てない"
	command -v herdr >/dev/null 2>&1 || fatal "herdr が PATH に無い"
	[ -n "${HERDR_WORKSPACE_ID:-}" ] || fatal "HERDR_WORKSPACE_ID が無い"

	prompt=${1:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	case $prompt in
	/*) ;;
	*) prompt=$(CDPATH= cd -P -- "$(dirname "$prompt")" && pwd)/$(basename "$prompt") ;;
	esac
	shift
	[ $# -ge 1 ] || fatal "advisor を 1 つ以上指定する"
	[ $# -le 2 ] || fatal "advisor は 2 つまで（左右 2 pane）"

	for a in "$@"; do
		case "$a" in codex | claude | grok) ;; *) fatal "未知の advisor: $a" ;; esac
	done

	run=$(mktemp -d "${TMPDIR:-/tmp}/advisors.XXXXXX") || fatal "run dir を作れない"
	rid=$(basename "$run")
	rid=${rid#advisors.}
	rid=$(printf '%s' "$rid" | tr 'A-Z' 'a-z')
	printf '%s\n' "$*" >"$run/advisors"
	cp "$prompt" "$run/prompt" || fatal "prompt を配れない"

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
	for a in $(cat "$run/advisors"); do
		i=$((i + 1))
		mkdir -p "$run/$a" || {
			close_tab "$tab_id"
			fatal "$run/$a を作れない"
		}
		if [ "$i" -eq 1 ]; then
			pane=$left
		else
			pane=$right
		fi
		name=a-$a-$rid
		printf '%s\n' "$name" >"$run/$a/name"
		printf '%s\n' "$pane" >"$run/$a/pane"
		extra=$(kind_args "$a")
		# extra はスクリプトが出すフラグだけ。IFS 分割して -- の後ろへ渡す
		# pane が interactive shell になる前に start すると agent_pane_busy になる
		# shellcheck disable=SC2086
		n=0
		started_one=0
		while [ "$n" -lt 20 ]; do
			if herdr agent start "$name" --kind "$a" --pane "$pane" --timeout 90000 -- $extra \
				>"$run/$a/start.json" 2>>"$run/$a/log"; then
				started_one=1
				break
			fi
			n=$((n + 1))
			sleep 1
		done
		if [ "$started_one" -eq 1 ] && herdr agent prompt "$name" \
			"次のファイルを読め。コードは変更するな。判断だけを応答に出せ。

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
		for a in $(cat "$run/advisors"); do
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
	names=$(cat "$run/advisors")
	tab_id=""
	[ -f "$run/tab_id" ] && tab_id=$(cat "$run/tab_id")
	deadline=$(($(date +%s) + wait_s))

	incomplete=0
	for a in $names; do
		name=""
		[ -f "$run/$a/name" ] && name=$(cat "$run/$a/name")
		start_rc=$(cat "$run/$a/start.rc" 2>/dev/null) || start_rc=1
		if [ -z "$name" ] || [ "$start_rc" != 0 ]; then
			printf '%s\n' 1 >"$run/$a/rc"
			incomplete=$((incomplete + 1))
			continue
		fi
		remain=$((deadline - $(date +%s)))
		[ "$remain" -lt 1 ] && remain=1
		# blocked は承認待ちであって完了ではない
		if herdr agent wait "$name" --until idle --until done --timeout "$((remain * 1000))" \
			>>"$run/$a/log" 2>&1; then
			printf '%s\n' 0 >"$run/$a/rc"
		else
			printf '%s\n' 1 >"$run/$a/rc"
			incomplete=$((incomplete + 1))
		fi
		herdr agent read "$name" --source recent-unwrapped --lines 400 \
			>"$run/$a/out" 2>>"$run/$a/log" || true
	done

	for a in $names; do
		rc=$(cat "$run/$a/rc" 2>/dev/null) || rc=1
		printf '=== %s (rc=%s) ===\n' "$a" "$rc"
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
