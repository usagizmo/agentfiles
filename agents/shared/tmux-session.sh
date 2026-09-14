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
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh open|paste-file|capture|screen|state|exists|kill <session> ..."
shift
session=${1:-}
[ -n "$session" ] || fatal "session 名が無い"
shift
# session 名は socket 名と socket file のパスになる。文字種と長さを tmux を呼ぶ前に固定する
case $session in
-* | *[![:lower:][:digit:]_-]*) fatal "session 名が不正: $session" ;;
esac
[ ${#session} -le 48 ] || fatal "session 名が不正: $session"

command -v tmux >/dev/null 2>&1 || fatal "tmux が PATH に無い"

# socket は session ごとに分ける（socket 名 = session 名）。tmux server は起こした
# 呼び出し元の cwd・env・実行環境を引き継ぎ、以降の session もそれを引くため、
# 別の呼び出し元の session と server を共有しない。ユーザー default socket も汚さない。
# -f /dev/null: server の振る舞い（remain-on-exit / exit-empty / base-index 等）をユーザー設定に左右させない
tmux_session() {
	tmux -f /dev/null -L "$session" "$@"
}

# server を止めて socket file を消す。server が先に終わっていても socket file は残る。
# 生きている server を止められなければ socket file を残す（消すとその server へ辿れなくなる）
destroy_session() {
	# kill-server の失敗は、その間に server が自分で終わった場合と区別する
	if tmux_session has-session -t "=$session" 2>/dev/null; then
		tmux_session kill-server 2>/dev/null ||
			! tmux_session has-session -t "=$session" 2>/dev/null || return 1
	fi
	rm -f "${TMUX_TMPDIR:-/tmp}/tmux-$(id -u)/$session"
}

screen_of() {
	tmux_session capture-pane -t "$1" -p 2>/dev/null
}

# 画面が prev から変わるまで 0.2 秒刻みで待つ。変わったら 0、読めたが変わらなければ 1、1 度も読めなければ 2
wait_screen_change() {
	w_target=$1
	w_prev=$2
	w_ticks=$3
	w_seen=0
	while [ "$w_ticks" -gt 0 ]; do
		if w_now=$(screen_of "$w_target"); then
			[ "$w_now" != "$w_prev" ] && return 0
			w_seen=1
		fi
		sleep 0.2
		w_ticks=$((w_ticks - 1))
	done
	[ "$w_seen" = 1 ] && return 1
	return 2
}

# 画面が prev から変わり、続けて 2 回同じ画面になるまで待つ。尽きたら 1
wait_screen_settle() {
	s_target=$1
	s_prev=$2
	s_ticks=$3
	s_last=$s_prev
	while [ "$s_ticks" -gt 0 ]; do
		if s_now=$(screen_of "$s_target") && [ "$s_now" != "$s_prev" ]; then
			[ "$s_now" = "$s_last" ] && return 0
			s_last=$s_now
		fi
		sleep 0.2
		s_ticks=$((s_ticks - 1))
	done
	return 1
}

# pane は base-index / pane-base-index に依存しない。session の pane id を引く
target_of() {
	t_id=$(tmux_session list-panes -t "=$session" -F '#{pane_id}' 2>/dev/null | head -n 1)
	[ -n "$t_id" ] || return 1
	printf '%s' "$t_id"
}

require_session() {
	tmux_session has-session -t "=$session" 2>/dev/null || fatal "session が無い: $session"
}

here=$(CDPATH= cd -P -- "$(dirname -- "$0")" && pwd) ||
	fatal "スクリプトの場所が取れない"
advisors_ts=$here/advisors.ts

require_judge() {
	[ -f "$advisors_ts" ] || fatal "画面判定が無い: $advisors_ts"
	command -v bun >/dev/null 2>&1 || fatal "bun が PATH に無い"
}

# session を作り、起動 argv を直接 exec する。harness が終われば pane / session と server が消える
create_session() {
	c_workdir=$1
	shift
	tmux_session has-session -t "=$session" 2>/dev/null && fatal "session が既にある: $session"
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
	# server はこの呼び出しで起き、今の env を引き継ぐ。
	# 呼び出し元の印（CLAUDECODE 等）は空にする —— 子を親の kind と誤認させない。
	set -- "--" "$c_abs" "$@"
	for name in $(env | sed -n -E 's/^(CLAUDECODE|CLAUDE_CODE_[A-Za-z0-9_]*|CURSOR_INVOKED_AS|CONSULT_[A-Za-z0-9_]*|DISPATCH_[A-Za-z0-9_]*|LC_ALL)=.*/\1/p' | sort -u); do
		set -- -e "$name=" "$@"
	done
	tmux_session new-session -d -s "$session" -c "$c_workdir" -x 120 -y 40 "$@" ||
		fatal "tmux session を作れない: $session"
}

case "$cmd" in
open)
	workdir=${1:-}
	[ -n "$workdir" ] && [ -d "$workdir" ] || fatal "workdir が不正: ${workdir:-未指定}"
	shift
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
	create_session "$workdir" "$@"
	# 入力を受ける画面になる前に止まったら session を残さない
	trap destroy_session EXIT
	deadline=$(($(date +%s) + timeout))
	answered=0
	while :; do
		tmux_session has-session -t "=$session" 2>/dev/null ||
			fatal "session が消えた（起動した harness が終了した）: $session"
		target=$(target_of) || fatal "pane が無い: $session"
		# 状態も選択肢番号も同じ 1 回の capture から読む（間で画面が変わらない）
		snap=$(tmux_session capture-pane -t "$target" -p 2>/dev/null) || snap=""
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
				tmux_session send-keys -t "$target" "$key" || fatal "選択肢を送れない: $key"
				sleep 0.2
				tmux_session send-keys -t "$target" C-m || fatal "Enter を送れない"
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
	file=${1:-}
	[ -n "$file" ] && [ -f "$file" ] || fatal "file が不正: ${file:-未指定}"
	require_session
	target=$(target_of) || fatal "pane が無い: $session"
	buf="consult-paste-$$"
	before=$(screen_of "$target") || fatal "画面を読めない: $session"
	tmux_session load-buffer -b "$buf" -- "$file" || fatal "buffer に読めない: $file"
	# -p: bracketed paste（LF→CR 置換を避ける）。-d: paste 後に buffer 削除
	tmux_session paste-buffer -p -d -b "$buf" -t "$target" || {
		tmux_session delete-buffer -b "$buf" 2>/dev/null || true
		fatal "paste できない"
	}
	# 貼り付けが画面に反映されて落ち着いてから Enter を送る（処理中に送ると入力欄に残る）
	wait_screen_settle "$target" "$before" 50 || fatal "貼り付けが画面に反映されない: $session"
	after=$(screen_of "$target") || fatal "画面を読めない: $session"
	tmux_session send-keys -t "$target" C-m || fatal "Enter を送れない"
	# 読めたのに画面が動かないときだけ Enter をもう 1 度送る
	wait_screen_change "$target" "$after" 10
	case $? in
	0) ;;
	1) tmux_session send-keys -t "$target" C-m || fatal "Enter を送れない" ;;
	*) fatal "送信後の画面を読めない: $session" ;;
	esac
	;;
capture)
	require_session
	target=$(target_of) || fatal "pane が無い: $session"
	tmux_session capture-pane -t "$target" -p -S - -E -
	;;
screen)
	require_session
	target=$(target_of) || fatal "pane が無い: $session"
	tmux_session capture-pane -t "$target" -p
	;;
state)
	require_session
	require_judge
	target=$(target_of) || fatal "pane が無い: $session"
	tmux_session capture-pane -t "$target" -p 2>/dev/null |
		bun "$advisors_ts" pane-state
	;;
exists)
	tmux_session has-session -t "=$session" 2>/dev/null
	;;
kill)
	destroy_session || fatal "session を殺せない: $session"
	;;
*) fatal "未知のサブコマンド: $cmd" ;;
esac
