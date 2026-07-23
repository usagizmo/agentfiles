---
name: resolve
description: >-
  課題 1 件を consult → 実装 → finish → 検証まで一気通貫で進める。
  ユーザーが /resolve で課題（Issue 番号・タスク説明）を渡したときに実行する。
---

# 課題解決

課題受領から検証レポートまでの標準進行。各ステップの中身は各 skill が SSOT。

available skills に `resolve-project` があれば先に invoke し、本 skill への project 差分（追加・具体化のみ。手順・ゲートを緩めない）として適用する。project 側は `resolve-project` 固定名で置き、単体では invoke しない。

1. `consult` — 課題内容を精査し方針を確定する（軽重・承認ゲートは consult skill に従う）
2. 実装
3. `finish` — 規模別仕上げ（[review-loop] → tidy → docs → commit）
4. 検証 — プロジェクトの検証 skill（例: `verify-app`）を実行し、レポートとセッションまとめを提示する
5. PR はユーザーの GO 後に `pr`（本 skill には含めない）

## セッションまとめ

検証レポートと合わせて提示する:

- 変更の要点（PR 作成済みなら PR 番号も）
- 変動した Issue すべて（作成・クローズ・更新。番号 + 一言）
- 積み残し・懸念点（Issue 化していないものはその旨を明示）
- 今後の改善につながる気づき（設計・運用・AGENTS / skills への graduate 候補）

積み残し・懸念・気づきの各項目には次アクションの推奨（例: 続けて着手 / Issue 化 / 対応不要）を添え、ユーザーが選ぶだけで進められる形にする。推奨を決める情報が足りなければユーザーに質問する。

## Issue 切り出しの基準

- 切り出しは独立レビューが要る規模だけ（作成は `issue` 経由）。それ以外の残課題・既存不具合・独立改善は Issue 化せず同一ブランチで解決する
- 今回変更由来の回帰・受け入れ失敗は Issue で消さず、そのブランチで直しきる
