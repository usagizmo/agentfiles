---
version: alpha
name: Rabi
description: 株式会社ラビのブランドスタイル。モノトーン + クリムゾン。
colors:
  primary: "{colors.ink}"
  ground: "#ffffff"
  paper: "#ffffff"
  paper-2: "#f4f4f4"
  line: "#e9e9e9"
  divider: "#d3d3d3"
  edge: "#888888"
  ink: "#222222"
  soft: "#575757"
  faint: "#6e6e6e"
  accent: "#dc143c"
  accent-text: "#d0123a"
  accent-hover: "color-mix(in oklab, #dc143c 88%, #000000)"
  accent-active: "color-mix(in oklab, #dc143c 76%, #000000)"
  on-accent: "#ffffff"
  wash: "#fdeff2"
  wash-line: "#f4d3db"
typography:
  hero:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 44px
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: -0.03em
  display:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 28px
    fontWeight: 800
    lineHeight: 1.2
  heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 18px
    fontWeight: 800
    lineHeight: 1.3
  subheading:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 16px
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.7
  body-doc:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  label-sm:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.4
  label-xs:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 10px
    fontWeight: 700
    lineHeight: 1.4
  mono:
    fontFamily: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
spacing:
  "1": 4px
  "1.5": 6px
  "2": 8px
  "2.5": 10px
  "3": 12px
  "3.5": 14px
  "4": 16px
  "4.5": 18px
  "5": 20px
  "6": 24px
  "8": 32px
  "10": 40px
  "12": 48px
  "14": 56px
  control-xs: 24px
  control-sm: 28px
  control: 32px
  control-lg: 36px
rounded:
  none: 0px
  sm: 3px
  md: 6px
  full: 999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.4}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.4}"
  button-secondary-hover:
    backgroundColor: "{colors.paper-2}"
  button-disabled:
    borderColor: "{colors.line}"
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
  chip:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "{spacing.control-xs}"
    padding: "{spacing.3}"
  input:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.2.5}"
  input-invalid:
    borderColor: "{colors.accent}"
    borderWidth: 2px
    textColor: "{colors.accent-text}"
  checkbox:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    size: 16px
  checkbox-checked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  radio:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.full}"
    size: 16px
  radio-checked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  list-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  list-item-hover:
    backgroundColor: "{colors.paper-2}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.4}"
  button-ghost-hover:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  chip-selected:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-text}"
  input-disabled:
    borderColor: "{colors.line}"
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
  textarea:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.1.5}"
    paddingInline: "{spacing.2.5}"
  select:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.2.5}"
  switch:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.full}"
    height: "{spacing.control-xs}"
    width: 44px
  switch-on:
    backgroundColor: "{colors.accent}"
  badge:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "{spacing.2}"
  badge-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  alert-warn:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-text}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.3}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "{spacing.5}"
  card-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.md}"
    padding: "{spacing.5}"
  tab:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    height: "{spacing.control}"
    padding: "{spacing.5}"
  tab-selected:
    textColor: "{colors.ink}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "{spacing.2}"
---

# Rabi DESIGN.md

値の SSOT は `rabi.css`。front matter は写しで、直し方は `../SKILL.md`。

CSS 変数名は `--rabi-` + 段の名。`colors` は同名、`typography` は `t-`、`rounded` は `r-`、`spacing` の余白は `gap-` を冠する。丈と `spacing.control-*` は同名。例外は `1.5` → `gap-1_5` **だけ**（`.` を CSS の識別子に置けない）。

front matter に出せないものは `rabi.css` だけが持つ —— 影、混色の入力（一覧は `../scripts/gen-tokens.ts` の `CSS_ONLY`）と、各 token の dark 値。

## Overview

核は小さく、積み重なる。

基調はモノトーン + クリムゾン。白兎が light、黒兎が dark、赤い目がアクセント。

**道具の面**として組む。地は `ground`、文字は `ink`、有彩色はクリムゾンのみ。階層は重なり・罫・影で作り、色数では作ら**ない**。

読み手は取引先と社内の実務者。作るのは web・見積・譜面・スライド・業務 UI。

