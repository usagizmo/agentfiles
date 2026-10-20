#!/usr/bin/env bash
# PR / Issue に載せる画像を <owner>/github-assets の main へ置き、本文に貼る URL を 1 行ずつ出す。
#
# 使い方: upload-images.sh <owner>/<repo> <PR か Issue の番号> <file>...
# 置き場は <owner>/github-assets（private）の <repo>/<番号>/<file 名>。同名は上書きする。
# 対象 repo にブランチや commit を作らない。置き場が無ければ止まる（作成は人が行う）。
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: upload-images.sh <owner>/<repo> <number> <file>..." >&2
  exit 2
fi

target="$1"
number="$2"
shift 2

owner="${target%%/*}"
repo="${target#*/}"
if [ -z "$owner" ] || [ -z "$repo" ] || [ "$owner" = "$target" ]; then
  echo "upload-images: <owner>/<repo> の形で渡す: ${target}" >&2
  exit 2
fi
case "$number" in
  '' | *[!0-9]*)
    echo "upload-images: 番号は数字だけ: ${number}" >&2
    exit 2
    ;;
esac
for file in "$@"; do
  if [ ! -f "$file" ]; then
    echo "upload-images: file が無い: ${file}" >&2
    exit 2
  fi
done

assets="${owner}/github-assets"
if ! gh repo view "$assets" --json name >/dev/null 2>&1; then
  echo "upload-images: 置き場 ${assets} が無い。private で作成してから再実行する" >&2
  exit 1
fi

dir="${repo}/${number}"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q -b main
git -C "$tmp" remote add origin "git@github.com:${assets}.git"

# 置き場の最新 main に画像を載せて commit する。空の置き場では最初の commit になる。
# commit したら 0、置き場と同じ内容なら 1 を返す。
stage() {
  if git -C "$tmp" fetch -q --depth 1 origin main 2>/dev/null; then
    git -C "$tmp" reset -q --hard FETCH_HEAD
  fi
  mkdir -p "$tmp/$dir"
  cp "$@" "$tmp/$dir/"
  git -C "$tmp" add -- "$dir"
  if git -C "$tmp" diff --cached --quiet; then
    return 1
  fi
  git -C "$tmp" commit -q -m "${target}#${number}"
}

# 同時に別の upload が main を進めて push が弾かれたときだけ、載せ直して再送する。
attempt=0
while stage "$@"; do
  if git -C "$tmp" push -q origin HEAD:refs/heads/main; then
    break
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 3 ]; then
    echo "upload-images: push が 3 回失敗した" >&2
    exit 1
  fi
done

for file in "$@"; do
  echo "https://github.com/${assets}/blob/main/${dir}/$(basename -- "$file")?raw=true"
done
