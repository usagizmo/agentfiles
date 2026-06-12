# ボーイスカウトルール

編集したコードの周辺を、着手前よりも綺麗な状態にする。

## 許容する改善

以下の改善は積極的に行う:

- 型の厳密化（`any` → 適切な型）
- 不要な変数・インポートの削除
- 命名の改善（より意図が伝わる名前へ）
- 早期リターンへの変換
- マジックナンバーの定数化
- 軽微なコードスタイルの統一
- 互換性維持のためだけの古い記述の削除（未使用の再export、deprecatedコード等）
- 不要なコード・ファイルの削除（dead code、空ファイル、スタブのみのファイル等）
  - dead 判定は grep / 棚卸し agent の結果だけでなく、caller chain を実コード (`Read`) で辿って確認する。同じ prefix / 命名規則を持つ API でも責務軸が違う並列 layer (例: `sync_X_*` と `sync_Y_*` のように名前が似ていても叩く endpoint と sync 対象が違う) の可能性があるため。判別不能ならユーザーに確認する
- 周辺コードの共通化・抽象化（重複ロジックの統合、共通パターンの抽出）

## sub-agent への作業委任

agent に大量 entry の機械的変換 (一括 rename / 構造化 migration 等) を委ねるときは、spec を以下の軸で書く:

- **機械的変換** (パターン置換・enum variant 移行) と **judgment-heavy 作業** (実体型を Params struct から読んで refine する / dead 判定 / reason 文言を書く) は **1 task に混ぜない**。混ぜると agent は低 precision の方に倒れ、judgment-heavy 側が placeholder (`"unknown"` / `"TODO"` / 同一文言の reason) で素通りする
- 必要 precision を spec に明示する。「Params struct を読んで実型を埋める」「placeholder のまま残さない」「reason は entry 個別の rationale」のような expectation を literal で書く
- 大量 entry の同名 placeholder (`"Step 3c migration placeholder"` / `ts_type: "unknown"` 等) が残る経路は、commit 直後に `git grep` で検出して必ず潰す。tidy phase まで残すと当該 commit に永続化される
- 機械的変換と judgment-heavy を分離する場合は 2 task に分け、agent への spec も分ける (機械的変換 task → judgment-heavy refine task の順)
- **rename / 構造変換時に agent が docstring・コメントの「コード参照」を捏造する罠**: agent は rename に合わせて docstring を「それっぽく」書き換える過程で、**実在しないコードパス / guard / フィールドを発明する** (例: rename 後の名前で `intercept_rn_call に prefix guard がある` のような guard を実体が無いのに docstring に書く)。機械的 rename を委ねた後は、**policy / 挙動 / 不変条件を説明する docstring・コメントを実コードと突き合わせて検証する** (該当ファイルを `Read` し、参照されている関数・guard・分岐が実在するか確認)。spec にも「docstring の挙動説明は実コードに存在する構造のみ書く。存在しない guard / path を補完しない」と literal で書く。これは placeholder 素通り (上記) とは別軸の失敗モードで、placeholder より発見が遅れる (もっともらしく読めるため)

## スコープ判断

周辺改善の変更が大きくなりそうな場合:

1. まず一定の調査を行い、改善の全体像と影響範囲を把握する
2. 同じ PR / ブランチで解決できないかを最優先で検討する。多少分量が増えても、関連する変更ならまとめて入れる方が望ましい
3. それでも明らかにスコープを超える（テーマが完全に別、影響範囲が広く独立してレビューすべき等）場合に限り、最終手段として調査結果をもとに GitHub Issue の作成を提案する

## 報告

改善した箇所は完了時に簡潔に報告する。
