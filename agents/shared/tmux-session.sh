#!/bin/sh
# tmux / pty session の薄い primitive。consult / dispatch の tmux backend が共有する。
#
#   tmux-session.sh open <session> <workdir> [--timeout <sec>] -- <cmd...>
#   tmux-session.sh paste-file <session> <file>
#   tmux-session.sh capture <session>
#   tmux-session.sh screen <session>
#   tmux-session.sh state <session>
#   tmux-session.sh poll <session>
#   tmux-session.sh exists <session>
#   tmux-session.sh kill <session>
#
# open は detached な 1 pane session を作って cmd を直接 exec し（login shell 経由にしない）、
# 入力を受ける画面になるまで待つ。起こせなければ session を破棄し、理由を FATAL 行に出して exit 2。
# capture は履歴全体、screen は表示中の 1 画面。状態判定に使うのは screen だけ。
# state は観測だけ。poll は巡の途中で重なった trust 対話を受け入れてから状態を返す（実行器を待つ側はこちら）。
# poll は失敗も状態語で返す（越えられない・越えた先が login / fatal・session / pane の消失は fatal。理由は stderr）。
# 画面の読み方は隣の advisors.ts（PaneState）が SSOT。bun が要る。

set -u

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

cmd=${1:-}
[ -n "$cmd" ] || fatal "使い方: tmux-session.sh open|paste-file|capture|screen|state|poll|exists|kill <session> ..."
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

# trust 対話の受け入れの選択肢を選ぶ。選択肢番号は画面から読む
# （初期選択に依存しない。番号が読めない・送れないときは Enter を送らない）
answer_trust() {
	a_key=$(printf '%s\n' "$2" | bun "$advisors_ts" trust-key) ||
		fatal "trust 対話の受け入れの選択肢を読めない"
	tmux_session send-keys -t "$1" "$a_key" || fatal "選択肢を送れない: $a_key"
	sleep 0.2
	tmux_session send-keys -t "$1" C-m || fatal "Enter を送れない"
}

# 入力欄を描いたあとに trust 対話を重ねる実行器がある（codex は起動の 1〜2 秒後）。
# open のあとに対話が出たら、受け入れて消えるまで待つ。対話の前に送った prompt は
# 対話を越えたあとに走るので、貼り直さない。越えた先が ready / working なら 0、
# login / fatal なら 1（越えた先の状態語は l_state）、越えられなければ 2
pass_late_trust() {
	answer_trust "$1" "$2"
	# 越えた証拠は、読めた画面が trust 以外の状態語になること。capture や判定の失敗・unknown は
	# 消えた証拠にしない（遷移中の空画面を越えたと読むと、続く Enter を対話へ送る）
	l_ticks=20
	while [ "$l_ticks" -gt 0 ]; do
		sleep 0.5
		l_ticks=$((l_ticks - 1))
		l_snap=$(screen_of "$1") || continue
		l_state=$(printf '%s\n' "$l_snap" | bun "$advisors_ts" pane-state) || continue
		case $l_state in
		ready | working) return 0 ;;
		login | fatal) return 1 ;;
		esac
	done
	return 2
}

# 送る途中で重なった trust 対話を越える。越えた先へ入力を送れなければ止める
late_trust_or_fatal() {
	pass_late_trust "$1" "$2" && return 0
	case $? in
	1) fatal "trust 対話のあとに入力を受けない画面になった（$l_state）: $session" ;;
	*) fatal "trust 対話を越えられない: $session" ;;
	esac
}

