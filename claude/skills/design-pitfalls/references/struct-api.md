# 派生 struct / 追加系 API

field copy の silent drop・追加系 API の前提条件 gate。

## 派生 struct への field-by-field copy で field を silent に drop しない

`struct A` から `struct B` を作る変換を `B { x: a.x, y: a.y }` のように **手書きの field-by-field copy** で書くと、A 側に新 field（pass-through 用 metadata / extra headers / trace ID 等）が増えたとき、B のコンストラクタに足し忘れても **コンパイラが教えてくれない**。B が下流の依存に渡される pass-through 用 struct（HTTP header の中継、event payload の forwarding、設定 snapshot 等）の場合、足し忘れた field は実行時に silent に消失して観測できない bug を作る。

具体例: 上流 `Config → ClientConfig` の field copy で extra header map を copy し忘れ、上流が貼った認証以外のメタ header（プロバイダー dashboard 上の利用元識別 header 等）が下流経路だけで脱落する。別経路では同 header を別箇所で貼っていたため、grep / lint / unit test では検出できなかった。

対策の優先順位:

1. **B = A + extra fields** の構造にする（`struct B { base: A, model: String }` のように A を内包）。新 field が増えても再 copy 不要。最も drift しにくい
2. それが API 互換等で難しいなら、変換を `impl From<A> for B` に集約し、`..` rest pattern や `Into` を使って未参照 field を残す（Rust の場合は `#[non_exhaustive]` + `..Default::default()` 併用）
3. 1 / 2 が取れず手書き copy を残すなら、A 側に新 field を追加する rules（PR template / CODEOWNERS）に「派生 struct B / C / D への伝搬を確認」を明記する

判定: 「この struct A に新 field が増えたとき、その field が B / C / D に正しく伝搬しないと何が壊れるか？」を自問し、silent に脱落する経路があるなら 1 / 2 で構造的に守る。

## 追加系 API の前提条件 gate は caller ではなく helper の内側に置く

`reqwest::RequestBuilder::header(k, v)`、`Map::push`、`Vec::extend`、SQL の `INSERT` 等、**同じキーで呼んでも上書きせず append される追加系 API** を helper / abstraction の入口で扱うとき、前提条件（protected key の除外、空値の skip、サイズ上限の enforcement 等）を caller に委ねると、新しい caller が gate を呼び忘れた瞬間に silent fail / silent privilege escalation が起きる。

具体例: HTTP client の `header(k, v)` API は同名 header を **append** する。`extra_headers` map に `Authorization` を仕込んでから後段で別の bearer token を `.header()` で貼る pattern は、**両方が並んで request に乗る** silent な credential 上書き経路を作る。caller 側に「`extra_headers` には認証 header を入れないこと」と docstring で書く運用は drift する。

対策: helper trait / extension を 1 箇所だけ作り、その内部で protected key を **case-insensitive に弾いてから** iterate する gate を埋め込む。caller は helper を呼ぶだけで前提条件が自動適用される。「不変条件の検証は条件分岐より上の層に置く」の helper / extension 版。

```rust
// ✅ Good — gate を helper の内側に閉じる
impl ProviderRequestExt for reqwest::RequestBuilder {
    fn with_provider_auth(mut self, key: &str, extra: &HashMap<String, String>) -> Self {
        for (k, v) in extra {
            if PROTECTED_HEADERS.iter().any(|p| k.eq_ignore_ascii_case(p)) { continue; }
            self = self.header(k.as_str(), v.as_str());
        }
        self.header("Authorization", format!("Bearer {}", key))
    }
}
```

判定: 「この追加系 API を新しい caller が直接呼んだとき、gate を忘れたら何が壊れるか？」を自問し、silent failure / 権限昇格に直結するなら helper の内側に gate を畳み込む。
