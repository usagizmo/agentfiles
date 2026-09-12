#!/bin/bash
# 外部依存の更新。配線の SSOT は lib/inventory.sh（変更後は links を再適用する）

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bootstrap.sh
. "$REPO_DIR/lib/bootstrap.sh"
# shellcheck source=lib/inventory.sh
. "$REPO_DIR/lib/inventory.sh"

# 外部更新の失敗と symlink blocked は別軸
UPDATE_FAILED=0

echo "## agent skills (external)"

# agents/.skill-lock.json 管理の外部 skill を更新する
# global scope で更新する。 実体は `~/.agents`（この repo への symlink）にあり、
# project scope では別形式の lock（skills-lock.json）を見て 1 件も更新しない。
# `-g` は cwd を見ないので cd しない
if [ -x "$(command -v bunx)" ]; then
  echo "📦 外部取得の agent skills を更新しています..."
  if bunx skills update -g -y; then
    echo "✅ agent skills を更新しました"
  else
    echo "⚠️ agent skills の更新に失敗しました"
    UPDATE_FAILED=1
  fi
else
  # skills 更新は up の主目的なので、ツール欠落は失敗扱い
  echo "⚠️ bunx が見つかりません。agent skills の更新をスキップします"
  UPDATE_FAILED=1
fi


# 新規 skill ディレクトリが増えた場合に harness 側 symlink を追随させる
# full reconcile（partial API は作らない = up 専用経路の drift を防ぐ）
echo ""
echo "## links (re-apply after skills update)"
run_inventory apply


echo ""
echo "## dev dependencies"

# package.json の範囲（^）内で上げ、bun.lock を書き換える。差分が出たら commit が要る。
# bun 自体はこの repo が上げない。ランタイムは dotfiles の ./up.sh が mise で上げる
if [ -x "$(command -v bun)" ]; then
  echo "📦 この repo の開発依存を更新しています..."
  if (cd "$REPO_DIR" && bun update); then
    echo "✅ 開発依存を更新しました"
  else
    echo "⚠️ 開発依存の更新に失敗しました"
    UPDATE_FAILED=1
  fi
else
  # commit gate が使う道具なので、欠落は失敗扱い（対象が無いのではなく道具が無い）
  echo "⚠️ bun が見つかりません。開発依存の更新をスキップします"
  UPDATE_FAILED=1
fi


echo ""
echo "## summary"

exit_code=0
if [ "$LINK_BLOCKED" -gt 0 ]; then
  echo "⚠️ symlink を作成できなかった箇所が ${LINK_BLOCKED} 件あります。"
  echo "   検査: ./doctor.sh ／ 修復の切り分け: ./init.sh"
  exit_code=1
fi
if [ "$UPDATE_FAILED" -ne 0 ]; then
  echo "⚠️ 外部更新の一部が失敗またはスキップされました（配線結果とは別軸）。"
  exit_code=1
fi
if [ "$exit_code" -eq 0 ]; then
  echo "✅ up 完了"
fi
exit "$exit_code"
