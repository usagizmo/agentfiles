#!/bin/sh
# tmux / pty session の薄い primitive。consult / dispatch の tmux backend が共有する。
#
#   tmux-session.sh create <session> <workdir> -- <cmd...>
#   tmux-session.sh accept-trust <session> [timeout-sec]
#   tmux-session.sh wait-ready <session> [timeout-sec]
#   tmux-session.sh paste-file <session> <file>
#   tmux-session.sh capture <session>
#   tmux-session.sh exists <session>
#   tmux-session.sh kill <session>
#
# create は detached な 1 pane session を作り、cmd を直接 exec する（login shell 経由にしない）。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh create|accept-trust|wait-ready|paste-file|capture|exists|kill ..."
shift

command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"

# ユーザー default socket を汚さない。この repo の session 専用。
AF_TMUX_SOCKET=agentfiles
tmux_af() {
	tmux -L "$AF_TMUX_SOCKET" "$@"
}

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
	tmux_af has-session -t "=$session" 2>/dev/null && fatal "session が既にある: $session"
	bin=$1
	shift
	case $bin in
	/*) abs=$bin ;;
	*)
		abs=$(command -v "$bin") || fatal "実行ファイルが PATH に無い: $bin"
		case $abs in
		/*) ;;
		*) abs=$(CDPATH= cd -P -- "$(dirname "$abs")" && pwd)/$(basename "$abs") ;;
		esac
		;;
	esac
	# argv を直接 exec。harness が終われば pane / session が消える
	# 専用 socket で server を起こす。呼び出し側の CONSULT_*/DISPATCH_*/CLAUDECODE を外す
	# （env -u … tmux_af だと関数が exec 対象になり失敗するので、subshell で unset する）
	(
		unset CONSULT_BACKEND CONSULT_SELF_KIND DISPATCH_BACKEND DISPATCH_KIND
		unset CLAUDECODE CLAUDE_CODE LC_ALL
		tmux_af new-session -d -s "$session" -c "$workdir" -x 120 -y 40 -- "$abs" "$@"
	) || fatal "tmux session を作れない: $session"
	;;
accept-trust)
	# Claude Code の workspace trust 対話（No / Yes）が出ていれば Yes を選ぶ
	session=${1:-}
	timeout=${2:-20}
	[ -n "$session" ] || fatal "session 名が無い"
	case $timeout in
	'' | *[!0-9]*) fatal "timeout が数値でない: $timeout" ;;
	esac
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	deadline=$(($(date +%s) + timeout))
	target=$(target_of "$session")
	while :; do
		pane=$(tmux_af capture-pane -t "$target" -p -S - -E - 2>/dev/null) || pane=""
		if printf '%s\n' "$pane" | LC_ALL=C grep -F -q 'Yes, I trust this folder'; then
			tmux_af send-keys -t "$target" Down || fatal "Down を送れない"
			sleep 0.2
			tmux_af send-keys -t "$target" C-m || fatal "Enter を送れない"
			# プロンプトが出るまで短く待つ（失敗しても呼び出し側が wait-ready する）
			sleep 1
			exit 0
		fi
		# 既に入力待ちなら trust は不要
		printf '%s\n' "$pane" | LC_ALL=C grep -E -q '(^|[^[:alnum:]])(❯|›|>)($|[[:space:]])' && exit 0
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
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	deadline=$(($(date +%s) + timeout))
	target=$(target_of "$session")
	while :; do
		# trust / ready とも表示中の 1 画面だけで判定（二重 capture のレースを避ける）
		pane=$(tmux_af capture-pane -t "$target" -p 2>/dev/null) || pane=""
		if printf '%s\n' "$pane" | LC_ALL=C grep -E -qi 'trust this folder|do you trust|without asking for approval'; then
			exit 3
		fi
		printf '%s\n' "$pane" | LC_ALL=C grep -E -q '(^|[^[:alnum:]])(❯|›|>)($|[[:space:]])' && exit 0
		printf '%s\n' "$pane" | LC_ALL=C grep -E -qi 'plan mode on|ask for approval|sandbox' && exit 0
		[ "$(date +%s)" -ge "$deadline" ] && exit 1
		sleep 0.5
	done
	;;
paste-file)
	session=${1:-}
	file=${2:-}
	[ -n "$session" ] || fatal "session 名が無い"
	[ -n "$file" ] && [ -f "$file" ] || fatal "file が不正: ${file:-未指定}"
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	target=$(target_of "$session")
	buf="consult-paste-$$"
	tmux_af load-buffer -b "$buf" -- "$file" || fatal "buffer に読めない: $file"
	# -p: bracketed paste（LF→CR 置換を避ける）。-d: paste 後に buffer 削除
	tmux_af paste-buffer -p -d -b "$buf" -t "$target" || {
		tmux_af delete-buffer -b "$buf" 2>/dev/null || true
		fatal "paste できない"
	}
	# 貼り付け直後の Enter（送信）
	sleep 0.2
	tmux_af send-keys -t "$target" C-m || fatal "Enter を送れない"
	;;
capture)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	tmux_af capture-pane -t "$(target_of "$session")" -p -S - -E -
	;;
exists)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux_af has-session -t "=$session" 2>/dev/null
	;;
kill)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux_af has-session -t "=$session" 2>/dev/null || exit 0
	tmux_af kill-session -t "=$session" || fatal "session を殺せない: $session"
	;;
*) fatal "未知のサブコマンド: $cmd" ;;
esac
