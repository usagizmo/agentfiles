#!/bin/bash
# agent 設定の配線と、この repo の commit gate / 開発依存のセットアップ。
# 配線の SSOT は lib/inventory.sh、primitive は dotfiles の lib/links.sh（lib/bootstrap.sh が読む）

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bootstrap.sh
. "$REPO_DIR/lib/bootstrap.sh"
# shellcheck source=lib/inventory.sh
. "$REPO_DIR/lib/inventory.sh"

INSTALL_FAILED=0

# インストールの成否を握りつぶさない。失敗は summary で集計し非ゼロ終了する
# 第 1 引数は助詞まで含む文節（「開発依存を」）。「インストール〜」に直接続ける
install_step() {
  local phrase="$1"
  shift
  echo "📦 ${phrase}インストールしています..."
  if "$@"; then
    echo "✅ ${phrase}インストールしました"
  else
    echo "⚠️ ${phrase}インストールできませんでした"
    INSTALL_FAILED=$((INSTALL_FAILED + 1))
  fi
}

echo "## links (lib/inventory.sh)"
run_inventory apply


echo ""
echo "## commit gate"

# .githooks/pre-commit（staged なファイルに oxfmt / oxlint をかけ、test を回す）を有効にする。
# 相対パスにするのは worktree でも各 worktree 直下の .githooks を指させるため
HOOKS_PATH="$(git -C "$REPO_DIR" config --get core.hooksPath || true)"
if [ "$HOOKS_PATH" = ".githooks" ]; then
  echo "⏭️ core.hooksPath は既に .githooks です"
elif git -C "$REPO_DIR" config core.hooksPath .githooks; then
  echo "✅ core.hooksPath を .githooks に設定しました"
else
  echo "⚠️ core.hooksPath を設定できませんでした"
  INSTALL_FAILED=$((INSTALL_FAILED + 1))
fi


echo ""
echo "## dev dependencies"

# commit gate（lint-staged → oxfmt / oxlint）と test が使う。
# **bun 自体はこの repo が入れない。**ランタイムは dotfiles の mise が供給する
if [ -x "$(command -v bun)" ]; then
  install_step "この repo の開発依存を" bun install --cwd "$REPO_DIR" --frozen-lockfile
else
  echo "⚠️ bun が見つかりません。開発依存のインストールをスキップします（dotfiles の ./init.sh で mise を入れてください）"
fi


echo ""
echo "## summary"

FAILED=0

if [ "$LINK_BLOCKED" -gt 0 ]; then
  echo "⚠️ symlink を作成できなかった箇所が ${LINK_BLOCKED} 件あります。"
  echo "   上の「実ディレクトリ / 実ファイル / 作成失敗」を確認し、退避または削除してから再実行してください。"
  echo "   検査だけなら: ./doctor.sh"
  FAILED=1
fi

if [ "$INSTALL_FAILED" -gt 0 ]; then
  echo "⚠️ インストールに失敗した項目が ${INSTALL_FAILED} 件あります。"
  echo "   上の「インストールできませんでした」を確認し、原因を解消してから再実行してください。"
  FAILED=1
fi

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

echo "✅ init 完了（symlink block / インストール失敗なし）"
