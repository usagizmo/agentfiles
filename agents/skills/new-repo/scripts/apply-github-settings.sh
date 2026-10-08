#!/usr/bin/env bash
# usagizmo/dev-template 由来リポ向けの GitHub 設定を当てる。
#
# 使い方: apply-github-settings.sh <owner>/<name>
# - Wiki オフ
# - squash / rebase オフ、通常マージのみ
# - merge commit = PR title + description
# - allow auto-merge オン、delete head branches オン
# - default branch に ruleset「main」（削除禁止・強制プッシュ禁止・CI Check 必須）
set -euo pipefail

repo="${1:-}"
if [ -z "$repo" ] || [[ "$repo" != */* ]]; then
  echo "usage: apply-github-settings.sh <owner>/<name>" >&2
  exit 1
fi

# CI ジョブ名は template の .github/workflows/main.yml の jobs.*.name
# （現テンプレは name: Check → status context "Check"）
check_context="Check"
# GitHub Actions
actions_integration_id=15368

gh api -X PATCH "repos/${repo}" \
  -F has_wiki=false \
  -F allow_merge_commit=true \
  -F allow_squash_merge=false \
  -F allow_rebase_merge=false \
  -f merge_commit_title=PR_TITLE \
  -f merge_commit_message=PR_BODY \
  -F allow_auto_merge=true \
  -F delete_branch_on_merge=true \
  --jq '{has_wiki,allow_merge_commit,allow_squash_merge,allow_rebase_merge,allow_auto_merge,delete_branch_on_merge,merge_commit_title,merge_commit_message}'

existing_id=$(
  gh api "repos/${repo}/rulesets" \
    --jq '.[] | select(.name=="main" and .target=="branch") | .id' \
    | head -n 1
)

payload=$(cat <<JSON
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    {
      "actor_id": null,
      "actor_type": "OrganizationAdmin",
      "bypass_mode": "always"
    }
  ],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": false,
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          {
            "context": "${check_context}",
            "integration_id": ${actions_integration_id}
          }
        ]
      }
    }
  ]
}
JSON
)

if [ -n "$existing_id" ]; then
  echo "ruleset main を更新: id=${existing_id}"
  printf '%s' "$payload" | gh api -X PUT "repos/${repo}/rulesets/${existing_id}" --input -
else
  echo "ruleset main を作成"
  printf '%s' "$payload" | gh api -X POST "repos/${repo}/rulesets" --input -
fi
