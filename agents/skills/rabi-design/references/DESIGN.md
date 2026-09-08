---
version: alpha
name: Rabi
description: 紙とキャンバスの上に思考を貼る。Rabi の製品 UI・LP・ドキュメント・図のデザインシステム。
colors:
  primary: "{colors.accent}"
  accent: "#dc143c"
  accent-text: "#d0123a"
  on-accent: "#ffffff"
  fill-accent: "{colors.accent}"
  on-fill-accent: "{colors.on-accent}"
  fill-ink: "{colors.ink}"
  on-fill-ink: "{colors.paper}"
  info: "#4a5a6a"
  info-text: "#3d4d5c"
  success: "#009f5b"
  success-text: "#007e47"
  caution: "#bf7a00"
  caution-text: "#9a6100"
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
  doc:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
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
  r-md: 18px
  r-full: 999px
spacing:
  hairline: 1px
  rule: 2px
  select-bar: 2px
  gap-0_5: 2px
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
  header-h: 56px
components:
  button-fill:
    backgroundColor: "{colors.fill-accent}"
    textColor: "{colors.on-fill-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.faint}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-ghost-hover:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 20px
  button-outline-hover:
    backgroundColor: "{colors.paper-2}"
  badge-accent:
    backgroundColor: transparent
    textColor: "{colors.accent-text}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-sm}"
    padding: 3px 10px
  badge-outline:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-sm}"
    padding: 3px 10px
  badge-ink:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-sm}"
    padding: 3px 10px
  badge-accent-solid:
    backgroundColor: "{colors.fill-accent}"
    textColor: "{colors.on-fill-accent}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-sm}"
    padding: 3px 10px
  badge-ink-solid:
    backgroundColor: "{colors.fill-ink}"
    textColor: "{colors.on-fill-ink}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-sm}"
    padding: 3px 10px
  chip:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.meta}"
    rounded: "{rounded.r-full}"
    padding: 3px 10px
  chip-selected:
    backgroundColor: "{colors.fill-accent}"
    textColor: "{colors.on-fill-accent}"
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
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-full}"
    height: "{spacing.control-lg}"
    padding: 0 16px
  textarea:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-md}"
    padding: 12px 16px
  select:
    backgroundColor: transparent
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
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: 8px 12px
  table-cell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    padding: 8px 12px
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
  callout:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    padding: 0 0 0 16px
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
    info: "#8fa3b5"
    info-text: "#a8bccc"
    success: "#3fbe7f"
    success-text: "#57d094"
    caution: "#d99a2b"
    caution-text: "#e5ad4a"
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
    stylesheets:
      - family: YakuHanJP
        href: https://cdn.jsdelivr.net/npm/yakuhanjp@4.1.1/dist/css/yakuhanjp.css
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
        - YakuHanJP
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
    on-accent-wash: { from: on-accent, to: transparent, keep: 10 }
    on-accent-edge: { from: on-accent, to: transparent, keep: 71 }
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
- ブランドのアクセントは crimson 1 色。注記の種別色は「Colors」の用途に限る

light と dark は同じ骨格を持つ。dark は反転ではなく、同じ役の別の値。

## Colors

役で名前が付いており、色相では付かない。

- **`accent`** —— ブランドのアクセント。線・点・図の節点・accent 地に使う。テーマで変わらない。文字に使うのは、accent 地の上の白い塗りボタンだけ
- **`accent-text`** —— 紙と地の上に置くアクセントの文字（現在地・選択中のラベル・リンク・番号）。light では accent より暗く、dark では明るい
- **`on-accent`** —— accent 地の上に載る文字と線。テーマで変わらない
- **`ground`** —— 盤。ページの地
- **`paper` / `paper-2`** —— 浮いた紙 / 沈んだ紙。footer・code-bar・hover 地は後者
- **`ink` / `soft` / `faint`** —— 文字の 3 段。本文 / 補助 / メタ
- **`divider` / `edge` / `line`** —— 線の 3 段。紙の縁 / 操作の縁 / 面の中の区切り
- **`shade`** —— 混色の相手専用。面・文字・線に直接使わない

`primary` は `accent` の別名で、DESIGN.md 形式（npm の @google/design.md）の推奨名に接続するためだけに在る。CSS には**出ない**。

