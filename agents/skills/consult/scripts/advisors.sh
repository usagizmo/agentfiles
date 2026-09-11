#!/bin/sh
# アドバイザーの起動・対話・回収。同じ pane を巡をまたいで使い回し、文脈を保つ。
# Herdr の tab 1 + 左右 pane で interactive に立て、思考が見えるようにする。
#
#   advisors.sh start <prompt-file>                run dir を作って起動し、巡 1 を送る。run dir を stdout へ
#   advisors.sh collect <run-dir> [wait-seconds]   今の巡が出揃うまで待って出力。既定 1200 秒
#                                                  完了の述語は今の巡の marker。timeout の巡は再 collect できる
#   advisors.sh ask <run-dir> <prompt-file>        次の巡を同じ agent へ送る。今の巡が全員確定している時だけ
#   advisors.sh close <run-dir>                    tab を閉じる。どのモードでも最後に呼ぶ
#
# 状態は run dir のファイルだけ: round / marker.<n> / prompt.<n> / <a>/{start.rc,sent.<n>,rc.<n>,reason.<n>,out.<n>,dead}
# rc.<n> があればその巡は確定（0 = 完走、1 = blocked で終端）。timeout は書かない。
#
# 候補は roster.toml の advisors。選出は advisors.ts。位置引数で kind を渡さない。
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
roster=$here/roster.toml
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

# 巡 n の prompt を run へ置き、marker を付けて 1 agent へ送る
send_round() {
	s_run=$1
	s_a=$2
	s_n=$3
	s_name=$(cat "$s_run/$s_a/name" 2>/dev/null) || return 1
	if herdr agent prompt "$s_name" \
		"次のファイルを読む。コードは変更しない。判断だけを応答に出す。consult を起動しない。agent を start しない。

$s_run/prompt.$s_n" >>"$s_run/$s_a/log" 2>&1; then
		# working への遷移は観測できれば十分。15 秒で見えなくても prompt は届いている
		herdr agent wait "$s_name" --until working --timeout 15000 >>"$s_run/$s_a/log" 2>&1 || true
		printf '%s\n' 0 >"$s_run/$s_a/sent.$s_n"
		return 0
	fi
	printf '%s\n' 1 >"$s_run/$s_a/sent.$s_n"
	printf 'agent prompt に失敗（巡 %s）\n' "$s_n" >>"$s_run/$s_a/log"
	return 1
}

# prompt-file を巡 n の prompt として run へ写し、marker を追記する
place_prompt() {
	p_run=$1
	p_src=$2
	p_n=$3
	p_rid=$(cat "$p_run/rid") || fatal "rid が無い"
	p_marker=ADVISOR-DONE-$p_rid-$p_n
	cp "$p_src" "$p_run/prompt.$p_n" || fatal "prompt を配れない"
	printf '%s\n' "$p_marker" >"$p_run/marker.$p_n" || fatal "marker を書けない"
	printf '\n\n質問・異論・指摘なしのどれでも、応答の最後の行に %s をそのまま書いて応答を終えよ。この指令行は書かない。\n' "$p_marker" >>"$p_run/prompt.$p_n" ||
		fatal "marker を prompt へ追記できない"
}

require_run() {
	[ -n "$1" ] && [ -d "$1" ] && [ -f "$1/advisors" ] && [ -f "$1/round" ] || fatal "run dir が不正: ${1:-未指定}"
	[ -f "$1/closed" ] && fatal "この run は close 済み: $1"
}

# 起動できた agent の一覧（dead を除く）
live_advisors() {
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ "$(cat "$1/$a/start.rc" 2>/dev/null)" = 0 ] || continue
		[ -f "$1/$a/dead" ] && continue
		printf '%s\n' "$a"
	done <"$1/advisors"
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors.sh start <prompt-file> | collect <run-dir> [秒] | ask <run-dir> <prompt-file> | close <run-dir>"
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
	printf '%s\n' "$rid" >"$run/rid" || fatal "rid を書けない"
	cp "$roster" "$run/roster.toml" || fatal "候補表を配れない"
	place_prompt "$run" "$prompt" 1
	printf '%s\n' 1 >"$run/round" || fatal "round を書けない"

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

	if ! bun "$select_ts" select --roster "$run/roster.toml" --self "$self" \
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
import json, pathlib, subprocess, sys
argv = json.load(open(sys.argv[1], encoding="utf-8"))
result = subprocess.run(argv, capture_output=True, text=True)
pathlib.Path(sys.argv[2]).write_text(result.stdout, encoding="utf-8")
sys.stderr.write(result.stderr)
if result.returncode == 0:
    raise SystemExit(0)
try:
    response = json.loads(result.stderr or result.stdout)
