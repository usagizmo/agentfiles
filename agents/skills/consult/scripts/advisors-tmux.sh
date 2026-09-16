#!/bin/sh
# consult の tmux / pty ConsultBackend。interactive harness を実端末で駆動する。
# CONSULT_BACKEND=tmux 経由、または本 script を直接呼ぶ。
#
#   advisors-tmux.sh start <prompt-file>                run dir を stdout へ。巡 1 を送る
#   advisors-tmux.sh collect <run-dir> [wait-seconds]   今の巡の marker 完走を待って出力。既定 1200 秒
#   advisors-tmux.sh ask <run-dir> <prompt-file>        次の巡を同じ session へ送る
#   advisors-tmux.sh replace <run-dir>                  dead を次の候補で起こし直し、巡 1〜今の巡の依頼と回収済み応答を連結して送る
#   advisors-tmux.sh close <run-dir>                    tmux session を破棄
#   advisors-tmux.sh verify <run-dir>                   今の巡の判定を並べ、「指摘なし」なら 0
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
	cp "$p_src" "$p_run/prompt.$p_n.body" || fatal "prompt 原本を配れない"
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

# 巡 n の prompt を 1 session へ paste する。第 4 引数があればその file を送る
send_round() {
	s_run=$1
	s_a=$2
	s_n=$3
	s_file=${4:-$s_run/prompt.$s_n}
	s_session=$(cat "$s_run/$s_a/session" 2>/dev/null) || return 1
	if ! sh "$tmux_sh" exists "$s_session"; then
		printf 'session が消えている（巡 %s）\n' "$s_n" >>"$s_run/$s_a/log"
		printf '%s\n' 1 >"$s_run/$s_a/sent.$s_n"
		return 1
	fi
	if sh "$tmux_sh" paste-file "$s_session" "$s_file" >>"$s_run/$s_a/log" 2>&1; then
		printf '%s\n' 0 >"$s_run/$s_a/sent.$s_n"
		return 0
	fi
	printf '%s\n' 1 >"$s_run/$s_a/sent.$s_n"
	printf 'paste-file に失敗（巡 %s）\n' "$s_n" >>"$s_run/$s_a/log"
	return 1
}

# 指令行と応答末尾の当該 marker 行だけを除いて付ける
append_response() {
	[ -f "$1" ] || return 0
	awk -v marker="$2" '
		$0 ~ /^質問・異論・指摘なしのどれでも、応答の最後の行に / && $0 ~ /この指令行は書かない。$/ { next }
		{ lines[++n] = $0 }
		END {
			while (n > 0 && (lines[n] ~ /^[ \t]*$/ || lines[n] ~ /^[ \t]*[❯›>][ \t]*$/)) n--
			if (n > 0 && lines[n] == marker) n--
			while (n > 0 && (lines[n] ~ /^[ \t]*$/ || lines[n] ~ /^[ \t]*[❯›>][ \t]*$/)) n--
			for (i = 1; i <= n; i++) print lines[i]
		}
	' "$1" >>"$3"
}

# 巡 k の回収済み応答（rc.k == 0 の advisor の out.k。dead でも除外しない）
out_of() {
	o_run=$1
	o_k=$2
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ "$(cat "$o_run/$a/rc.$o_k" 2>/dev/null)" = 0 ] || continue
		[ -f "$o_run/$a/out.$o_k" ] || continue
		printf '%s\n' "$o_run/$a/out.$o_k"
		return 0
	done <"$o_run/advisors"
	return 1
}

