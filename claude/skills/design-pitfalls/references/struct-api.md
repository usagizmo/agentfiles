# 派生 struct / 追加系 API

field copy の silent drop・追加系 API の前提条件 gate。

## 派生 struct への field-by-field copy で field を silent に drop しない

`struct A` から `struct B` を作る変換を `B { x: a.x, y: a.y }` のように **手書きの field-by-field copy** で書くと、A 側に新 field（pass-through 用 metadata / extra headers / trace ID 等）が増えたとき、B のコンストラクタに足し忘れても **コンパイラが教えてくれない**。B が下流の依存に渡される pass-through 用 struct（HTTP header の中継、event payload の forwarding、設定 snapshot 等）の場合、足し忘れた field は実行時に silent に消失して観測できない bug を作る。

具体例: 上流 `UpstreamConfig → ClientConfig` の field copy で extra header map を copy し忘れ、上流が貼った認証以外のメタ header（利用元識別 / 計測 / プロバイダー dashboard 用 header 等）が下流経路だけで脱落する。別経路では同 header を別箇所で貼っていたため、grep / lint / unit test では検出できなかった。

対策の優先順位:

1. **B = A + extra fields** の構造にする（`struct B { base: A, model: String }` のように A を内包）。新 field が増えても再 copy 不要。最も drift しにくい
2. それが API 互換等で難しいなら、変換を `impl From<A> for B` に集約し、`..` rest pattern や `Into` を使って未参照 field を残す（Rust の場合は `#[non_exhaustive]` + `..Default::default()` 併用）
3. 1 / 2 が取れず手書き copy を残すなら、A 側に新 field を追加する rules（PR template / CODEOWNERS）に「派生 struct B / C / D への伝搬を確認」を明記する

判定: 「この struct A に新 field が増えたとき、その field が B / C / D に正しく伝搬しないと何が壊れるか？」を自問し、silent に脱落する経路があるなら 1 / 2 で構造的に守る。

## runtime context が必要な API は `async fn` 化で caller に明示要求する

`tokio::spawn` / `tokio::net::TcpListener::from_std` / `tokio::time::interval` のように **ambient runtime handle (`Handle::current()`)** に依存する API を内部で呼ぶ関数を `pub fn` で sync として公開すると、runtime context 外（main thread の setup フック、cli の main、テストの top-level 等）から呼んだ瞬間に `there is no reactor running` で panic する。`async fn body 内で `.await` を 1 つも使わない場合でも、関数を `pub async fn` で宣言する**だけで caller に「await するか `block_on` で wrap するか」を強制でき、context 不整合を型レベルで防げる。

```rust
// ❌ Bad — sync 公開で context 外から呼ばれて panic
pub fn start(port: u16) -> Result<Self, io::Error> {
    let listener = tokio::net::TcpListener::from_std(std_listener)?; // panics
    tokio::spawn(async move { ... });
    ...
}

// ✅ Good — async fn で caller に runtime 接続を明示要求
pub async fn start(port: u16) -> Result<Self, io::Error> {
    let listener = tokio::net::TcpListener::from_std(std_listener)?;
    tokio::spawn(async move { ... });
    ...
}
```

判定: 「この関数 body は ambient runtime に依存しているか？（`Handle::current()` を直接 / 間接的に呼ぶ API を使うか？）」を自問。Yes なら `async fn` に倒し、docstring に「caller の責務: runtime context 内から呼ぶこと」を併記する。`async fn` 化は実行時オーバーヘッドゼロで型 contract が増えるだけ。

## 追加系 API の前提条件 gate は caller ではなく helper の内側に置く

`reqwest::RequestBuilder::header(k, v)`、`Map::push`、`Vec::extend`、SQL の `INSERT` 等、**同じキーで呼んでも上書きせず append される追加系 API** を helper / abstraction の入口で扱うとき、前提条件（protected key の除外、空値の skip、サイズ上限の enforcement 等）を caller に委ねると、新しい caller が gate を呼び忘れた瞬間に silent fail / silent privilege escalation が起きる。

具体例: HTTP client の `header(k, v)` API は同名 header を **append** する。caller が用意する extra header map に `Authorization` を仕込んでから、後段で別の bearer token を `.header()` で貼る pattern は、**両方が並んで request に乗る** silent な credential 上書き経路を作る。caller 側に「extra header map には認証 header を入れないこと」と docstring で書く運用は drift する。

対策: helper trait / extension を 1 箇所だけ作り、その内部で protected key (`Authorization` 等) を **case-insensitive に弾いてから** iterate する gate を埋め込む。caller は helper を呼ぶだけで前提条件が自動適用される。「不変条件の検証は条件分岐より上の層に置く」の helper / extension 版。

```rust
// ✅ Good — gate を helper の内側に閉じる
impl RequestBuilderExt for reqwest::RequestBuilder {
    fn with_auth_and_extras(mut self, key: &str, extra: &HashMap<String, String>) -> Self {
        for (k, v) in extra {
            if PROTECTED_HEADERS.iter().any(|p| k.eq_ignore_ascii_case(p)) { continue; }
            self = self.header(k.as_str(), v.as_str());
        }
        self.header("Authorization", format!("Bearer {}", key))
    }
}
```

判定: 「この追加系 API を新しい caller が直接呼んだとき、gate を忘れたら何が壊れるか？」を自問し、silent failure / 権限昇格に直結するなら helper の内側に gate を畳み込む。
