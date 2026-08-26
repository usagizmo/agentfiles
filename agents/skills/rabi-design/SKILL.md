---
name: rabi-design
description: >-
  株式会社ラビのブランドスタイル（カラー・フォント・余白・角丸・影・深さ・トーン）を適用する。
  Rabi 名義の UI・ドキュメント・スライド・譜面を作るとき、
  または「Rabiスタイルで」と言われたときに使う。
  デザイントークンと CSS を含む。
---

# rabi-design

## 読む順

1. `references/DESIGN.md` —— 仕様の全文。front matter が機械可読なトークン、本文が適用の規則
2. `assets/rabi.css` —— ブランド層の値の SSOT
3. `assets/rabi-components.css` —— UI 部品の実装
4. `assets/rabi-role.css` —— 情報層の値の SSOT と部品。いつ読むかは `references/DESIGN.md`「情報層」と「Components」

値と規則の SSOT は上の 1 と 2 と 4 で、媒体には依ら**ない**。このファイルには写さ**ない**。

## 展開する順

CSS を書く媒体では `assets/rabi.css` を先頭にインライン展開する。

UI を組む媒体では続けて `assets/rabi-components.css` を入れる。**`assets/rabi.css` より後に置く**。どの媒体が文書に当たるかは `references/DESIGN.md`「Components」。

情報層を使う面では、続けて `assets/rabi-role.css` を入れる。いつ入れるかは `references/DESIGN.md`「Components」の媒体表。

図を描く媒体では `assets/rabi-mermaid.js` も入れる。**`assets/rabi.css` より後に置く**。

## 値を変えるとき

ブランド層で `assets/rabi.css` と `references/DESIGN.md` の front matter の両方に現れる値は、`assets/rabi.css` だけを直し、次で写しへ書き戻す。

情報層は `assets/rabi-role.css` だけを直す。front matter に写さ**ない**。

```bash
bun <skills root>/rabi-design/scripts/gen-tokens.ts
```

**path は skill 側の実体を指す**。

front matter だけが持つ値は `references/DESIGN.md` を直接直す。どの path がそれに当たるかは `scripts/gen-tokens.ts` の `ownedByFrontMatter`。

`components` の値は書き戻しの対象外。**front matter と `assets/rabi-components.css` の両方を直す**。
