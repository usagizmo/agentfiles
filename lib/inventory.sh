# shellcheck shell=bash
# **この repo が何を配線するかの SSOT。**追加・変更は原則ここだけ。
# inv_* の実装と run_inventory は dotfiles の lib/links.sh（lib/bootstrap.sh が読む）。
#
# 使い方:
#   REPO_DIR=... source lib/bootstrap.sh && source lib/inventory.sh
#   run_inventory apply   # 配線を適用
#   run_inventory check   # 健全性検査

# ---------- SSOT: 配線一覧 ----------
# harness を足すときは、ここに 1 ブロック足すだけで init と doctor に反映される。
#
# harnesses/<agent>/hooks.json（中身は `{"hooks": {}}`）は空 overlay ではなく tripwire。
# 空であること自体が基準線。中身を埋めたり配線を外したりしない（規約は AGENTS.md）。

inventory_define() {
  # --- Agents 共通 SSOT 投影 ---
  # codex / opencode / cursor はここをネイティブに読む。
  # この 3 つに共通 skills の union は張らない（張ると同じ skill を二重に配る）
  inv_section "agents (SSOT projection)"
  inv_home "$HOME/.agents"
  inv_symlink agents/AGENTS.md "$HOME/.agents/AGENTS.md"
  inv_symlink agents/skills "$HOME/.agents/skills"
  inv_symlink agents/.skill-lock.json "$HOME/.agents/.skill-lock.json"

  # --- Claude ---
  inv_section "claude"
  inv_home "$HOME/.claude"
  inv_symlink agents/AGENTS.md "$HOME/.claude/CLAUDE.md"
  inv_harness_skills "$HOME/.claude/skills" claude
  inv_symlink harnesses/claude/settings.json "$HOME/.claude/settings.json"
  inv_symlink harnesses/claude/statusline.py "$HOME/.claude/statusline.py"
  inv_home "$HOME/.claude/hooks"
  inv_symlink harnesses/claude/hooks/herdr-agent-state.sh \
    "$HOME/.claude/hooks/herdr-agent-state.sh"
  inv_guard_dir "$HOME/.claude/hooks"

  # --- Codex ---
  # Codex は ~/.agents/skills をネイティブに読む。union は harness 固有 overlay のみ
  inv_section "codex"
  inv_home "$HOME/.codex"
  inv_symlink agents/AGENTS.md "$HOME/.codex/AGENTS.md"
  inv_collection "$HOME/.codex/skills" harnesses/codex/skills
  inv_symlink harnesses/codex/hooks.json "$HOME/.codex/hooks.json"

  # --- Grok ---
  # Grok は `~/.grok/AGENTS.md` を global rules として読む（探索順は global → repo root → cwd）
  inv_section "grok"
  inv_home "$HOME/.grok"
  inv_symlink agents/AGENTS.md "$HOME/.grok/AGENTS.md"
  inv_symlink harnesses/grok/hooks/hooks.json "$HOME/.grok/hooks/hooks.json"
  inv_guard_dir "$HOME/.grok/hooks"
  inv_harness_skills "$HOME/.grok/skills" grok

  # --- opencode ---
  # home は `~/.opencode`（binary）ではなく config dir。`opencode debug paths` の config が SSOT
  # opencode は `~/.agents/skills` をネイティブに読む（`opencode debug skill` の location）。union は張らない
  inv_section "opencode"
  inv_home "$HOME/.config/opencode"
  inv_symlink agents/AGENTS.md "$HOME/.config/opencode/AGENTS.md"
}