塗り部品は `fill-accent` と `on-fill-accent`、または `fill-ink` と `on-fill-ink` を対で使う。地だけ・文字だけを差し替えない。これらの役割参照は CSS にも残す。

注記の種別色は info / success / caution / danger。罫と見出しの文字だけに使い、地を塗らない。対応は「文書」の表に従う。ブランドのアクセントやフォームの成功表示へ流用しない。

front matter の `colors` が light の値、`extensions.dark` が同名の dark の値。両方を持つ役は `light-dark()` で 1 つの `--rabi-*` になる。値を直に持ち `dark` に現れない役はテーマ不変。役割参照のテーマは参照先が持つ。

既定は OS に従う。明示して切り替えるときは `:root` の `data-theme` を `light` か `dark` にする。JS で**色を書き換えない**。

**導出色は色トークンではない**。混ぜる 2 色と割合は `extensions.derive` が持ち、生成 CSS が `color-mix(in oklab, ...)` を組み立てる。`transparent` と混ぜたものは、載る面の色で見え方が決まる。

`accent` 地の上での線と枠は `on-accent-edge`、薄い hover 地は `on-accent-wash`。**別の色を持ち込まない**。

## Typography

読み込む webfont は `extensions.fonts.webfont` と `extensions.fonts.stylesheets`、媒体ごとの書体と fallback の順序は `extensions.fonts.stack` に従う。YakuHanJP は和文の約物に使う。

`local()` だけを `src` に持つ**別名を作らない**。

`<head>` に貼る webfont の `<link>` は [`../assets/rabi-head.html`](../assets/rabi-head.html)、フォントスタックは [`../assets/rabi-tokens.css`](../assets/rabi-tokens.css)。どちらも front matter の `extensions.fonts` から生成する。

規模の規則:

- 本文は `body` 固定。文書本文は `prose`、説明・注記の行送りは `doc`
- 面の見出し（hero・CTA・statement・ページ・セクション）は `clamp()` で可変にする。**トークンにしない** —— 面ごとに下限・上限が違う。文書の見出し（`prose-h2` / `subheading`）は固定で、トークンを引く
- メタは `meta` の mono + `text-transform: uppercase`。字間は `meta` の既定を使い、縦書きの飾りラベル・kicker は 0.2em 以上へ広げる。badge と chip は 0.12em。`label` 系は sans で、mono に**しない**
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

余白は `gap-0_5` 〜 `gap-14` の非等比スケール。密な面は `gap-0_5` 〜 `gap-3`、面と面の間は `gap-8` 〜 `gap-14` を使う。

レール・ヘッダーナビ・左右余白・サイドの折り畳みは `extensions.layout.narrow` で切り替える。文書の目次は 1080px 以下で隠す。その他のグリッドの列を減らす幅は面ごとに決める。

固定の骨格は Web の UI・LP・文書ページに当てる。単独の文書成果物と図には当てない:

- ヘッダー・レール・フッターは全ページで共用する。ヘッダーはサイト回遊とアカウント状態、右レールはアプリへの導線、左レールは装飾ラベルを持つ
- ヘッダーは `position: fixed`。丈は `header-h`、地は `head-veil`、`backdrop-filter: blur(8px)`。本文とアンカー移動にはヘッダー分の逃げを取る
- 左右のレールは `narrow` 以下で隠し、導線はモバイルメニューへ移す。閉じたメニューを Tab 移動の対象に残さない
- 文書の器は 224px + `minmax(0, 1fr)` + 176px の 3 列で、列間は `gap-10`。本文と前後移動は中央の 1 grid item に束ねる
- 文書のサイドの器と目次は `position: sticky; top: 96px`。ナビ自体を二重に sticky にしない。検索結果は器の外へ張り出せるようにする
- app shell は 224px + `minmax(0, 1fr)` の 2 列。器に `width: 100%` と左右余白を持たせる。サイドは `position: sticky; top: 0; height: 100svh; overflow: auto`
- 狭幅ではサイドを折り畳み、1 列へ切り替える。上余白は `header-h` + `gap-4`。サイドの高さ固定・sticky・自前スクロールを外す
- ページの器は `min-height: 100svh` の flex column、本文は `flex: 1`。短いページでもフッターを下端へ置く
- セクションの上下は `gap-14` / `gap-12`

`ground` の盤はドットグリッドで描く。28px 間隔、`grid-dot` の 1px の円、下 30% を `mask-image` で消す。

