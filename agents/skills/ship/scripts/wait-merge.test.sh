#!/bin/sh
# wait-merge.sh の終端と追随を固定する。
#
# ネットワークに出ず、実時間を待たない。gh / date / sleep は PATH の stub、sync-and-push.sh は
# script の隣に置いた stub。PR の姿は 1 ケース 1 dir の場面ファイルで渡す:
#   view.<n>   n 回目の PR の読み出し（REST の pulls）が返す JSON。script の --jq を jq で当てる（無ければ n 未満で最大の番号）
#   view-fails.<n> / checks-fails.<n> 在れば n 回目のその呼び出しを一時失敗させる
#   behind.<n> その回の compare の behind_by（どの番号も無ければ 1）
#   compare-fails.<n> 在れば n 回目の compare を一時失敗させる
#   synced-at  追随した回の番号
#   sync-takes 追随 stub が進める秒数
#   checks.<n> その回の gh pr checks の出力（TSV。どの番号も無ければ required checks 無し）
#   clock      date / sleep が共有する経過秒
#   calls      追随コマンドの呼び出し記録

set -u

for git_env_var in $(git rev-parse --local-env-vars) GIT_CEILING_DIRECTORIES; do
  unset "$git_env_var"
done

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

export GIT_CONFIG_GLOBAL="$TMP/gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test
export GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test
export GIT_COMMITTER_EMAIL=test@example.com

mkdir -p "$TMP/bin" "$TMP/skill"
cp "$DIR/wait-merge.sh" "$TMP/skill/wait-merge.sh"
SCRIPT="$TMP/skill/wait-merge.sh"

cat >"$TMP/skill/sync-and-push.sh" <<'STUB'
#!/bin/sh
echo sync-and-push >>"$SCENE/calls"
cat "$SCENE/n" >>"$SCENE/synced-at"
echo "sync-and-push stub: stdout へ出す"
# 追随に掛かる秒数。
if [ -e "$SCENE/sync-takes" ]; then
  echo $(($(cat "$SCENE/clock" 2>/dev/null || echo 0) + $(cat "$SCENE/sync-takes"))) >"$SCENE/clock"
fi
[ ! -e "$SCENE/sync-fails" ]
STUB

# 場面ファイルの n 番以下で最大の番号のものを返す。
cat >"$TMP/bin/scene-file" <<'STUB'
#!/bin/sh
i="$2"
while [ "$i" -gt 0 ]; do
  if [ -e "$SCENE/$1.$i" ]; then
    echo "$SCENE/$1.$i"
    exit 0
  fi
  i=$((i - 1))
done
exit 1
STUB

cat >"$TMP/bin/gh" <<'STUB'
#!/bin/sh
n=$(cat "$SCENE/n" 2>/dev/null || echo 0)
case "$1 $2" in
"api repos/{owner}/{repo}/pulls/42")
  n=$((n + 1))
  echo "$n" >"$SCENE/n"
  # 終端しない script を test が待ち続けない。
  [ "$n" -le 60 ] || { echo "gh stub: poll が多すぎる" >&2; exit 1; }
  [ ! -e "$SCENE/view-fails.$n" ] || { echo "HTTP 502" >&2; exit 1; }
  f=$(scene-file view "$n") || { echo "gh stub: view が無い" >&2; exit 1; }
  [ "$3" = --jq ] || { echo "gh stub: --jq が無い" >&2; exit 1; }
  jq -r "$4" "$f"
  ;;
"pr checks")
  [ ! -e "$SCENE/checks-fails.$n" ] || { echo "HTTP 502" >&2; exit 1; }
  f=$(scene-file checks "$n") || { echo "no required checks reported" >&2; exit 1; }
  cat "$f"
  exit 8
  ;;
"api repos/{owner}/{repo}/compare/main..."*)
  [ ! -e "$SCENE/compare-fails.$n" ] || { echo "HTTP 502" >&2; exit 1; }
  f=$(scene-file behind "$n") && cat "$f" || echo 1
  ;;
"pr update-branch")
  echo update-branch >>"$SCENE/calls"
  cat "$SCENE/n" >>"$SCENE/synced-at"
  echo "gh stub: update-branch の stdout"
  [ ! -e "$SCENE/sync-fails" ]
  ;;
*)
  echo "gh stub: 想定外の呼び出し: $*" >&2
  exit 1
  ;;
esac
STUB

cat >"$TMP/bin/date" <<'STUB'
#!/bin/sh
t=$(cat "$SCENE/clock" 2>/dev/null || echo 0)
case "$*" in
"-u +%s") echo "$t" ;;
"-u +%Y-%m-%dT%H:%M:%SZ") printf '2026-01-01T%02d:%02d:%02dZ\n' $((t / 3600)) $((t / 60 % 60)) $((t % 60)) ;;
*)
  echo "date stub: 想定外の呼び出し: $*" >&2
  exit 1
  ;;
esac
STUB

cat >"$TMP/bin/sleep" <<'STUB'
#!/bin/sh
t=$(cat "$SCENE/clock" 2>/dev/null || echo 0)
echo $((t + $1)) >"$SCENE/clock"
STUB

