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
    fontWeight: 600
    lineHeight: 1.15
  display:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 28px
    fontWeight: 600
    lineHeight: 1.2
  heading:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.3
  subheading:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "BIZ UDPGothic", sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
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
    fontWeight: 600
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
  md: 10px
  lg: 14px
  full: 999px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    fontWeight: 500
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    fontWeight: 500
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  button-secondary-hover:
    backgroundColor: "{colors.paper-2}"
  button-ghost:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    fontWeight: 500
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  button-ghost-hover:
    backgroundColor: "{colors.paper-2}"
  button-disabled:
    borderColor: "{colors.line}"
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
  button-icon:
    iconSize: 16px
  button-inline-icon:
    iconSize: 14px
  chip:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    height: "{spacing.control-xs}"
    padding: "{spacing.2}"
  chip-selected:
    backgroundColor: "{colors.wash}"
    borderColor: "{colors.wash-line}"
    textColor: "{colors.accent-text}"
  chip-disabled:
    borderColor: "{colors.line}"
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
  chip-selected-disabled:
    borderColor: "{colors.line}"
    backgroundColor: "{colors.wash}"
    textColor: "{colors.faint}"
  badge:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 20px
    padding: "{spacing.1.5}"
  badge-outline:
    backgroundColor: transparent
    borderColor: "{colors.edge}"
    textColor: "{colors.soft}"
  badge-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  input:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  input-invalid:
    borderColor: "{colors.accent}"
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
    paddingInline: "{spacing.3}"
  select:
    borderColor: "{colors.edge}"
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
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
  switch:
    backgroundColor: "{colors.paper-2}"
    borderColor: "{colors.edge}"
    rounded: "{rounded.full}"
    height: 20px
    width: 34px
    knobSize: 14px
  switch-on:
    backgroundColor: "{colors.accent}"
  field-row-label:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  field-label:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
    fontWeight: 600
  field-note:
    textColor: "{colors.soft}"
    typography: "{typography.label}"
  field-note-error:
    textColor: "{colors.accent-text}"
  choice:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
  choice-disabled:
    textColor: "{colors.faint}"
  section-head:
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
  section-index:
    textColor: "{colors.accent-text}"
    typography: "{typography.heading}"
  section-note:
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
  cell:
    backgroundColor: "{colors.paper}"
    padding: "{spacing.4}"
  cell-head:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
    fontWeight: 600
    paddingBlock: "{spacing.2}"
    paddingInline: "{spacing.3}"
  cell-action-disabled:
    textColor: "{colors.faint}"
  cell-featured:
    backgroundColor: "{colors.wash}"
    borderColor: "{colors.accent}"
    borderWidth: 2px
  list-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    minHeight: "{spacing.control}"
    padding: "{spacing.3}"
  list-item-hover:
    backgroundColor: "{colors.paper-2}"
  list-item-selected:
    backgroundColor: "{colors.wash}"
    borderColor: "{colors.accent}"
    borderWidth: 3px
  list-item-disabled:
    textColor: "{colors.faint}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.divider}"
    rounded: "{rounded.lg}"
    padding: "{spacing.4}"
    iconSize: 18px
  card-title:
    typography: "{typography.subheading}"
    fontWeight: 600
  card-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
  price:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    fontFamily: "{typography.mono}"
    fontWeight: 700
    unitColor: "{colors.faint}"
    unitTypography: "{typography.label-sm}"
    unitFontWeight: 600
  tab:
    backgroundColor: transparent
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
  tab-hover:
    backgroundColor: "{colors.paper-2}"
  tab-disabled:
    textColor: "{colors.faint}"
  tab-selected-disabled:
    textColor: "{colors.faint}"
    borderColor: "{colors.faint}"
  tab-selected:
    textColor: "{colors.ink}"
    borderColor: "{colors.accent}"
    borderWidth: 2px
    fontWeight: 600
  segment:
    backgroundColor: "{colors.paper-2}"
    borderColor: "{colors.line}"
    textColor: "{colors.soft}"
    typography: "{typography.label}"
    fontWeight: 500
    rounded: "{rounded.md}"
    height: "{spacing.control-sm}"
    padding: 2px
  segment-hover:
    backgroundColor: "{colors.paper}"
  segment-item:
    padding: "{spacing.2.5}"
  segment-selected:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    fontWeight: 600
  segment-selected-disabled:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.faint}"
  segment-disabled:
    textColor: "{colors.faint}"
  dropdown:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.line}"
    rounded: "{rounded.md}"
    padding: "{spacing.1}"
    minWidth: 200px
    iconSize: 14px
  dropdown-item:
    textColor: "{colors.ink}"
    typography: "{typography.body-doc}"
    height: "{spacing.control-sm}"
    padding: "{spacing.2.5}"
  dropdown-item-hover:
    backgroundColor: "{colors.paper-2}"
  dropdown-item-disabled:
    textColor: "{colors.faint}"
  dropdown-group:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
    height: "{spacing.control-xs}"
    padding: "{spacing.2}"
  dropdown-key:
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
  dropdown-divider:
    borderColor: "{colors.line}"
  panel:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.divider}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  panel-head:
    textColor: "{colors.ink}"
    typography: "{typography.subheading}"
    height: "{spacing.control}"
    padding: "{spacing.3}"
    iconSize: 16px
  panel-section-head:
    height: "{spacing.control-sm}"
    padding: "{spacing.2.5}"
    iconSize: 14px
  panel-body:
    padding: "{spacing.3}"
  dialog:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.divider}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "{spacing.5}"
    maxWidth: 440px
  dialog-title:
    textColor: "{colors.ink}"
    typography: "{typography.heading}"
  dialog-lead:
    textColor: "{colors.soft}"
    typography: "{typography.label}"
  dialog-foot:
    borderColor: "{colors.line}"
    paddingBlock: "{spacing.2.5}"
    paddingInline: "{spacing.4}"
  accordion-summary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    fontWeight: 600
    padding: "{spacing.3}"
  accordion-summary-hover:
    backgroundColor: "{colors.paper-2}"
  accordion-body:
    textColor: "{colors.soft}"
    typography: "{typography.label}"
  accordion-mark:
    borderColor: "{colors.faint}"
    size: 18px
  accordion-mark-open:
    borderColor: "{colors.accent}"
  statusbar:
    textColor: "{colors.faint}"
    borderColor: "{colors.line}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
    minHeight: "{spacing.control-sm}"
    padding: "{spacing.4}"
  statusbar-on:
    textColor: "{colors.accent-text}"
  alert:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-text}"
    borderColor: "{colors.wash-line}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.2.5}"
    paddingInline: "{spacing.3}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.1}"
    paddingInline: "{spacing.2}"
    arrowSize: 5px
  tooltip-key:
    textColor: "{colors.divider}"
  appbar:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.divider}"
    height: 48px
    padding: "{spacing.5}"
  brand:
    textColor: "{colors.ink}"
    typography: "{typography.subheading}"
    fontWeight: 600
    iconSize: 22px
  appbar-nav:
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    fontWeight: 500
  appbar-nav-current:
    textColor: "{colors.ink}"
    fontWeight: 600
  nav-item:
    textColor: "{colors.soft}"
    typography: "{typography.body-doc}"
    fontWeight: 500
    rounded: "{rounded.md}"
    height: "{spacing.control-sm}"
    padding: "{spacing.2.5}"
    indent: "{spacing.3}"
    iconSize: 14px
  nav-item-hover:
    backgroundColor: "{colors.paper-2}"
  nav-item-current:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-text}"
    fontWeight: 600
  nav-group:
    textColor: "{colors.ink}"
    typography: "{typography.body-doc}"
    fontWeight: 600
    height: "{spacing.control-sm}"
    padding: "{spacing.2.5}"
  crumbs:
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
    fontWeight: 600
    separatorColor: "{colors.divider}"
  crumbs-current:
    textColor: "{colors.ink}"
  page-kicker:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
    fontWeight: 500
  page-title:
    textColor: "{colors.ink}"
    typography: "{typography.display}"
    fontWeight: 600
  page-meta:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
    fontFamily: "{typography.mono}"
    fontWeight: 500
  page-lead:
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    fontWeight: 400
  prose:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    fontWeight: 400
    blockGap: "{spacing.6}"
    headingGap: "{spacing.10}"
    subheadingGap: "{spacing.8}"
    markerColor: "{colors.accent}"
  prose-code:
    backgroundColor: "{colors.paper-2}"
    typography: "{typography.body-doc}"
    fontFamily: "{typography.mono}"
    fontWeight: 500
    rounded: "{rounded.sm}"
  steps:
    dotColor: "{colors.accent}"
    dotTextColor: "{colors.on-accent}"
    dotSize: 22px
    dotTypography: "{typography.label-sm}"
    dotFontWeight: 600
    lineColor: "{colors.line}"
    gap: "{spacing.5}"
  step-title:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    fontWeight: 600
  callout:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.soft}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.3}"
    paddingInline: "{spacing.4}"
    iconSize: 18px
  callout-title:
    textColor: "{colors.ink}"
    fontWeight: 600
  code:
    backgroundColor: "{colors.paper-2}"
    textColor: "{colors.ink}"
    typography: "{typography.body-doc}"
    fontFamily: "{typography.mono}"
    fontWeight: 400
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.3}"
    paddingInline: "{spacing.4}"
  kbd:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.soft}"
    borderColor: "{colors.edge}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
    fontWeight: 600
    rounded: "{rounded.sm}"
    height: 20px
    padding: "{spacing.1.5}"
  empty:
    textColor: "{colors.soft}"
    borderColor: "{colors.divider}"
    borderStyle: dashed
    typography: "{typography.body}"
    fontWeight: 400
    rounded: "{rounded.lg}"
    paddingBlock: "{spacing.12}"
    paddingInline: "{spacing.5}"
    iconSize: 24px
    iconColor: "{colors.accent-text}"
  empty-title:
    textColor: "{colors.ink}"
    typography: "{typography.subheading}"
    fontWeight: 600
  stat:
    backgroundColor: "{colors.paper-2}"
    rounded: "{rounded.md}"
    paddingBlock: "{spacing.3}"
    paddingInline: "{spacing.4}"
  stat-label:
    textColor: "{colors.faint}"
    typography: "{typography.label}"
    fontWeight: 500
  avatar:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.accent-text}"
    typography: "{typography.body}"
    fontWeight: 600
    rounded: "{rounded.full}"
    size: "{spacing.control}"
  avatar-lg:
    size: 48px
  checklist:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    fontWeight: 400
    markColor: "{colors.accent}"
    markWidth: 2px
  input-figure:
    iconColor: "{colors.faint}"
    iconSize: 14px
  input-figure-invalid:
    iconColor: "{colors.accent-text}"
  btn-stack:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.divider}"
    dividerColor: "{colors.line}"
    rounded: "{rounded.md}"
  card-body:
    padding: "{spacing.4}"
  card-head:
    textColor: "{colors.ink}"
    typography: "{typography.subheading}"
    fontWeight: 600
    padding: "{spacing.4}"
  card-foot:
    textColor: "{colors.faint}"
    borderColor: "{colors.line}"
    typography: "{typography.label}"
    fontWeight: 500
    paddingBlock: "{spacing.2.5}"
    paddingInline: "{spacing.4}"
  footer:
    textColor: "{colors.soft}"
    borderColor: "{colors.divider}"
    typography: "{typography.label}"
    fontWeight: 500
    paddingBlock: "{spacing.8}"
    paddingInline: "{spacing.5}"
  footer-col-title:
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
    fontWeight: 600
  footer-bottom:
    textColor: "{colors.faint}"
    typography: "{typography.label-sm}"
    fontFamily: "{typography.mono}"
    fontWeight: 500
