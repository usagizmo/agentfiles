# AGENTS.md

## プラン作成・実装方針

- 最終形に不要なコード（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）は初手から書かない
- skill はユーザーが /xxx と言わなくても、下記トリガーに該当したら読んで実行する（規模判定 SSOT は本節）

## task workflow

### 途中確認（単発・必須ではない）

| skill | いつ |
| --- | --- |
| `consult` | 短い確認から設計プランまで。迷ったら。プラン確定時だけ GO 待ち |
| `issue` | 既存不具合・要件外・独立改善で今ブランチに載せると膨らむもの → 切り離し。**今回変更由来の回帰は Issue で消さない** |

聞き先: プロダクト方針 → ユーザー。技術的収束 → アドバイザー。判断主体は実行中のエージェント。

### 仕上げ（実装一段落で規模により必須）

| 規模 | 目安 | 必須フロー |
| --- | --- | --- |
| 軽微 | 局所・低リスク | `commit` のみ可 |
| 中規模 | 意味のある挙動変更（骨格は変えない） | `tidy` → `docs` → `commit` |
| 大規模 | 責務・API・データフロー・永続形式・security/correctness 境界を変える | `review-loop` → `tidy` → `docs` → `commit` |

- 修正で非自明に膨らんだら規模を再判定する
- コミット以降（verify / PR / リリース）はプロジェクトの AGENTS.md / skills に従う

## 共通 rules / skills

| 層 | 置き場 | 役割 |
| --- | --- | --- |
| Global | `~/.agents/rules/` | 製品非依存の原則 + 作業衛生 + default stack（TS/Svelte） |
| Project | `<repo>/.agents/rules/` | 追加・具体化のみ |

- 両書き禁止。矛盾はエラー（例外は成立条件を明示）
- ファイル: `design-principles.md` / `boy-scout.md` / `coding-conventions.md`
- graduate: 同一 project 再発 → project / 複数 project 再発 → global 候補 / 製品非依存 → global（dotfiles は提案のみ）
- skills: `~/.agents/skills/` + harness 固有（union symlink、後勝ち）。Codex の `.rules` は別物
