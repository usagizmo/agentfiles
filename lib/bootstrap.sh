# shellcheck shell=bash
# dotfiles の配線 primitive と inventory API を読み込む。
# REPO_DIR は呼び出し側で設定済みであること。
#
# **参照方向は agentfiles → dotfiles の一方通行。**dotfiles 側は agentfiles を知らない。
# primitive を二重に持たないのは、配布先の状態ごとの扱い（実ファイル / repo 外 symlink /
# 実ディレクトリ）の規約が実装そのものなので、写すと片方だけ直る事故が起きるため。

# 在処は環境変数 > 兄弟ディレクトリ の順。ghq でも素の clone でも、兄弟に置けば当たる
DOTFILES_REPO="${DOTFILES_REPO:-$(dirname "$REPO_DIR")/dotfiles}"

# **見つからなければ止める。**関数が未定義のまま run_inventory へ進むと、
# どの inv_* も no-op になり「成功したのに何も張られていない」で終わる
if [ ! -r "$DOTFILES_REPO/lib/links.sh" ]; then
  echo "❌ dotfiles が見つかりません: $DOTFILES_REPO/lib/links.sh" >&2
  echo "   agentfiles は dotfiles の配線 primitive を使います。" >&2
  echo "   兄弟ディレクトリに clone するか、DOTFILES_REPO=<path> を指定してください。" >&2
  exit 2
fi

# shellcheck source=/dev/null
. "$DOTFILES_REPO/lib/links.sh"