---

# Rabi DESIGN.md

値の SSOT は `rabi.css`。front matter は写しで、直し方は `../SKILL.md`。

CSS 変数名は `--rabi-` + 段の名。`colors` は同名、`typography` のサイズは `t-`・行送りは `lh-`、`rounded` は `r-`、`spacing` の余白は `gap-` を冠する。丈と `spacing.control-*` は同名。例外は `1.5` → `gap-1_5` **だけ**（`.` を CSS の識別子に置けない）。

front matter に出せないものは `rabi.css` だけが持つ —— 影、混色の入力、状態が変わる速さ（一覧は `../scripts/gen-tokens.ts` の `CSS_ONLY`）と、各 token の dark 値。

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

下限を持たないのは、罫の `wash-line` と `line`、および面そのもの（`ground` `paper` `paper-2` `wash` `accent`）**だけ**。`divider` は罫だが吹き出しの上で文字になるので、`ink` の面で 4.5:1 を持つ（「Components」）。`accent-hover` / `accent-active` は `accent` の派生で、同じく面。

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

### 図

面・罫・文字の割り当ては `../assets/rabi-mermaid.js` が持つ。ここへ写さ**ない**。

図のソースへ色を書かない。強調するノードには `accent` クラスを当てる。

```html
<pre class="mermaid">
flowchart LR
  A[前] --> B[後]
  class B accent
</pre>
```