## Elevation & Depth

外側の影は `e1` / `e2` / `e3` の 3 段。面と overlay にだけ使う。ボタン・chip・range のつまみには付けない。部品ごとの適用は「Components」。

light と dark で影の色が変わる。light は ink 寄りの薄い影、dark は黒の濃い影。`light-dark()` で 1 つの `--rabi-e*` になる。

影を持つ面のうち、accent で塗った面と accent 地に載る白い面は `e1-accent` 〜 `e3-accent` を使う。ニュートラルの影を使い回さない。

内側へ沈める影は `e-inset` の 1 つだけ。**外へ出す影と混ぜない**。

深さは影だけでは作らない。

- 線 —— 通常は `hairline`、強い罫は `rule`、選択行の左端の印は `select-bar`。checkbox と radio だけ 1.2px
- 地の差 —— 沈める面は `paper-2`、浮かせる面は `paper`
- 回転 —— 付箋とカードは微回転する。hover で `rotate(0deg)` へ戻し 4px 持ち上げる

## Shapes

角丸は用途で決まる。**大きさでは決まらない**。

| 対象                                                    | 角丸     |
| ------------------------------------------------------- | -------- |
| 操作（ボタン・入力・chip・switch・アイコンボタン）      | `r-full` |
| 紙・札（付箋・カード・表・menu・code・checkbox・badge） | `r-sm`   |
| 大きい面（`board`・`textarea`・composer）               | `r-md`   |
| 区切り線・レール                                        | `r-none` |

**同じ面の中で紙と操作の角丸を揃えない**。差が役の違いを表す。

アイコンは lucide の geometry を inline SVG または CSS mask で置き、`currentColor` に追従させる。mask の素材は npm の `lucide-static` から取る。操作内の SVG は幅・高さを 1em に揃える。矢印も icon にし、取れないときは同じ太さの線で描く。絵文字で代用しない。

## Components

原子だけを規定する。LP の複合ブロック（hero・statement・機能カード・料金表・FAQ・更新履歴・キャンバス盤）は原子の組み合わせで作る。クラス名を API に**しない**。

### 操作

ボタンの面は fill / outline / ghost の 3 種。役割・色・大きさと分けて選ぶ。文字の weight は 500。

| 面      | 通常                           | hover                  | active                       |
| ------- | ------------------------------ | ---------------------- | ---------------------------- |
| fill    | `button-fill`                  | `accent-hover`         | `accent-active` + 1px 下げる |
| outline | `button-outline` + `edge` の枠 | `button-outline-hover` | 変えない                     |
| ghost   | `button-ghost`、可視枠なし     | `button-ghost-hover`   | 変えない                     |

accent 地は地色と子部品の配色を一緒に持つ。ボタンの面は変えず、次を同じスコープで差し替える。

| 対象                         | accent 地での値        |
| ---------------------------- | ---------------------- |
| fill の地 / 文字             | `on-accent` / `accent` |
| fill の hover と active の地 | `on-accent-hover`      |
| outline と ghost の文字      | `on-accent`            |
| outline の枠                 | `on-accent-edge`       |
| outline と ghost の hover 地 | `on-accent-wash`       |
| 補助文字・focus              | `on-accent`            |

fill の active の移動は維持する。派生した custom property は定義した要素で解決されるため、親で参照先だけを変えず、子が読む配色の対も同じスコープで再定義する。

配色の最小例。class と `--example-*` は例示で、配布 API ではない。形・focus・disabled は各節の規則を加える。

```html
<style>
  .example-surface {
    background: var(--rabi-paper);
    --example-fill: var(--rabi-fill-accent);
    --example-on-fill: var(--rabi-on-fill-accent);
    --example-hover: var(--rabi-accent-hover);
    --example-active: var(--rabi-accent-active);
  }
  .example-surface.example-accent {
    background: var(--rabi-accent);
    --example-fill: var(--rabi-on-accent);
    --example-on-fill: var(--rabi-accent);
    --example-hover: var(--rabi-on-accent-hover);
    --example-active: var(--rabi-on-accent-hover);
  }
  .example-fill {
    background: var(--example-fill);
    color: var(--example-on-fill);
  }
  .example-fill:not(:disabled):hover {
    background: var(--example-hover);
  }
  .example-fill:not(:disabled):active {
    background: var(--example-active);
  }
</style>
<div class="example-surface"><button class="example-fill">Save</button></div>
<div class="example-surface example-accent"><button class="example-fill">Save</button></div>
```

