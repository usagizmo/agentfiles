# review-loop 共通手順（SSOT）

書いた diff の不具合・パッチ感・規約違反をアドバイザーで潰す。指摘は命令ではなく精査対象。設計骨格の問い直しは `consult`。

北極星: ゼロベース設計 / 根本解決 / 互換コード排除。

## 手順

### 1. スコープ

- 未コミットあり → working tree（`git diff` + `git diff --cached` + untracked）
- コミット済み feature ブランチ → `git diff <base>...HEAD`
- 迷い → ユーザー確認

### 2. プロンプト

`PROMPT=$(mktemp "${TMPDIR:-/tmp}/review-loop-prompt.XXXXXX")`（ラウンドごと新規）:

```markdown
あなたはコードレビュアーです。コードは変更しないでください。

## レビュー対象
次で変更を把握:
{未コミット: git status --short / git diff / git diff --cached / untracked の中身}
{base 比較: git diff <base>...HEAD}

## 観点
1. ゼロベース設計と一致するか
2. パッチでなく根本解決か
3. 互換 shim / deprecated / dead code が残っていないか
加えて: バグ・エッジ・軸混在 / SSOT・規約違反

## 出力
重要度順「ファイル:行 / 問題 / 推奨修正」。なければ「指摘なし」のみ。nitpick 不要。
```

### 3. アドバイザーに渡す

**harness の `SKILL.md` に従う**。モデル / effort は上書きしない。失敗は隠さない。

### 4. 精査 → 修正

1 件ずつ: 実害か / 根本直しか / 採用・棄却・ユーザー相談。修正後はステップ 2〜4 を再実行。複数アドバイザーなら先に 1 本にマージしてから精査。

### 5. 完走

指摘なし、または残指摘をすべて棄却できるまで。堂々巡りならユーザーに相談。

報告: 修正 / 棄却 / 未解決（欠落アドバイザーがあれば併記）。完走後は `tidy` → `docs` → `commit` へ。
