# コーディング規約

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
- リアクティビティが不要な場合（`$derived` 内の一時変数・定数ルックアップ等）は `new Map` / `new Set` のままで可。ESLint の `svelte/prefer-svelte-reactivity` 警告は `// eslint-disable-next-line svelte/prefer-svelte-reactivity -- <理由>` で抑止し、理由を必ず書く
- TS ファイル内で Rune を使用する場合、ファイル名は `.svelte.ts` にする
