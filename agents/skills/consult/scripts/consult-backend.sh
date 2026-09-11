#!/bin/sh
# consult の明示 backend セレクタ。黙って別経路へ倒さない。
#
#   CONSULT_BACKEND=tmux|herdr <skills root>/consult/scripts/consult-backend.sh <start|collect|ask|close> ...
#
# herdr → advisors.sh（HERDR_ENV=1 が別途必要）
# tmux  → advisors-tmux.sh（CONSULT_SELF_KIND が別途必要）

set -u
LC_ALL=C
export LC_ALL

fatal() {
	printf 'FATAL\t%s\n' "$1" >&2
	exit 2
}

here=$(python3 -c 'import os,sys; print(os.path.dirname(os.path.realpath(sys.argv[1])))' "$0") ||
	fatal "スクリプトの場所が取れない"

backend=${CONSULT_BACKEND:-}
case "$backend" in
herdr)
	exec sh "$here/advisors.sh" "$@"
	;;
tmux)
	exec sh "$here/advisors-tmux.sh" "$@"
	;;
"")
	fatal "CONSULT_BACKEND が無い（herdr|tmux）。別の起動方式へ倒さない"
	;;
*)
	fatal "未知の CONSULT_BACKEND: $backend（herdr|tmux）"
	;;
esac
