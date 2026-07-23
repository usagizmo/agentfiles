# AGENTS.md

## タスクの進め方

- 規模の定義（各 skill が参照する SSOT）:

| 規模 | 定義 |
| --- | --- |
| 軽微 | 挙動を変えない局所変更（typo・コメント・等価リファクタ） |
| 中規模 | 挙動変更あり（バグ修正を含む。局所でも該当。骨格は変えない） |
| 大規模 | 責務・API・データフロー・永続形式・security/correctness 境界を変える |

- コミット以降（verify / PR / リリース）はプロジェクトの AGENTS.md / skills に従う

## 層契約

| 層 | 置き場 | 役割 |
| --- | --- | --- |
| Global | 本ファイル（「設計原則」以降の節） | 製品非依存の原則 + 作業衛生 + default stack（TS/Svelte） |
| Project | `<repo>` の AGENTS.md / skills | 追加・具体化のみ |

- 両書き禁止。矛盾はエラー（例外は成立条件を明示）
- graduate: 同一 project 再発 → project / 複数 project 再発 → global 候補 / 製品非依存 → 本ファイルの該当節
- skills: `~/.agents/skills/` + harness 固有（union symlink、後勝ち）

## 設計原則

トップエンジニアが目指す、理想的で美しく合理的な設計を追求する。

優先順位（上位が優先）:

1. **根本解決を優先**: 部分パッチで済ませず、原因側を直す。明示された互換契約・migration・外部 API 安定性がある場合はそれを守る
2. **構造の美しさ**: ドメインに沿った設計、重複の一元管理（SSOT）、既存パターンとの整合性

実装方針:

- **不変条件・順序制約は型で固定する**（コメントや env に頼らない）
- **抽象化は実際の分岐が 2 つ以上あるときだけ入れる**。1-variant / 将来予約 / dead label は作らず、trivial になったら削る
- **最終形に不要なコードは初手から書かない**（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）
- **production / test の差は型 (DI) で表す**（env bypass で分岐しない）

## ボーイスカウトルール

編集したコードの周辺を、着手前よりも綺麗な状態にする。多少スコープが広がっても、関連する改善（型の厳密化、dead code 削除、重複の共通化など）は同じ変更にまとめる。分量増を理由に後回しにしない。テーマが完全に別・独立レビューが必要な規模だけ Issue 提案に回す。

- dead 判定は grep 結果だけでなく caller chain を実コードで辿る。判別不能ならユーザーに確認する
- 改善した箇所は完了時に簡潔に報告する

## コーディング規約（default stack: TypeScript / Svelte 5）

常時適用の薄い default。プロジェクト差分は各 repo の AGENTS.md / skills。

### TypeScript/JavaScript

- `any` 禁止 → `unknown` または適切な型
- `interface` より `type` を優先
- デバッグログは `console.debug`

### Svelte 5 Runes

- 派生値は `$derived` / `$derived.by`（getter で代替しない）
- リアクティブな Map/Set は `SvelteMap` / `SvelteSet`（リアクティビティ不要なら `new Map` / `new Set` で可。ESLint 抑止時は理由を書く）
- Rune を使う TS ファイルは `.svelte.ts`
