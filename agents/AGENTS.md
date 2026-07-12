# AGENTS.md

## プラン作成・実装方針

- 最終形に不要なコード（feature flag / deprecated alias / 互換 shim / 後で削除する前提の温存コード）は初手から書かない
- skill は **ユーザーが /xxx と言わなくても**、下記トリガーに該当したら自分から読んで実行する（発動条件の **規模判定 SSOT は本節**。各 skill の description は本節を参照する）

## task workflow

### 途中確認（単発・必須ではない）

| skill | いつ |
| --- | --- |
| `consult` | 短い「これでいい？」から深い設計プランまで。迷ったら。プラン確定時だけ GO 待ち |
| `issue` | 既存不具合・要件外・独立改善で、重く今ブランチに載せると膨らむもの → 切り離し。**今回変更由来の回帰・受け入れ失敗は Issue で消さない**（直す / スコープ縮小 / 撤回が PR blocker） |

聞き先: プロダクト方針 → ユーザー。技術的に収束する問い → アドバイザー（構成は harness の skill 定義）。判断主体は常に実行中のエージェント。

### 仕上げ（実装が一段落したら規模で必須）

ユーザーが仕上げを指示しなくても、実装完了時点で規模を判定して実行する。**規模の SSOT は下表**（ファイル数は補助指標。挙動・契約リスクを優先）。

| 規模 | 目安 | 必須フロー |
| --- | --- | --- |
| 軽微 | 局所的で挙動・契約リスクが低い（typo・設定値・単純な 1 箇所修正） | `commit` のみ可 |
| 中規模 | 意味のある挙動変更だが、責務・API・データフロー・永続形式・security/correctness 境界の骨格は変えない | `tidy` → `docs` → `commit` |
| 大規模 | 責務・API・データフロー・永続形式・security/correctness 境界を変える（多ファイルの機能実装・リファクタを含む） | `review-loop` → `tidy` → `docs` → `commit` |

- `tidy` / verify 後の修正などで **非自明な挙動変更やスコープ拡大**が出たら、その時点の diff で規模を再判定する（毎回 `review-loop` に機械的に戻さない）
- コミット以降（verify / PR / リリース）は **プロジェクトの AGENTS.md / skills** に従う

## 共通 rules / skills

- 永続ルール: `~/.agents/rules/`（設計は `design-principles.md`、整理は `boy-scout.md`、実装は `coding-conventions.md`）
- task workflow: `~/.agents/skills/` と harness 固有 skill。各 harness の skills 入口は inventory の source 列（`agents/skills` + `harnesses/shared/skills` + harness 固有）の union symlink（後勝ち）
- Codex の `.rules` は command approval 用で、ここでの設計・実装 rules とは別物