# poll の本体。前提が崩れたら fatal で抜ける（呼び出し側の subshell が受ける）
poll_state() {
	require_session
	require_judge
	p_target=$(target_of) || fatal "pane が無い: $session"
	p_snap=$(tmux_session capture-pane -t "$p_target" -p 2>/dev/null) || p_snap=""
	p_state=$(printf '%s\n' "$p_snap" | bun "$advisors_ts" pane-state) || p_state=unknown
	if [ "$p_state" = trust ]; then
		if pass_late_trust "$p_target" "$p_snap"; then
			p_state=$l_state
		else
			case $? in
			1) fatal "trust 対話のあとに入力を受けない画面になった（$l_state）: $session" ;;
			*) fatal "trust 対話を越えられない: $session" ;;
			esac
		fi
	fi
	printf '%s\n' "$p_state"
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
		fatal) fatal "不通: $bin" ;;
		trust)
			# workspace trust 対話は 1 度だけ受け入れる
			if [ "$answered" -eq 0 ]; then
				answer_trust "$target" "$snap"
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
	require_judge
	target=$(target_of) || fatal "pane が無い: $session"
	buf="consult-paste-$$"
	before=$(screen_of "$target") || fatal "画面を読めない: $session"
	tmux_session load-buffer -b "$buf" -- "$file" || fatal "buffer に読めない: $file"
	# -p: bracketed paste（LF→CR 置換を避ける）。-d: paste 後に buffer 削除
	tmux_session paste-buffer -p -d -b "$buf" -t "$target" || {
		tmux_session delete-buffer -b "$buf" 2>/dev/null || true
		fatal "paste できない"
	}
	# 貼り付けが入力欄に反映されて落ち着いてから Enter を送る（処理中に送ると入力欄に残る）。
	# 画面全体の変化は状態行でも起きるので、入力欄の行が変わったことを見る
	before_in=$(printf '%s\n' "$before" | bun "$advisors_ts" input-line) || fatal "入力欄を読めない: $session"
	p_ticks=50
	pasted=$before_in
	# 2 回続けて同じ（貼り付け前の行に戻る・読めない回があれば数え直す）
	while [ "$p_ticks" -gt 0 ]; do
		if now=$(screen_of "$target"); then
			if [ "$(printf '%s\n' "$now" | bun "$advisors_ts" pane-state)" = trust ]; then
				late_trust_or_fatal "$target" "$now"
				continue
			fi
			now_in=$(printf '%s\n' "$now" | bun "$advisors_ts" input-line) || fatal "入力欄を読めない: $session"
			if [ "$now_in" != "$before_in" ] && [ "$now_in" = "$pasted" ]; then
				break
			fi
			pasted=$now_in
		else
			pasted=$before_in
		fi
		sleep 0.2
		p_ticks=$((p_ticks - 1))
	done
	[ "$p_ticks" -gt 0 ] || fatal "貼り付けが入力欄に反映されない: $session"
	# 送信の証拠は入力欄の中身が消えること（画面全体は状態行の動きでも変わる）。
	# 起動直後の実行器は貼り付けの直後の Enter を取りこぼすので、消えるまで送り直す（最大 5 回）。
	# 1 回あたり 0.2 秒おきに 1 秒まで見る —— 固定で 1 秒待つと、消えたあとも待ち続ける
	p_tries=0
	p_sent=0
	while [ "$p_sent" -eq 0 ]; do
		tmux_session send-keys -t "$target" C-m || fatal "Enter を送れない"
		p_tries=$((p_tries + 1))
		p_ticks=5
		while [ "$p_ticks" -gt 0 ]; do
			sleep 0.2
			p_ticks=$((p_ticks - 1))
			now=$(screen_of "$target") || fatal "送信後の画面を読めない: $session"
			# 対話に取られた Enter は送信していない。越えてから送り直す
			if [ "$(printf '%s\n' "$now" | bun "$advisors_ts" pane-state)" = trust ]; then
				late_trust_or_fatal "$target" "$now"
				break
			fi
			now_in=$(printf '%s\n' "$now" | bun "$advisors_ts" input-line) ||
				fatal "入力欄を読めない: $session"
			if [ "$now_in" != "$pasted" ]; then
				p_sent=1
				break
			fi
		done
		[ "$p_sent" -eq 1 ] && break
		[ "$p_tries" -lt 5 ] || fatal "送信されない（入力欄に残っている）: $session"
	done
	;;
capture)
	require_session
	target=$(target_of) || fatal "pane が無い: $session"
	tmux_session capture-pane -t "$target" -p -J -S - -E -
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
poll)
	# 待つ側は状態語だけで分岐する。内部の失敗（session / pane の消失・trust の送信失敗）は
	# fatal へ写し、理由は stderr に残す。判定器の失敗だけは unknown（停止とは読まない）
	if p_out=$(poll_state); then
		printf '%s\n' "$p_out"
	else
		printf '%s\n' fatal
	fi
	;;
exists)
	tmux_session has-session -t "=$session" 2>/dev/null
	;;
kill)
	destroy_session || fatal "session を殺せない: $session"
	;;
*) fatal "未知のサブコマンド: $cmd" ;;
esac
