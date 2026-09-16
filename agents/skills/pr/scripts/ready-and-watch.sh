#!/usr/bin/env bash
# Ready 直後は Draft 時の結果が残るので、Ready 時刻以降に作られた workflow run を見てから watch する。
# event は pull_request のまま。createdAt が Ready 時刻以降の run を見る。
# 自分で ready するときは直前の run id を控え、控えに無い id かつ createdAt >= ready_at を新 run とする。控えが無い再実行は createdAt > ready_at（同秒は採らない。正当な新 run を同秒で落とす timeout は fail-closed）。
#
# 使い方: ready-and-watch.sh <number>
# Draft なら ready する。Ready 遷移が一度も無い PR は待たずに watch する。
set -euo pipefail

fail() {
	printf '%s\n' "$1" >&2
	exit 1
}

number=${1:-}
[ -n "$number" ] || fail "使い方: ready-and-watch.sh <number>"
[ $# -eq 1 ] || fail "使い方: ready-and-watch.sh <number>"

{
	IFS= read -r sha
	IFS= read -r is_draft
	IFS= read -r head
} <<EOF
$(gh pr view "$number" --json headRefOid,isDraft,headRefName --jq '.headRefOid, .isDraft, .headRefName')
EOF

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)

snapshot=
if [ "$is_draft" = true ]; then
	snapshot=$(gh run list --branch "$head" --json databaseId,headSha --jq ".[] | select(.headSha==\"${sha}\") | .databaseId")
	gh pr ready "$number"
fi

ready_at=$(gh api --paginate "repos/${repo}/issues/${number}/timeline" --jq '.[] | select(.event=="ready_for_review") | .created_at' | tail -n 1)

if [ -n "$ready_at" ] && [ "$ready_at" != null ]; then
	deadline=$(($(date +%s) + 180))
	ids=
	while :; do
		if [ -n "$snapshot" ]; then
			cmp='>='
		else
			cmp='>'
		fi
		candidates=$(gh run list --branch "$head" --limit 50 --json databaseId,event,headSha,createdAt --jq ".[] | select(.event==\"pull_request\" and .headSha==\"${sha}\" and .createdAt ${cmp} \"${ready_at}\") | .databaseId")
		ids=
		while IFS= read -r id; do
			[ -n "$id" ] || continue
			if [ -n "$snapshot" ] && printf '%s\n' "$snapshot" | grep -qxF "$id"; then
				continue
			fi
			ids=${ids}${id}$'\n'
		done <<EOF
$candidates
EOF
		[ -n "$ids" ] && break
		if [ "$(date +%s)" -ge "$deadline" ]; then
			fail "Ready で CI が起動していない。workflow の pull_request.types に ready_for_review があるか、空 commit で再走させる"
		fi
		sleep 2
	done
	while IFS= read -r id; do
		[ -n "$id" ] || continue
		gh run watch "$id" --exit-status
	done <<EOF
$ids
EOF
fi

gh pr checks "$number" --watch
