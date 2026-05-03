# 正誤判定 / setup+verify 統合 / プラットフォームレール

正誤の独立 proof・setup と verify の単一 API・公式構造への準拠。

## 正誤判定は独立した cheap proof で行う（副作用の成否に依存させない）

鍵・トークン・構成の「正しさ」を、それを使った実行（復号・通信・I/O）の成功/失敗で間接的に判定する設計は、実行対象が存在しない初期状態で機能しない上、成否の原因が正誤以外（マイグレーション境界・ネットワーク・プロバイダー側のエラー）と混在して区別不能になる。正誤判定専用の **deterministic で cheap な proof**（HMAC・署名・既知平文の検証値など）を別軸で持ち、実行前に判定を完結させる。

E2EE の passphrase 正誤を blob 復号の成否で判定するアンチパターンが典型例: blob 未作成の新規ユーザーでは誤 passphrase を検出できず、silent に不整合 state を量産する。代わりに `HMAC-SHA256(derived_key, context_constant)` を server に保管すれば、鍵そのものを server に送らずに (E2EE 維持) 1 回の HMAC 突合で正誤判定できる。context 定数に version suffix (`-v1`) を付けておけば、将来アルゴリズム変更時に無停止で切り替えられる。

## setup + verify を同じ API に統合する（呼び分けを caller に漏らさない）

「X が未初期化なら setup、初期化済みなら verify」のような分岐は、内部状態の問題であって caller の関心事ではない。setup と verify を別 API / 別 IPC に分けて caller に「hasSetup を先に判定して正しい方を呼べ」と要求すると、呼び忘れ・順序ミスでサイレント故障する（「呼び忘れ・順序ミスで破綻する API を作らない」の具体形）。

単一 API の内部で state を fetch → 分岐 (`None` / `Some + valid` / `Some + invalid` / `Some + stale`) し、caller から見える surface は 1 入力・1 出力に保つ。migration grace のような過渡的 state も分岐の 1 ケースとして内部で吸収する。

## プラットフォームの推奨レールから外れない

ツール・フレームワーク・SDK が公式に推奨する構造（ディレクトリ配置、設定ファイル、ライフサイクル API 等）があるなら、独自の並行構造を作らない。公式レールから外れると、アップデート時の drift・他ツール連携時の不整合・新メンバーの学習コストが累積する。独自構造を選ぶなら「公式では解決できない明確な理由」を docs に明示する。
