# 設計原則

トップエンジニアが目指す、理想的で美しく合理的な設計を追求する。

## 優先順位（上位が優先）

1. **破壊的変更の推奨**: 部分的パッチより、根本的な改善を優先。不調なコードは完全に削除し、新しい実装に置き換える。動く状態を一時的に犠牲にしても、中途半端な併存（古い実装の温存、feature flag での棚上げ）は選ばない
2. **構造の美しさ**: ドメインに沿った設計、重複の一元管理（SSOT）、既存パターンとの整合性

## 実装方針

- エッジケースまで考慮した完全な実装を目指す
- **抽象化は variant が 2 つ以上の分岐ロジックを実際に持つ時点で導入する**: 1-variant enum / 将来用の予約 variant / dead label は YAGNI 違反。trivial dispatch に落ちたら tidy 段階で容赦なく削る
- **primitive の base 前提を override で打ち消す状況が 2 例以上あれば、variant 追加ではなく feature-local wrapper に切り出す**: 同じ base 前提なら primitive に variant、違う base 前提なら wrapper
- **順序制約・不変条件は docstring ではなく型で固定する**: guard / token / session を struct に束ね、「A の後でしか B できない」を compile time で強制する
- **表示 gate / active-implicit を撤去するときは、暗黙依存を全経路で確認する**: 時間軸（gate が下位 layer の readiness を隠していないか → 全解決経路の直前に単一 preflight）と空間軸（下位 helper が暗黙に active tenant を読んでいないか → owner を 1 回解決し全副作用を同一 owner で駆動）の両方
- **trust boundary を跨ぐ移動は専用 journal を新設せず、既存の delete + create lifecycle SSOT の合成で表現する**: B-first 順序（先に移動先を作る）+ boot 時 reconcile で crash-safety を担保する
- **production / test の振る舞いの差は env var ではなく型 (DI) で表現する**: trait + 必須引数で依存を明示し、test への副作用混入を compile error で構造的に排除する

各原則の詳細な判定基準・事例は `design-pitfalls` skill の `references/deep-dives.md` にある。判定に迷ったときだけ該当項目を読む。

## 設計の落とし穴

軸の混在 / SSOT / orchestration 配置 / cache と view-binning / 正誤判定 / クロスプロセス契約など、設計上の典型的な落とし穴は `design-pitfalls` skill に集約。設計レビュー時・落とし穴の判定が必要なときは skill を参照する。
