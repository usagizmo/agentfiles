---
name: rabi-design
description: >-
  株式会社ラビのブランドスタイル（カラー・フォント・角丸・トーン）を適用する。
  Rabi 名義の UI・ドキュメント・スライド・譜面を作るとき、
  または「Rabiスタイルで」と言われたときに使う。CSS デザイントークンを含む。
---

# rabi-design

Rabi のデザイン仕様。基調はモノトーン＋クリムゾン。白兎が light、黒兎が dark、赤い目がアクセント。

## Colors

値の SSOT は `assets/rabi.css`。既定の用途は同ファイルのコメント、状態による上書きは「状態」の表。

16 進値を写さず、常にトークンを参照する（light / dark で値が切り替わるため）。CSS を持たない媒体（docx・スライド）だけは、ライト値を直接指定する。

有彩色はクリムゾンのみ。第 2 の色を足さ**ない**。

## 赤を出す場所

赤を出してよいのは次の 3 役だけ。どれでもない場所では黒・グレー・太字で表す。

| 役     | 例                                 | 量            |
| ------ | ---------------------------------- | ------------- |
| 状態   | 完了・警告・選択・キーボード focus | 状態の数だけ  |
| 主操作 | 送信・保存・確定のボタン           | 1 画面に 1 つ |
| 強調   | 本文中の一語                       | 1 節に 1 つ   |

`.rabi-heading` の下罫と `.rabi-table` の合計行は既定の強調。量に数えない。

新しい部品は「どの役か」で決める。装飾・分類・格上げには使わ**ない**（タグの色分け・グラフの系列色・見出しを目立たせる用途）。

3 役に収まらない赤が要るときは、赤を足すのではなく状態の設計を疑う。

`--rabi-accent-soft` の地に `--rabi-accent` の文字を載せ**ない**。文字は `--rabi-ink`。

## 状態

状態ごとに新しい色を作らない。hover と active は `assets/rabi.css` が accent から導出する。

| 状態   | 表し方                                                                           |
| ------ | -------------------------------------------------------------------------------- |
| hover  | 赤ベタの部品は `--rabi-accent-hover`。他は地を `--rabi-paper-2`                  |
| active | 赤ベタの部品は `--rabi-accent-active`。他は hover と同じ地                       |
| focus  | `outline: 2px solid var(--rabi-accent)` + `outline-offset: 2px`。地は変えない    |
| 選択   | `--rabi-accent-soft` の地 + 左 2px の `--rabi-accent`                            |
| 完了   | `--rabi-accent` のベタ + `--rabi-on-accent` の印                                 |
| 警告   | 文字を `--rabi-accent`。入力欄は枠を 2px の `--rabi-accent` にして説明文を添える |
| 無効   | 地を `--rabi-paper-2`、文字を `--rabi-faint`、輪郭を `--rabi-line` へ            |

無効を色だけで表さ**ない**。押せないことを形と文言でも示す。

## 角丸

半径は 0 と `--rabi-r-round` の 2 値のみ。中間の値を作ら**ない**。

- 0: パネル・カード・表・区切り・リスト行・選択の左線・入力枠。一覧に無いものもここ
- `--rabi-r-round`: チェックボックス・ラジオ・ボタン・ステータスの点

チェックボックス・ラジオは `appearance: none` で組み、checked は「状態」の完了で描く。ネイティブのままでは半径が効かない。

文書（見積・譜面・スライド）は全部 0。角丸は UI にだけ効く。

## Typography

- フォントは `--rabi-font`
- 文書の本文は 10pt 相当。サブタイトルは `--rabi-soft`
- 数値が縦に並ぶ列は右揃え + `font-variant-numeric: tabular-nums`（`.rabi-table` では `.num`）

## Voice

簡潔・実務的。誇張や装飾語を避ける。

## 使い方

- `assets/rabi.css` を先頭にインライン展開する
- タイトルも節見出しも `.rabi-heading`、表は `.rabi-table`
- 白抜き文字を載せる地には `print-color-adjust: exact` を付ける
- UI 部品のクラスは持たない。「状態」「角丸」に従って組む
- docx・スライド等でも上の各節に従う

`.rabi-table` のセレクタは要素まで固定されている。`thead` を省く・`tr.group` / `tr.total` を `th` で組むと効かない。

```html
<table class="rabi-table">
  <thead>
    <tr>
      <th>項目</th>
      <th class="num">金額</th>
    </tr>
  </thead>
  <tbody>
    <tr class="group">
      <td colspan="2">制作</td>
    </tr>
    <tr>
      <td>画面設計</td>
      <td class="num">420,000</td>
    </tr>
    <tr class="total">
      <td>合計</td>
      <td class="num">1,560,000</td>
    </tr>
  </tbody>
</table>
```