丈は 4 段。`control-lg` が単体のボタンと入力、`control` が面に埋め込む送信ボタン、`control-sm` がヘッダーの小さな操作、`control-xs` が menu の項目と switch / range の当たり判定。

ボタンのアイコンが接する縁は `gap-3` まで詰め、文字との間隔は `gap-2` を保つ。小さい操作は `control-sm` と `label`。ghost の当たり判定は丈の実体で持ち、負の margin で広げない。

文の中のリンクは常時下線、文の外の導線は hover で下線。単独の操作は ghost ボタンにする。

badge は押せない状態表示、chip は押せる絞り込み。字・余白は揃え、角で区別する。badge の枠は accent / ink / outline の順に `accent` / `ink` / `edge`。既定は透明で、強調する札だけ solid の塗りを使う。形式タグは `badge-outline`。

選ばれた chip は `chip-selected` の塗りと文字、透明な枠、weight 600。hover でも選択時の文字色を保つ。選択の見た目と ARIA の意味を分け、リンクには現在地、切替ボタンには押下状態を付ける。

### 状態

`-hover` `-active` `-selected` `-checked` が付く component は**差分だけ**を持つ。書いていないプロパティは基底のまま。

| 接尾        | 受ける selector                                              |
| ----------- | ------------------------------------------------------------ |
| `-hover`    | `:hover`                                                     |
| `-active`   | `:active`                                                    |
| `-selected` | 選択状態の class または data 属性。ARIA は要素の役に合わせる |
| `-checked`  | `:checked`                                                   |

focus と disabled は component に**持たせない**。全ての操作要素に同じ規則を当てる。

- focus —— `:focus-visible` の共通規則が `focus` / `focus-width` / `focus-offset` を引く。例外は輪郭を親の面へ移すときだけ。行が隣接する部品は offset を負にして内側へ描く
- 入力の focus —— ポインタ由来と確認できた input / textarea / select だけ輪郭を消してよい。キーボード由来・入力元が不明・JS が動かない場合は表示する
- disabled —— `:disabled`、要素が受けないときだけ `[aria-disabled='true']`。`opacity: 0.45` と `cursor: not-allowed`。色は差し替えない。hover と active は**当てない**

印の色は選択後の component から取る。`backgroundColor` が部品の地、`textColor` が**その上に載る印**（チェック・丸・knob）。

寸法は front matter が持つ。ここに書くのは front matter が**持てない**形だけ。

