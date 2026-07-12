# 設計原則

トップエンジニアが目指す、理想的で美しく合理的な設計を追求する。

## 優先順位（上位が優先）

1. **根本解決を優先**: 部分パッチや互換 shim / feature flag 棚上げより、原因側を直す。明示された互換契約・migration・外部 API 安定性がある場合はそれを守る
2. **構造の美しさ**: ドメインに沿った設計、重複の一元管理（SSOT）、既存パターンとの整合性

## 実装方針

- エッジケースまで考慮した完全な実装を目指す
- **不変条件・順序制約は型で固定する**（コメントや env に頼らない）
- **抽象化は実際の分岐が 2 つ以上あるときだけ入れる**。1-variant / 将来予約 / dead label は作らず、trivial になったら削る
- **production / test の差は型 (DI) で表す**（env bypass で分岐しない）

判定に迷う具体シナリオ（gate 撤去、trust boundary 移動、primitive wrapper 等）は `design-pitfalls` skill（`references/deep-dives.md`）を読む。

## エージェント向け文書

モデルに読ませる文（AGENTS / rules / skills / prompts 等）の品質基準と手順は `docs` skill（品質パス）が SSOT。

## 設計の落とし穴

軸の混在 / SSOT / orchestration / 型で固定 / cache・async / correctness / output は `design-pitfalls` skill に集約。設計レビュー時に参照する。
