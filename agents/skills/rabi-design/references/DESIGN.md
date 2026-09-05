---
version: alpha
name: Rabi
description: 紙とキャンバスの上に思考を貼る。Rabi の製品 UI・LP・ドキュメント・図のデザインシステム。
colors:
  primary: "{colors.accent}"
  accent: "#dc143c"
  accent-text: "#d0123a"
  on-accent: "#ffffff"
  shade: "#000000"
  ground: "#f1f1f1"
  paper: "#ffffff"
  paper-2: "#f4f4f4"
  ink: "#222222"
  soft: "#575757"
  faint: "#6e6e6e"
  divider: "#d3d3d3"
  edge: "#8b8b8b"
  line: "#e9e9e9"
typography:
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  subheading:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  prose:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.7
  prose-h2:
    fontFamily: Inter
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.4
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.4
  label-xs:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.4
  meta:
    fontFamily: Roboto Mono
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: 0.14em
rounded:
  r-none: 0px
  r-sm: 6px
  r-md: 16px
  r-full: 999px
spacing:
  gap-1: 4px
  gap-1_5: 6px
  gap-2: 8px
  gap-2_5: 10px
  gap-3: 12px
  gap-3_5: 14px
  gap-4: 16px
  gap-4_5: 18px
  gap-5: 20px
  gap-6: 24px
  gap-8: 32px
  gap-10: 40px
  gap-12: 48px
  gap-14: 56px
  control-xs: 24px
  control-sm: 28px
  control: 32px
  control-lg: 36px
  pad-x: "{spacing.gap-12}"
  pad-x-narrow: "{spacing.gap-6}"
  content-max: 1280px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-ghost:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-ghost-hover:
    backgroundColor: "{colors.paper-2}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-on-accent:
    backgroundColor: "{colors.on-accent}"
    textColor: "{colors.accent}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  badge-accent:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.accent-text}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    padding: 3px 10px
  badge-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    padding: 3px 10px
  badge-ink:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    padding: 3px 10px
  badge-on-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    padding: 3px 10px
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    height: 26px
    padding: 0 12px
  chip-selected:
    textColor: "{colors.accent-text}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-sm}"
  sticky:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-sm}"
  board:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-md}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 16px
  textarea:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-md}"
    padding: 12px 16px
  select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 16px
  checkbox:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.r-sm}"
    size: 16px
  checkbox-checked:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  radio:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.r-full}"
    size: 16px
  radio-checked:
    textColor: "{colors.accent}"
  range:
    height: "{spacing.control-xs}"
  range-track:
    backgroundColor: "{colors.edge}"
    height: 2px
  range-thumb:
    backgroundColor: "{colors.accent}"
    rounded: "{rounded.r-full}"
    size: 12px
  switch:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.r-full}"
    width: 42px
    height: "{spacing.control-xs}"
  switch-checked:
    backgroundColor: "{colors.accent}"
  field-label:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.faint}"
    typography: "{typography.meta}"
  menu:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.r-sm}"
    padding: 4px
  menu-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.r-sm}"
    height: "{spacing.control-xs}"
    padding: 0 12px
  menu-item-hover:
    backgroundColor: "{colors.paper-2}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.r-sm}"
    padding: 6px 12px
  table-header:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: 12px 16px
  table-cell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    padding: 12px 16px
  prose-body:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.prose}"
  code-block:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.r-sm}"
    padding: 16px 20px
  code-bar:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
    typography: "{typography.meta}"
    padding: 6px 12px
  note-box:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    padding: 4px 0 4px 16px
  caption:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.faint}"
    typography: "{typography.meta}"
  page-title:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
  cta-band:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  footer:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
