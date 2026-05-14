---
name: design-pitfalls
description: >
  軸が異なる値を同じ enum / union に混ぜない、SSOT 集約、orchestration 配置、
  cache event-driven update と view-binning の分離、SSOT positive/negative gate、
  正誤判定の独立 proof、setup+verify 統合、派生 struct field-by-field copy、
  追加系 API の helper-internal gate、クロスプロセス SSOT drift、観測軸が異なる出力 channel、
  機械 caller 向け error 応答 / truncate-safe doc、
  lock 内副作用回避 (分類 / 副作用 2 フェーズ分離)、flag と外部観測状態の併用
  など、設計上の典型的な落とし穴の詳細解説。
  rules `design-principles.md` に各項目の見出しと 1 行サマリだけ常駐し、詳細は本 skill に集約。
  設計レビュー / 落とし穴の判定 / 詳細根拠が必要なときに使う。
  本 skill は全プロジェクト共通の抽象原則のみを扱う。プロジェクト固有の事例集は各プロジェクト側の skill を参照。
---

# 設計の落とし穴（index）

詳細・判定基準・例は `references/` 配下。該当テーマだけを Read する。

実プロジェクトで踏んだ war story は各プロジェクト側 skill に保管し、本 skill はドメイン非依存の粒度に保つ。

## `references/type-system.md` — 型システム / SSOT 派生

- 軸が異なる値を同じ enum / union に混ぜない
- variant / constructor の命名軸は経路名ではなく機能軸で取る
- 公開 surface と実装層は migration コストの非対称性で軸を分ける
- スキーマライブラリが表現できるものは手書きしない
- SSOT は契約層に置き、利用側は派生させる
- 関数 surface も入力軸ごとに分ける

## `references/state-orchestration.md` — 状態の所有 / orchestration / 通知 / cache

- 実行時状態の持ち主は 1 箇所に集約し、consumer は引数で受け取る
- 同じ collection を走査する propagation は走査骨格を helper 1 本に集約する
- 並列 init path に inline bind を重複して書かない (one-time setup と per-execution reset を別 helper に分ける)
- 対象を取る command / handler の入口は target を明示パラメータで受ける
- orchestration は event source に近い側で所有する
- 変更通知は discriminated union で fan-out する
- cache は event 駆動で常に最新化、view-binning は UX 境界で gate する
- lazy singleton cache は success だけ永続 cache、rejection は捨てる
- cache / 展開状態 / in-flight token は 1 つの invalidate 入口で同時 purge する
- 非同期 read-then-commit pipeline は monotonic global token で commit gate する
- RMW merge は previous の diff を 3 軸目に持つ（append-only ロジックを CRUD に流用しない）
- lock 内では分類のみ実行し、副作用関数は lock 解放後に呼ぶ
- flag は時間軸の状態のみ。「self / external」識別は外部の観測可能な状態と併用する

## `references/naming-validation.md` — 名前空間 / 不変条件 / 境界の極性

- 同じ名前空間に異なる責務を混ぜない
- 不変条件の検証は条件分岐より上の層に置く
- 境界の極性はプロダクトの意図に合わせる
- 集合 SSOT は positive list と negative list の両端で gate する

## `references/correctness-security.md` — 正誤判定 / setup+verify / プラットフォームレール / 認証経路

- 正誤判定は独立した cheap proof で行う
- setup + verify を同じ API に統合する
- プラットフォームの推奨レールから外れない
- セキュリティ validation のエラー応答は外向き generic / 内向き構造化に軸分離する
- 並列 counter check は INSERT-then-check + ROLLBACK で atomic にする
- fail-open / fail-closed のスイッチは環境で明示分岐する
- 双方向参照を持つ load 経路は fire-and-forget で cycle を断つ
- CORS / CSRF は認証経路ごとに検証軸を分ける
- build 時に値が不明な allowlist は runtime narrow gate で締める（CSP wide + navigation exact の二段 gate）
- CSP allowlist は実態に合わせて最小化、先取り allow をしない
- inline は CSP の主敵 → 静的化できるなら codegen で外す

## `references/struct-api.md` — 派生 struct / 追加系 API

- 派生 struct への field-by-field copy で field を silent に drop しない
- runtime context が必要な API は `async fn` 化で caller に明示要求する
- 追加系 API の前提条件 gate は caller ではなく helper の内側に置く

## `references/cross-process.md` — クロスプロセス契約

- クロスプロセス SSOT の drift は test 文字列 pin + 相互参照コメントで二重 gate
- クロスプロセス契約は fail-closed に寄せる

## `references/output-channels.md` — 出力チャネル / 機械 caller 向け応答

- 観測軸が異なる出力チャネルは混ぜない
- 出力 channel の filter は produce 入口に置く、consume 出口に置かない
- 機械 caller 向け error 応答は self-repair に必要な情報量を同梱する
- 機械 caller 向け doc は truncate-safe に書く