# 巡 1〜n-1 の依頼と応答、巡 n の依頼を連結し、今の巡の marker 指令を末尾に付ける
compose_replace_prompt() {
	c_run=$1
	c_n=$2
	c_out=$3
	c_marker=$(cat "$c_run/marker.$c_n") || return 1
	: >"$c_out"
	k=1
	while [ "$k" -lt "$c_n" ]; do
		[ -f "$c_run/prompt.$k.body" ] || return 1
		printf '## 巡 %s の依頼\n\n' "$k" >>"$c_out"
		cat "$c_run/prompt.$k.body" >>"$c_out" || return 1
		printf '\n## 巡 %s の応答\n\n' "$k" >>"$c_out"
		if c_resp=$(out_of "$c_run" "$k"); then
			c_prev=$(cat "$c_run/marker.$k") || return 1
			append_response "$c_resp" "$c_prev" "$c_out"
		fi
		printf '\n' >>"$c_out"
		k=$((k + 1))
	done
	[ -f "$c_run/prompt.$c_n.body" ] || return 1
	printf '## 巡 %s の依頼\n\n' "$c_n" >>"$c_out"
	cat "$c_run/prompt.$c_n.body" >>"$c_out" || return 1
	printf '\n\n質問・異論・指摘なしのどれでも、応答の最後の行に %s をそのまま書いて応答を終えよ。この指令行は書かない。\n' "$c_marker" >>"$c_out"
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

record_tried() {
	r_run=$1
	r_a=$2
	if [ -f "$r_run/tried" ] && grep -qx "$r_a" "$r_run/tried"; then
		return 0
	fi
	printf '%s\n' "$r_a" >>"$r_run/tried"
}

# kind を 1 つ起こして巡 n の prompt を送る。起こせない / 送信失敗 / 送信直後の fatal は 1
start_kind() {
	sk_run=$1
	sk_a=$2
	sk_n=$3
	sk_cwd=$4
	sk_file=${5:-$sk_run/prompt.$sk_n}
	record_tried "$sk_run" "$sk_a"
	mkdir -p "$sk_run/$sk_a" || return 1
	sk_rid=$(cat "$sk_run/rid") || return 1
	session=c-$sk_a-$sk_rid
	printf '%s\n' "$session" >"$sk_run/$sk_a/session"
	printf '%s\n' "$session" >"$sk_run/$sk_a/name"
	if ! bun "$select_ts" launch-argv --roster "$sk_run/roster.toml" --kind "$sk_a" \
		>"$sk_run/$sk_a/argv" 2>>"$sk_run/$sk_a/log"; then
		printf '%s\n' 1 >"$sk_run/$sk_a/start.rc"
		printf 'launch-argv に失敗\n' >>"$sk_run/$sk_a/log"
		return 1
	fi
	set --
	while IFS= read -r arg; do set -- "$@" "$arg"; done <"$sk_run/$sk_a/argv"
	if [ $# -eq 0 ] || ! command -v "$1" >/dev/null 2>&1; then
		printf '%s\n' 1 >"$sk_run/$sk_a/start.rc"
		printf '実行ファイルが PATH に無い: %s\n' "${1:-?}" >>"$sk_run/$sk_a/log"
		return 1
	fi
	if ! sh "$tmux_sh" open "$session" "$sk_cwd" -- "$@" >>"$sk_run/$sk_a/log" 2>&1; then
		printf '%s\n' 1 >"$sk_run/$sk_a/start.rc"
		return 1
	fi
	if ! send_round "$sk_run" "$sk_a" "$sk_n" "$sk_file"; then
		printf '%s\n' 1 >"$sk_run/$sk_a/start.rc"
		printf 'prompt 送信に失敗\n' >>"$sk_run/$sk_a/log"
		sh "$tmux_sh" kill "$session" >>"$sk_run/$sk_a/log" 2>&1 || true
		return 1
	fi
	case $(sh "$tmux_sh" state "$session" 2>>"$sk_run/$sk_a/log") in
	fatal)
		printf '%s\n' 1 >"$sk_run/$sk_a/start.rc"
		printf '%s\n' "不通" >"$sk_run/$sk_a/reason.$sk_n"
		: >"$sk_run/$sk_a/dead"
		sh "$tmux_sh" kill "$session" >>"$sk_run/$sk_a/log" 2>&1 || true
		return 1
		;;
	esac
	printf '%s\n' 0 >"$sk_run/$sk_a/start.rc"
	return 0
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors-tmux.sh start <prompt-file> | collect <run-dir> [秒] | ask <run-dir> <prompt-file> | replace <run-dir> | close <run-dir> | verify <run-dir>"
shift

case "$cmd" in
start)
	command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	[ -f "$roster" ] || fatal "候補表が無い: $roster"
	[ -f "$select_ts" ] || fatal "選出スクリプトが無い: $select_ts"
	[ -f "$tmux_sh" ] || fatal "tmux-session.sh が無い: $tmux_sh"
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
	cp "$roster" "$run/roster.toml" || fatal "候補表を配れない"
	place_prompt "$run" "$prompt" 1
	printf '%s\n' 1 >"$run/round" || fatal "round を書けない"

	# select は候補列を行で返す。起こせるまで順に試す
	if ! bun "$select_ts" select --roster "$run/roster.toml" \
		>"$run/candidates" 2>"$run/select.err"; then
		cat "$run/select.err" >&2
		rm -rf "$run"
		fatal "選出できない"
	fi
	cat "$run/select.err" >&2 || true
	[ -s "$run/candidates" ] || fatal "選出結果が空"
	: >"$run/tried"
	: >"$run/advisors"

	caller_cwd=$PWD
	started=0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		if start_kind "$run" "$a" 1 "$caller_cwd"; then
			printf '%s\n' "$a" >>"$run/advisors"
			started=1
			break
		fi
	done <"$run/candidates"

	if [ "$started" -eq 0 ]; then
		while IFS= read -r a; do
			[ -n "$a" ] || continue
			printf '=== %s start 失敗 ===\n' "$a" >&2
			tail -n 20 "$run/$a/log" >&2 2>/dev/null
		done <"$run/tried"
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
			case $(sh "$tmux_sh" state "$session" 2>>"$run/$a/log") in
			fatal)
				sh "$tmux_sh" capture "$session" >"$run/$a/raw.$n" 2>>"$run/$a/log" || true
				if [ -f "$run/$a/raw.$n" ]; then
					bun "$select_ts" extract --raw "$run/$a/raw.$n" --prev "$prev" \
						>"$run/$a/out.$n" 2>>"$run/$a/log" || cp "$run/$a/raw.$n" "$run/$a/out.$n"
				fi
				printf '%s\n' 1 >"$run/$a/rc.$n"
				printf '%s\n' "不通" >"$run/$a/reason.$n"
				: >"$run/$a/dead"
				continue
				;;
			esac
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

	passed=0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		[ "$(cat "$run/$a/reason.$n" 2>/dev/null)" = "不在" ] && continue
		[ -f "$run/$a/dead" ] && continue
		[ "$(cat "$run/$a/rc.$n" 2>/dev/null)" = 0 ] || exit 1
		passed=1
	done <"$run/advisors"
	[ "$passed" -eq 1 ] || exit 1
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