extensions:
  dark:
    accent-text: "#ff3b5c"
    ground: "#111111"
    paper: "#181818"
    paper-2: "#1f1f1f"
    ink: "#f2f2f2"
    soft: "#aaaaaa"
    faint: "#888888"
    divider: "#3e3e3e"
    edge: "#696969"
    line: "#2c2c2c"
  fonts:
    webfont:
      origin: https://fonts.googleapis.com
      assets: https://fonts.gstatic.com
      display: swap
      families:
        - { family: Inter, weight: "400..700" }
        - { family: Roboto Mono, weight: "400..700" }
        - { family: Noto Sans JP, weight: "400..700" }
    stack:
      font:
        - Inter
        - system-ui
        - Helvetica Neue
        - Arial
        - Noto Sans JP
        - Hiragino Kaku Gothic ProN
        - Hiragino Sans
        - BIZ UDPGothic
        - sans-serif
      mono:
        - Menlo
        - Roboto Mono
        - Consolas
        - Noto Sans JP
        - Hiragino Kaku Gothic ProN
        - Hiragino Sans
        - BIZ UDPGothic
        - monospace
  elevation:
    e-inset:
      inset: true
      offset: 0 1px 2px
      color: rgb(0 0 0 / 0.08)
    e1:
      offset: 0 1px 3px
      light: rgb(34 34 34 / 0.07)
      dark: rgb(0 0 0 / 0.49)
    e2:
      offset: 0 5px 14px
      light: rgb(34 34 34 / 0.1)
      dark: rgb(0 0 0 / 0.56)
    e3:
      offset: 0 12px 28px
      light: rgb(34 34 34 / 0.16)
      dark: rgb(0 0 0 / 0.63)
    e1-accent:
      offset: 0 3px 6px
      color: rgb(88 6 22 / 0.18)
    e2-accent:
      offset: 0 5px 14px
      color: rgb(88 6 22 / 0.34)
    e3-accent:
      offset: 0 12px 28px
      color: rgb(88 6 22 / 0.4)
  derive:
    accent-hover: { from: accent, to: shade, keep: 88 }
    accent-active: { from: accent, to: shade, keep: 76 }
    on-accent-hover: { from: on-accent, to: accent, keep: 93 }
    outline-hover: { from: on-accent, to: transparent, keep: 10 }
    outline-edge: { from: on-accent, to: transparent, keep: 71 }
    head-veil: { from: ground, to: transparent, keep: 82 }
    grid-dot: { from: divider, to: transparent, keep: 62 }
    board-dot: { from: divider, to: transparent, keep: 55 }
  focus:
    color: accent
    width: 2px
    offset: 2px
  motion:
    motion: 0.1s
    motion-lift: 0.28s
    motion-reveal: 0.7s
  layout:
    narrow: 860px
---

# Rabi

## Overview

紙とキャンバス。地はドットグリッドの盤で、その上に紙の面が浮く。

- 面は 3 段。地の上に紙が浮き、沈んだ紙が下がる
- 全面に紙のグレインを敷く。SVG の `feTurbulence`（`fractalNoise` / `baseFrequency` 0.85 / `numOctaves` 2 / `stitchTiles` は `stitch`）を 180px でタイルし、その上の `rect` を不透明度 0.55 で塗る。敷く層は light が `multiply` の 0.05、dark が `screen` の 0.04
- アクセントは crimson 1 色だけ。2 色目を作ら**ない**

light と dark は同じ骨格を持つ。dark は反転ではなく、同じ役の別の値。

## Colors

役で名前が付いており、色相では付かない。

- **`accent`** —— 唯一のアクセント。塗り・線・点に使う（主操作の地・選択の枠・強調の点・図の節点）。テーマで変わらない。文字に使うのは、accent 地の文脈で白く塗った面の上だけ（`button-on-accent`）
- **`accent-text`** —— 紙と地の上に置くアクセントの文字（現在地・選択中のラベル・リンク・番号）。light では accent より暗く、dark では明るい
- **`on-accent`** —— accent 地の上に載る文字と線。テーマで変わらない
- **`ground`** —— 盤。ページの地
- **`paper` / `paper-2`** —— 浮いた紙 / 沈んだ紙。footer・code-bar・hover 地は後者
- **`ink` / `soft` / `faint`** —— 文字の 3 段。本文 / 補助 / メタ
- **`divider` / `edge` / `line`** —— 線の 3 段。紙の縁 / 操作の縁 / 面の中の区切り
- **`shade`** —— 混色の相手専用。面・文字・線に直接使わない

`primary` は `accent` の別名で、DESIGN.md 形式（npm の @google/design.md）の推奨名に接続するためだけに在る。CSS には出**ない**。

front matter の `colors` が light の値、`extensions.dark` が同名の dark の値。両方を持つ役は `light-dark()` で 1 つの `--rabi-*` になる。`dark` に現れない役はテーマ不変。

既定は OS に従う。明示して切り替えるときは `:root` の `data-theme` を `light` か `dark` にする。JS で色を書き換え**ない**。

導出色は色トークンでは**ない**。混ぜる 2 色と割合は `extensions.derive` が持ち、生成 CSS が `color-mix(in oklab, ...)` を組み立てる。`transparent` と混ぜたものは、載る面の色で見え方が決まる。

`accent` 地の上での線と枠は `on-accent` を薄めて作る（`outline-edge`）。別の色を持ち込ま**ない**。

## Typography

