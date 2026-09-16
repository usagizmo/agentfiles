#!/bin/sh
# dispatch の tmux / pty DispatchBackend。実装役 1 体を write 可で interactive 起動する。
# consult の advisors-tmux.sh（read-only・複数）とは別経路。silent fallback しない。
#
#   worker-tmux.sh start <prompt-file>                 run dir を stdout へ。巡 1 を送る
#   worker-tmux.sh collect <run-dir> [wait-seconds] [stall-seconds]
#                          marker 完走を待って出力。既定 1200 秒。画面が stall 秒（既定 120）変わらず
#                          処理中でもなければ「停滞」で早く戻る（承認待ちなどを 20 分待たせない）
#   worker-tmux.sh ask <run-dir> <prompt-file>         次の巡を同じ session へ送る
#   worker-tmux.sh close <run-dir>                     tmux session を破棄
#
# env:
#   DISPATCH_KIND   任意。roster の [resolve] を上書きする kind（例: claude / codex）
#
# 完走述語は advisors.ts complete（consult と共有。marker SSOT）。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

fail_start() {
	msg=$1
	printf '(log の末尾)\n' >&2
	tail -n 20 "$run/log" >&2 2>/dev/null || true
	rm -rf "$run"
	fatal "$msg"
}

here=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd) ||
	fatal "スクリプトの場所が取れない"
roster_ts=$here/roster.ts
complete_ts=$here/advisors.ts
tmux_sh=$here/tmux-session.sh
roster_toml=$here/roster.toml

place_prompt() {
	p_run=$1
	p_src=$2
	p_n=$3
	p_rid=$(cat "$p_run/rid") || fatal "rid が無い"
	p_marker=WORKER-DONE-$p_rid-$p_n
	cp "$p_src" "$p_run/prompt.$p_n" || fatal "prompt を配れない"
	printf '%s\n' "$p_marker" >"$p_run/marker.$p_n" || fatal "marker を書けない"
	printf '\n\n作業の区切りとして、応答の最後の行に %s をそのまま書いて応答を終えよ。この指令行は書かない。\n' "$p_marker" >>"$p_run/prompt.$p_n" ||
		fatal "marker を prompt へ追記できない"
}

require_run() {
	[ -n "$1" ] && [ -d "$1" ] && [ -f "$1/worker" ] && [ -f "$1/round" ] || fatal "run dir が不正: ${1:-未指定}"
	[ -f "$1/closed" ] && fatal "この run は close 済み: $1"
	[ -f "$1/backend" ] && [ "$(cat "$1/backend")" = tmux ] || fatal "tmux backend の run ではない: ${1:-未指定}"
	[ -f "$1/layer" ] && [ "$(cat "$1/layer")" = dispatch ] || fatal "dispatch の run ではない: ${1:-未指定}"
}

