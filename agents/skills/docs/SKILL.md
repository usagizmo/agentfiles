---
name: docs
description: >-
  仕上げでコミット前に実行し、仕様変更・機能実装を project docs / agent-facing 文書（AGENTS / skills / references）へ反映する。
  agent-facing 文書の規則を変えたときは、コミット前に `consult`（ループ）で往復する。
  使用した AGENTS / skills の不備（誤誘導・欠落・冗長）に気づいたときにも実行する。製品コード実装そのものには使わない。
---

# ドキュメント

## 更新判定

1. `git status --short` で起点を確定する
2. 起点の変更が、docs / AGENTS / skills に書かれた仕様・手順・判断基準を変えているかを見る。変えていれば直す。追加の前に削れる箇所を探し、起点外でも直す
3. 使用した AGENTS / skills の不備は、反映先を `~/.agents/AGENTS.md` の「層契約」に従って決めて直す
4. 更新・見送りを簡潔に報告する

## 品質基準（agent-facing 文書）

- **AGENTS / skills は薄く**: 発動条件・判断・恣意的な規約・SSOT への誘導だけ。語と文は `~/.agents/AGENTS.md` の「文章の書き方」
- 本文には毎回評価する条件・分岐を置く。`references/` には分岐に入ったときだけ必要な詳細を置き、いつ読むかを本文に書く
- 数値・既定値・規則は 1 箇所に置き、他は参照する
- 発動条件は description に書く。本文は「どのケースで何をするか」に留める
- **ゲート系 skill は置き換える生コマンド名にする**（`git commit` → commit、`gh issue create` → issue、衝突するときだけ別語: `gh pr merge` → ship）
- skill 本文の実行コマンドは `<skills root>` 起点で自分の `scripts/` を指す
- Issue / PR 番号等の外部リンクを張らない

## レビュー

規則を変えたら `consult`（ループ）を回す。prompt の必読に編集した文書とその規則が関係する文書を足し、観点を次に差し替える（品質基準を含む）:

- 参照先の節・ファイルが実在する
- 同じ規則・数値が 2 箇所に実体として無い。文書間で矛盾しない
- 削ると判断ができなくなる記述を落としていない
- 複数の文書を順に読んだとき、順序・前提・差し戻し先が噛み合う

プロジェクトに Markdown lint があれば通す。
