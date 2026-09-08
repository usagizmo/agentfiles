---
name: finish
description: 実装が一段落したら必ず実行する仕上げ。規模を判定し、consult（ループ）→ docs → commit を順に実行する。
---

# 仕上げ

1. 規模を判定する（定義は `~/.agents/AGENTS.md` の「規模」）。実装中に `consult` を使ったなら中規模以上
2. 中規模以上: `consult`（ループ）
3. `docs`
4. `commit`

途中で非自明に膨らんだら規模を再判定し、必要な段から入り直す。コミット後は `~/.agents/AGENTS.md` のボーイスカウトルールに従って積み残しを確認し、追加実装したら 1 から繰り返す。
