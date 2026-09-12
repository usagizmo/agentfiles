#!/bin/sh
# dispatch の明示 backend セレクタ。黙って別経路へ倒さない。
#
#   DISPATCH_BACKEND=tmux <skills root>/dispatch/scripts/dispatch-backend.sh <start|collect|ask|close> ...
#
# tmux → worker-tmux.sh（DISPATCH_KIND 任意）
# 将来の backend（例: cloud）はここに足す。未設定・未知は fatal。

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
"")
	fatal "DISPATCH_BACKEND が無い（tmux）。別の起動方式へ倒さない"
	;;
*)
	fatal "未知の DISPATCH_BACKEND: ${backend} (tmux)"
	;;
esac