テーマ切替では図を描き直す。印刷は追随しないので、`data-theme="light"` にしてから印刷する。描けない図はソースのまま残る。

### 状態

状態ごとに新しい色を作ら**ない**。部品ごとの値は front matter の `components` の `-hover` / `-active` / `-disabled` / `-invalid` / `-selected` が持つ。ここには何の軸で表すかと、front matter に置けない値だけを書く。

| 状態   | 何を動かすか                                                                                                                           |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| hover  | 赤ベタは地を 1 段暗く。他は地を 1 段動かす —— `paper` の面では `paper-2` へ沈め、`paper-2` の面では `paper` へ浮かせる                 |
| active | hover と同じ軸で、赤ベタだけ 1 段暗く                                                                                                  |
| focus  | 部品の外側の `outline` 1px + `outline-offset` 2px。色は `accent`。地は変え**ない**。切る容器（`overflow: hidden`）の中だけ内側へ寄せる |
| 選択   | 部品の外側の `outline` 2px。色は `ink` で、赤の面の上だけ `accent`。例外は下の 4 つ**だけ**                                            |
| 完了   | 赤ベタと反転した印                                                                                                                     |
| 警告   | 面と文字。入力欄は枠を `accent` にして説明文を添える                                                                                   |
| 無効   | 地・文字・輪郭の 3 つとも下げる                                                                                                        |

選択で地を赤にし**ない**。

状態が変わる速さは `--rabi-motion` の 1 つ**だけ**。段を作ら**ない**。`prefers-reduced-motion` では遷移を消す。

チェック・ラジオ・スイッチの `checked` は**選択では**なく、値が真であることを印そのものが表す。`outline` を使わ**ない**。

