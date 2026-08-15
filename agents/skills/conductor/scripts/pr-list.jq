# open PR を snapshot の PRs 行へ写す。
#
# **追跡していない PR の checks は untracked。**番号を持たない PR の checks は
# どの progress も動かせない。判定は形だけ（`<prefix>/<番号>-`）。
# **判定できないものは残す側（fail-open）へ倒す** —— headRefName が取れないときは追跡中。
#
# CheckRun の実行中は `conclusion` が null で `status` に値が在る。
# StatusContext は `state` だけで `conclusion` は常に null。
# **空の status は出さない**（decode が空を落とすと pending が消える）。

def untracked:
  .headRefName != null and ((.headRefName | test("^[^/]+/[0-9]+-")) | not);

def check_of:
  {
    status: (.conclusion // .status // .state // ""),
    at: (.completedAt // .startedAt // .createdAt // ""),
    name: (.name // .context // "")
  };

def checks_field:
  if untracked then "untracked"
  else
    [(.statusCheckRollup // [])[] | check_of | select(.status != "" and .name != "")
      | "\(.status)@\(.at)@\(.name)"]
    | if length == 0 then "none" else join("|") end
  end;

.[] | "\(.number) \(.headRefName) \(.state) draft=\(.isDraft) checks=\(checks_field)"
