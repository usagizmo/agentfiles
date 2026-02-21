# コーディング規約

## 言語使用規則

### ユーザー向け (英語で記述)

- UIテキスト（ラベル、ボタン、メニュー）
- エラーメッセージ
- ログメッセージ

### 開発者向け (日本語で記述)

- コードコメント・JSDoc
- テストコード・説明
- 技術文書

## TypeScript/JavaScript 規約

### 型システム

- `any`型禁止 → `unknown`型や適切な型定義を使用
- `interface`より`type`を優先 → 予期しないプロパティの追加を防ぐため
- ジェネリック型・ユニオン型を活用して型安全性を保持

### 言語機能

- optional chaining（`?.`）とnullish coalescing（`??`）の積極活用
- デバッグ用のログ表示は `console.debug` を使用

## Svelte 5 Runes 規約

### リアクティビティ

- 派生値の計算は getter ではなく `$derived` / `$derived.by` を使用する
- リアクティブな Map/Set は `$state(new Map/Set)` ではなく `SvelteMap` / `SvelteSet` を直接使用する

### ファイル命名

- TSファイル内で Rune を使用する場合、ファイル名は `.svelte.ts` にする
