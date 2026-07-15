---
name: rabi-design
description: >-
  株式会社ラビのブランドスタイル（カラー・フォント・トーン）を適用する。
  Rabi 名義の UI・ドキュメント・スライド・Artifact を作るとき、
  または「Rabiスタイルで」と言われたときに使う。CSS デザイントークンを含む。
---

# rabi-design

Rabi のデザイン仕様。基調はモノトーン＋クリムゾン。rabi.co.jp の黒・白・グレーに赤 1 色だけを持ち込む。

## Colors

値の SSOT は `assets/rabi.css`。ライト値の要約:

| トークン | 値 | 用途 |
| --- | --- | --- |
| `--rabi-accent` | `#DC143C` | クリムゾン。最重要強調・見出し下線・合計行。アクセント専用 |
| `--rabi-accent-soft` | `#FBE4EA` | 強調行・淡背景（クリムゾン太字と組む） |
| `--rabi-ink` | `#1A1A1A` | 本文・見出し |
| `--rabi-soft` | `#595959` | 補足・添え書き |
| `--rabi-faint` | `#8F8F8F` | ラベル・キャプション |
| `--rabi-paper-2` | `#F5F5F5` | 区分見出し・薄地 |
| `--rabi-header` | `#1A1A1A` + 白文字 | 表ヘッダー・帯 |

- 有彩色はクリムゾンのみ。第 2 の色を足さない。強調は太字と地色の濃淡で表す
- ダークモード値も `assets/rabi.css` に定義済み（アクセントは明るく持ち上げる）

## Typography

- フォント: Noto Sans JP（fallback は `assets/rabi.css` の `--rabi-font`）
- 本文 10pt 相当。タイトルはクリムゾン太字 + グレーのサブタイトル
- 見出しは黒太字 + クリムゾン下線

## Voice

- 簡潔・実務的。誇張や装飾語を避ける

## 使い方

HTML / Artifact では `assets/rabi.css` の `--rabi-*` トークンを先頭にインライン展開して使う。表は `.rabi-table` + `tr.group` / `tr.total`。他形式（docx・スライド等）でも上記トークンと Typography に従う。