Inter が本文、Roboto Mono がメタ情報。和文は Noto Sans JP を取り寄せる。実際にどの和文が当たるかは OS のフォント設定が決める —— スタックは欧文を先に解決するので、`system-ui` が和文も覆う環境ではそちらへ落ちる。

読み込みは 2 段。webfont を取り寄せ、取れなければ OS のフォントへ落ちる。sans は `system-ui` → `Helvetica Neue` → `Arial`、和文は `Hiragino Kaku Gothic ProN` → `Hiragino Sans` → `BIZ UDPGothic`。

mono だけ順が違う。`Menlo` が先頭に来る。macOS では Menlo、無ければ Roboto Mono、Windows でネットが無ければ `Consolas` へ落ちる。

`local()` だけを `src` に持つ別名を作ら**ない**。install 済みの和文が weight を 1 つしか持たないと、600 と 700 が擬似太字になる。

`<head>` に貼る `<link>` は [`../assets/rabi-head.html`](../assets/rabi-head.html)。`@font-face` とスタックは [`../assets/rabi-tokens.css`](../assets/rabi-tokens.css)。どちらも front matter の `extensions.fonts` から生成する。

規模の規則:

- 本文は `body` 固定。文書本文だけ `prose`
- 面の見出し（hero・CTA・statement・ページ・セクション）は `clamp()` で可変にする。トークンに**しない** —— 面ごとに下限・上限が違う。文書の見出し（`prose-h2` / `subheading`）は固定で、トークンを引く
- メタは `meta` の mono + `text-transform: uppercase`。字間は `meta` の既定を使い、縦書きの飾りラベルだけ 0.2em 以上へ広げる。`label` 系は sans で、mono に**しない**
- 見出しの `font-weight` は 600 まで。700 は大きく見せる数値だけ
- 見出しには `letter-spacing` の負値を当てる。大きいほど詰める（-0.01em 〜 -0.03em）
- 見出しには `text-wrap: balance`
- 数値を縦に並べる場所は `font-variant-numeric: tabular-nums`
- 本文には `-webkit-font-smoothing: antialiased`
- `label` は表と menu の文字、`label-sm` は補足と tooltip、`label-xs` は最小のメタ

面ごとの可変サイズ:

| 用途                         | size                       | weight / line-height |
| ---------------------------- | -------------------------- | -------------------- |
| hero                         | `clamp(44px, 9vw, 112px)`  | 600 / 1.08           |
| CTA バンド                   | `clamp(36px, 7vw, 92px)`   | 600 / 1.1            |
| statement                    | `clamp(34px, 6.5vw, 88px)` | 600 / 1.14           |
| ページ見出し                 | `clamp(40px, 6.5vw, 84px)` | 600 / 1.1            |
| ページ見出し（文字情報の面） | `clamp(28px, 3.2vw, 44px)` | 600 / 1.1            |
| セクション見出し             | `clamp(30px, 4.5vw, 54px)` | 600 / 1.15           |
| リード文                     | `clamp(14px, 1.4vw, 16px)` | 400 / 1.5            |

## Layout

本文の最大幅は `content-max` で、中央に置く。左右の余白は `pad-x`。

余白は `gap-1` 〜 `gap-14` の非等比スケール。等比では**ない** —— 密な面は `gap-1` 〜 `gap-3`、面と面の間は `gap-8` 〜 `gap-14` を使う。

骨格が切り替わるのは `extensions.layout.narrow` の 1 か所だけ。ここでレール・ヘッダーナビ・左右余白が変わる。グリッドの列を減らす幅は面ごとに決める。トークンに**しない**。

固定の骨格。**当てるのは UI と LP だけ**で、文書と図には当てない:

- ヘッダーは `position: fixed`。地は `head-veil` で、`backdrop-filter: blur(8px)` を掛ける
- 左右の縦書きレールは `narrow` 以下で消す
- サイドナビ・目次は `position: sticky; top: 96px`
- app shell は 224px + 可変の 2 列。側は `height: 100svh` で自前にスクロールする
- セクションの上下は `gap-14` / `gap-12`

`ground` の盤はドットグリッドで描く。28px 間隔、`grid-dot` の 1px の円、下 30% を `mask-image` で消す。

## Elevation & Depth

影は 3 段だけ。`e1` は貼り付いた面、`e2` は浮いた面、`e3` は最前面。どの部品がどれを取るかは「Components」。

light と dark で影の色が変わる。light は ink 寄りの薄い影、dark は黒の濃い影。`light-dark()` で 1 つの `--rabi-e*` になる。

