# AGENTS.md

## タスクの進め方

### 途中確認（単発・必須ではない）

- `consult` / `issue` の発動条件は各 skill の description に従う
- 聞き先: プロダクト方針 → ユーザー。技術的収束 → アドバイザー。判断主体は実行中のエージェント。

### 仕上げ（実装一段落で規模により必須）

| 規模 | 目安 | 必須フロー |
| --- | --- | --- |
| 軽微 | 局所・低リスク | `commit` のみ可（agent-facing を含むなら下表） |
| 中規模 | 意味のある挙動変更（骨格は変えない） | `tidy` → `docs` → `commit` |
| 大規模 | 責務・API・データフロー・永続形式・security/correctness 境界を変える | `review-loop` → `tidy` → `docs` → `commit` |

- 実装中に `consult` または `review-loop` を使った場合は、規模に関わらず実装完了時に必ず `tidy` → `docs` → `commit` まで実行する。確認のみで実装しなかった `consult` は対象外
- 修正で非自明に膨らんだら規模を再判定する
- コミット以降（verify / PR / リリース）はプロジェクトの AGENTS.md / skills に従う

#### agent-facing 文（規模と独立）

対象: AGENTS / rules / skills / prompts / references など、モデルに読ませる文。

- 下書きは判断材料の抜け漏れを優先してよい。品質は `docs`（品質パス）が担保する
- コミット前に `docs` を実行し、完了条件で自己判定する。パス未実行なら未完了
- 軽微でも agent-facing を含むなら `docs` → `commit`

## 層契約（rules / skills）

| 層 | 置き場 | 役割 |
| --- | --- | --- |
| Global | 本ファイル（「設計原則」以降の節） | 製品非依存の原則 + 作業衛生 + default stack（TS/Svelte） |
| Project | `<repo>/.agents/rules/` | 追加・具体化のみ |

- 両書き禁止。矛盾はエラー（例外は成立条件を明示）
- graduate: 同一 project 再発 → project / 複数 project 再発 → global 候補 / 製品非依存 → 本ファイルの該当節（dotfiles は提案のみ）
- skills: `~/.agents/skills/` + harness 固有（union symlink、後勝ち）。Codex の `.rules` は別物

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

設計レビュー時、および判定に迷う具体シナリオ（gate 撤去、trust boundary 移動、primitive wrapper 等）は `design-pitfalls` skill を読む。

## ボーイスカウトルール

編集したコードの周辺を、着手前よりも綺麗な状態にする。多少スコープが広がっても、関連する改善（型の厳密化、dead code 削除、重複の共通化など）は同じ変更にまとめる。分量増を理由に後回しにしない。テーマが完全に別・独立レビューが必要な規模だけ Issue 提案に回す。

- dead 判定は grep 結果だけでなく caller chain を実コードで辿る。判別不能ならユーザーに確認する
- 改善した箇所は完了時に簡潔に報告する

## コーディング規約（default stack: TypeScript / Svelte 5）

常時適用の薄い default。プロジェクト差分は各 repo の `.agents/rules/{typescript,svelte-runes}.md`。

### TypeScript/JavaScript

- `any` 禁止 → `unknown` または適切な型
- `interface` より `type` を優先
- デバッグログは `console.debug`

### Svelte 5 Runes

- 派生値は `$derived` / `$derived.by`（getter で代替しない）
- リアクティブな Map/Set は `SvelteMap` / `SvelteSet`（リアクティビティ不要なら `new Map` / `new Set` で可。ESLint 抑止時は理由を書く）
- Rune を使う TS ファイルは `.svelte.ts`
