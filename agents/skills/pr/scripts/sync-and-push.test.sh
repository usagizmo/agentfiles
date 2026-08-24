#!/bin/sh
# sync-and-push.sh の宛先契約を固定する。
#
# 宛先は常に origin の refs/heads/<branch>。base へは送らない。空範囲では push
# しない。lease 無しで他人の tip は上書きしない。
#
# **ネットワークに出ない。**origin は一時 dir の bare repo。base 名は引数で渡す。

set -u

# **周りの git 環境を持ち込まない。**呼び出し元が GIT_DIR を立てていると、-C を付けても
# 本番の repo へ書く。**repo-local な変数は git 自身に列挙させる** —— 手書きの allowlist は
# git が版で増やすたびに漏れる。identity はこの下で立て直すので、落ちても困らない。
for git_env_var in $(git rev-parse --local-env-vars) GIT_CEILING_DIRECTORIES; do
  unset "$git_env_var"
done

DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SCRIPT="$DIR/sync-and-push.sh"
REAL_GIT=$(command -v git)
TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT

export GIT_CONFIG_GLOBAL="$TMP/gitconfig"
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test
export GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test
export GIT_COMMITTER_EMAIL=test@example.com
export GIT_TERMINAL_PROMPT=0
git config --global user.name test
git config --global user.email test@example.com
git config --global init.defaultBranch main

fails=0
pass=0

fail() {
  fails=$((fails + 1))
  echo "FAIL: $1" >&2
}

ok() {
  pass=$((pass + 1))
}

# 1 ケース 1 sandbox。$1 はケース名。
sandbox() {
  case="$1"
  root="$TMP/$case"
  mkdir -p "$root"
  git init --bare -b main "$root/origin.git" >/dev/null
  git clone "$root/origin.git" "$root/seed" >/dev/null 2>&1
  git -C "$root/seed" checkout -b main >/dev/null 2>&1
  printf 'base\n' >"$root/seed/README"
  git -C "$root/seed" add README
  git -C "$root/seed" commit -m init >/dev/null
  git -C "$root/seed" push -u origin main >/dev/null
  git clone "$root/origin.git" "$root/work" >/dev/null 2>&1
  git -C "$root/work" config push.default simple
}

origin_ref() {
  git --git-dir="$1/origin.git" rev-parse --verify --quiet "$2" 2>/dev/null || echo ""
}

# --- upstream が base。push.default=simple でも origin の同名へ届く ---
sandbox simple
git -C "$TMP/simple/work" checkout -b feat >/dev/null
printf 'feat\n' >>"$TMP/simple/work/README"
git -C "$TMP/simple/work" add README
git -C "$TMP/simple/work" commit -m feat >/dev/null
git -C "$TMP/simple/work" branch --set-upstream-to=origin/main >/dev/null
main_before=$(origin_ref "$TMP/simple" refs/heads/main)
feat_head=$(git -C "$TMP/simple/work" rev-parse HEAD)
if (cd "$TMP/simple/work" && bash "$SCRIPT" main >/dev/null 2>"$TMP/simple.err"); then
  ok
else
  fail "upstream が base のとき simple で落ちた: $(cat "$TMP/simple.err")"
fi
if [ "$(origin_ref "$TMP/simple" refs/heads/feat)" = "$feat_head" ]; then
  ok
else
  fail "simple: origin/feat に届いていない"
fi
if [ "$(origin_ref "$TMP/simple" refs/heads/main)" = "$main_before" ]; then
  ok
else
  fail "simple: origin/main が動いた"
fi
if [ "$(git -C "$TMP/simple/work" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" = "origin/feat" ]; then
  ok
else
  fail "simple: 終わったあと upstream が origin/feat ではない"
fi

# --- upstream が base。push.default=upstream でも base へ送らない ---
sandbox upstream
git -C "$TMP/upstream/work" checkout -b feat >/dev/null
printf 'feat\n' >>"$TMP/upstream/work/README"
git -C "$TMP/upstream/work" add README
git -C "$TMP/upstream/work" commit -m feat >/dev/null
git -C "$TMP/upstream/work" branch --set-upstream-to=origin/main >/dev/null
git -C "$TMP/upstream/work" config push.default upstream
main_before=$(origin_ref "$TMP/upstream" refs/heads/main)
feat_head=$(git -C "$TMP/upstream/work" rev-parse HEAD)
if (cd "$TMP/upstream/work" && bash "$SCRIPT" main >/dev/null 2>"$TMP/upstream.err"); then
  ok
else
  fail "push.default=upstream で落ちた: $(cat "$TMP/upstream.err")"
fi
if [ "$(origin_ref "$TMP/upstream" refs/heads/feat)" = "$feat_head" ]; then
  ok
else
  fail "upstream: origin/feat に届いていない"
fi
if [ "$(origin_ref "$TMP/upstream" refs/heads/main)" = "$main_before" ]; then
  ok
else
  fail "upstream: origin/main へ送った"
fi

# --- upstream が無い。origin の同名へ届き、upstream はその同名 ---
sandbox nous
git -C "$TMP/nous/work" checkout -b feat >/dev/null
printf 'feat\n' >>"$TMP/nous/work/README"
git -C "$TMP/nous/work" add README
git -C "$TMP/nous/work" commit -m feat >/dev/null
feat_head=$(git -C "$TMP/nous/work" rev-parse HEAD)
if (cd "$TMP/nous/work" && bash "$SCRIPT" main >/dev/null 2>"$TMP/nous.err"); then
  ok
