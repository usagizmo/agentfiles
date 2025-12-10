日本語で返答して。

## 言語使用規則

### ユーザー向け (英語で記述)

- UIテキスト（ラベル、ボタン、メニュー）
- エラーメッセージ
- ログメッセージ

### 開発者向け (日本語で記述)

- コードコメント・JSDoc
- テストコード・説明
- 技術文書

## コーディング原則

- YAGNI: 将来使うかもしれない機能は実装しない
- DRY: 重複するコードは必ず関数化・モジュール化する
- KISS: 複雑な解決策より単純な解決策を優先する

## コーディング規約

### TypeScript/JavaScript 一般

- `any`型禁止 → `unknown`型や適切な型定義を使用
- `interface`より`type`を優先 → 予期しないプロパティの追加を防ぐため
- optional chaining（`?.`）とnullish coalescing（`??`）の積極活用
- ジェネリック型・ユニオン型を活用して型安全性を保持
- デバッグ用のログ表示は `console.debug` を使用
- プライベートフィールド・メソッド: `#` を使用、`private` は禁止
  - 例外: シングルトンパターンの `private constructor` のみ許可
- readonly vs #prop + getter の使い分け:
  - `readonly prop`: 初期化後に一切変更しない値（constructor 引数など）
  - `readonly prop = $derived(...)`: 派生値（初期化時に依存値が確定している場合）
  - `#prop` + `get prop()`: 内部で変更される状態を読み取り専用で公開
  - `#prop`（非公開）: 内部でのみ使用
- 早期リターンは `if (...) { return; }` ではなく `if (...) return;` の1行形式を使用する

### Svelte 5 Runes 規約

- 派生値の計算は getter ではなく `$derived` / `$derived.by` を使用する
  - 単純な式の場合は `$derived(...)` を直接使用する
  - 複雑な計算や条件分岐が必要な場合のみ `$derived.by(() => ...)` を使用する
- リアクティブな Map/Set は `$state(new Map/Set)` ではなく `SvelteMap` / `SvelteSet` を直接使用する
- TSファイル内で Rune を使用する場合、ファイル名は `.svelte.ts` にする