選択の印は `aria-selected` でも `aria-pressed` でも受ける。`listbox` / `tablist` / `menu` の role は矢印キーと roving tabindex の操作契約を伴うので、**それを実装してから**名乗る。静的な見本では名乗ら**ない**。

| 部品       | 選択の表し方                                      |
| ---------- | ------------------------------------------------- |
| チップ     | `wash` の面                                       |
| タブ       | `accent` の下罫                                   |
| リスト行   | `wash` の面 + 左の `accent` の帯                  |
| セグメント | 沈めた容器の上に、選択セルだけ `paper` で浮かせる |

focus と、`outline` を使う選択は部品の**外側**に出る。エラー・警告は**枠そのもの**の色。誤りは説明文を必ず添える。色だけで表さ**ない**。

無効を色だけで表さ**ない**。押せないことを形と文言でも示す。

地・輪郭を持たない部品（セル・リスト行・ドロップダウンの行）は、**文字とカーソルと hover** を落とす。持っていない軸は下げようが**ない**。

印と文字が並ぶ部品（チェック・ラジオ・スイッチ）は、印だけでなく**ラベルの文字とカーソルも**落とす。

無効と選択が重なったら、**選択を示すものは残す**。地を選択に使う部品（チップ・セグメント）はその地を保ち、文字と輪郭だけ落とす。消すと状態が読め**ない**。

## Typography

フォントは `--rabi-font`、等幅は `--rabi-mono`。行送りは段ごとに `--rabi-lh-<段>` を持ち、`body` の値は `rabi.css` が `body` の既定として敷く。面が書き直さ**ない**。

| 段           | 用途                                     |
| ------------ | ---------------------------------------- |
| `hero`       | web の表紙。文書では使わない             |
| `display`    | 表紙・スライドのタイトル・価格などの数値 |
| `heading`    | 節見出し。節の番号も同じ段で組む         |
| `subheading` | 小見出し                                 |
| `body`       | UI の本文                                |
| `body-doc`   | 文書の本文（10pt 相当）と、詰めた面の UI |
| `label`      | ラベル・キャプション（`soft` / `faint`） |
| `label-sm`   | ナビ・メタ・帯の小さいラベル             |
| `label-xs`   | 字間を開けた見出しラベル                 |
| `mono`       | 番号・時刻・件数                         |

数値が縦に並ぶ列は右揃え + `font-variant-numeric: tabular-nums`（`.rabi-table` では `.num`）。

段の間のサイズを作ら**ない**。強調は太さで作り、サイズを 1 段上げて代用しない。

太さの上限は 600。**例外は価格の数値だけ**（`price` の 700）—— そこは太字そのものが意匠。

行送りも段から選ぶ。段の外の値を持てるのは、行の高さそのものが意味を持つ面**だけ**（等幅の擬似端末・行送り 1 で組む数値）。

画面幅で伸縮させるときは `clamp()` で段と段の間を補間してよい。禁じているのは**固定値**として段の間を持つこと。

`.rabi-heading` はサイズを持た**ない**。大きさは要素（`h1` / `h2`）が決める。

## Layout

余白は 14 段。段の間の値を作ら**ない**。

**段の名は 4px を 1 とする倍数**。CSS 変数名の規則は冒頭。

刻みは `5` までが 2px、`6` から先が 8px。境の `5` → `6` はどちらでも**ない** 4px。

| 段            | 位置 | 用途                                                               |
| ------------- | ---- | ------------------------------------------------------------------ |
| `1` – `2`     | 内部 | 印と文字の間                                                       |
| `2.5` – `3.5` | 内部 | 部品とリスト行と表のセルの内側                                     |
| `4` – `5`     | 内部 | 部品と部品の間・見出しと中身の間・カードと結合グリッドのセルの内側 |
| `6` – `8`     | 外縁 | 節の内側の余白・まとまりとまとまりの間                             |
| `10` – `14`   | 外縁 | 段組の列の間・節と節の間                                           |

位置は対象で決まる —— 部品・セル・見出しと中身は**内部**、節・まとまり・段組は**外縁**。

内部に `6` 以上を使わ**ない**。面が疎でも密でも変わらない。

外縁で `6`–`14` を使えるのは疎な面**だけ**。密な面は外縁も `5` 以下（疎/密は「深さを使わない面」）。

頁の骨格（天・地・桁割り・頁の顔）は面の密度に依ら**ない**。密度が効くのは節の内側から。

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

タブ・セグメントもボタンと同じ段から選ぶ。丈が決まれば、文字の段も左右の余白も図の寸法も決まる。

| 丈           | 文字       | 左右の余白 | 図   |
| ------------ | ---------- | ---------- | ---- |
| `control-lg` | `body`     | `3`        | 16px |
| `control`    | `body`     | `3`        | 16px |
| `control-sm` | `body-doc` | `2.5`      | 14px |
| `control-xs` | `label`    | `2`        | 14px |

設定画面やエディタのように**値を並べて変える面**は `control-sm` で組む。

figure だけのボタンは幅を丈と同値にする。丈は上の 4 段から選び、独自の寸法を作らない。