余白はグループの区切りとしてだけ使い、消しても区切りが壊れない余白は削る。装飾は足す側ではなく削る側へ倒す。

削るのは装飾**だけ**。深さ（層・重なり・影）は削ら**ない**。

## Voice

簡潔・実務的。誇張・装飾語を使わ**ない**。

## Colors

16 進値を写さず、常にトークンを参照する（light / dark で値が切り替わる）。CSS を持たない媒体（docx・スライド）だけは、ライト値を直接指定する。

有彩色はクリムゾンのみ。第 2 の色を足さ**ない**。

`accent` は両テーマで同じ値を使う。テーマや外観設定で差し替え**ない**。上に載る文字は両テーマとも `on-accent`。

例外は小さな赤い文字**だけ** —— `accent-text` は下限を満たすまで動かす（light は暗い側、dark は明るい側）。ベタには使わ**ない**。値は `rabi.css` の `light-dark()` が持つ（front matter はライト値のみ）。

地を塗って白抜き文字を載せる面には `print-color-adjust: exact` を付ける。

### 面と段

面は 3 段、罫線は 3 種。段の間の値を作ら**ない**（影は「Elevation & Depth」）。

| 段  | 面        | 用途                            |
| --- | --------- | ------------------------------- |
| 地  | `ground`  | 面を敷く下                      |
| 面  | `paper`   | カード・パネル・帯              |
| 沈  | `paper-2` | hover・無効・グループ行・節の帯 |

**light** は `ground` と `paper` を同値にし、濃淡を持つのは `paper-2` だけ。**dark** は `paper` にも濃淡を持たせる。この非対称を他の段へ持ち込ま**ない**。

罫線の 3 種は役で選ぶ —— 面と面の境は `divider`、操作部品の輪郭は `edge`、面の内側の仕切りは `line`。濃い順に `edge` > `divider` > `line`。`wash` の面の上だけ 3 種の外で、`wash-line` を使う。`accent` のベタ面には罫を引か**ない** —— 分けるなら `on-accent` の面を重ねる。

罫を `ink` と同値にし**ない**。面を分けるのは影が主で、罫は従。

文字色は 3 段。強い順に `ink` > `soft` > `faint` で、段の間の値を作ら**ない**。

| 段      | 何に付くか           |
| ------- | -------------------- |
| `ink`   | 本文・見出し         |
| `soft`  | 補足                 |
| `faint` | ラベル・キャプション |

地との比の下限は、文字（`ink` `soft` `faint` `accent-text` `on-accent`）が 4.5:1、操作部品の輪郭 `edge` が 3:1。薄く見せたくても割ら**ない**。

下限を持たないのは、罫の `divider` と `wash-line` と `line`、および面そのもの（`ground` `paper` `paper-2` `wash` `accent`）**だけ**。`accent-hover` / `accent-active` は `accent` の派生で、同じく面。

下限は**その色が載りうる面のうち、地との差が最小の面**で測る。`paper` の上だけで測ら**ない**。文字と `edge` が載りうる面は `ground` `paper` `paper-2` `wash` の 4 つ、`on-accent` は `accent` **だけ**。

節と節の境は `paper-2` の帯か `divider` の罫で分ける。同じ境で両方を使わ**ない**。

本文・ラベル・リンクは面の上に置く。地の上には置か**ない**。

### 赤を出す場所

赤は 2 つの立ち方をする。同じ面の中で両方を使わ**ない**。

| 立ち方 | 何になるか                                     | その面での制約                     |
| ------ | ---------------------------------------------- | ---------------------------------- |
| 地     | `accent` のベタで塗った帯・カード・表紙        | その面の中で赤を意味に使わ**ない** |
| 意味   | 状態・主操作・強調・リンク・罫・点・番号・目印 | その面の地を赤にし**ない**         |

赤が地の面では、状態も主操作も `on-accent` と輪郭で表す。`wash` は地に当たら**ない** —— 淡い面の上に赤を意味として載せてよい。

赤の量は数え**ない**。目立たせるところに使い、目立たせないところは黒・グレー・太字で済ませる。

