#!/bin/sh
# dispatch の明示 backend セレクタ。黙って別経路へ倒さない。
#
#   DISPATCH_BACKEND=tmux|herdr <skills root>/dispatch/scripts/dispatch-backend.sh <start|collect|ask|close> ...
#
# tmux  → worker-tmux.sh（DISPATCH_KIND 任意）
# herdr → いまはセレクタ上の互換入口のみ。実体は resolve skill の HERDR_ENV=1 手順が SSOT

set -u
# 子 process に LC_ALL を渡さない（tmux server / harness を C locale にしない）

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

here=$(python3 -c 'import os,sys; print(os.path.dirname(os.path.realpath(sys.argv[1])))' "$0") ||
	fatal "スクリプトの場所が取れない"

backend=${DISPATCH_BACKEND:-}
case "$backend" in
tmux)
	exec sh "$here/worker-tmux.sh" "$@"
	;;
herdr)
	fatal "DISPATCH_BACKEND=herdr の script 実体は未配線。resolve skill の HERDR_ENV=1 手順（herdr worktree + resolve-argv）を使え"
	;;
"")
	fatal "DISPATCH_BACKEND が無い（tmux|herdr）。別の起動方式へ倒さない"
	;;
*)
	fatal "未知の DISPATCH_BACKEND: ${backend} (tmux|herdr)"
	;;
esac