表の図に従わ**ない**のは、ボタンと入力で文字と並ぶ図だけ —— 丈に依らない。

セグメントは**例外**。段に載るのは容器で、文字と左右の余白は容器から余白を引いた中のセルの丈で決まる。

丈の段に載るのは、**文字を内包する操作枠**だけ —— ボタン・入力・select・チップ・タブ・セグメントの容器・リスト行。

印そのものが的になる部品（チェック・ラジオ・スイッチ）と、押せない表示（バッジ）は**印の寸法**で組み、丈の段に載せ**ない**。値は front matter の `components`。段を増やす対象では**ない**。

front matter が持つ**寸法**は、その部品を選ぶときに読む値 —— 丈・印の大きさ・図の大きさ・幅の下限と上限・罫の太さ。図形の内側の描き方（チェックの線の長さ、矢印の辺の角度）は実装が持つ。

これがチップとバッジを分ける境。

丈の段が足りないと感じたら、部品の選び方が違う。段を増やさ**ない** —— `control-xs` より小さい操作はボタンでは**なく**、チップ・figure だけのボタン・本文中のリンクで組む。

グリッドは持たない。文書は 1 段組で、幅は読み幅で決める。UI は箱の入れ子で組み、列数を先に決め**ない**。

### 図の置き方

図は 3 通りしか持たない。**選ぶ軸はまとまりが内部構造を持つかどうか**で、図の大きさでは**ない**。

| 置き方             | いつ                   | 文の左端           |
| ------------------ | ---------------------- | ------------------ |
| 左に出す           | 見出し + 本文 2 行まで | 図の右（ぶら下げ） |
| 見出しの行に載せる | 内部構造を持つまとまり | 図の左と同じ       |
| 上に積む           | 表紙・空状態           | 図の左と同じ       |

左に出すのはぶら下げで、まとまりの全行が図の右の列に揃う。価格・箇条書き・ボタンのように内部構造を持つまとまりでは、図が支配するのは 1 行目だけなのに列は下まで残る。そこでは左に出さ**ない**。

図の列の幅は図の寸法と同値にし、まとまりごとに変え**ない**。図と文の間は `1` —— 部品ごとに変え**ない**。

印（開閉・チェック・選択）と文の間は `2`。図の列を図と共有する印は**例外**で、その列の規則に従って `1` で並べる。

図の線幅は文字のステムに合わせる —— `1.2px`。**上に積む図だけ** `1.5px`。部品が決めるのは図の寸法だけで、線幅は図を引く側が持つ。

### 一覧の組み方

同種のものを並べる面は**結合グリッド**で組む。部品を個別の枠で浮かせて並べ**ない**。

- 容器に `border: 1px solid line` と `rounded: lg` と `overflow: hidden` と `e1` を付ける。**外周も内側の罫と同値**（`line`）で、面の境の `divider` にし**ない**
- セルは枠を持た**ない**。容器を `gap: 1px` + `background: line` にして、罫を容器に引かせる
- 押せるセルの hover は地を `paper-2` にする。容器と罫は動かさない。押せないセルは反応させ**ない**。押せるセルは `button` か `a` で組む —— `div` ではキーボードで届か**ない**
- グループ行のセルは地を `paper-2` に沈める（`.rabi-cell-head`）。表の `tr.group` と同じ扱い

**例外は `border-collapse` の表だけ** —— `gap` を持てないので、セルが下罫を持つ（`.rabi-table`）。

実装は `../assets/rabi-components.css` の `.rabi-grid` / `.rabi-cell`。列数は使う側が決める。

