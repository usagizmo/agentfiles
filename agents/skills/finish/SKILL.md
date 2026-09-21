---
name: finish
description: 実装の仕上げ。docs → consult（ループ）→ commit を順に実行する。resolve の手順から呼ばれたとき、またはユーザーが /finish と言ったときに実行する。
---

# 仕上げ

1. `docs`
2. `consult`（ループ）。code と docs を同じ diff で見せる。飛ばせるのは軽微（定義は `~/.agents/AGENTS.md` の「規模」）だけ。採用した修正で仕様・手順が変わったら同じ巡で docs も直す。`consult` の終了ゲートを通るまで commit に進まない。構造見直し・ユーザーへの判断依頼で保留中は進まない。完了報告には `verify` の出力を貼り、pass 以外はレビュー合格と**呼ばない**（未レビューはそう書く）
3. `commit`

軽微として飛ばしたあとに挙動を変える変更が入ったら 1 から入り直す。コミット後は `~/.agents/AGENTS.md` のボーイスカウトルールに従って積み残しを確認し、追加実装したら 1 から繰り返す。

push / PR / merge はここに含めない。確認後の再開で新 commit が無いときは呼ばない（手順は `resolve`）。**実物確認中の修正で新 commit が増えたときは必ず呼ぶ**（Pass → Ready 直行の前に挟む）。