`.rabi-heading` の下罫と `.rabi-table` の合計行は既定の強調。その面へ更に赤を足さ**ない**。

面に載せる赤い文字は `accent-text`、ベタ・枠・点・下罫は `accent`。

### 状態

状態ごとに新しい色を作ら**ない**。部品ごとの値は front matter の `components` の `-hover` / `-active` / `-disabled` / `-invalid` / `-selected` が持つ。ここには何の軸で表すかと、front matter に置けない値だけを書く。

| 状態   | 何を動かすか                                                                           |
| ------ | -------------------------------------------------------------------------------------- |
| hover  | 赤ベタは地を 1 段暗く。他は地を `paper-2` へ沈める                                     |
| active | hover と同じ軸で、赤ベタだけ 1 段暗く                                                  |
| focus  | 部品の外側の `outline` 2px + `outline-offset` 2px。色は `accent`。地は変え**ない**     |
| 選択   | 部品の外側の `outline` 2px。色は `ink` で、赤の面の上だけ `accent`。チップだけ面で表す |
| 完了   | 赤ベタと反転した印                                                                     |
| 警告   | 面と文字。入力欄は枠を太くして説明文を添える                                           |
| 無効   | 地・文字・輪郭の 3 つとも下げる                                                        |

選択で地を赤にし**ない**。

focus・選択と、エラー・警告は形で分ける —— 前者は部品の外側の `outline`、後者は枠そのものを太くする。

無効を色だけで表さ**ない**。押せないことを形と文言でも示す。

## Typography

フォントは `--rabi-font`、等幅は `--rabi-mono`。

| 段           | 用途                                     |
| ------------ | ---------------------------------------- |
| `hero`       | web の表紙。文書では使わない             |
| `display`    | 表紙・スライドのタイトル・価格などの数値 |
| `heading`    | 節見出し。節の番号も同じ段で組む         |
| `subheading` | 小見出し                                 |
| `body`       | UI の本文                                |
| `body-doc`   | 文書の本文（10pt 相当）                  |
| `label`      | ラベル・キャプション（`soft` / `faint`） |
| `label-sm`   | ナビ・メタ・帯の小さいラベル             |
| `label-xs`   | 字間を開けた見出しラベル                 |
| `mono`       | 番号・時刻・件数                         |

数値が縦に並ぶ列は右揃え + `font-variant-numeric: tabular-nums`（`.rabi-table` では `.num`）。

段の間のサイズを作ら**ない**。強調は太さで作り、サイズを 1 段上げて代用しない。

画面幅で伸縮させるときは `clamp()` で段と段の間を補間してよい。禁じているのは**固定値**として段の間を持つこと。

`.rabi-heading` はサイズを持た**ない**。大きさは要素（`h1` / `h2`）が決める。

## Layout

余白は 14 段。段の間の値を作ら**ない**。

**段の名は 4px を 1 とする倍数**。CSS 変数は `--rabi-gap-<名>` で、`.` を CSS の識別子に置けないので半段だけ `_`（`1.5` → `--rabi-gap-1_5`）。

刻みは `5` までが 2px、`6` から先が 8px。

| 段            | 位置 | 用途                                                               |
| ------------- | ---- | ------------------------------------------------------------------ |
| `1` – `2`     | 内部 | 印と文字の間・表のセルとリスト行の内側                             |
| `2.5` – `3.5` | 内部 | 部品の内側                                                         |
| `4` – `5`     | 内部 | 部品と部品の間・見出しと中身の間・カードと結合グリッドのセルの内側 |
| `6` – `8`     | 外縁 | 節の内側の余白・まとまりとまとまりの間                             |
| `10` – `14`   | 外縁 | 段組の列の間・節と節の間                                           |

位置は対象で決まる —— 部品・セル・見出しと中身は**内部**、節・まとまり・段組は**外縁**。

内部に `6` 以上を使わ**ない**。面が疎でも密でも変わらない。

外縁で `6`–`14` を使えるのは疎な面（web の表紙・LP・節）**だけ**。密な面（業務 UI・一覧・表・サイドバー・文書・印刷）は外縁も `5` 以下（疎/密は「深さを使わない面」）。

