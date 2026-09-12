#!/bin/sh
# consult の tmux / pty ConsultBackend。interactive harness を実端末で駆動する。
# CONSULT_BACKEND=tmux 経由、または本 script を直接呼ぶ。
#
#   advisors-tmux.sh start <prompt-file>                run dir を stdout へ。巡 1 を送る
#   advisors-tmux.sh collect <run-dir> [wait-seconds]   今の巡の marker 完走を待って出力。既定 1200 秒
#   advisors-tmux.sh ask <run-dir> <prompt-file>        次の巡を同じ session へ送る
#   advisors-tmux.sh close <run-dir>                    tmux session を破棄
#
# 必須 env:
#   CONSULT_SELF_KIND  自己 kind（観測は env。LLM 自己申告は禁止）
#
# 状態ファイル契約（round / marker / prompt / <a>/{start.rc,sent,rc,reason,out,dead}）。
# silent fallback しない。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

here=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd) ||
	fatal "スクリプトの場所が取れない"
roster=$here/roster.toml
select_ts=$here/advisors.ts
tmux_sh=$here/tmux-session.sh

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
	[ -f "$1/backend" ] && [ "$(cat "$1/backend")" = tmux ] || fatal "tmux backend の run ではない: ${1:-未指定}"
}

live_advisors() {
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ "$(cat "$1/$a/start.rc" 2>/dev/null)" = 0 ] || continue
		[ -f "$1/$a/dead" ] && continue
		printf '%s\n' "$a"
	done <"$1/advisors"
}

# 巡 n の prompt を 1 session へ paste する
send_round() {
	s_run=$1
	s_a=$2
	s_n=$3
	s_session=$(cat "$s_run/$s_a/session" 2>/dev/null) || return 1
	if ! sh "$tmux_sh" exists "$s_session"; then
		printf 'session が消えている（巡 %s）\n' "$s_n" >>"$s_run/$s_a/log"
		printf '%s\n' 1 >"$s_run/$s_a/sent.$s_n"
		return 1
	fi
	if sh "$tmux_sh" paste-file "$s_session" "$s_run/prompt.$s_n" >>"$s_run/$s_a/log" 2>&1; then
		printf '%s\n' 0 >"$s_run/$s_a/sent.$s_n"
		return 0
	fi
	printf '%s\n' 1 >"$s_run/$s_a/sent.$s_n"
	printf 'paste-file に失敗（巡 %s）\n' "$s_n" >>"$s_run/$s_a/log"
	return 1
}

