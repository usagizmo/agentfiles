# open PR を snapshot の PRs 行へ写す。
#
# **追跡していない PR の checks は untracked。**番号を持たない PR の checks は
# どの progress も動かせない。判定は形だけ（`<prefix>/<番号>-`）。
# **判定できないものは残す側（fail-open）へ倒す** —— headRefName が取れないときは追跡中。
#
# status は conclusion → status → state、at は completedAt → startedAt → createdAt。
# 欠落値（空文字、および `0001-01-01` で始まるゼロ時刻）を除外して次候補へ進む。
# 欠落を残すと実行中が空に見える。jq の `//` は空文字を欠落とみなさない。
# StatusContext は `state` だけ。
# 読めない status は行を捨てず `UNREADABLE` を出す（decode が空を落とすと行が消える）。

def untracked:
  .headRefName != null and ((.headRefName | test("^[^/]+/[0-9]+-")) | not);

def missing:
  . == null or . == "" or (type == "string" and startswith("0001-01-01"));

def first_present:
  (map(select(missing | not)) | .[0]) // "";

def check_of:
  {
    status: ([.conclusion, .status, .state] | first_present),
    at: ([.completedAt, .startedAt, .createdAt] | first_present),
    name: ([.name, .context] | first_present)
  };

def checks_field:
  if untracked then "untracked"
  else
    [(.statusCheckRollup // [])[] | check_of | select(.name != "")
      | .status |= if . == "" then "UNREADABLE" else . end
      | "\(.status)@\(.at)@\(.name)"]
    | if length == 0 then "none" else join("|") end
  end;

.[] | "\(.number) \(.headRefName) \(.state) draft=\(.isDraft) checks=\(checks_field)"
