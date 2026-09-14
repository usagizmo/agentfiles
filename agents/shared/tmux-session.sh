#!/bin/sh
# tmux / pty session の薄い primitive。consult / dispatch の tmux backend が共有する。
#
#   tmux-session.sh create <session> <workdir> -- <cmd...>
#   tmux-session.sh accept-trust <session> [timeout-sec]
#   tmux-session.sh wait-ready <session> [timeout-sec]
#   tmux-session.sh paste-file <session> <file>
#   tmux-session.sh capture <session>
#   tmux-session.sh screen <session>
#   tmux-session.sh state <session>
#   tmux-session.sh exists <session>
#   tmux-session.sh kill <session>
#
# create は detached な 1 pane session を作り、cmd を直接 exec する（login shell 経由にしない）。
# capture は履歴全体、screen は表示中の 1 画面。状態判定に使うのは screen だけ。
# 画面の読み方（trust / working / ready）は隣の advisors.ts が SSOT。bun が要る。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh create|accept-trust|wait-ready|paste-file|capture|screen|state|exists|kill ..."
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

# 待機ループの各回で見る。消えた session を画面判定の失敗と区別して報告する
require_alive() {
	tmux_af has-session -t "=$1" 2>/dev/null ||
		fatal "session が消えた（起動した harness が終了した）: $1"
}

# 表示中の 1 画面から状態語を読む（trust / working / ready / unknown）
pane_state() {
	[ -f "$advisors_ts" ] || fatal "画面判定が無い: $advisors_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	p_target=$(target_of "$1") || fatal "pane が無い: $1"
	tmux_af capture-pane -t "$p_target" -p 2>/dev/null |
		bun "$advisors_ts" pane-state
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
	#
	# cwd は env -C で起動 argv に固定する。new-session -c は server の状態次第で
	# 無視され、pane が server 自身の cwd（消えていることがある）で起動するため。
	#
	# 渡す env は session ごとに -e で明示する。server の global env は最初に
	# server を起こした client のもので、以降の session もそれを引くため。
	# 呼び出し元の印（CLAUDECODE 等）は空にする —— 子を親の kind と誤認させない。
	set -- "--" /usr/bin/env -C "$workdir" -- "$abs" "$@"
	for name in $({
		env
		# server の global env は最初の client のもの。今の env に無い印もここに残る
		tmux_af show-environment -g 2>/dev/null
	} | sed -n -E 's/^(CLAUDECODE|CLAUDE_CODE_[A-Za-z0-9_]*|CURSOR_INVOKED_AS|CONSULT_[A-Za-z0-9_]*|DISPATCH_[A-Za-z0-9_]*|LC_ALL)=.*/\1/p' | sort -u); do
		set -- -e "$name=" "$@"
	done
	set -- -e "PATH=$PATH" "$@"
	tmux_af new-session -d -s "$session" -x 120 -y 40 "$@" ||
		fatal "tmux session を作れない: $session"
	;;
accept-trust)
	# workspace trust 対話が出ていれば Yes を選ぶ。選択肢番号は画面から読む
	# （初期選択に依存しない。番号が読めない・送れないときは Enter を送らない）
	session=${1:-}
	timeout=${2:-20}
	[ -n "$session" ] || fatal "session 名が無い"
	case $timeout in
	'' | *[!0-9]*) fatal "timeout が数値でない: $timeout" ;;
	esac
	tmux_af has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
	[ -f "$advisors_ts" ] || fatal "画面判定が無い: $advisors_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
	deadline=$(($(date +%s) + timeout))
	target=$(target_of "$session") || fatal "pane が無い: $session"
	answered=0
	while :; do
		require_alive "$session"
		# 状態も選択肢番号も同じ 1 回の capture から読む（間で画面が変わらない）
		snap=$(tmux_af capture-pane -t "$target" -p 2>/dev/null) || snap=""
		state=$(printf '%s\n' "$snap" | bun "$advisors_ts" pane-state) ||
			fatal "画面を判定できない: $session"
		case $state in
		trust)
			if [ "$answered" -eq 0 ]; then
				key=$(printf '%s\n' "$snap" | bun "$advisors_ts" trust-key) ||
					fatal "trust 対話の Yes を読めない"
				tmux_af send-keys -t "$target" "$key" || fatal "選択肢を送れない: $key"
				sleep 0.2
				tmux_af send-keys -t "$target" C-m || fatal "Enter を送れない"
				answered=1
			fi
			;;
		# 対話が消えて入力待ちへ変わったら受理できている
		ready) exit 0 ;;
		esac
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
	while :; do
		require_alive "$session"
		state=$(pane_state "$session") || fatal "画面を判定できない: $session"
		case $state in
		ready) exit 0 ;;
		trust) exit 3 ;;
		esac
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