accent で塗った部品の影は `e1-accent` 〜 `e3-accent`。accent を沈めた赤褐色で、ニュートラルの影を使い回さ**ない**。accent 地の上に載る白い部品は `e*-accent` を取る —— 地が accent だから。

内側へ沈める影は `e-inset` の 1 つだけ。外へ出す影と混ぜ**ない**。

深さは影だけでは作らない。

- 線 —— `divider` は紙の縁、`edge` は操作の縁、`line` は面の中の区切り。幅は 1px。**例外は checkbox と radio の 1.2px**
- 地の差 —— 沈める面は `paper-2`、浮かせる面は `paper`
- 回転 —— 付箋とカードは微回転する。hover で `rotate(0deg)` へ戻し 4px 持ち上げる

塗りボタンの hover に影を足さ**ない**。地を 1 段暗くするだけ。

## Shapes

角丸は用途で決まる。大きさでは決まら**ない**。

| 対象                                                        | 角丸     |
| ----------------------------------------------------------- | -------- |
| 丸い形（ボタン・入力・chip・switch・アイコンボタン・badge） | `r-full` |
| 紙（付箋・カード・表・menu・code・checkbox）                | `r-sm`   |
| 大きい面（`board`・`textarea`・入力の複合面）               | `r-md`   |
| 区切り線・レール                                            | `r-none` |

同じ面の中で紙と操作の角丸を揃え**ない**。差が役の違いを表す。

アイコンは lucide（npm の `lucide-static`）の geometry を CSS mask で置く。`currentColor` を敷くので、色とテーマに自動で追従する。矢印もフォントの文字ではなく icon で形を固定する。取れないときは同じ太さの線で描く。**絵文字で代用しない**。

## Components

原子だけを規定する。LP の複合ブロック（hero・statement・機能カード・料金表・FAQ・更新履歴・キャンバス盤）は原子の組み合わせで作る。クラス名を API にし**ない**。

### 操作

`primary` は `e1-accent` で軽く浮かせる。

4 つの変種を持つ。`primary`（accent 塗り）、`ghost`（紙 + `edge` の枠）、`on-accent`（accent 地の上の白塗り）、`outline`（accent 地の上で塗らない）。

hover はどの変種も地を 1 段動かす。active は `primary` だけが `accent-active` まで沈み、全変種が 1px 下がる。

| 変種        | hover の地        |
| ----------- | ----------------- |
| `primary`   | `accent-hover`    |
| `ghost`     | `paper-2`         |
| `on-accent` | `on-accent-hover` |
| `outline`   | `outline-hover`   |

枠は component のプロパティで表せ**ない**。`ghost` は `edge`、`outline` は `outline-edge`、`badge-outline` と `chip` は `edge`。

丈は 4 段。`control-lg` が単体のボタンと入力、`control` が面に埋め込む送信ボタン、`control-sm` がヘッダーの小さな操作、`control-xs` が menu の項目と switch / range の当たり判定。

badge は押せ**ない**状態表示、chip は押せる絞り込み。形式タグも badge 側に置く。選ばれた chip は枠を `accent`、文字を `accent-text` にし、`font-weight` を 600 にする。

### 状態

`-hover` `-active` `-selected` `-checked` が付く component は**差分だけ**を持つ。書いていないプロパティは基底のまま。

| 接尾        | 受ける selector                                   |
| ----------- | ------------------------------------------------- |
| `-hover`    | `:hover`                                          |
| `-active`   | `:active`                                         |
| `-selected` | `[aria-pressed='true']` / `[aria-current='page']` |
| `-checked`  | `:checked`                                        |

focus と disabled は component に**持たせない**。全ての操作要素に同じ規則を当てる。

- focus —— `:focus-visible` の 1 規則が `focus` / `focus-width` / `focus-offset` を引く。**部品側に focus 規則を書かない**。accent 地の面と、accent 地でしか使わない部品は `--rabi-focus` を `on-accent` へ差し替える。行が隣接する部品は offset を負にして内側へ描く
- disabled —— `:disabled`、要素が受けないときだけ `[aria-disabled='true']`。`opacity: 0.45` と `cursor: not-allowed`。色は差し替えない。hover と active は**当てない**

印の色は選択後の component から取る。`backgroundColor` が部品の地、`textColor` が**その上に載る印**（チェック・丸・knob）。

寸法は front matter が持つ。ここに書くのは front matter が持て**ない**形だけ。

