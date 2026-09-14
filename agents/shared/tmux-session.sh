#!/bin/sh
# tmux / pty session の薄い primitive。consult / dispatch の tmux backend が共有する。
#
#   tmux-session.sh open <session> <workdir> [--timeout <sec>] -- <cmd...>
#   tmux-session.sh paste-file <session> <file>
#   tmux-session.sh capture <session>
#   tmux-session.sh screen <session>
#   tmux-session.sh state <session>
#   tmux-session.sh exists <session>
#   tmux-session.sh kill <session>
#
# open は detached な 1 pane session を作って cmd を直接 exec し（login shell 経由にしない）、
# 入力を受ける画面になるまで待つ。起こせなければ session を破棄し、理由を FATAL 行に出して exit 2。
# capture は履歴全体、screen は表示中の 1 画面。状態判定に使うのは screen だけ。
# 画面の読み方は隣の advisors.ts（PaneState）が SSOT。bun が要る。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh open|paste-file|capture|screen|state|exists|kill ..."
shift

command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"

# ユーザー default socket を汚さない。この repo の session 専用。
AF_TMUX_SOCKET=agentfiles
tmux_af() {
	tmux -L "$AF_TMUX_SOCKET" "$@"
}

# pane は base-index / pane-base-index に依存しない。session の pane id を引く
target_of() {
	t_id=$(tmux_af list-panes -t "=$1" -F '#{pane_id}' 2>/dev/null | head -n 1)
	[ -n "$t_id" ] || return 1
	printf '%s' "$t_id"
}

here=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd) ||
	fatal "スクリプトの場所が取れない"
advisors_ts=$here/advisors.ts

require_judge() {
	[ -f "$advisors_ts" ] || fatal "画面判定が無い: $advisors_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
}

# 表示中の 1 画面から状態語を読む
pane_state() {
	require_judge
	p_target=$(target_of "$1") || fatal "pane が無い: $1"
	tmux_af capture-pane -t "$p_target" -p 2>/dev/null |
		bun "$advisors_ts" pane-state
}

# session を作り、起動 argv を直接 exec する。harness が終われば pane / session が消える
create_session() {
	c_session=$1
	c_workdir=$2
	shift 2
	tmux_af has-session -t "=$c_session" 2>/dev/null && fatal "session が既にある: $c_session"
	c_bin=$1
	shift
	case $c_bin in
	/*) c_abs=$c_bin ;;
	*)
		c_abs=$(command -v "$c_bin") || fatal "実行ファイルが PATH に無い: $c_bin"
		case $c_abs in
		/*) ;;
		*) c_abs=$(CDPATH= cd -P -- "$(dirname "$c_abs")" && pwd)/$(basename "$c_abs") ;;
		esac
		;;
	esac
	# cwd は env -C で起動 argv に固定する。new-session -c は server の状態次第で
	# 無視され、pane が server 自身の cwd（消えていることがある）で起動するため。
	#
	# 渡す env は session ごとに -e で明示する。server の global env は最初に
	# server を起こした client のもので、以降の session もそれを引くため。
	# 呼び出し元の印（CLAUDECODE 等）は空にする —— 子を親の kind と誤認させない。
	set -- "--" /usr/bin/env -C "$c_workdir" -- "$c_abs" "$@"
	for name in $({
		env
		# server の global env は最初の client のもの。今の env に無い印もここに残る
		tmux_af show-environment -g 2>/dev/null
	} | sed -n -E 's/^(CLAUDECODE|CLAUDE_CODE_[A-Za-z0-9_]*|CURSOR_INVOKED_AS|CONSULT_[A-Za-z0-9_]*|DISPATCH_[A-Za-z0-9_]*|LC_ALL)=.*/\1/p' | sort -u); do
		set -- -e "$name=" "$@"
	done
	set -- -e "PATH=$PATH" "$@"
	tmux_af new-session -d -s "$c_session" -x 120 -y 40 "$@" ||
		fatal "tmux session を作れない: $c_session"
}

case "$cmd" in
open)
	session=${1:-}
	workdir=${2:-}
	[ -n "$session" ] || fatal "session 名が無い"
	[ -n "$workdir" ] && [ -d "$workdir" ] || fatal "workdir が不正: ${workdir:-未指定}"
	shift 2
	# 既定は trust 対話の受理と TUI の起動を合わせた待ち時間
	timeout=65
	if [ "${1:-}" = "--timeout" ]; then
		[ $# -ge 2 ] || fatal "--timeout の値が無い"
		timeout=$2
		shift 2
	fi
	case $timeout in
	'' | *[!0-9]*) fatal "timeout が数値でない: $timeout" ;;
	esac
	[ "${1:-}" = "--" ] || fatal "open は -- のあとに起動 argv を置く"
	shift
	[ $# -ge 1 ] || fatal "起動 argv が空"
	require_judge
	bin=$1
	create_session "$session" "$workdir" "$@"
	# 入力を受ける画面になる前に止まったら session を残さない
	trap 'tmux_af kill-session -t "=$session" 2>/dev/null' EXIT
	deadline=$(($(date +%s) + timeout))
	answered=0
	while :; do
		tmux_af has-session -t "=$session" 2>/dev/null ||
			fatal "session が消えた（起動した harness が終了した）: $session"
		target=$(target_of "$session") || fatal "pane が無い: $session"
		# 状態も選択肢番号も同じ 1 回の capture から読む（間で画面が変わらない）
		snap=$(tmux_af capture-pane -t "$target" -p 2>/dev/null) || snap=""
		state=$(printf '%s\n' "$snap" | bun "$advisors_ts" pane-state) ||
			fatal "画面を判定できない: $session"
		case $state in
		ready)
			trap - EXIT
			exit 0
			;;
		login) fatal "ログインが要る: $bin" ;;
		trust)
			# workspace trust 対話は Yes を 1 度だけ選ぶ。選択肢番号は画面から読む
			# （初期選択に依存しない。番号が読めない・送れないときは Enter を送らない）
			if [ "$answered" -eq 0 ]; then
				key=$(printf '%s\n' "$snap" | bun "$advisors_ts" trust-key) ||
					fatal "trust 対話の Yes を読めない"
				tmux_af send-keys -t "$target" "$key" || fatal "選択肢を送れない: $key"
				sleep 0.2
				tmux_af send-keys -t "$target" C-m || fatal "Enter を送れない"
				answered=1
			fi
			;;
		esac
		if [ "$(date +%s)" -ge "$deadline" ]; then
			[ "$state" = trust ] && fatal "trust 対話を越えられない: $workdir"
			fatal "入力を受ける画面にならない（${timeout} 秒）: $session"
		fi
		sleep 0.5
	done
	;;
paste-file)
	session=${1:-}
	file=${2:-}
	[ -n "$session" ] || fatal "session 名が無い"
	[ -n "$file" ] && [ -f "$file" ] || fatal "file が不正: ${file:-未指定}"
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	target=$(target_of "$session") || fatal "pane が無い: $session"
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
	target=$(target_of "$session") || fatal "pane が無い: $session"
	tmux_af capture-pane -t "$target" -p -S - -E -
	;;
screen)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	target=$(target_of "$session") || fatal "pane が無い: $session"
	tmux_af capture-pane -t "$target" -p
	;;
state)
	session=${1:-}
	[ -n "$session" ] || fatal "session 名が無い"
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	pane_state "$session"
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
