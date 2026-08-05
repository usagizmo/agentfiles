#!/bin/sh
# アドバイザーの起動と回収。**同じ run を 2 度使えない形にするのが目的。**
# 手で書くと、前回の run dir を貼って前回の出力を今回の結果として出す事故が起きる。
#
#   advisors.sh start <prompt-file> <advisor>...   run dir を作って起動。run dir を stdout へ
#   advisors.sh collect <run-dir> [wait-seconds]   出揃うまで待って出力。既定 1200 秒
#                                                  1 run 1 回。2 度目は落ちる
#
# advisor は codex / claude / grok。**実行中の自分自身を除いた 2 つ**を呼び出し側が選ぶ。
# 不変条件: アドバイザーにコードを変更させない（codex は -s read-only、他は --permission-mode plan）。

set -u
LC_ALL=C
export LC_ALL

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

# 1 advisor を起動する。呼び出し元 shell から切り離し、終了コードを .rc に残す。
# 待ち受けでブロックしないので harness のタイムアウトで打ち切られない。
launch() {
	l_dir=$1
	l_name=$2
	case "$l_name" in
	codex)
		nohup sh -c 'codex exec -s read-only -o "$1/out" - <"$1/prompt" >"$1/log" 2>&1; echo $? >"$1/rc"' \
			_ "$l_dir" >/dev/null 2>&1 &
		;;
	claude)
		nohup sh -c 'claude -p --permission-mode plan --tools "Bash,Read,Grep,Glob" --output-format text <"$1/prompt" >"$1/out" 2>"$1/log"; echo $? >"$1/rc"' \
			_ "$l_dir" >/dev/null 2>&1 &
		;;
	grok)
		nohup sh -c 'grok --prompt-file "$1/prompt" --permission-mode plan --tools "Bash,Read,Grep,Glob" >"$1/out" 2>"$1/log"; echo $? >"$1/rc"' \
			_ "$l_dir" >/dev/null 2>&1 &
		;;
	esac
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: advisors.sh start <prompt-file> <advisor>... | collect <run-dir> [秒]"
shift

case "$cmd" in
start)
	prompt=${1:-}
	[ -n "$prompt" ] && [ -s "$prompt" ] || fatal "prompt が空 / 不正: ${prompt:-未指定}"
	shift
	[ $# -ge 1 ] || fatal "advisor を 1 つ以上指定する"

	# run dir は毎回新規。既存を掴めないので、前回の .rc を今回の結果と誤認しない。
	run=$(mktemp -d "${TMPDIR:-/tmp}/advisors.XXXXXX") || fatal "run dir を作れない"
	for a in "$@"; do
		case "$a" in codex | claude | grok) ;; *) fatal "未知の advisor: $a" ;; esac
	done
	printf '%s\n' "$*" >"$run/advisors"
	for a in "$@"; do
		mkdir -p "$run/$a" || fatal "$run/$a を作れない"
		cp "$prompt" "$run/$a/prompt" || fatal "prompt を配れない"
		launch "$run/$a" "$a"
	done
	printf '%s\n' "$run"
	;;

collect)
	run=${1:-}
	[ -n "$run" ] && [ -d "$run" ] && [ -f "$run/advisors" ] || fatal "run dir が不正: ${run:-未指定}"
	# 1 run 1 回。古いパスを貼ったら静かに前回の出力を返すのではなく、ここで落ちる。
	[ -f "$run/collected" ] && fatal "この run は回収済み: $run（start からやり直す）"
	wait_s=${2:-1200}
	case $wait_s in
	'' | *[!0-9]*) fatal "待ち秒数が数値でない: $wait_s" ;;
	esac
	names=$(cat "$run/advisors")
	total=$(printf '%s\n' $names | wc -l | tr -d ' ')
	[ "$total" -ge 1 ] || fatal "advisor が記録されていない: $run"

	waited=0
	while [ "$waited" -lt "$wait_s" ]; do
		n=0
		for a in $names; do [ -f "$run/$a/rc" ] && n=$((n + 1)); done
		[ "$n" -eq "$total" ] && break
		sleep 5
		waited=$((waited + 5))
	done

	incomplete=0
	for a in $names; do
		rc=$(cat "$run/$a/rc" 2>/dev/null) || rc=""
		if [ -z "$rc" ]; then
			printf '=== %s (未完了: %s 秒で打ち切り) ===\n' "$a" "$wait_s"
			incomplete=$((incomplete + 1))
			tail -n 20 "$run/$a/log" 2>/dev/null
		else
			printf '=== %s (rc=%s) ===\n' "$a" "$rc"
			[ -s "$run/$a/out" ] && cat "$run/$a/out"
			# 部分出力を残して失敗したときが一番原因を知りたい。rc≠0 なら常に log を添える。
			if [ "$rc" != 0 ] || [ ! -s "$run/$a/out" ]; then
				printf '(log の末尾)\n'
				tail -n 20 "$run/$a/log" 2>/dev/null
			fi
		fi
		printf '\n'
	done
	: >"$run/collected"
	# 未完了・失敗を隠さない。呼び出し側が「揃った」と誤認しないための終了コード。
	[ "$incomplete" -gt 0 ] && exit 1
	exit 0
	;;

*) fatal "未知のサブコマンド: $cmd" ;;
esac