else
  fail "upstream 無しで落ちた: $(cat "$TMP/nous.err")"
fi
if [ "$(origin_ref "$TMP/nous" refs/heads/feat)" = "$feat_head" ]; then
  ok
else
  fail "nous: origin/feat に届いていない"
fi
if [ "$(git -C "$TMP/nous/work" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" = "origin/feat" ]; then
  ok
else
  fail "nous: 終わったあと upstream が origin/feat ではない"
fi

# --- HEAD が origin の同名と同じなら push しない。skip 後も upstream は同名 ---
sandbox skip
git -C "$TMP/skip/work" checkout -b feat >/dev/null
printf 'feat\n' >>"$TMP/skip/work/README"
git -C "$TMP/skip/work" add README
git -C "$TMP/skip/work" commit -m feat >/dev/null
git -C "$TMP/skip/work" push -u origin feat >/dev/null
git -C "$TMP/skip/work" branch --set-upstream-to=origin/main >/dev/null
mkdir -p "$TMP/skip/work/.git/hooks"
cat >"$TMP/skip/work/.git/hooks/pre-push" <<'HOOK'
#!/bin/sh
while read -r local_ref local_oid remote_ref remote_oid; do
  if [ "$local_oid" = "$remote_oid" ]; then
    echo "empty range" >&2
    exit 1
  fi
  if [ "$remote_oid" != "0000000000000000000000000000000000000000" ]; then
    if [ -z "$(git rev-list "$remote_oid".."$local_oid")" ]; then
      echo "empty range" >&2
      exit 1
    fi
  fi
done
HOOK
chmod +x "$TMP/skip/work/.git/hooks/pre-push"
if (cd "$TMP/skip/work" && bash "$SCRIPT" main >/dev/null 2>"$TMP/skip.err"); then
  ok
else
  fail "空範囲の skip が落ちた: $(cat "$TMP/skip.err")"
fi
if [ "$(git -C "$TMP/skip/work" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}')" = "origin/feat" ]; then
  ok
else
  fail "skip: upstream が origin/feat ではない"
fi

# --- 他人が動かした origin の同名 tip は lease 無しでは上書きされない ---
sandbox lease
git -C "$TMP/lease/work" checkout -b feat >/dev/null
printf 'feat\n' >>"$TMP/lease/work/README"
git -C "$TMP/lease/work" add README
git -C "$TMP/lease/work" commit -m feat >/dev/null
git -C "$TMP/lease/work" push -u origin feat >/dev/null
printf 'more\n' >>"$TMP/lease/work/README"
git -C "$TMP/lease/work" add README
git -C "$TMP/lease/work" commit -m more >/dev/null
git clone "$TMP/lease/origin.git" "$TMP/lease/other" >/dev/null 2>&1
git -C "$TMP/lease/other" checkout feat >/dev/null 2>&1
printf 'other\n' >>"$TMP/lease/other/README"
git -C "$TMP/lease/other" add README
git -C "$TMP/lease/other" commit -m other >/dev/null
other_head=$(git -C "$TMP/lease/other" rev-parse HEAD)
mkdir -p "$TMP/lease/bin"
cat >"$TMP/lease/bin/git" <<GITWRAP
#!/bin/sh
if [ "\$1" = push ]; then
  "$REAL_GIT" -C "$TMP/lease/other" push origin feat >/dev/null 2>&1
fi
exec "$REAL_GIT" "\$@"
GITWRAP
chmod +x "$TMP/lease/bin/git"
set +e
(cd "$TMP/lease/work" && PATH="$TMP/lease/bin:$PATH" bash "$SCRIPT" main >"$TMP/lease.out" 2>"$TMP/lease.err")
lease_code=$?
set -e
if [ "$lease_code" -ne 0 ]; then
  ok
else
  fail "他人の tip を上書きした"
fi
if grep -q 'refs/heads/feat' "$TMP/lease.err"; then
  ok
else
  fail "lease 失敗の文言に origin の同名が無い: $(cat "$TMP/lease.err")"
fi
if [ "$(origin_ref "$TMP/lease" refs/heads/feat)" = "$other_head" ]; then
  ok
else
  fail "lease: origin/feat が他人の tip のままではない"
fi

# --- base 自身へは送らない ---
sandbox base
main_before=$(origin_ref "$TMP/base" refs/heads/main)
set +e
(cd "$TMP/base/work" && bash "$SCRIPT" main >"$TMP/base.out" 2>"$TMP/base.err")
base_code=$?
set -e
if [ "$base_code" -ne 0 ]; then
  ok
else
  fail "base 自身への push を止めなかった"
fi
if grep -q 'base 自身' "$TMP/base.err"; then
  ok
else
  fail "base 拒否の文言が無い: $(cat "$TMP/base.err")"
fi
if [ "$(origin_ref "$TMP/base" refs/heads/main)" = "$main_before" ]; then
  ok
else
  fail "base: origin/main が動いた"
fi

echo "sync-and-push.sh: $pass pass, $fails fail"
[ "$fails" -eq 0 ]