except (ValueError, TypeError):
    raise SystemExit(1)
error = response.get("error") if isinstance(response, dict) else None
busy = isinstance(error, dict) and error.get("code") == "agent_pane_busy"
raise SystemExit(75 if busy else 1)
' "$run/$a/argv.json" "$run/$a/start.json" 2>>"$run/$a/log"; then
				started_one=1
				break
			else
				start_result=$?
			fi
			[ "$start_result" -eq 75 ] || break
			n=$((n + 1))
			[ "$n" -lt 20 ] || break
			sleep 1
		done
		if [ "$started_one" -eq 1 ] && send_round "$run" "$a" 1; then
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
	require_run "$run"
	wait_s=${2:-1200}
	case $wait_s in
	'' | *[!0-9]*) fatal "待ち秒数が数値でない: $wait_s" ;;
	esac
	n=$(cat "$run/round")
	[ -f "$run/marker.$n" ] || fatal "巡 $n の marker が無い"
	marker=$(cat "$run/marker.$n")
	prev=""
	[ "$n" -gt 1 ] && prev=$(cat "$run/marker.$((n - 1))")
	[ -f "$select_ts" ] || fatal "述語が無い: $select_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	set --
	while IFS= read -r a; do
		set -- "$@" "$a"
	done <"$run/advisors"
	deadline=$(($(date +%s) + wait_s))

	for a in "$@"; do
		name=$(cat "$run/$a/name" 2>/dev/null) || name=""
		# 既に確定した巡は待たない（終端の理由を上書きしない）
		[ -f "$run/$a/rc.$n" ] && continue
		# 起こせなかった・終端した agent はこの巡に居ない
		if [ "$(cat "$run/$a/start.rc" 2>/dev/null)" != 0 ] || [ -f "$run/$a/dead" ]; then
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "不在" >"$run/$a/reason.$n"
			continue
		fi
		# 送れなかった agent はこの巡で終端する（再送は次の巡ではなく人の判断）
		if [ "$(cat "$run/$a/sent.$n" 2>/dev/null)" != 0 ]; then
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "送信失敗" >"$run/$a/reason.$n"
			: >"$run/$a/dead"
			continue
		fi
		reason=""
		stale_since=""
		while :; do
			remain=$((deadline - $(date +%s)))
			if [ "$remain" -lt 1 ]; then
				reason=timeout
				break
			fi
			wait_json=$run/$a/wait.$n.json
			# idle / done は応答を読む契機。完了は今の巡の marker で判定する。
			if ! herdr agent wait "$name" --until idle --until done --until blocked \
				--timeout "$((remain * 1000))" >"$wait_json" 2>>"$run/$a/log"; then
				# 居なくなった agent は待ち直しても戻らない。timeout と分けて終端する
				if herdr agent get "$name" >/dev/null 2>>"$run/$a/log"; then
					reason=timeout
				else
					reason=消失
				fi
				break
			fi
			status=$(json_get "$wait_json" result.agent.agent_status 2>/dev/null) || status=""
			herdr agent read "$name" --source recent-unwrapped --lines 400 \
				>"$run/$a/raw.$n" 2>>"$run/$a/log" || true
			if bun "$select_ts" complete --output "$run/$a/raw.$n" --marker "$marker" \
				>"$run/$a/complete.$n.json" 2>>"$run/$a/log"; then
				break
			fi
			case $status in
			blocked)
				reason=$status
				break
				;;
			esac
			# marker の無い idle は前の巡の余韻。今の巡の応答が始まるまで待ち直す
			if herdr agent wait "$name" --until working --timeout 2000 >>"$run/$a/log" 2>&1; then
				stale_since=""
				continue
			fi
			sleep 1
			# 60 秒 idle のままなら prompt が届いていない。1 度だけ送り直す
			now=$(date +%s)
			[ -n "$stale_since" ] || stale_since=$now
			if [ $((now - stale_since)) -ge 60 ] && [ ! -f "$run/$a/resent.$n" ]; then
				: >"$run/$a/resent.$n"
				printf '巡 %s の prompt を送り直す\n' "$n" >>"$run/$a/log"
				send_round "$run" "$a" "$n" || true
				stale_since=""
			fi
		done
		# 前の巡の marker より後ろだけを今の巡の出力にする
		if [ -f "$run/$a/raw.$n" ]; then
			python3 -c '
import sys
raw = open(sys.argv[1], encoding="utf-8", errors="replace").read()
prev = sys.argv[3]
if prev:
    i = raw.rfind(prev)
    if i >= 0:
        raw = raw[i + len(prev):]