```html
<div class="rabi-grid">
  <div class="rabi-cell">…</div>
  <div class="rabi-cell">…</div>
</div>
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

| 密度 | 何                                     | 分け方                      |
| ---- | -------------------------------------- | --------------------------- |
| 疎   | web の表紙・長文を読む面・浮かせる強調 | 層を 2 つ以上使う           |
| 密   | 一覧・表・リスト・サイドバー・文書・帯 | 面の段（`paper-2`）と罫のみ |

同じ製品の中で疎と密が混ざってよい。境目は面の単位で、1 つの面の中で 2 つを混ぜ**ない**。

一覧・表は自分で密の面を作る。外側の節が疎でも、その密度は継が**ない**。

### 影の色

彩度のある面の上では `e1` 〜 `e3` を使わ**ない**。

赤の面の上は `e2-accent` / `e3-accent` を使う。

影の色はこの 2 系統**だけ**。赤以外の彩度のある面を作ら**ない**。

## Shapes

半径は 5 値。段の間の値を作ら**ない**。

**段は要素の大きさで選ぶ**。半径は大きさに対する比で読まれるので、同じ値を印と部品へ使わ**ない**。

| 値     | 何に付くか                                                             |
| ------ | ---------------------------------------------------------------------- |
| 0      | 既定。セル・行・帯・区切り・文書。一覧に無いものもここ                 |
| `sm`   | 印 —— チェック                                                         |
| `md`   | 部品と、浮く操作面 —— ボタン・入力・チップ・ドロップダウン・セグメント |
| `lg`   | 枠になる面 —— カード・パネル・ダイアログ・結合グリッド・一覧           |
| `full` | 円形と丸端の部品 —— ラジオ・点（ステータス・窓）・スイッチ・バッジ     |

`md` を印には使わ**ない**。半径が丈の 1/4 を超えると弧が辺の半分を覆い、ラジオと読み分けられ**ない**。印だけが `sm` を持つ理由はここ**だけ**。

`md` と `lg` は**中身を持つかどうか**で分ける —— 単体の部品と浮く操作面は `md`、その中に部品を並べる枠は `lg`。

セル・行・帯・全面は物体では**ない**ので 0 のまま。結合グリッドは容器だけが `lg` で、中のセルは 0 のまま（「一覧の組み方」）。

全幅に伸びる面は 0。

**面を入れ子にしたときの内側の半径は計算する**。段から選ぶのはいちばん外側の面**だけ**。

| 外側の持ち方              | 内側の半径           |
| ------------------------- | -------------------- |
| `overflow: hidden` で切る | 0（外側が切る）      |
| 余白を空けて内側を置く    | 外側 − 罫 − その余白 |

引くのは**外縁から内側の面までの距離すべて**で、罫の太さも入る。距離が外側の半径以上なら内側は 0。計算した値は段では**ない**ので、他の面へ持ち出さ**ない**。

チェックボックスを丸にし**ない**。checked の印はチェックで、丸ではない。

チェックボックス・ラジオは `appearance: none` で組む。

## Components

値は front matter の `components`、実装は `../assets/rabi-components.css`。ここにはどちらにも置けない規則だけを書く。文書の部品（`.rabi-heading` / `.rabi-table`）だけは `rabi.css` が実装を持ち、front matter に値を持た**ない**。

部品が自分の中でだけ使う値（丈から幅や寄せを導くなど）は、**部品クラスのスコープ**で `--rabi-<部品>-<名>` を宣言してよい。`:root` に立てるのは値のトークン**だけ**で、そこは `rabi.css` の持ち分。

UI を組む媒体では `rabi-components.css` のクラスを使う。部品の一覧はそのファイルの節見出し。

front matter のキーは class 名と 1 対 1 では**ない**。

| front matter          | class                                    |
| --------------------- | ---------------------------------------- |
| `button-*`            | `.rabi-btn` + `.rabi-btn-*`              |
| `checkbox`            | `.rabi-check`                            |
| `field-label`         | `.rabi-field` の**直下**の `label`       |
| `tooltip-key`         | `.rabi-tooltip` の中の `kbd`             |
| `accordion-mark`      | `.rabi-accordion-summary` の `::before`  |
| `accordion-mark-open` | 同上（`[open]` の中）                    |
| `appbar-nav`          | `.rabi-appbar-nav` の中の `a`            |
| `nav-item`            | `.rabi-nav` の中の `a`                   |
| `crumbs` の区切り     | `.rabi-crumbs li + li` の `::before`     |
| `page-title`          | `.rabi-page-head` の中の見出し           |
| `prose-code`          | `.rabi-prose` の中の `code`              |
| `steps` の丸          | `.rabi-steps > li` の `::before`         |
| `checklist` の印      | `.rabi-checklist > li` の `::before`     |
| `button-inline-icon`  | `.rabi-btn:not(.rabi-btn-icon)` の `svg` |
| `input-figure`        | `.rabi-input-wrap` の中の `svg`          |
| `price` の単位        | `.rabi-price-unit`                       |
| `footer-col-title`    | `.rabi-footer-col` の `h2` / `h3`        |
| それ以外              | `rabi-` を冠すだけ                       |

単体では効か**ない**クラスがある。variant は土台と、内側の部品は容器と併記する。

```html
<button class="rabi-btn rabi-btn-sm rabi-btn-primary">主操作</button>
<div class="rabi-select-wrap">
  <select class="rabi-select">
    …
  </select>