罫の太さは余白では**ない**。結合グリッドの `gap: 1px` は罫で、段に載せない。

帯で分ける節は、上下それぞれに `14` を取る。境で 2 つ分になるのは段の間の値では**ない**。

操作部品の丈は余白の段の外。4px 刻みの 4 段だけ。

| 段           | 何に付くか                        |
| ------------ | --------------------------------- |
| `control-xs` | チップ・ツールバー                |
| `control-sm` | 詰めた面のボタン・入力            |
| `control`    | ボタン・入力・リスト行の**既定**  |
| `control-lg` | 疎な面の主操作（web の表紙・CTA） |

`control-lg` を密な面に出さ**ない**。

アイコンだけのボタンは幅を丈と同値にする。丈は上の 4 段から選び、独自の寸法を作ら**ない**。

印の寸法（チェック・ラジオ）は丈の段に載せ**ない**。値は front matter の `components`。段を増やす対象では**ない**。

グリッドは持たない。文書は 1 段組で、幅は読み幅で決める。UI は箱の入れ子で組み、列数を先に決め**ない**。

### 一覧の組み方

同種のものを並べる面は**結合グリッド**で組む。部品を個別の枠で浮かせて並べ**ない**。

- 容器に `border: 1px solid line` と `rounded: md` と `overflow: hidden` と `e1` を付ける。**外周も内側の罫と同値**（`line`）で、面の境の `divider` にし**ない**
- セルは枠を持た**ない**。容器を `gap: 1px` + `background: line` にして、罫を容器に引かせる
- 押せるセルの hover は地を `paper-2` にする。容器と罫は動かさない。押せないセルは反応させ**ない**

**例外は `border-collapse` の表だけ** —— `gap` を持てないので、セルが下罫を持つ（`.rabi-table`）。

```html
<div class="grid">
  <div class="cell">…</div>
  <div class="cell">…</div>
</div>
```

```css
.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: var(--rabi-line);
  border: 1px solid var(--rabi-line);
  border-radius: var(--rabi-r-md);
  overflow: hidden;
  filter: drop-shadow(var(--rabi-e1));
}

.cell {
  background: var(--rabi-paper);
  padding: var(--rabi-gap-5);
}
```

## Elevation & Depth

影は 3 段。1 が置いてある、2 が掴んでいる、3 が浮く。

段の間の値を作ら**ない**。影で階層を作れないときは、面の段（`paper` / `paper-2`）か罫線で分ける。

影は `filter: drop-shadow()` で落とす。`box-shadow` を使わ**ない**。

**例外は内側の影だけ** —— そこは `box-shadow: inset`。

overlay の背面を黒く塗ら**ない**。影だけで離す。

### 深さの作り方

層は 3 つ。**奥 / 面 / 手前**で、間の層を作ら**ない**。

深さは色で作ら**ない**。次の 5 つのうち、少なくとも 3 つを同時に動かす。

| 変数     | 奥      | 面    | 手前   |
| -------- | ------- | ----- | ------ |
| 影       | `e1`    | `e2`  | `e3`   |
| 大きさ   | `0.93`  | `1`   | `1.04` |
| ぼけ     | `2.5px` | 0     | 0      |
| 不透明度 | `0.62`  | `1`   | `1`    |
| 速度     | `-0.3`  | `0.2` | `0.6`  |

速度はスクロール量に対する移動量の比。負値は逆へ動く。

同じ層の中で材質を変え**ない**。強調は大きさ・影・速度で付ける。

### 深さを使わない面

外縁が `5` 以下の面では、5 つとも動かさ**ない**。

`e1` は層では**ない**。置いてあることを示すだけなので、密な面でも容器に付ける。層に数えるのは `e2` 以上。

| 密度 | 何                                              | 分け方                      |
| ---- | ----------------------------------------------- | --------------------------- |
| 疎   | web の表紙・浮かせる強調（引きの言葉・overlay） | 層を 2 つ以上使う           |
| 密   | 一覧・表・リスト・サイドバー・文書・印刷・帯    | 面の段（`paper-2`）と罫のみ |

