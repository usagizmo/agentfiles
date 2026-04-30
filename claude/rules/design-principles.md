# 設計原則

トップエンジニアが目指す、理想的で美しく合理的な設計を追求する。

## 優先順位（上位が優先）

1. **破壊的変更の推奨**: 部分的パッチより、根本的な改善を優先。不調なコードは完全に削除し、新しい実装に置き換える。動く状態を一時的に犠牲にしても、中途半端な併存（古い実装の温存、feature flag での棚上げ）は選ばない
2. **構造の美しさ**: ドメインに沿った設計、重複の一元管理（SSOT）、既存パターンとの整合性

## 実装方針

- エッジケースまで考慮した完全な実装を目指す

## 設計の落とし穴（要約）

各項目の詳細・実例・コード例は `~/.claude/skills/design-pitfalls/SKILL.md` を参照。

- **軸が異なる値を同じ enum / union に混ぜない** — 軸を混ぜると `Exclude` の応酬で nested 型が unknown に落ちる。軸ごとに union を分け外側で discriminate
- **公開 surface と実装層は migration コストの非対称性で軸を分ける** — surface は dispatch table 1 つで rename 完了、実装層 (DB / event key / migration) は version 互換が要る。一斉 rename を恐れず層ごとに分けて良い
- **スキーマライブラリが表現できるものは手書きしない** — `serde(tag, rename_all)` / Valibot `v.variant` / `v.transform` で表現できるものを手書き `to_json()` で書かない
- **SSOT は契約層に置き、利用側は派生させる** — schema を contracts に集約、利用側は `v.InferOutput<...>` / `typeof XXX[number]` で派生
- **実行時状態の持ち主は 1 箇所に集約し、consumer は引数で受け取る** — load / persist / mutate 入口が 2 箇所以上ならメモリ整合が壊れる。query / mutate は instance を引数で受ける pure ロジックに
- **orchestration は event source に近い側で所有する** — debounce / coalescing / retry を event source から遠いレイヤに置くと中継 IPC・ライフサイクル依存・トリガ重複を生む
- **変更通知は discriminated union で fan-out する** — 情報量ゼロの `onChange()` は全 reload を強制する。差分（kind / before / after）を同梱
- **cache は event 駆動で常に最新化、view-binning は UX 境界で gate する** — sort / group key にしている field を event で null 上書きしない。`existing?.field ?? next.field` で preserve、re-bin は `refresh()` 1 関数に集約
- **同じ名前空間に異なる責務を混ぜない** — モジュール名 / prefix / ディレクトリに複数軸を共存させない
- **不変条件の検証は条件分岐より上の層に置く** — `#[cfg(unix)]` / `if (platform === 'X')` の内側ではなく外側（共通エントリ）に置く
- **境界の極性はプロダクトの意図に合わせる** — 許可リスト / 除外リスト。「リストに書き忘れた場合 safe か？」を自問し safe 側をデフォルトにする
- **集合 SSOT は positive list と negative list の両端で gate する** — 入れ忘れ検証と誤投入検証は別軸の gate が必要
- **正誤判定は独立した cheap proof で行う** — 鍵 / トークンの正誤を副作用の成否で間接判定しない。HMAC / 署名で deterministic に判定
- **setup + verify を同じ API に統合する** — 内部状態の問題を caller に漏らさない。1 surface 内で `None` / `Some + valid` / `Some + invalid` / `Some + stale` を分岐
- **プラットフォームの推奨レールから外れない** — 公式構造があるなら独自並行構造を作らない
- **派生 struct への field-by-field copy で field を silent に drop しない** — `B = A + extra` の包含構造、または `impl From<A> for B` + rest pattern で守る
- **追加系 API の前提条件 gate は caller ではなく helper の内側に置く** — `RequestBuilder::header` のような append API は protected key を helper 内で弾く
- **クロスプロセス SSOT の drift は test 文字列 pin + 相互参照コメントで二重 gate** — 3 端以上に拡散したら literal の owner を 1 端に絞る (build-time codegen)
- **観測軸が異なる出力チャネルは混ぜない** — 人間 UI / 機械 caller / 下流 pipeline は別 surface
- **機械 caller 向け error 応答は self-repair に必要な情報量を同梱する** — underlying error + hint + minimal example JSON。catalog 集約方式 + positive/negative gate test
- **機械 caller 向け doc は truncate-safe に書く** — 冒頭 N 字 (~1000) に signature / invariant / minimal example を揃える