chmod +x "$TMP/bin/"* "$TMP/skill/"*
PATH="$TMP/bin:$PATH"
export PATH

fails=0
pass=0

fail() {
  fails=$((fails + 1))
  echo "FAIL: $1" >&2
}

ok() {
  pass=$((pass + 1))
}

# 1 ケース 1 場面。$1 はケース名、$2 は cwd の worktree の branch。
scene() {
  case="$1"
  SCENE="$TMP/$case"
  export SCENE
  mkdir -p "$SCENE/repo"
  git -C "$SCENE/repo" init -q -b "$2"
  git -C "$SCENE/repo" commit -q --allow-empty -m init
}

# $1 は場面ファイル名、$2 以降が行。
put() {
  f="$1"
  shift
  printf '%s\n' "$@" >"$SCENE/$f"
}

# 場面で script を走らせ、理由・終了コード・stdout の行数を確かめる。$1 は期待する理由、$2 は終了コード。
expect() {
  out=$(cd "$SCENE/repo" && sh -c '"$0" 42 2>"$1"' "$SCRIPT" "$SCENE/err")
  code=$?
  if [ "$out" = "$1" ] && [ "$code" -eq "$2" ] && [ "$(printf '%s\n' "$out" | wc -l | tr -d ' ')" -eq 1 ]; then
    ok
  else
    fail "$case: 期待 $1/$2、実際 [$out]/$code: $(cat "$SCENE/err")"
  fi
}

calls() {
  cat "$SCENE/calls" 2>/dev/null | tr '\n' ' '
}

clock() {
  cat "$SCENE/clock" 2>/dev/null || echo 0
}

# REST の pulls の JSON。state mergeable_state（null は JSON の null）head.sha [merged_at]
v() {
  ms="\"$2\""
  [ "$2" != null ] || ms=null
  ma=null
  [ -z "${4:-}" ] || ma="\"$4\""
  printf '{"state":"%s","mergeable_state":%s,"merged_at":%s,"head":{"sha":"%s","ref":"feat"},"base":{"ref":"main"}}' \
    "$1" "$ms" "$ma" "$3"
}
c() { printf '%s\t%s' "$1" "$2"; }

# --- 終端 ---
scene merged feat
put view.1 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect merged 0

scene closed feat
put view.1 "$(v closed unknown a)"
expect closed 3

scene conflict feat
put view.1 "$(v open dirty a)"
put checks.1 "$(c pending '')"
expect conflict 7

scene failed feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pass 2026-01-01T00:00:01Z)" "$(c fail 2026-01-01T00:00:01Z)"
expect checks-failed 6

scene cancelled feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c cancel 2026-01-01T00:00:01Z)"
expect checks-failed 6

# mergeable_state が欠けても（null）、読めない回として数えず、checks の判定へ進む。
scene unknown-state feat
put view.1 "$(v open null a)"
put checks.1 "$(c pending '')"
put view.4 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect merged 0

scene view-error feat
expect error 1

# --- poll の間隔 ---
# rate limit は同じ user の全 session で共有する。待つ PR が数本並んでも上限に届かない間隔にする。
scene interval feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pending '')"
put view.3 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(clock)" -ge 60 ]; then ok; else fail "interval: 3 回目の読み出しまでが 60 秒未満: $(clock) 秒"; fi

# --- 待機の上限 ---
# 現 head の checks が完了してから 2 分で timeout。完了前は計時しない。
scene timeout feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pending '')"
put checks.2 "$(c pass 2026-01-01T00:00:31Z)"
expect timeout 5
if [ "$(clock)" -ge 150 ] && [ "$(clock)" -le 160 ]; then ok; else fail "timeout: 完了から 2 分で止まっていない: $(clock) 秒"; fi

# checks pending の間は上限に数えない。
scene pending feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pass 2026-01-01T00:00:01Z)" "$(c pending '')"
put view.30 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect merged 0

# 開始前に完了した checks は現 head のもの（開始時は head を動かしていない）。開始から 2 分で timeout。
scene done-before-start feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pass 2025-12-31T23:59:00Z)"
expect timeout 5
if [ "$(clock)" -ge 120 ] && [ "$(clock)" -le 125 ]; then ok; else fail "done-before-start: 開始から 2 分で止まっていない: $(clock) 秒"; fi

# required checks が無ければ起点から 2 分。
scene no-checks feat
put view.1 "$(v open blocked a)"
expect timeout 5
if [ "$(clock)" -ge 120 ] && [ "$(clock)" -le 125 ]; then ok; else fail "no-checks: 起点から 2 分で止まっていない: $(clock) 秒"; fi

# --- BEHIND への追随 ---
# 自分の worktree の PR は sync-and-push.sh。追随の出力は stdout に混ぜない（expect が 1 行を見る）。
scene own feat
put view.1 "$(v open behind a)"
put view.2 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(calls)" = "sync-and-push " ]; then ok; else fail "own: 追随経路が違う: $(calls)"; fi