同じ製品の中で疎と密が混ざってよい。境目は面の単位で、1 つの面の中で 2 つを混ぜ**ない**。

一覧・表は自分で密の面を作る。外側の節が疎でも、その密度は継が**ない**。

### 影の色

彩度のある面の上では `e1` 〜 `e3` を使わ**ない**。

赤の面の上は `e2-accent` / `e3-accent` を使う。

影の色はこの 2 系統**だけ**。赤以外の彩度のある面を作ら**ない**。

## Shapes

半径は 4 値。段の間の値を作ら**ない**。

**段は要素の大きさで選ぶ**。半径は大きさに対する比で読まれるので、同じ値を印と部品へ使わ**ない**。

| 値     | 何に付くか                                                  |
| ------ | ----------------------------------------------------------- |
| 0      | 既定。セル・行・帯・区切り・文書。一覧に無いものもここ      |
| `sm`   | 印 —— チェック                                              |
| `md`   | 部品と容器の既定 —— ボタン・入力・カード・窓・overlay・容器 |
| `full` | 円形の部品 —— ラジオ・ステータスの点・スイッチ              |

`md` を印には使わ**ない**。半径が丈の 1/4 を超えると弧が辺の半分を覆い、ラジオと読み分けられ**ない**。印だけが `sm` を持つ理由はここ**だけ**。

セル・行・帯・全面は物体では**ない**ので 0 のまま。結合グリッドは容器だけが `md` で、中のセルは 0 のまま（「一覧の組み方」）。

全幅に伸びる面は 0。

チェックボックスを丸にし**ない**。checked の印はチェックで、丸ではない。

チェックボックス・ラジオは `appearance: none` で組む。

文書（見積・譜面・スライド）は全部 0。

## Components

部品ごとの値は front matter の `components` が持つ。ここには front matter で表せない規則だけを書く。

UI 部品のクラスは持た**ない**。`.rabi-heading` と `.rabi-table` を除いて、部品は「状態」「Shapes」「Layout」に従ってその場で組む。

`rabi.css` をインライン展開すると要素の既定も付く —— `body` の地と文字、`a` の色と下線、フォーム要素の `font-family`、`color-scheme` と `accent-color`。上書きするときは段の中から選ぶ。

その 2 つは**文書**（見積・譜面・スライド・docs）の部品。文書ではタイトルも節見出しも `.rabi-heading`、表は `.rabi-table` を必ず使う。web・UI の節見出しは他の形で組んでよい。

- ボタン: 主操作は意味のまとまりに 1 つだけ赤ベタ。残りは `button-secondary`
- ボタンの hover: 主操作は `accent-hover`、二次は地を `paper-2`。枠と文字は動かさ**ない**
- 一覧: 結合グリッドで組む（「一覧の組み方」）。セルに個別の影を付け**ない**
- カード: 強調は `card-accent`（赤ベタ）。赤の面の上では使え**ない**（「赤を出す場所」）。その面では大きさと影で付ける
- リンク: 本文中は色だけで示さ**ない**。下線を必ず添える。ナビ・ボタン・面全体のリンクは位置と形で分かるので対象外
- リンクの hover: 下線を外す。色は動かさ**ない**
- 入力: 誤りは枠を太くする。枠色の付け替えで表さ**ない**
- チップ: 分類の色分けをし**ない**。文言で区別する
- リスト行: hover は地、選択は `outline`。両方を地で表さ**ない**
- hover は押せるものだけ。押せない面を hover で動かさ**ない**
- 押せる一覧は `paper` の面に置く。`paper-2` の帯に直接置か**ない**
- 表の本文行は**例外**。押せなくても hover で地を `paper-2` にする。合計行とグループ行は除く
- 吹き出し: 地は `ink` のベタ。面の段を使わ**ない**。広い面を `ink` で塗ってよい**唯一の例外**
- 表: `.rabi-table` のセレクタは要素まで固定。`thead` を省く・`tr.group` / `tr.total` を `th` で組むと効か**ない**

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
