# コメント指紋の 1 行。`$board` は board 上の Issue 番号（改行区切り）。
#
# 単独行の識別は `../src/standalone-line.ts` と同じ判定。時刻の畳みは下の `owned`。
# 未知と混在は畳まない。フィールドは削らず、畳むときは固定文字列 `owned` を置く。

def board_nums:
  ($board | split("\n") | map(select(length > 0)));

def issue_num:
  ((.issue_url // "") | split("/") | last) as $last
  | if ($last | test("^[0-9]+$")) then ($last | tonumber) else empty end;

def bare:
  sub("\r$"; "") | sub("[ \t]+$"; "");

def open_names:
  (.body // "")
  | split("\n")
  | map(bare)
  | map(select(test("^<!-- [a-z][a-z-]* -->$")))
  | map(capture("^<!-- (?<n>[a-z][a-z-]*) -->$") | .n);

def owned:
  ["cycle", "retry", "yield", "integration"];

def fold:
  . as $names
  | ($names | length) > 0
    and ($names | all(. as $n | owned | index($n) != null));

def stamp($names):
  if ($names | fold) then "owned" else (.updated_at // "") end;

.[]
| issue_num as $n
| select($n != null and (board_nums | index($n | tostring) != null))
| open_names as $names
| "\(.id) \(stamp($names)) \($names | join(","))"
