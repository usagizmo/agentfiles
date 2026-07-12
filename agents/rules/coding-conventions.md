# コーディング規約（default stack: TypeScript / Svelte 5）

常時適用の薄い default。プロジェクト差分は各 repo の `.agents/rules/{typescript,svelte-runes}.md`。

## TypeScript/JavaScript

- `any` 禁止 → `unknown` または適切な型
- `interface` より `type` を優先
- デバッグログは `console.debug`

## Svelte 5 Runes

- 派生値は `$derived` / `$derived.by`（getter で代替しない）
- リアクティブな Map/Set は `SvelteMap` / `SvelteSet`（リアクティビティ不要なら `new Map` / `new Set` で可。ESLint 抑止時は理由を書く）
- Rune を使う TS ファイルは `.svelte.ts`