</div>
<div class="rabi-segment"><button class="rabi-segment-item">値</button></div>
```

状態は要素の状態と `aria-*` で受かる。class で受けるのは `.rabi-statusbar-on` と `.rabi-field-note-error` **だけ**。

| suffix               | 受け方                            |
| -------------------- | --------------------------------- |
| `-hover` / `-active` | `:hover` / `:active`              |
| `-invalid`           | `aria-invalid="true"`             |
| `-disabled`          | `:disabled`                       |
| `-selected`          | `aria-pressed` か `aria-selected` |
| `-checked`           | `:checked`                        |
| `-current`           | `aria-current`                    |
| `-open`              | `[open]`                          |

front matter にキーを持たないのは、寄せと列だけの構造クラスと、容器が段から引く値（一覧・タブの罫・半径・影は「一覧の組み方」「Shapes」が決める）と、密度の variant。

丈を持つ variant は「Layout」の丈の表の行をそのまま下げる。丈を持たない面（セル・表）の密度は位置の表の段から選び、値は `../assets/rabi-components.css` が持つ。

無い部品は「状態」「Shapes」「Layout」に従ってその場で組む。**`.rabi-` は部品の名前空間**なので、面固有のクラスに冠さ**ない**。繰り返し要るものは `../assets/rabi-components.css` と front matter へ足してから使う。

媒体で読むものが変わる。

| 媒体                             | 読むもの                           | 使える部品                            |
| -------------------------------- | ---------------------------------- | ------------------------------------- |
| UI（web の面・業務 UI）          | `rabi.css` + `rabi-components.css` | すべて                                |
| 文書（見積・譜面・PDF）          | `rabi.css` だけ                    | `.rabi-heading` と `.rabi-table` のみ |
| CSS を持たない（docx・スライド） | 読めない                           | 無し。段と余白を表から読んで当てる    |

文書では表に `.rabi-table` を必ず使う。ナビと操作と状態を持つ面は文書では**ない** —— web の docs は UI に当たり、長文は `.rabi-prose` で組む。

**面**の見出しは 4 つあり、媒体と役で決まる。部品が持つ頭（カード・パネル・ダイアログ）は部品側。

| 見出し                         | 役                                   |
| ------------------------------ | ------------------------------------ |
| `.rabi-heading`                | 文書のタイトルと節。下罫つき         |
| `.rabi-page-head` の中の見出し | 頁の顔。頁に 1 つだけ                |
| `.rabi-section-head`           | web・UI の節。番号と注記を横に並べる |
| `.rabi-prose` の `h2` / `h3`   | 長文の中の見出し                     |

同じ面で `.rabi-heading` と `.rabi-section-head` を両方使わ**ない**。

`rabi.css` をインライン展開すると要素の既定も付く —— `body` の地と文字、`a` の色と下線、フォーム要素の `font-family`、`color-scheme` と `accent-color`。上書きするときは段の中から選ぶ。

- ボタン: 主操作は意味のまとまりに 1 つだけ赤ベタ。残りは二次操作
- ボタンの hover: 地だけ動かす。枠と文字は動かさ**ない**。沈んだ帯（`paper-2`）の上では浮かせる
- カード: 強調は `card-accent`（赤ベタ）。赤の面の上では使え**ない**（「赤を出す場所」）。その面では大きさと影で付ける
- リンク: 本文中は色だけで示さ**ない**。下線を必ず添える。ナビ・ボタン・面全体のリンクは位置と形で分かるので対象外
- リンクの hover: 下線を外す。色は動かさ**ない**
- 入力: 枠の太さは変え**ない**
- チップ: 押せる。分類の色分けをし**ない**。文言で区別する
- バッジ: 押せ**ない**。hover も focus も持たない。状態と件数を示すだけ
- バッジを沈んだ帯（`paper-2`）の上に置くときは輪郭の版にする。地が同じだと見え**ない**
- セグメントの文字の段: 容器では**なく**、中のセルの丈で決まる
- リスト行: hover と選択で同じ面を使わ**ない**（表し方は「状態」）。押せる行は `button` か `a` で組む
- hover は押せるものだけ。押せない面を hover で動かさ**ない**
- 押せる一覧は `paper` の面に置く。`paper-2` の帯に直接置か**ない**
- 表の本文行は**例外**。押せなくても hover で地を `paper-2` にする。合計行とグループ行は除く
- 吹き出し: 地は `ink` のベタ。面の段を使わ**ない**。広い面を `ink` で塗ってよい**唯一の例外**
- 吹き出しの文字: 本文は `paper`、添えるショートカットは `divider`。`divider` を文字に使えるのはこの面**だけ**
- ドロップダウン: 浮く面。区切りは `line` の横罫で、面の段で分け**ない**
- ドロップダウンの行: figure は左端、補足（ショートカット・入れ子の印・チェック）は右端。figure を使うドロップダウンは容器に `.rabi-dropdown-icons` を付け、**全行で**列を確保して文字の左端を揃える
- ドロップダウンの見出し: 行では**ない**ので押せない。hover させ**ない**。行の figure の列にも揃え**ない**
- パネル: 節を積む面。節の見出しはセルのグループ行と同じ帯（`.rabi-cell-head` と同じレシピ）で、右端にその節への操作を置く。帯は `control-sm`、中の操作は `control-xs` の figure だけのボタン。body の中身は面が決める
- 丈を固定した部品は折り返さ**ない**。文字が丈からはみ出す
- 図と文字を並べる部品は、**文字を要素で包む**。テキストノードのままだと図が先か後かを CSS で判定できない
- 端に置く figure だけのボタン: 当たり判定は丈のまま、**図の端**を面の余白の端へ揃える。食い込ませる量は `(丈 − 図) / 2`
- パネルの節境: 帯**だけ**で分ける。帯の上に罫を重ね**ない**（「面と段」）
- 欄: ラベルは `faint`、補足は `soft`、誤りの説明は `accent-text`
- 欄を積む間隔は面の密度で決まる。部品が `control` の面は `4`、`control-sm` の面は `2`（位置の表の**例外**）
- 欄の並べ方は 2 つ。**縦**（ラベル・入力・注記を積む）と**横**（名前と補足を左、操作を右）。狭い面では横が縦へ落ちる
- 節の開閉: 見出しそのものを `summary` にする。印は右端で、開いたら回す
- ダイアログ: 手前の層。面の組み方はカードと同じで、影だけ `e3`。背面は塗ら**ない**
- ダイアログの閉じる: figure だけのボタンを右上の角へ寄せる。表題と同じ行に並べ**ない**
- ダイアログの操作: 下端に右寄せで、主操作は 1 つ。上の罫は面を**突っ切る**（余白の外まで伸ばす）
- 開閉: 印は文の外の列へ出し、問いと答えの左端を 1 本に揃える。開いた印だけ `accent`
- 結合グリッドの強調セル: 内側の上罫で示す。セルの外周と容器は動かさ**ない**
- 価格: 数値は `display` の段を等幅で組み、単位は `label-sm` の `faint`。数値と単位で段を跨がせ**ない**。太さは front matter の `price`
- セグメント: 排他の選択肢を並べる。タブと使い分ける —— タブは現在地、セグメントは値
- セグメントが受ける属性: 頁の現在地に使うなら `aria-current`。印は値の選択と同じ
- セグメントの丈: 段に載るのは**容器**。中のセルは容器の内側に収まるだけで、段に載せ**ない**
- セグメントの容器の余白: 浮かせるための隙間なので余白の段に載せ**ない**。値は front matter の `segment`
- セグメントの hover: 沈んだ容器の上なので `paper` へ浮かせる。選択との差は影と太さと文字色で付け、hover では動かさ**ない**
- ステータスバー: 等幅で組み、文字は `label-sm` の段。地と外周は置く面が持つ。区切りは `line` の縦罫で、境の `divider` にし**ない**
- 密度: 詰めた面では variant を併記する（`.rabi-table-sm` / `.rabi-cell-row`）。面ごとに部品の余白や字の段を直接上書きし**ない**
- 結合グリッドのセルの密度: カードとして並べるなら `.rabi-cell`、**表として**組むなら `.rabi-cell-row`
- 面が要素で指すセレクタ（`.x span`）を、部品の載った要素へ届かせ**ない**。中身の組み方は面の裁量だが、届いた先が部品なら実装が 2 つになる
- 頁の天: brand と横のナビと右端の操作。現在地は太さと文字色で示し、地は動かさ**ない**
- 頁の天は折り返さ**ない**。狭い面では横のナビが縮んで横へ流れる
- 頁の天で余りの幅を食うのは `.rabi-appbar-action` **だけ**。ナビも右端へ寄せたいなら、ナビをその中に入れる
- 縦のナビ: 左のナビも頁内の目次も同じ部品。位置で variant を分け**ない**。密度だけ `-sm` で分ける
- 縦のナビの字下げ: 入れ子の `ul` が持つ。使う側が数値を渡さ**ない**
- 縦のナビの現在地: `aria-current` で受ける。頁のナビは `page`、頁内の目次は `location`。表し方は同じ
- 縦のナビを分ける条件は操作の契約の差**だけ**（roving tabindex・並べ替え・値の選択）。密度と figure の有無では分けない
- 縦のナビの figure: ドロップダウンと同じで、使うなら容器に `.rabi-nav-icons` を付けて**全行で**列を確保する
- パンくず: 区切りは項目の `::before`。要素として置くと読み上げに乗る。最後の 1 つが `aria-current="page"`
- 長文: 積む間隔は `.rabi-prose` が 1 か所で持つ。要素ごとの margin で積ま**ない**
- 長文が組むのは**直下の、class を持たない要素だけ**
- 長文の行送りは `body-doc`。字の段は `body` のまま
- 添え物: 見出しを持つなら `.rabi-callout`、1 行の状態なら `.rabi-alert`。callout には赤を意味として載せ**ない**
- コードの塊: 横に流さず折り返す。読む幅は面が決める
- キー: 紙の面は `.rabi-kbd`（枠つき）、吹き出しの中は `kbd`（枠なし）。1 つにまとめ**ない**
- 何も無い面: 押せる面と枠の形で区別する
- 読むだけの値: 数値は `.rabi-price` を入れる。600 より太い段はそこ 1 か所のまま
- 読むだけのチェック: 入力の `.rabi-check` とは別物。押せ**ない**
- 入力の先頭の図: 包む枠が持つ。誤りと無効は枠が本体から受け取って図へ映す
- 頭・胴・脚を持つカード: 3 つとも**直下**に置く。余白は中の 3 つが持ち、カード自身は持たない
- `.rabi-card-title` は頭・胴・脚のどれとも併用し**ない**。余白の持ち主が 2 つになる
- 赤ベタのカード（`card-accent`）は頭も脚も持た**ない**
- 縦に結合したボタン: 外周だけ丸め、境は 1 本。値の排他選択は `.rabi-segment` で、こちらは値では**ない**
- 頁の地: 上罫で本文と切る。リンクは下線を持た**ない**
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