open(sys.argv[2], "w", encoding="utf-8").write(raw.lstrip("\n"))
' "$run/$a/raw.$n" "$run/$a/out.$n" "$prev" 2>>"$run/$a/log" || cp "$run/$a/raw.$n" "$run/$a/out.$n"
		fi
		case $reason in
		"")
			printf '%s\n' 0 >"$run/$a/rc.$n"
			: >"$run/$a/reason.$n"
			;;
		blocked | 消失)
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "$reason" >"$run/$a/reason.$n"
			: >"$run/$a/dead"
			;;
		*)
			# timeout は確定させない。再 collect で続きを待てる
			printf '%s\n' "$reason" >"$run/$a/reason.$n"
			;;
		esac
	done

	for a in "$@"; do
		rc=$(cat "$run/$a/rc.$n" 2>/dev/null) || rc=1
		reason=$(cat "$run/$a/reason.$n" 2>/dev/null) || reason=""
		if [ -n "$reason" ]; then
			printf '=== %s 巡 %s (rc=%s %s) ===\n' "$a" "$n" "$rc" "$reason"
		else
			printf '=== %s 巡 %s (rc=%s) ===\n' "$a" "$n" "$rc"
		fi
		[ -s "$run/$a/out.$n" ] && cat "$run/$a/out.$n"
		if [ "$rc" != 0 ] || [ ! -s "$run/$a/out.$n" ]; then
			printf '(log の末尾)\n'
			tail -n 20 "$run/$a/log" 2>/dev/null
		fi
		printf '\n'
	done

	# 非ゼロは「この巡に居るはずの agent に未完了がある」。起こせなかった agent は数えない
	for a in "$@"; do
		[ "$(cat "$run/$a/reason.$n" 2>/dev/null)" = "不在" ] && continue
		[ "$(cat "$run/$a/rc.$n" 2>/dev/null)" = 0 ] || exit 1
	done
	exit 0
	;;
ask)
	[ "${HERDR_ENV:-}" = 1 ] || fatal "Herdr の外では送れない"
	run=${1:-}
	require_run "$run"
	prompt=${2:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	n=$(cat "$run/round")
	live=$(live_advisors "$run")
	[ -n "$live" ] || fatal "生きている advisor が無い"
	for a in $live; do
		[ -f "$run/$a/rc.$n" ] && continue
		[ -f "$run/$a/reason.$n" ] || fatal "巡 $n が未回収: $a（collect を先に通す）"
		# timeout した agent は、まだ働いているなら送らない。完走していたら回収させる。
		# 止まったまま完走していないなら終端して残りで進む
		name=$(cat "$run/$a/name")
		herdr agent wait "$name" --until idle --until done --until blocked --timeout 1000 \
			>>"$run/$a/log" 2>&1 || fatal "巡 $n を $a がまだ処理中（collect を先に通す）"
		herdr agent read "$name" --source recent-unwrapped --lines 400 >"$run/$a/raw.$n" 2>>"$run/$a/log" ||
			fatal "巡 $n の $a を読めない（終端しない。collect をやり直す）"
		bun "$select_ts" complete --output "$run/$a/raw.$n" --marker "$(cat "$run/marker.$n")" \
			>/dev/null 2>>"$run/$a/log"
		case $? in
		0) fatal "巡 $n を $a が完走している（collect で回収してから ask する）" ;;
		1) ;;
		*) fatal "巡 $n の $a を判定できない（終端しない。collect をやり直す）" ;;
		esac
		printf '%s\n' 1 >"$run/$a/rc.$n"
		printf '%s\n' "timeout" >"$run/$a/reason.$n"
		: >"$run/$a/dead"
	done
	live=$(live_advisors "$run")
	[ -n "$live" ] || fatal "生きている advisor が無い"
	next=$((n + 1))
	place_prompt "$run" "$prompt" "$next"
	printf '%s\n' "$next" >"$run/round" || fatal "round を書けない"
	sent=0
	for a in $live; do
		send_round "$run" "$a" "$next" && sent=$((sent + 1))
	done
	[ "$sent" -ge 1 ] || fatal "巡 $next を 1 つも送れなかった"
	printf '%s\n' "$next"
	;;
close)
	run=${1:-}
	[ -n "$run" ] && [ -d "$run" ] || fatal "run dir が不正: ${run:-未指定}"
	[ -f "$run/closed" ] && exit 0
	tab_id=""
	[ -f "$run/tab_id" ] && tab_id=$(cat "$run/tab_id")
	if [ -n "$tab_id" ] && ! herdr tab close "$tab_id" >/dev/null 2>&1; then
		printf 'WARN\ttab を閉じられない: %s\n' "$tab_id" >&2
		exit 1
	fi
	: >"$run/closed"
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