replace)
	run=${1:-}
	require_run "$run"
	live=$(live_advisors "$run")
	if [ -n "$live" ]; then
		exit 0
	fi
	[ -f "$run/candidates" ] || fatal "候補列が無い"
	n=$(cat "$run/round")
	[ -f "$run/prompt.$n" ] || fatal "巡 $n の prompt が無い"
	combined=$(mktemp "${TMPDIR:-/tmp}/consult-replace.XXXXXX") || fatal "連結 prompt を作れない"
	if ! compose_replace_prompt "$run" "$n" "$combined"; then
		rm -f "$combined"
		fatal "巡の prompt を連結できない"
	fi
	caller_cwd=$PWD
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		if [ -f "$run/tried" ] && grep -qx "$a" "$run/tried"; then
			continue
		fi
		if start_kind "$run" "$a" "$n" "$caller_cwd" "$combined"; then
			rm -f "$combined"
			printf '%s\n' "$a" >>"$run/advisors"
			exit 0
		fi
	done <"$run/candidates"
	rm -f "$combined"
	printf '候補枯渇\n' >&2
	exit 1
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

verify)
	# close 済みでも読める（証跡は run dir に残る）。session には触らない
	run=${1:-}
	[ -n "$run" ] && [ -d "$run" ] && [ -f "$run/advisors" ] && [ -f "$run/round" ] || fatal "run dir が不正: ${run:-未指定}"
	[ -f "$run/backend" ] && [ "$(cat "$run/backend")" = tmux ] || fatal "tmux backend の run ではない: $run"
	[ -f "$select_ts" ] || fatal "述語が無い: $select_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	n=$(cat "$run/round")
	[ -f "$run/marker.$n" ] || fatal "巡 $n の marker が無い"
	marker=$(cat "$run/marker.$n")
	printf 'run: %s\n' "$run"
	printf 'round: %s\n' "$n"
	if [ -f "$run/closed" ]; then printf 'closed: yes\n'; else printf 'closed: no\n'; fi
	passed=0
	failed=0
	while IFS= read -r a; do
		[ -n "$a" ] || continue
		rc=$(cat "$run/$a/rc.$n" 2>/dev/null) || rc=""
		reason=$(cat "$run/$a/reason.$n" 2>/dev/null) || reason=""
		if [ "$rc" = 0 ]; then
			verdict=$(bun "$select_ts" verdict --output "$run/$a/out.$n" --marker "$marker" 2>>"$run/$a/log") ||
				fatal "巡 $n の $a の判定を読めない"
			printf '%s: %s\n' "$a" "$verdict"
			if [ "$verdict" = 指摘なし ]; then passed=$((passed + 1)); else failed=$((failed + 1)); fi
			continue
		fi
		# 起こせなかった・終端した agent は判定に数えない。回収前の agent は未終了
		if [ "$(cat "$run/$a/start.rc" 2>/dev/null)" != 0 ] || [ -f "$run/$a/dead" ]; then
			printf '%s: 終端 (%s)\n' "$a" "${reason:-不在}"
			continue
		fi
		printf '%s: 未回収 (%s)\n' "$a" "${reason:-collect 前}"
		failed=$((failed + 1))
	done <"$run/advisors"
	if [ "$failed" -eq 0 ] && [ "$passed" -ge 1 ]; then
		printf 'verify: pass\n'
		exit 0
	fi
	if [ "$passed" -eq 0 ] && [ "$failed" -eq 0 ]; then
		printf 'verify: fail (生きている advisor が無い。未レビュー)\n'
	else
		printf 'verify: fail\n'
	fi
	exit 1
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
