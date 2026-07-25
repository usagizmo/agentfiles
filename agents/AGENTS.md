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

| 気づきの性質 | 反映先 |
| --- | --- |
| 製品非依存の原則・作業衛生・default stack（TS/Svelte） | 本ファイル |
| skill の手順・基準・skill 間の棲み分け | 該当する共通 skill |
| その project 固有 | project の AGENTS.md / skills（上の追加・具体化のみ） |
| 特定 harness の起動・配線に依存する | その harness の設定側。本ファイルには書かない |

- 両書き禁止。矛盾を見つけたら適用せず報告する（例外は成立条件を明示）
- 作業中に気づいた改善は上表に従って反映する。一回限りの判断は上げず、再利用できる判断だけを上げる。自明な修正はその場で直し、判断が要るものはユーザーに提案する
- project 差分は skill 単位にも効く: 同名 `<skill>-project` skill が存在すれば、本体 skill は自分の手順を始める前にそれを invoke し、追加・具体化のみ適用する。基準・手順・完了条件を緩める記述は適用せず報告する。`<skill>-project` は単体では invoke しない

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
