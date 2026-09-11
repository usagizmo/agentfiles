#!/bin/sh
# tmux / pty session の薄い primitive。consult の tmux backend と、後の dispatch が共有する。
#
#   tmux-session.sh create <session> <workdir> -- <cmd...>
#   tmux-session.sh accept-trust <session> [timeout-sec]
#   tmux-session.sh wait-ready <session> [timeout-sec]
#   tmux-session.sh paste-file <session> <file>
#   tmux-session.sh capture <session>
#   tmux-session.sh exists <session>
#   tmux-session.sh kill <session>
#
# create は detached な 1 pane session を作り、cmd を interactive に起動する（-p / exec は使わない）。

set -u
LC_ALL=C
export LC_ALL

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh create|accept-trust|wait-ready|paste-file|capture|exists|kill ..."
shift

command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"

target_of() {
	printf '%s:0.0' "$1"
}

case "$cmd" in
create)
	session=${1:-}
	workdir=${2:-}
	[ -n "$session" ] || fatal "session 名が無い"
	[ -n "$workdir" ] && [ -d "$workdir" ] || fatal "workdir が不正: ${workdir:-未指定}"
	shift 2
	[ "${1:-}" = "--" ] || fatal "create は -- のあとに起動 argv を置く"
	shift
	[ $# -ge 1 ] || fatal "起動 argv が空"
	tmux has-session -t "=$session" 2>/dev/null && fatal "session が既にある: $session"
	# まず空の login shell を立て、起動を send-keys する（argv の quoting を shell に任せる）
	tmux new-session -d -s "$session" -c "$workdir" -x 120 -y 40 -- "${SHELL:-zsh}" -l ||
		fatal "tmux session を作れない: $session"
	launch=$(
		python3 -c 'import shlex,sys; print(" ".join(shlex.quote(a) for a in sys.argv[1:]))' "$@"
	) || fatal "起動 argv を quote できない"
	tmux send-keys -t "$(target_of "$session")" -l -- "$launch" || {
		tmux kill-session -t "=$session" 2>/dev/null || true
		fatal "起動コマンドを送れない"
	}
	tmux send-keys -t "$(target_of "$session")" C-m || {
		tmux kill-session -t "=$session" 2>/dev/null || true
		fatal "起動 Enter を送れない"
	}
	;;
accept-trust)
	# Claude Code の workspace trust 対話（No / Yes）が出ていれば Yes を選ぶ
	session=${1:-}
	timeout=${2:-20}
	[ -n "$session" ] || fatal "session 名が無い"
	case $timeout in
	'' | *[!0-9]*) fatal "timeout が数値でない: $timeout" ;;
	esac
	tmux has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	deadline=$(($(date +%s) + timeout))
	target=$(target_of "$session")
	while :; do
		pane=$(tmux capture-pane -t "$target" -p -S - -E - 2>/dev/null) || pane=""
		if printf '%s\n' "$pane" | grep -F -q 'Yes, I trust this folder'; then
			tmux send-keys -t "$target" Down || fatal "Down を送れない"
			sleep 0.2
			tmux send-keys -t "$target" C-m || fatal "Enter を送れない"
			# プロンプトが出るまで短く待つ（失敗しても呼び出し側が wait-ready する）
			sleep 1
			exit 0
		fi
		# 既に入力待ちなら trust は不要
		printf '%s\n' "$pane" | grep -E -q '(^|[^[:alnum:]])[❯›>]($|[[:space:]])' && exit 0
		[ "$(date +%s)" -ge "$deadline" ] && exit 1
		sleep 0.5
	done
	;;
wait-ready)
	session=${1:-}
	timeout=${2:-30}
	[ -n "$session" ] || fatal "session 名が無い"
	case $timeout in
	'' | *[!0-9]*) fatal "timeout が数値でない: $timeout" ;;
	esac
	tmux has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	deadline=$(($(date +%s) + timeout))
	target=$(target_of "$session")
	while :; do
		pane=$(tmux capture-pane -t "$target" -p -S - -E - 2>/dev/null) || pane=""
		# Claude / Codex / 一般的な TUI の入力待ち。見つからなくても timeout で返す
		printf '%s\n' "$pane" | grep -E -q '(^|[^[:alnum:]])[❯›>]($|[[:space:]])' && exit 0
		printf '%s\n' "$pane" | grep -E -qi 'plan mode on|ask for approval|sandbox' && exit 0
		[ "$(date +%s)" -ge "$deadline" ] && exit 1
		sleep 0.5
	done
	;;
paste-file)
	session=${1:-}
	file=${2:-}
	[ -n "$session" ] || fatal "session 名が無い"
	[ -n "$file" ] && [ -f "$file" ] || fatal "file が不正: ${file:-未指定}"
	tmux has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	target=$(target_of "$session")
	buf="consult-paste-$$"
	tmux load-buffer -b "$buf" -- "$file" || fatal "buffer に読めない: $file"
	tmux paste-buffer -b "$buf" -t "$target" || {
		tmux delete-buffer -b "$buf" 2>/dev/null || true
		fatal "paste できない"
	}
	tmux delete-buffer -b "$buf" 2>/dev/null || true
	# 貼り付け直後の Enter（送信）
	sleep 0.2
	tmux send-keys -t "$target" C-m || fatal "Enter を送れない"
	;;
capture)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	tmux capture-pane -t "$(target_of "$session")" -p -S - -E -
	;;
exists)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux has-session -t "=$session" 2>/dev/null
	;;
kill)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux has-session -t "=$session" 2>/dev/null || exit 0
	tmux kill-session -t "=$session" || fatal "session を殺せない: $session"
	;;
*) fatal "未知のサブコマンド: $cmd" ;;
esac