# 他 session の PR は update-branch。local は触らない。
scene other main
put view.1 "$(v open behind a)"
put view.2 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(calls)" = "update-branch " ]; then ok; else fail "other: 追随経路が違う: $(calls)"; fi

synced_at() {
  cat "$SCENE/synced-at" 2>/dev/null | tr '\n' ' '
}

# 追随後に残る BEHIND は遅れが 0 なら残留。追随せず、回数も消費しない。
scene residual feat
put view.1 "$(v open behind a)"
put view.2 "$(v open behind b)"
put behind.2 0
put view.4 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(synced_at)" = "1 " ]; then ok; else fail "residual: 残留で追随した: $(synced_at)"; fi

# 残留の後に base が進めば、head が動いていなくても追随する。
scene base-advances feat
put view.1 "$(v open behind a)"
put view.2 "$(v open behind b)"
put behind.2 0
put behind.4 2
put view.5 "$(v closed unknown c 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(synced_at)" = "1 4 " ]; then ok; else fail "base-advances: 追随した回が違う: $(synced_at)"; fi

# 遅れ 0 の BEHIND が残り続けるなら、起点から 2 分で timeout。
scene stuck-behind feat
put view.1 "$(v open behind a)"
put behind.2 0
expect timeout 5
if [ "$(synced_at)" = "1 " ]; then ok; else fail "stuck-behind: 追随回数が違う: $(synced_at)"; fi
if [ "$(clock)" -ge 120 ] && [ "$(clock)" -le 130 ]; then ok; else fail "stuck-behind: 起点から 2 分で止まっていない: $(clock) 秒"; fi

# base が進むたびに追随し、3 回を超えたところで止める。
scene behind-limit feat
put view.1 "$(v open behind a)"
put view.2 "$(v open behind b)"
put view.3 "$(v open behind c)"
put view.4 "$(v open behind d)"
expect behind-limit 4
if [ "$(synced_at)" = "1 2 3 " ]; then ok; else fail "behind-limit: 追随回数が違う: $(synced_at)"; fi

# 追随が PR の head に反映されるまでの BEHIND（追随元と同じ head）では追随し直さない。
scene pending-head feat
put view.1 "$(v open behind a)"
put view.4 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(synced_at)" = "1 " ]; then ok; else fail "pending-head: 反映待ちで追随した: $(synced_at)"; fi

# 追随しても head が動かないなら、起点から 2 分で timeout。
scene head-stuck feat
put view.1 "$(v open behind a)"
expect timeout 5
if [ "$(synced_at)" = "1 " ]; then ok; else fail "head-stuck: 追随回数が違う: $(synced_at)"; fi

scene compare-fails feat
put view.1 "$(v open behind a)"
put behind.1 0
: >"$SCENE/compare-fails.2"
: >"$SCENE/compare-fails.3"
: >"$SCENE/compare-fails.4"
put view.5 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect error 1

scene compare-flaky feat
put view.1 "$(v open behind a)"
: >"$SCENE/compare-fails.1"
put view.3 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0
if [ "$(synced_at)" = "2 " ]; then ok; else fail "compare-flaky: 追随した回が違う: $(synced_at)"; fi

# 追随後は起点を取り直す。追随前に完了した checks で計時しない。
scene restart feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pass 2026-01-01T00:00:01Z)"
put view.3 "$(v open behind a)"
put view.4 "$(v open blocked b)"
put view.40 "$(v closed unknown b 2026-01-01T00:00:00Z)"
expect merged 0

# 起点は追随の前の時刻。追随の完了と同じ秒に完了した新 head の check で計時を始める。
scene sync-same-second feat
echo 3 >"$SCENE/sync-takes"
put view.1 "$(v open behind a)"
put view.2 "$(v open blocked b)"
put checks.2 "$(c pass 2026-01-01T00:00:03Z)"
expect timeout 5

# --- gh の一時失敗 ---
# pr checks の一時失敗は required checks 無しと取り違えない。
scene checks-flaky feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pending '')"
: >"$SCENE/checks-fails.30"
put view.31 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect merged 0

# pr checks が続けて読めなければ error（読み飛ばしで終端を失わない）。
scene checks-fails feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pending '')"
: >"$SCENE/checks-fails.2"
: >"$SCENE/checks-fails.3"
: >"$SCENE/checks-fails.4"
put view.5 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect error 1

scene view-flaky feat
put view.1 "$(v closed unknown a 2026-01-01T00:00:00Z)"
: >"$SCENE/view-fails.1"
expect merged 0

scene view-fails feat
put view.1 "$(v open blocked a)"
put checks.1 "$(c pending '')"
: >"$SCENE/view-fails.2"
: >"$SCENE/view-fails.3"
: >"$SCENE/view-fails.4"
put view.5 "$(v closed unknown a 2026-01-01T00:00:00Z)"
expect error 1

scene sync-fails main
: >"$SCENE/sync-fails"
put view.1 "$(v open behind a)"
expect error 1

echo "wait-merge.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
