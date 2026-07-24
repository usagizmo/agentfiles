---
name: finish
description: >-
  実装が一段落したら必ず実行する仕上げ。規模判定（SSOT は ~/.agents/AGENTS.md）に従い
  [review-loop] → tidy → docs → commit を順に実行する。
---

# 仕上げ

実装完了からコミットまで。規模の定義は `~/.agents/AGENTS.md` が SSOT、仕上げフローは本 skill が SSOT。

1. 規模を判定する（実装中に consult / review-loop を使った場合は中規模以上として扱う。確認のみで実装しなかった consult は対象外）
2. 大規模: `review-loop`
3. 中規模以上: `tidy`
4. `docs` — 仕様変更・機能実装を文書へ反映する（agent-facing 文書の定義・基準は docs skill。触った変更は規模不問で必須）
5. `commit` — 変更が複数の独立した論理単位を含む場合は、単位ごとに分割してコミットする

軽微は `commit` のみ（agent-facing を含むなら 4 → 5）。
途中で非自明に膨らんだら規模を再判定し、上の段から入り直す。
コミット後、当初課題に対する積み残しを確認する。同スコープの残りがあれば追加実装し、1 から繰り返す。