| 部品       | 形                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkbox` | 選択後の `on-accent` のチェックは 10px・線幅 1.8・端は丸                                                                                      |
| `radio`    | 選択後は枠が accent になり、半径 4px の丸を紙の上に置く                                                                                       |
| `switch`   | 地は `e-inset`。knob は半径 8px の `on-accent` で、左 12px から右 12px へ動く。素の地では knob と地の差が小さい —— 形を出すのは枠と `e-inset` |
| `range`    | `range-track` を中央に敷く。つまみは `range-thumb`                                                                                            |

range の進捗は両 engine とも track に `linear-gradient` を敷き、境目を `--val` で動かす。`--val` は `(value - min) / (max - min)` の百分率を 0〜100% へ収めた値で、初回描画と `input` のたびに書き直す。`min` と `max` が等しいときは 0% にする。

割合の表示は `<progress value max>` を使う。溝は `paper-2`、進捗は `accent`、丈は 3px。幅だけの div で値を表さない。

`forced-colors: active` では、`background` で描いたものが色を奪われて消える。UA 描画か system color へ戻す。

- mask のアイコンと印は `forced-color-adjust: none` と `background-color: currentColor` で残す
- checkbox・radio・switch・select・range は `appearance: auto` で native へ戻し、寸法と影の上書きも外す
- range の track と thumb は engine ごとの疑似要素を**別々の規則**に書く。`-webkit-` と `-moz-` を 1 つの selector list にまとめると、片方が未知のとき規則ごと無効になる
- progress は UA 描画へ戻し、境界が消える場合は `CanvasText` の枠を足す

native の UA 描画は `appearance: none` で外してから描く。描画は `background` で行う。range と progress だけ engine ごとの疑似要素を使う。

### 面

`card` は紙 + `divider` の枠 + `e1`。コード面と表の器も同じ面を使う。

`sticky` は付箋。影を `e2` にし、メタ行と本文で内側を分ける。

`board` はキャンバス盤。地の盤と同じ点を `board-dot` で 20px 間隔に敷く。フェードは掛けない。上に載る節点は `card` で、起点だけ左端に `rule` 幅の accent 帯を持つ。

未確定・これから入る内容は frame の破線の器にする。罫は `hairline` の `edge`、角は `r-sm`。名札は左上の内側に置き、罫を切らない。空状態も破線と中央寄せの見出し・説明・操作で表すが、罫は `divider`。

押せないアイコン枠は `paper-2` と `r-none`。カテゴリは `accent-text`、個物は `faint`。器は `gap-6` / `gap-8` / `gap-10`、アイコンはその半分。顔画像は円形に切り、画像がなければ頭文字を置く。

### 入力

枠は `edge`、地は透明。塗りが必要な場所は載せる面が持つ。textarea だけ高さが伸びる。

検索・複合入力の器は位置決めとアイコン・末尾操作の逃げだけを持つ。入力の丈・角・地を上書きしない。消去操作は値があるときだけ置き、入力と重ならない余白を確保する。

ラベルは `meta`（mono・uppercase・`faint`）で入力の上に置く。

### 文書

`prose-body` が文書本文。紙の上に載せる。

`h2` は下線（`line`）付きの `prose-h2`、`h3` は `subheading`。箇条書きは `soft` で、大きさは `body`、行間は `prose` に合わせる。

`code-block` の器は「面」の規則に従う。上に `code-bar`（`paper-2` の帯、mono の `faint`）を持つ。強調するトークンだけ `accent-text`。

注記は `callout` の本文と左の `rule` 幅の罫。見出しは `meta` と種別のアイコン、本文の行送りは `doc`。

| 種別    | 罫        | 見出し         |
| ------- | --------- | -------------- |
| note    | `info`    | `info-text`    |
| tip     | `success` | `success-text` |
| warning | `caution` | `caution-text` |
| danger  | `accent`  | `accent-text`  |

本文内の導線群は罫で区切る行にし、カードの枠と影を重ねない。アイコン / 本文 / 行き先の列位置を固定し、どれかが無くても文字の頭を揃える。行内のアイコンは 1em、枠なし。独自の文字サイズを持つ注記・行・手順の中では、段落とリストにもサイズと行送りを継承させる。

表は縦罫を引かない。見出しは `table-header` と weight 600、下に `divider`。行の間に `line`、最終行の下罫は省く。数値は右寄せ + mono + `tabular-nums`。文章のセルは上寄せと `doc` の行送り。器は横スクロールを受ける。

### 図

図の中の線・節点・注記はトークンで塗る。

- 線 —— `stroke: edge`、`stroke-width: 1.2`、`fill: none`
- 節点 —— `fill: paper`、`stroke: divider`、`stroke-width: 1`。強調する節点だけ `fill: accent`
- 注記 —— mono・7px・`faint`・`letter-spacing: 0.08em`

### 重なり

`menu` と項目の値は `components.menu` / `components.menu-item` / `components.menu-item-hover` に従う。menu の枠は `divider`、影は `e3`。チェック位置を空の slot で揃える。

`tooltip` の値は `components.tooltip` に従う。0.5s のホバー遅延で出す。

### 動き

`motion` が操作の反応、`motion-lift` がカードの浮上、`motion-reveal` が scroll-in。

scroll-in は 26px 下から浮かせる。イージングは `cubic-bezier(0.2, 0.7, 0.2, 1)`。

scroll-in の要素は既定で表示する。JS が監視を開始したあとだけ隠し、初期化に失敗しても本文を残す。

`prefers-reduced-motion: reduce` で animation と transition を全て切り、scroll-in は最初から表示にする。

## Do's and Don'ts

本文に無い規則だけを置く。**本文の規則を写さない**。

- 同じ操作群で強調する fill ボタンは 1 つにする
- 付箋の回転は ±2.4° まで。**傾けすぎない**
- 左レールのラベル・ドットグリッド・グレインは装飾で、情報を載せない。右レールの導線は操作要素として扱う
- 操作できる要素の当たり判定は `control-xs` 以上にする
- **色だけで意味を示さない**。形・文字・位置を併せる
