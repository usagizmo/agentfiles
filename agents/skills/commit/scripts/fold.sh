#!/usr/bin/env bash
# <base>..HEAD の commit と staged を、1 つの commit に畳む。
#
# 書き換えるのは、今の branch 以外の refs/heads・refs/remotes・refs/tags のどれからも到達できない commit だけ
# （checkpoint などそれ以外の namespace は公開の証拠にしない）。fetch はしない: 判定は呼び出し時点の local の ref。
# remote に在っても local の ref に反映されていない commit と、判定の後に push された commit は検知できない。
#
# 使い方: fold.sh <base> [--message-file <file>]
# message を渡さなければ、範囲で最も古い commit の message を使う。
set -euo pipefail

usage="使い方: fold.sh <base> [--message-file <file>]"
fail() {
	printf '[fold] %s\n' "$1" >&2
	exit 1
}

[ $# -ge 1 ] || fail "$usage"
base_ref=$1
shift
message_file=
case $# in
0) ;;
2) [ "$1" = --message-file ] || fail "$usage"; message_file=$2 ;;
*) fail "$usage" ;;
esac

branch=$(git symbolic-ref -q HEAD) || fail "detached HEAD"
base=$(git rev-parse --verify -q "$base_ref^{commit}") || fail "base が無い: $base_ref"
git merge-base --is-ancestor "$base" HEAD || fail "$base_ref が HEAD の祖先でない"
git_dir=$(git rev-parse --git-dir)
for state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD; do
	[ ! -e "$git_dir/$state" ] || fail "$state が進行中"
done

count=$(git rev-list --count "$base..HEAD")
[ "$count" -ge 1 ] || fail "$base_ref..HEAD に commit が無い"
[ -z "$(git rev-list --merges "$base..HEAD")" ] || fail "範囲に merge commit がある"
[ "$(git rev-list --first-parent --count "$base..HEAD")" = "$count" ] || fail "範囲が直線でない"
# --all は HEAD を含むので使わず、ref を列挙する。
others=$(git for-each-ref --format='%(objectname)' --exclude="$branch" refs/heads refs/remotes refs/tags)
# shellcheck disable=SC2086 # objectname は空白を含まない
private=$(git rev-list --count "$base..HEAD" --not $others)
[ "$private" = "$count" ] || fail "範囲の commit が他の ref から到達できる（公開済みか別の branch のもの）"

work=$(mktemp -d "${TMPDIR:-/tmp}/fold.XXXXXX")
trap 'rm -rf "$work"' EXIT
oldest=$(git rev-list --reverse "$base..HEAD" | head -n 1)
if [ -z "$message_file" ]; then
	message_file=$work/message
	git log -1 --format=%B "$oldest" >"$message_file"
fi
[ -s "$message_file" ] || fail "message が空"

head=$(git rev-parse HEAD)
# intent-to-add や skip-worktree も戻すため、tree ではなく index file を退避する。
index=$(git rev-parse --git-path index)
cp "$index" "$work/index"
restore() {
	if ! { git reset -q --soft "$head" && cp "$work/index" "$index"; }; then
		trap - EXIT
		fail "復旧に失敗した。元の HEAD は $head、index の退避は $work/index"
	fi
}
trap 'restore; fail "中断した。HEAD と staged を戻した"' INT TERM HUP
git reset -q --soft "$base"
if ! git commit -q -F "$message_file"; then
	restore
	fail "commit に失敗した。HEAD と staged を戻した"
fi
trap - INT TERM HUP
printf '[fold] %s 件を %s に畳んだ（元の HEAD %s）\n' "$count" "$(git rev-parse --short HEAD)" "$(git rev-parse --short "$head")"