kill_sessions() {
	k_run=$1
	[ -f "$k_run/advisors" ] || return 0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		session=$(cat "$k_run/$a/session" 2>/dev/null) || continue
		sh "$tmux_sh" kill "$session" >>"$k_run/$a/log" 2>&1 || true
	done <"$k_run/advisors"
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors-tmux.sh start <prompt-file> | collect <run-dir> [秒] | ask <run-dir> <prompt-file> | close <run-dir>"
shift

case "$cmd" in
start)
	command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	[ -f "$roster" ] || fatal "候補表が無い: $roster"
	[ -f "$select_ts" ] || fatal "選出スクリプトが無い: $select_ts"
	[ -f "$tmux_sh" ] || fatal "tmux-session.sh が無い: $tmux_sh"
	self=${CONSULT_SELF_KIND:-}
	[ -n "$self" ] || fatal "CONSULT_SELF_KIND が無い（自己 kind は env で明示する）"
	# env に自己の印があれば観測が優先。申告と食い違えば止まる
	self=$(bun "$select_ts" self-kind --declared "$self") || fatal "自己 kind を確定できない"

	prompt=${1:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	case $prompt in
	/*) ;;
	*) prompt=$(CDPATH= cd -P -- "$(dirname "$prompt")" && pwd)/$(basename "$prompt") ;;
	esac
	[ $# -eq 1 ] || fatal "advisor の位置引数は渡さない"

	run=$(mktemp -d "${TMPDIR:-/tmp}/advisors-tmux.XXXXXX") || fatal "run dir を作れない"
	rid=$(basename "$run")
	rid=${rid#advisors-tmux.}
	rid=$(printf '%s' "$rid" | tr 'A-Z' 'a-z')
	printf '%s\n' "$rid" >"$run/rid" || fatal "rid を書けない"
	printf '%s\n' tmux >"$run/backend" || fatal "backend を書けない"
	printf '%s\n' "$self" >"$run/self" || fatal "self を書けない"
	cp "$roster" "$run/roster.toml" || fatal "候補表を配れない"
	place_prompt "$run" "$prompt" 1
	printf '%s\n' 1 >"$run/round" || fatal "round を書けない"

	# select は選出した kind を行で返す
	if ! bun "$select_ts" select --roster "$run/roster.toml" --self "$self" \
		>"$run/advisors" 2>"$run/select.err"; then
		cat "$run/select.err" >&2
		rm -rf "$run"
		fatal "選出できない"
	fi
	cat "$run/select.err" >&2 || true
	[ -s "$run/advisors" ] || fatal "選出結果が空"

	# 選出された kind ごとに独立 session。cwd は呼び出し元
	caller_cwd=$PWD
	started=0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		mkdir -p "$run/$a" || {
			kill_sessions "$run"
			rm -rf "$run"
			fatal "$run/$a を作れない"
		}
		session=c-$a-$rid
		session=$(printf '%s' "$session" | tr -cd 'a-zA-Z0-9_-' | cut -c1-50)
		printf '%s\n' "$session" >"$run/$a/session"
		printf '%s\n' "$session" >"$run/$a/name"
		# 起動 argv は 1 行 1 要素。sh の位置引数へそのまま積む
		if ! bun "$select_ts" launch-argv --roster "$run/roster.toml" --kind "$a" \
			>"$run/$a/argv" 2>>"$run/$a/log"; then
			printf '%s\n' 1 >"$run/$a/start.rc"
			printf 'launch-argv に失敗\n' >>"$run/$a/log"
			continue
		fi
		set --
		while IFS= read -r arg; do set -- "$@" "$arg"; done <"$run/$a/argv"
		if [ $# -eq 0 ] || ! command -v "$1" >/dev/null 2>&1; then
			printf '%s\n' 1 >"$run/$a/start.rc"
			printf '実行ファイルが PATH に無い: %s\n' "${1:-?}" >>"$run/$a/log"
			continue
		fi
		if ! sh "$tmux_sh" create "$session" "$caller_cwd" -- "$@" >>"$run/$a/log" 2>&1; then
			printf '%s\n' 1 >"$run/$a/start.rc"
			printf 'tmux create に失敗\n' >>"$run/$a/log"
			continue
		fi
		# Claude の workspace trust 対話があれば Yes を選ぶ
		sh "$tmux_sh" accept-trust "$session" 20 >>"$run/$a/log" 2>&1 || true
		sh "$tmux_sh" wait-ready "$session" 45 >>"$run/$a/log" 2>&1
		wr=$?
		if [ "$wr" -ne 0 ]; then
			printf '%s\n' 1 >"$run/$a/start.rc"
			if [ "$wr" -eq 3 ]; then
				printf 'trust 対話を越えられない: %s\n' "$caller_cwd" >>"$run/$a/log"
			else
				printf 'wait-ready に失敗（TUI 未準備）\n' >>"$run/$a/log"
			fi
			sh "$tmux_sh" kill "$session" >>"$run/$a/log" 2>&1 || true
			continue
		fi
		if send_round "$run" "$a" 1; then
			started=$((started + 1))
			printf '%s\n' 0 >"$run/$a/start.rc"
		else
			printf '%s\n' 1 >"$run/$a/start.rc"
			printf '初回 prompt 送信に失敗\n' >>"$run/$a/log"
			sh "$tmux_sh" kill "$session" >>"$run/$a/log" 2>&1 || true
		fi
	done <"$run/advisors"

	if [ "$started" -eq 0 ]; then
		while IFS= read -r a; do
			[ -n "$a" ] || continue
			printf '=== %s start 失敗 ===\n' "$a" >&2
			tail -n 20 "$run/$a/log" 2>/dev/null >&2
		done <"$run/advisors"
		kill_sessions "$run"
		rm -rf "$run"
		fatal "アドバイザーを 1 つも起こせなかった"
	fi
	printf '%s\n' "$run"
	;;

collect)
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
	deadline=$(($(date +%s) + wait_s))

	# 不在・送信失敗を先に確定
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ -f "$run/$a/rc.$n" ] && continue
		if [ "$(cat "$run/$a/start.rc" 2>/dev/null)" != 0 ] || [ -f "$run/$a/dead" ]; then
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "不在" >"$run/$a/reason.$n"
			continue
		fi
		if [ "$(cat "$run/$a/sent.$n" 2>/dev/null)" != 0 ]; then
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "送信失敗" >"$run/$a/reason.$n"
			: >"$run/$a/dead"
		fi
	done <"$run/advisors"

	# 全員を round-robin で観測（1 体が待ちを食い尽くさない）
	# timeout は rc を書かないので、再 collect で続きを観測できる
	while :; do
		pending=0
		while IFS= read -r a; do
			[ -n "$a" ] || continue
			[ -f "$run/$a/rc.$n" ] && continue
			pending=1
			session=$(cat "$run/$a/session")
			if ! sh "$tmux_sh" exists "$session"; then
				printf '%s\n' 1 >"$run/$a/rc.$n"
				printf '%s\n' "消失" >"$run/$a/reason.$n"
				: >"$run/$a/dead"
				continue
			fi
			sh "$tmux_sh" capture "$session" >"$run/$a/raw.$n" 2>>"$run/$a/log" || true
			if bun "$select_ts" complete --output "$run/$a/raw.$n" --marker "$marker" \
				>"$run/$a/complete.$n.json" 2>>"$run/$a/log"; then
				bun "$select_ts" extract --raw "$run/$a/raw.$n" --prev "$prev" \
					>"$run/$a/out.$n" 2>>"$run/$a/log" || cp "$run/$a/raw.$n" "$run/$a/out.$n"
				printf '%s\n' 0 >"$run/$a/rc.$n"
				: >"$run/$a/reason.$n"
			fi
		done <"$run/advisors"
		[ "$pending" -eq 0 ] && break
		if [ "$(date +%s)" -ge "$deadline" ]; then
			while IFS= read -r a; do
				[ -n "$a" ] || continue
				[ -f "$run/$a/rc.$n" ] && continue
				printf '%s\n' timeout >"$run/$a/reason.$n"
				if [ -f "$run/$a/raw.$n" ]; then
					bun "$select_ts" extract --raw "$run/$a/raw.$n" --prev "$prev" \
						>"$run/$a/out.$n" 2>>"$run/$a/log" || cp "$run/$a/raw.$n" "$run/$a/out.$n"
				fi
			done <"$run/advisors"
			break
		fi
		sleep 1
	done

	while IFS= read -r a; do
		[ -n "$a" ] || continue
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
	done <"$run/advisors"

	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ "$(cat "$run/$a/reason.$n" 2>/dev/null)" = "不在" ] && continue
		[ "$(cat "$run/$a/rc.$n" 2>/dev/null)" = 0 ] || exit 1
	done <"$run/advisors"
	exit 0
	;;

ask)
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
		# timeout: 完走なら collect を要求。稼働中なら止める。止まって未完走なら終端
		session=$(cat "$run/$a/session")
		if ! sh "$tmux_sh" exists "$session"; then
			printf '%s\n' 1 >"$run/$a/rc.$n"
			printf '%s\n' "消失" >"$run/$a/reason.$n"
			: >"$run/$a/dead"
			continue
		fi
		sh "$tmux_sh" capture "$session" >"$run/$a/raw.$n" 2>>"$run/$a/log" ||
			fatal "巡 $n の $a を読めない（終端しない。collect をやり直す）"
		bun "$select_ts" complete --output "$run/$a/raw.$n" --marker "$(cat "$run/marker.$n")" \
			>/dev/null 2>>"$run/$a/log"
		case $? in
		0) fatal "巡 $n を $a が完走している（collect で回収してから ask する）" ;;
		1) ;;
		*) fatal "巡 $n の $a を判定できない（終端しない。collect をやり直す）" ;;
		esac
		# 終端してよいのは、表示中の画面が入力待ちに戻っているときだけ
		case $(sh "$tmux_sh" state "$session") in
		working) fatal "巡 $n を $a がまだ処理中（collect を先に通す）" ;;
		ready) ;;
		*) fatal "巡 $n の $a の状態を読めない（終端しない。collect をやり直す）" ;;
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
	[ -f "$run/backend" ] || fatal "backend が無い（tmux run ではない）: $run"
	[ "$(cat "$run/backend")" = tmux ] || fatal "tmux backend の run ではない: $run"
	fail=0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		session=$(cat "$run/$a/session" 2>/dev/null) || continue
		if ! sh "$tmux_sh" kill "$session" >>"$run/$a/log" 2>&1; then
			printf 'WARN\tsession を殺せない: %s\n' "$session" >&2
			fail=1
		fi
	done <"$run/advisors"
	[ "$fail" -eq 0 ] || exit 1
	: >"$run/closed"
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
