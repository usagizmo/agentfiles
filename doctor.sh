#!/bin/bash
# 配線の read-only 健全性チェック。修復は ./init.sh
# expected の SSOT は lib/inventory.sh（init と共有）

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/bootstrap.sh
. "$REPO_DIR/lib/bootstrap.sh"
# shellcheck source=lib/inventory.sh
. "$REPO_DIR/lib/inventory.sh"

usage() {
  cat <<'EOF'
Usage: ./doctor.sh [--quiet]

lib/inventory.sh の expected 配線を read-only で検査する。
問題があれば非ゼロ終了（自動修復はしない → ./init.sh）。

  --quiet   成功行を出さず、問題とサマリのみ
EOF
}

DOCTOR_QUIET=0
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --quiet)
      DOCTOR_QUIET=1
      ;;
    *)
      echo "unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "🩺 agentfiles doctor"
echo "   repo: $REPO_DIR"
echo "   dotfiles: $DOTFILES_REPO"
echo "   inventory: lib/inventory.sh"

echo ""
echo "## inventory"
run_inventory check

echo ""
echo "## commit gate"
check_commit_gate

echo ""
echo "## 移植性"
check_absolute_home_paths

echo ""
echo "## summary"
echo "   ok=$DOCTOR_OK  warn=$DOCTOR_WARN  fail=$DOCTOR_FAIL"

if [ "$DOCTOR_FAIL" -gt 0 ]; then
  echo ""
  echo "❌ doctor が問題を検出しました。内容を確認し、必要なら ./init.sh を実行してください。"
  exit 1
fi

if [ "$DOCTOR_WARN" -gt 0 ]; then
  echo ""
  echo "⚠️ 警告のみです（exit 0）。気になる項目があれば確認してください。"
  exit 0
fi

echo ""
echo "✅ 問題は見つかりませんでした。"
exit 0
