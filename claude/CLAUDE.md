日本語で返答して。

## Git運用
- commitメッセージは絵文字（gitmoji）で開始

## パッケージ管理

- npm/yarn よりも pnpm を優先的に使用します
- package.json の scripts は pnpm での実行を前提とする

## 言語使用規則
### ユーザー向け (英語で記述)
- UIテキスト（ラベル、ボタン、メニュー）
- エラーメッセージ
- ログメッセージ

### 開発者向け (日本語で記述)
- コードコメント・JSDoc
- テストコード・説明
- Gitコミットメッセージ
- プルリクエスト説明
- 技術文書

## コーディング規約
- `any`型禁止 → `unknown`型や適切な型定義を使用
- optional chaining（`?.`）とnullish coalescing（`??`）の積極活用
- ジェネリック型・ユニオン型を活用して型安全性を保持
- デバッグ用のログ表示は `console.debug` を使用
- TSファイル内で $state, $derived など Rune を使用する場合、ファイル名は .svelte.ts にする

## CSS・Tailwind CSS
- `w-*` と `h-*` の値が同じ場合は `size-*` を使用
  - 例: `w-4 h-4` → `size-4`
  - 例: `w-full h-full` → `size-full`

## ドキュメント作成規則
- ドキュメント（.md）を作成する際は、コードよりもMermaid図を優先して使用し、全体感が掴めるようにする
- Mermaidでは以下の図表を適切に使い分ける：
  - `flowchart`: フローチャート・処理の流れ
  - `sequenceDiagram`: シーケンス図・処理の時系列
  - `classDiagram`: クラス図・構造の関係性
  - `stateDiagram`: 状態遷移図・状態の変化
  - `erDiagram`: ER図・データの関係性
  - `journey`: ユーザージャーニー・体験の流れ
  - `quadrantChart`: 象限図・分析・比較
  - `requirementDiagram`: 要件図・機能要件の関係