| 部品       | 形                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkbox` | 選択後の `on-accent` のチェックは 10px・線幅 1.8・端は丸                                                                                      |
| `radio`    | 選択後は枠が accent になり、半径 4px の丸を紙の上に置く                                                                                       |
| `switch`   | 地は `e-inset`。knob は半径 8px の `on-accent` で、左 12px から右 12px へ動く。素の地では knob と地の差が小さい —— 形を出すのは枠と `e-inset` |
| `range`    | `range-track` を中央に敷く。つまみは `range-thumb` に `e1-accent`                                                                             |

進捗（線の左だけ accent）を作る手は engine で違う。WebKit は専用の疑似要素を持た**ない**ので、track に `linear-gradient` を敷き、境目を `--val` で動かす。`--val` は `(value - min) / (max - min)` の百分率を 0〜100% へ丸めた値で、初回描画と `input` のたびに書き直す。`min` と `max` が等しいときは 0% にする。Firefox は `::-moz-range-progress` を使う。

`forced-colors: active` では、`background` で描いたものが色を奪われて消える。UA 描画か system color へ戻す。

- mask のアイコンと印（`.i`・kicker の点・author の dot・meter の帯）は `forced-color-adjust: none` と `background-color: currentColor` で残す
- checkbox・radio・switch・select・range は `appearance: auto` で native へ戻し、寸法と影の上書きも外す
- range の track と thumb は engine ごとの疑似要素を**別々の規則**に書く。`-webkit-` と `-moz-` を 1 つの selector list にまとめると、片方が未知のとき規則ごと無効になる
- 面の境界が消える部品（meter）は `CanvasText` の枠を足す

native の UA 描画は `appearance: none` で外してから描く。描画は `background` で行い、疑似要素に頼らない。**例外は range のつまみと線だけ**で、これは engine ごとの疑似要素（`::-webkit-slider-thumb` / `::-webkit-slider-runnable-track` / `::-moz-range-thumb` / `::-moz-range-track` / `::-moz-range-progress`）で描く。native の `input[type='range']` が他に手を持たない。

### 面

`card` は紙 + `divider` の枠。影は持た**ない**。

`sticky` は付箋。`card` に `e2` を足したもの。メタ行と本文で内側を分ける。

`board` はキャンバス盤。地の盤と同じ点を `board-dot` で 20px 間隔に敷く。フェードは掛け**ない**。上に載る節点は `card` に `e1` を足したもので、起点だけ左端に 2px の accent 帯を持つ。

### 入力

枠は `edge`。textarea だけ高さが伸びる。

ラベルは `meta`（mono・uppercase・`faint`）で入力の上に置く。

### 文書

`prose-body` が文書本文。紙の上に載せる。

`h2` は下線（`line`）付きの `prose-h2`、`h3` は `subheading`。箇条書きは `soft` で、大きさは `body`、行間は `prose` に合わせる。

`code-block` は紙 + `divider` + `e1`。上に `code-bar`（`paper-2` の帯、mono の `faint`）を持つ。強調するトークンだけ `accent-text`。

`note-box` は枠を持た**ない**。左に 2px の accent 線を引くだけ。見出しは mono の uppercase で `accent-text`。

表は罫線を縦に引か**ない**。見出しの下に `divider`、行の間に `line`。数値の列は右寄せ + mono + `tabular-nums`。

### 図

図の中の線・節点・注記はトークンで塗る。

- 線 —— `stroke: edge`、`stroke-width: 1.2`、`fill: none`
- 節点 —— `fill: paper`、`stroke: divider`、`stroke-width: 1`。強調する節点だけ `fill: accent`
- 注記 —— mono・7px・`faint`・`letter-spacing: 0.08em`

### 重なり

`menu` は紙 + `divider` + `e3`。項目の丈は `control-xs`、hover 地は `paper-2`。チェック位置を空の slot で揃える。

`tooltip` は `ink` 地に `paper` 文字。0.5s のホバー遅延で出す。

### 動き

`motion` が操作の反応、`motion-lift` がカードの浮上、`motion-reveal` が scroll-in。

scroll-in は 26px 下から浮かせる。イージングは `cubic-bezier(0.2, 0.7, 0.2, 1)`。

`prefers-reduced-motion: reduce` で animation と transition を全て切り、scroll-in は最初から表示にする。

## Do's and Don'ts

本文に無い規則だけを置く。本文の規則を写さ**ない**。

- accent 塗りのボタンは 1 画面に 1 つ。2 つ目を並べ**ない**
- 付箋の回転は ±2.4° まで。傾けすぎ**ない**
- 縦書きレール・ドットグリッド・グレインは装飾で、情報を載せ**ない**
- 操作できる要素の当たり判定は 24px 以上にする。見た目を変えずに padding と負の margin で広げる
- 色だけで意味を示さ**ない**。形・文字・位置を併せる
