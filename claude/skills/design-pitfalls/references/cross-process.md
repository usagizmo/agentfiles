# クロスプロセス契約

別プロセス / 別言語 にまたがる SSOT drift と silent default の fail-closed 化。

## クロスプロセス SSOT の drift は test の文字列 pin + 相互参照コメントで二重 gate する

同じ identifier（HTTP header 値、event key、URL 定数、shared secret の context 文字列等）を **別プロセス / 別言語** が独立に持つ必要があるとき（Rust Daemon と TS App、Desktop と Web 等）、片方を変えてももう片方は build / lint で気づかない。型 SSOT を契約層に集約する原則がそもそも適用できない（プロセス境界を超えた型共有が成立しない）。

対策は二重 gate:

1. **両端の literal を pin する unit test** を片側に置く（例: ある側で `assert_eq!(SOME_CONSTANT, "expected literal")`）。文字列リテラル自体を test に書き込むことで、定数を変更すると test が必ず失敗する
2. **両端のソース近傍に "Keep in sync with X" コメント**を書き、相互参照の grep 経路を残す（一方の言語のコメントに他方の path、その逆も）

両方単独では弱い: コメントだけだと PR 中に剥がれる、test だけだと反対側の存在を知らない人に届かない。**コメントが grep の入り口、test が drift の検出器**として並立して初めて閉じる。

判定: 「この identifier を片方だけ変更したら、もう片方の build / lint / test で検出されるか？」を自問し、検出されないならコメント + 文字列 pin test の両方を仕込む。

**3 端以上に拡散したら一段抽象化する**: 同じ literal が **TS code + Rust code + リソース JSON + CLI default_value + ドキュメント Markdown** のように 3 端以上に散らばると、pin test を 1 端に置いても他端が test の存在を知らずに drift する（ドキュメント側を grep 漏れで放置するのが典型）。3 端を超える時点で「文字列を直書きする端」を 1 つに減らす設計に倒す: (a) リソース JSON の該当 field を build 時に code 側 const から生成する、(b) CLI `default_value_t` を const 参照にする、(c) ドキュメントの値表記を生成済み JSON への hyperlink に置き換える、等。**「pin test を増やす」のではなく「直書きする端を減らす」が正解**。残った 1〜2 端を pin test + Keep-in-sync コメントで守る。

判定の追加: 「この literal を直書きしている端は何箇所あるか？」を数える。3 以上なら test を増やす前に literal の owner を 1 つに絞る (build-time codegen / 参照渡し)。

## クロスプロセス契約は fail-closed に寄せる（silent default で drift する SDK 最適化を許容しない）

発行側 (issuer) が値を produce しても、SDK / フレームワーク / プロトコルの **silent default** で受信側 (receiver) に伝わらない経路があると、片側だけ更新したときに契約 drift が **無症状で永続化** する。drift 検出は build / lint / test ではなく「本番で挙動が変だ」で初めて気づく — 一番遅い検出経路に倒れている。

silent path の典型:

- **ヘッダの hoist**: AWS S3 presigned URL の `getSignedUrl` は default で `PutObjectCommand` の header value を `X-Amz-SignedHeaders` から外す（hoist して URL 生成側にだけ反映）。client が PUT 時に同じ header を送らなくても URL は valid → R2 オブジェクトメタデータに値が入らない silent failure
- **optional 引数の省略**: presign API のレスポンスに `cacheControl` を optional にすると、client が field を読まずに済む経路ができる
- **暗黙デフォルト**: 関数内で「デフォルト値を持つ optional パラメータ」にすると、caller の意図が明示されず drift する

判定: 「issuer が産んだ値を receiver が読まなくても build / 通常 path が成功してしまうか？」を自問する。Yes なら fail-closed に倒す:

1. **発行側で SignedHeaders / required schema field / response echo を強制**して、receiver に「読まないと URL / payload が成立しない」状態を作る。SDK の最適化を上書きしてでも閉じる
2. **受信側に required field として schema 強制**（Valibot `v.pipe(v.string(), v.minLength(1))` / Rust `String` non-Option / TS の non-optional `cacheControl: string`）。optional にしない
3. **発行側 → 受信側の値の echo** を契約に組み込む（response に値を含めて、receiver が再送する義務がある形にする）。receiver が値を捨てると次の hop で実行時エラーになる極性

「呼び忘れ・順序ミスで破綻する API を作らない」（runtime 状態系の原則）を SDK / プロトコル境界に拡張した版。runtime 系は順序制約を 1 関数に閉じるのが正解だが、SDK 境界は順序ではなく「値の伝播経路」が問題で、こちらは強制注入 + schema 強制 + echo の三段構えで閉じる。

例: ✅ Good — `getSignedUrl(client, command, { signableHeaders: new Set(['cache-control']) })` で SignedHeaders に強制注入し、レスポンスに `cacheControl` を required で含めて返し、Rust 側 `LibraryPresignResult::Upload.cache_control: String` (non-Option) で受け取り、PUT 時に `.header("cache-control", &cache_control)` で再送する。client が `cache_control` field を読まずに PUT すると R2 が SignatureMismatch を返す → 契約違反が **deploy 後の最初のリクエストで実行時エラーとして必ず顕在化** する。

例: ❌ Bad — `PutObjectCommand({ CacheControl: '...' })` を渡して presign URL を発行して終わり。SDK の hoist 最適化で SignedHeaders から外れるため、client が PUT 時に header を忘れても URL は valid。R2 にはメタデータが入らないが PUT は成功する → 数ヶ月後に「キャッシュされてないですね？」で気づく。

**判定フロー**: cross-process / cross-language 契約で値を渡すとき、(1) 発行側の SDK / lib に「silent default で値を捨てる経路」がないか docs を確認、(2) あれば override option を探す（`signableHeaders` / `forceHeaders` / 等）、(3) override が無ければそもそもその SDK の使い方を疑う、(4) override + schema required + echo の三段構えで fail-closed に倒す。