send_round() {
	s_run=$1
	s_n=$2
	s_session=$(cat "$s_run/session" 2>/dev/null) || return 1
	if ! sh "$tmux_sh" exists "$s_session"; then
		printf 'session が消えている（巡 %s）\n' "$s_n" >>"$s_run/log"
		printf '%s\n' 1 >"$s_run/sent.$s_n"
		return 1
	fi
	if sh "$tmux_sh" paste-file "$s_session" "$s_run/prompt.$s_n" >>"$s_run/log" 2>&1; then
		printf '%s\n' 0 >"$s_run/sent.$s_n"
		return 0
	fi
	printf '%s\n' 1 >"$s_run/sent.$s_n"
	printf 'paste-file に失敗（巡 %s）\n' "$s_n" >>"$s_run/log"
	return 1
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: worker-tmux.sh start|collect|ask|close ..."
shift

case "$cmd" in
start)
	command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	[ -f "$roster_ts" ] || fatal "roster.ts が無い: $roster_ts"
	[ -f "$roster_toml" ] || fatal "roster.toml が無い: $roster_toml"
	[ -f "$tmux_sh" ] || fatal "tmux-session.sh が無い: $tmux_sh"
	[ -f "$complete_ts" ] || fatal "advisors.ts が無い: $complete_ts"

	prompt=${1:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	case $prompt in
	/*) ;;
	*) prompt=$(CDPATH= cd -P -- "$(dirname "$prompt")" && pwd)/$(basename "$prompt") ;;
	esac
	[ $# -eq 1 ] || fatal "余分な引数がある"

	run=$(mktemp -d "${TMPDIR:-/tmp}/worker-tmux.XXXXXX") || fatal "run dir を作れない"
	rid=$(basename "$run")
	rid=${rid#worker-tmux.}
	rid=$(printf '%s' "$rid" | tr 'A-Z' 'a-z')
	printf '%s\n' "$rid" >"$run/rid" || fatal "rid を書けない"
	printf '%s\n' tmux >"$run/backend" || fatal "backend を書けない"
	printf '%s\n' dispatch >"$run/layer" || fatal "layer を書けない"
	cp "$roster_toml" "$run/roster.toml" || fatal "候補表を配れない"
	place_prompt "$run" "$prompt" 1
	printf '%s\n' 1 >"$run/round" || fatal "round を書けない"

	# kind も argv も roster.ts が返す（toml をここで読み直さない）
	set -- --roster "$run/roster.toml"
	[ -n "${DISPATCH_KIND:-}" ] && set -- "$@" --kind "$DISPATCH_KIND"
	bun "$roster_ts" resolve-launch-argv "$@" --print kind \
		>"$run/worker" 2>>"$run/log" || fail_start "resolve.kind を読めない"
	bun "$roster_ts" resolve-launch-argv "$@" --print argv \
		>"$run/argv" 2>>"$run/log" || fail_start "resolve-launch-argv に失敗"

	# 起動 argv は 1 行 1 要素。sh の位置引数へそのまま積む
	set --
	while IFS= read -r arg; do set -- "$@" "$arg"; done <"$run/argv"
	if [ $# -eq 0 ] || ! command -v "$1" >/dev/null 2>&1; then
		fail_start "実行ファイルが PATH に無い: ${1:-?}"
	fi

	session=d-$(cat "$run/worker")-$rid
	printf '%s\n' "$session" >"$run/session"
	caller_cwd=$PWD
	# 起こせなかった理由は open が log へ FATAL 行で残す
	if ! sh "$tmux_sh" open "$session" "$caller_cwd" -- "$@" >>"$run/log" 2>&1; then
		fail_start "worker を起こせない"
	fi
	if ! send_round "$run" 1; then
		sh "$tmux_sh" kill "$session" >>"$run/log" 2>&1 || true
		fail_start "初回 prompt 送信に失敗"
	fi
	printf '%s\n' 0 >"$run/start.rc"
	printf '%s\n' "$run"
	;;

collect)
	run=${1:-}
	require_run "$run"
	wait_s=${2:-1200}
	case $wait_s in
	'' | *[!0-9]*) fatal "待ち秒数が数値でない: $wait_s" ;;
	esac
	stall_s=${3:-120}
	case $stall_s in
	'' | *[!0-9]*) fatal "停滞秒数が数値でない: $stall_s" ;;
	esac
	n=$(cat "$run/round")
	[ -f "$run/marker.$n" ] || fatal "巡 $n の marker が無い"
	marker=$(cat "$run/marker.$n")
	prev=""
	[ "$n" -gt 1 ] && prev=$(cat "$run/marker.$((n - 1))")
	deadline=$(($(date +%s) + wait_s))

	if [ ! -f "$run/rc.$n" ]; then
		if [ "$(cat "$run/sent.$n" 2>/dev/null)" != 0 ]; then
			printf '%s\n' 1 >"$run/rc.$n"
			printf '%s\n' "送信失敗" >"$run/reason.$n"
			: >"$run/dead"
		else
			session=$(cat "$run/session")
			final=0
			last_screen=""
			last_change=$(date +%s)
			while :; do
				[ -f "$run/rc.$n" ] && break
				if ! sh "$tmux_sh" exists "$session"; then
					printf '%s\n' 1 >"$run/rc.$n"
					printf '%s\n' "消失" >"$run/reason.$n"
					: >"$run/dead"
					break
				fi
				case $(sh "$tmux_sh" state "$session" 2>>"$run/log") in
				fatal)
					sh "$tmux_sh" capture "$session" >"$run/raw.$n" 2>>"$run/log" || true
					if [ -f "$run/raw.$n" ]; then
						bun "$complete_ts" extract --raw "$run/raw.$n" --prev "$prev" \
							>"$run/out.$n" 2>>"$run/log" || cp "$run/raw.$n" "$run/out.$n"
					fi
					printf '%s\n' 1 >"$run/rc.$n"
					printf '%s\n' "不通" >"$run/reason.$n"
					: >"$run/dead"
					break
					;;
				esac
				# complete_rc: 0 完走 / 1 未完走 / それ以外は読めない・判定できない
				complete_rc=2
				if sh "$tmux_sh" capture "$session" >"$run/raw.$n" 2>>"$run/log"; then
					bun "$complete_ts" complete --output "$run/raw.$n" --marker "$marker" \
						>"$run/complete.$n.json" 2>>"$run/log"
					complete_rc=$?
				fi
				if [ "$complete_rc" = 0 ]; then
					bun "$complete_ts" extract --raw "$run/raw.$n" --prev "$prev" \
						>"$run/out.$n" 2>>"$run/log" || cp "$run/raw.$n" "$run/out.$n"
					printf '%s\n' 0 >"$run/rc.$n"
					: >"$run/reason.$n"
					break
				fi
				# 停止の疑い: 画面が stall 秒変わらない、または deadline 到達
				screen=$(sh "$tmux_sh" screen "$session" 2>>"$run/log") || screen=$last_screen
				if [ "$screen" != "$last_screen" ]; then
					last_screen=$screen
					last_change=$(date +%s)
				fi
				stalled=0
				[ $(($(date +%s) - last_change)) -ge "$stall_s" ] && stalled=1
				at_deadline=0
				[ "$(date +%s)" -ge "$deadline" ] && at_deadline=1
				if [ "$stalled" = 0 ] && [ "$at_deadline" = 0 ]; then
					sleep 1
					continue
				fi
				if [ -f "$run/raw.$n" ]; then
					bun "$complete_ts" extract --raw "$run/raw.$n" --prev "$prev" \
						>"$run/out.$n" 2>>"$run/log" || cp "$run/raw.$n" "$run/out.$n"
				fi
				case $(sh "$tmux_sh" state "$session" 2>>"$run/log") in
				working)
					# 稼働中は deadline まで待つ。timeout は再 collect できる
					if [ "$at_deadline" = 1 ]; then
						printf '%s\n' timeout >"$run/reason.$n"
						break
					fi
					sleep 1
					continue
					;;
				ready)
					# 入力待ちなら履歴をもう 1 度読んで完走判定をやり直す。
					# 終端にするのは、その再読込が成功して未完走と判定できたときだけ。読めなければ timeout
					if [ "$final" = 0 ]; then
						final=1
						continue
					fi
					if [ "$complete_rc" != 1 ]; then
						printf '%s\n' timeout >"$run/reason.$n"
						break
					fi
					printf '%s\n' 1 >"$run/rc.$n"
					printf '%s\n' "marker 無し" >"$run/reason.$n"
					: >"$run/dead"
					break
					;;
				*)
					# 読めない画面（承認待ちなど）。rc も dead も書かない
					if [ "$at_deadline" = 1 ]; then
						printf '%s\n' timeout >"$run/reason.$n"
					else
						printf '%s\n' "停滞" >"$run/reason.$n"
					fi
					break
					;;
				esac
			done
		fi
	fi

	rc=$(cat "$run/rc.$n" 2>/dev/null) || rc=1
	reason=$(cat "$run/reason.$n" 2>/dev/null) || reason=""
	w=$(cat "$run/worker")
	if [ -n "$reason" ]; then
		printf '=== %s 巡 %s (rc=%s %s) ===\n' "$w" "$n" "$rc" "$reason"
	else
		printf '=== %s 巡 %s (rc=%s) ===\n' "$w" "$n" "$rc"
	fi
	[ -s "$run/out.$n" ] && cat "$run/out.$n"
	if [ "$rc" != 0 ] || [ ! -s "$run/out.$n" ]; then
		printf '(log の末尾)\n'
		tail -n 20 "$run/log" 2>/dev/null
	fi
	printf '\n'
	[ "$rc" = 0 ] || exit 1
	exit 0
	;;

ask)
	run=${1:-}
	require_run "$run"
	prompt=${2:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	[ -f "$run/dead" ] && fatal "worker は終端している"
	n=$(cat "$run/round")
	if [ ! -f "$run/rc.$n" ]; then
		[ -f "$run/reason.$n" ] || fatal "巡 $n が未回収（collect を先に通す）"
		session=$(cat "$run/session")
		if ! sh "$tmux_sh" exists "$session"; then
			printf '%s\n' 1 >"$run/rc.$n"
			printf '%s\n' "消失" >"$run/reason.$n"
			: >"$run/dead"
			fatal "生きている worker が無い"
		fi
		sh "$tmux_sh" capture "$session" >"$run/raw.$n" 2>>"$run/log" ||
			fatal "巡 $n を読めない（collect をやり直す）"
		bun "$complete_ts" complete --output "$run/raw.$n" --marker "$(cat "$run/marker.$n")" \
			>/dev/null 2>>"$run/log"
		case $? in
		0) fatal "巡 $n は完走している（collect で回収してから ask する）" ;;
		1) ;;
		*) fatal "巡 $n を判定できない（collect をやり直す）" ;;
		esac
		case $(sh "$tmux_sh" state "$session") in
		working) fatal "巡 $n はまだ処理中（collect を先に通す）" ;;
		ready) ;;
		*) fatal "巡 $n の状態を読めない（終端しない。collect をやり直す）" ;;
		esac
		printf '%s\n' 1 >"$run/rc.$n"
		printf '%s\n' "timeout" >"$run/reason.$n"
		: >"$run/dead"
		fatal "生きている worker が無い"
	fi
	[ "$(cat "$run/rc.$n")" = 0 ] || fatal "巡 $n は失敗終端（ask できない）"
	next=$((n + 1))
	place_prompt "$run" "$prompt" "$next"
	printf '%s\n' "$next" >"$run/round" || fatal "round を書けない"
	send_round "$run" "$next" || fatal "巡 $next を送れなかった"
	printf '%s\n' "$next"
	;;

close)
	run=${1:-}
	[ -n "$run" ] && [ -d "$run" ] || fatal "run dir が不正: ${run:-未指定}"
	[ -f "$run/closed" ] && exit 0
	[ -f "$run/backend" ] || fatal "backend が無い: $run"
	[ "$(cat "$run/backend")" = tmux ] || fatal "tmux backend の run ではない: $run"
	[ -f "$run/layer" ] && [ "$(cat "$run/layer")" = dispatch ] || fatal "dispatch の run ではない: $run"
	session=$(cat "$run/session" 2>/dev/null) || session=""
	if [ -n "$session" ]; then
		if ! sh "$tmux_sh" kill "$session" >>"$run/log" 2>&1; then
			printf 'WARN\tsession を殺せない: %s\n' "$session" >&2
			exit 1
		fi
	fi
	: >"$run/closed"
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
