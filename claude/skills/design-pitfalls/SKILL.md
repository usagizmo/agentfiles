---
name: design-pitfalls
description: >
  軸が異なる値を同じ enum / union に混ぜない、SSOT 集約、orchestration 配置、
  cache event-driven update と view-binning の分離、SSOT positive/negative gate、
  正誤判定の独立 proof、setup+verify 統合、派生 struct field-by-field copy、
  追加系 API の helper-internal gate、クロスプロセス SSOT drift、観測軸が異なる出力 channel、
  機械 caller 向け error 応答 / truncate-safe doc など、設計上の典型的な落とし穴の詳細解説。
  rules `design-principles.md` に各項目の見出しと 1 行サマリだけ常駐し、詳細は本 skill に集約。
  設計レビュー / 落とし穴の判定 / 詳細根拠が必要なときに使う。
  本 skill は全プロジェクト共通の抽象原則のみを扱う。プロジェクト固有の事例集は各プロジェクト側の skill を参照。
---

# 設計の落とし穴（詳細・抽象例）

`~/ghq/github.com/usagizmo/dotfiles/claude/rules/design-principles.md` に各落とし穴の見出しと 1 行サマリが常駐する。本 skill には抽象的な詳細・判定基準・ドメイン中立の例を集約する。

実際のプロジェクトで踏んだ事例（war story）は各プロジェクトの skill に保管し、本 skill はどのドメインからも参照できる粒度に保つ。

## 軸が異なる値を同じ enum / union に混ぜない

discriminated union の variant は「同一の軸」上の分類でなければならない。「種別」と「伝搬形態」と「不在」など異なる次元を同じ union に混ぜると、境界ごとに `Exclude` が必要になり、nested 情報の型が unknown に落ちる。異なる軸は外側で discriminate し、各軸内で独立した union として閉じる。

## 公開 surface と実装層は migration コストの非対称性で軸を分ける

同じドメインでも、公開 surface（IPC method 名 / CLI command / URL path）と実装層（DB column / event key / module ディレクトリ）では rename コストが非対称。surface は dispatch table を 1 つ書き換えれば終わるが、実装層 (DB column / event key / migration を伴う file 名) は version compatibility / migration script が要る。drift を恐れて全層を一斉 rename しようとせず、層ごとに rename タイミングを分けて良い。

ただし命名軸が分かれた事実を **rules SSOT に明記**しないと、次の人が「全層が同じ prefix で揃っている」と誤認する。「公開 surface = X 軸」「実装層 = Y 軸」と表で対比し、grep / 一括 rename を走らせる前に「どの軸の話か」を分類するルールを書き残す。

判定: 「この識別子を rename すると、他端 (DB / 別プロセス / 永続化された設定) との互換性が壊れるか？」を自問し、Yes なら surface と実装層を別軸として運用する。No なら全層揃えて良い。

## スキーマライブラリが表現できるものは手書きしない

serde の `#[serde(tag, rename_all)]`、Valibot の `v.variant` / `v.transform` 等で表現できる JSON shape を、手書きの `to_json()` や手動変換で書かない。手書きは variant 追加時のフィールド名 typo・漏れを型が守らない。schema 属性で自動導出すれば JSON shape が型定義から一意に決まる。

## SSOT は契約層に置き、利用側は派生させる

型と schema を複数箇所で独立に定義すると drift が起きる。schema を契約層（contracts / IPC schema）に集約し、利用側は `v.InferOutput<...>` や `typeof XXX[number]` で派生させる。同じ概念の型を複数モジュールから export しない。

## 実行時状態の持ち主は 1 箇所に集約し、consumer は引数で受け取る

型・schema の SSOT と同じ原則は、**メモリ上の状態 instance**（キャッシュ・検索 index・接続プール等）にも当てはまる。load / persist / mutate を複数モジュールから独立に呼べる設計にすると、同じ state instance が並走してメモリ上の不整合（片方に upsert したのに他方は stale）を生む。

具体策: instance を生成・保持する「持ち主」を 1 モジュールに決め（orchestrator 等）、query / mutate 関数は instance を**引数で受け取る pure ロジック**にする。consumer（UI / 他モジュール）は持ち主越しにアクセスし、独自の load を持たない。lifecycle（初期化・persist debounce・破棄）は持ち主のみが責任を持つ。

判定: 「この state を load / persist できる入口は何箇所あるか？」を自問し、2 箇所以上なら入口を 1 つに寄せる。

## orchestration は event source に近い側で所有する

debounce / coalescing / re-schedule / retry のような orchestration 状態（timer・ticket・in-flight flag・pending set 等）は、event を発火するレイヤ（プロセス / モジュール / SDK）と同じ場所に置く。event source から遠いレイヤで orchestrate すると、(1) event を IPC/message で中継する往復コスト、(2) remote 側のライフサイクル依存（WebView 起動待ち・子プロセス接続待ち）、(3) 起動トリガの重複（同じ event を複数 subscriber が個別に debounce する）が発生する。

**非対称を恐れない**: 同一 domain でも event source が別レイヤに分かれていれば、orchestrator も分かれて良い。無理に 1 レイヤに揃えると「event を中継するためだけの IPC 層」が生まれる。

判定: 「この orchestration state を駆動する event は誰が最初に発火するか？」を自問し、その発火源と同じレイヤに orchestrator を置く。発火源が複数レイヤに跨るなら、レイヤごとに orchestrator を分けて並立させる方が、単一 orchestrator に寄せて中継を増やすより素直。

## 変更通知は「何が変わったか」を同梱した discriminated union で fan-out する

「cache に変化があった」ような情報量ゼロのイベント（`onChange()` / `invalidate()`）は、subscriber に**全 reload を強制**し、incremental update を封じる。代わりに差分を同梱した event（`{ kind: 'upsert' | 'delete', entityId, before, after }` 等）を配信すれば、同じ event を複数用途（UI reconcile / 検索 index upsert / meta 登録）に fan-out できる。

軸が違う variant（削除 vs upsert など、運ぶ情報量・型が違うもの）を単一 record + nullable field で表現すると「`deleted === true ⇔ after === undefined`」のような不変条件が型で守られない。discriminated union にして各 variant の必要 field だけを持たせる（「軸が異なる値を同じ enum / union に混ぜない」の通知レイヤー版）。

## cache は event 駆動で常に最新化、view-binning は UX 境界で gate する

SSOT になる in-memory cache（entity を ID で索引化した Map 等）は event 駆動で**常に最新化**するのが正しい。一方、その cache から派生する **view-state（リスト振り分け Set / sort 済み配列 / グルーピング結果）** をどのタイミングで再計算するかは、データ整合性とは別軸の **UX 要件**で決める。「ユーザー操作の直後に行が視界から消える」のような視覚フィードバックの喪失を防ぎたい場合、event ごとの incremental 振り分けは敢えてやらず、panel mount / tab 切替などの境界（`refresh()` 等の re-bin 入口）で再振り分けする方が美しい。

このとき必ず守る不変条件: **event 駆動で更新する cache は、view-state の現在の所属を「壊さない」値だけを書き込む**。具体的には sort key / group key として使われている field を event で `null` 上書きすると、まだ「現在のグループに居続けている item」が直後に "No timestamp" 等の他グループへ jump する mid-list 故障が起きる。

ただし「既存値が常に正しい」とは限らない。**既存値が non-null（過去の sort key を持っている）のときだけ保持し、null（まだ持っていない）の場合は新値を採用する**。これを無条件に preserve すると、初回 transition（例: false → true への最初の遷移）で新しいタイムスタンプが既存の null に潰され、re-bin 時に "No timestamp" group へ全件流入する逆方向の壊し方が起きる。

判定:

- cache の field を event で上書きする前に、「その field は現在の view-state の sort / group / filter キーとして使われているか？」を自問する。Yes なら preserve 分岐を入れる
- preserve は `existing?.field ?? next.field` で書き、「既存が non-null のときだけ保持」と明示する。三項演算子 `existing ? existing.field : next.field` は existing 自体は存在するが field が null のケースで意図せず null を伝搬する
- view-state を event で incremental update するか境界で再計算するかの選択は、UX 上「変化を即座に見せたい」か「ユーザー操作の途中で勝手に並び替わってほしくない」かで決める。「呼び忘れ・順序ミスで破綻する API を作らない」と矛盾するように見えるが、re-bin trigger を `refresh()` 1 関数に集約し caller を panel mount + 操作切替の 2 箇所に閉じておけば、呼び忘れの面積は十分小さい

例: ✅ Good — entity changed event で ID-keyed Map を最新化するが、sort key 用の timestamp field は `existing?.field ?? next.field` で preserve（既存値があれば位置 jump を防ぎ、null なら新タイムスタンプを採用）。Set 移動は `refresh()` でのみ起きる。
例: ❌ Bad — `existing ? { ...next, field: existing.field } : next`。existing.field が null のときに新値を捨ててしまい、初回遷移で全件 "No timestamp" group に集約される逆向きの故障。
例: ❌ Bad — event で sort key field を `null` で即上書きし、Set 移動も即実行する。操作直後に行が視界から消えてユーザーが「何が起きたか」を見失う。

## 同じ名前空間に異なる責務を混ぜない

モジュール名・prefix・ディレクトリ等の名前空間に複数軸の責務を共存させると、利用者は 1 軸だと誤認し、一方の削除が他方を巻き込む事故が起きる。「軸が違う enum variant を混ぜない」の命名レイヤー版。rename できないなら少なくとも docs で両方の責務を明示する。

## 不変条件の検証は条件分岐より上の層に置く

セキュリティチェック・入力検証など「常に成り立つべき不変条件」は、`#[cfg(unix)]` / `if (platform === 'X')` 等の条件分岐の**内側**ではなく**外側**（プラットフォーム非依存層・共通エントリ）に置く。条件分岐の内側に置くと、新しい分岐（Windows サポート追加等）を実装した人が検証コピーを忘れた瞬間に抜け穴になる。検証を共通層に 1 箇所だけ書けば、分岐追加時に書き忘れる余地がそもそも生まれない。

## 境界の極性はプロダクトの意図に合わせる（許可 vs 除外リスト）

「一部だけ特別扱いする」境界を実装するとき、許可リスト（allowlist）と除外リスト（denylist）のどちらを選ぶかは、**未知の新要素が追加されたときに「特別扱いに入るか／外れるか」のデフォルトがプロダクトの意図と一致する方**を選ぶ。意図と逆方向の極性を選ぶと、新しい要素が追加されるたびに意図せず特別扱いに巻き込まれ（または漏れ）、事故が起きる。

例: 「LP ページだけ多言語 URL prefix を持つ」が意図なら、未知のトップレベルパス（`/robots.txt`, 新しい静的資産等）は**デフォルトで prefix を付けない**のが安全 → 許可リスト方式を選ぶ。除外リストだと新しい静的資産が追加されるたびに意図せず prefix が付き 404 を生む。

判定: 「リストに書き忘れた場合、何が起きるのが safe か？」を自問し、safe 側をデフォルトにする極性を選ぶ。

## 集合 SSOT は positive list と negative list の両端で gate する

ある集合 X（mutation method の集合、purge 対象テーブル、AI に許可する API 等）を SSOT として運用するとき、**X に含まれるべき要素の positive list だけ**でテストすると、「X から不当に除外された要素」（false negative = 入れ忘れ）は検出できるが、「X に不当に含められた要素」（false positive = 誤って入れた）は検出できない。逆もまた然り。

両端の gate（positive list + negative list）を併置して初めて SSOT が双方向に閉じる。`enum / Record<K, true>` で TypeScript の exhaustive check が効くケースは型システムが両端を兼ねるが、test 配列ベースの SSOT では片方向だけだと逆方向の誤分類を見逃す。

判定: 「この list に書き忘れた場合」と「誤って書き加えた場合」の両方の事故シナリオを列挙し、片方しか検出できないなら反対側の gate を追加する。

例: registry handler の `is_mutation` flag を「mutation 候補が positive list にあるか」だけで test すると、read-only handler を誤って mutation 付与した時に `--dry-run` で実 handler 呼び出しが echo に振り替わる正反対の regression を埋め込んでも検出できない。positive list (`known_mutations_are_marked`) と negative list (`known_read_only_are_not_marked`) を併置して両軸を gate する。

「境界の極性はプロダクトの意図に合わせる」が「list そのものをどちら極性で書くか」なのに対し、こちらは「list の **検証** をどちら方向で書くか」。同じ allowlist / denylist でも、入れ忘れ検証と誤投入検証は別軸の gate が必要。

## 正誤判定は独立した cheap proof で行う（副作用の成否に依存させない）

鍵・トークン・構成の「正しさ」を、それを使った実行（復号・通信・I/O）の成功/失敗で間接的に判定する設計は、実行対象が存在しない初期状態で機能しない上、成否の原因が正誤以外（マイグレーション境界・ネットワーク・プロバイダー側のエラー）と混在して区別不能になる。正誤判定専用の **deterministic で cheap な proof**（HMAC・署名・既知平文の検証値など）を別軸で持ち、実行前に判定を完結させる。

E2EE の passphrase 正誤を blob 復号の成否で判定するアンチパターンが典型例: blob 未作成の新規ユーザーでは誤 passphrase を検出できず、silent に不整合 state を量産する。代わりに `HMAC-SHA256(derived_key, context_constant)` を server に保管すれば、鍵そのものを server に送らずに (E2EE 維持) 1 回の HMAC 突合で正誤判定できる。context 定数に version suffix (`-v1`) を付けておけば、将来アルゴリズム変更時に無停止で切り替えられる。

## setup + verify を同じ API に統合する（呼び分けを caller に漏らさない）

「X が未初期化なら setup、初期化済みなら verify」のような分岐は、内部状態の問題であって caller の関心事ではない。setup と verify を別 API / 別 IPC に分けて caller に「hasSetup を先に判定して正しい方を呼べ」と要求すると、呼び忘れ・順序ミスでサイレント故障する（「呼び忘れ・順序ミスで破綻する API を作らない」の具体形）。

単一 API の内部で state を fetch → 分岐 (`None` / `Some + valid` / `Some + invalid` / `Some + stale`) し、caller から見える surface は 1 入力・1 出力に保つ。migration grace のような過渡的 state も分岐の 1 ケースとして内部で吸収する。

## プラットフォームの推奨レールから外れない

ツール・フレームワーク・SDK が公式に推奨する構造（ディレクトリ配置、設定ファイル、ライフサイクル API 等）があるなら、独自の並行構造を作らない。公式レールから外れると、アップデート時の drift・他ツール連携時の不整合・新メンバーの学習コストが累積する。独自構造を選ぶなら「公式では解決できない明確な理由」を docs に明示する。

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

## クロスプロセス SSOT の drift は test の文字列 pin + 相互参照コメントで二重 gate する

同じ identifier（HTTP header 値、event key、URL 定数、shared secret の context 文字列等）を **別プロセス / 別言語** が独立に持つ必要があるとき（Rust Daemon と TS App、Desktop と Web 等）、片方を変えてももう片方は build / lint で気づかない。型 SSOT を契約層に集約する原則がそもそも適用できない（プロセス境界を超えた型共有が成立しない）。

対策は二重 gate:

1. **両端の literal を pin する unit test** を片側に置く（例: ある側で `assert_eq!(SOME_CONSTANT, "expected literal")`）。文字列リテラル自体を test に書き込むことで、定数を変更すると test が必ず失敗する
2. **両端のソース近傍に "Keep in sync with X" コメント**を書き、相互参照の grep 経路を残す（一方の言語のコメントに他方の path、その逆も）

両方単独では弱い: コメントだけだと PR 中に剥がれる、test だけだと反対側の存在を知らない人に届かない。**コメントが grep の入り口、test が drift の検出器**として並立して初めて閉じる。

判定: 「この identifier を片方だけ変更したら、もう片方の build / lint / test で検出されるか？」を自問し、検出されないならコメント + 文字列 pin test の両方を仕込む。

**3 端以上に拡散したら一段抽象化する**: 同じ literal が **TS code + Rust code + リソース JSON + CLI default_value + ドキュメント Markdown** のように 3 端以上に散らばると、pin test を 1 端に置いても他端が test の存在を知らずに drift する（ドキュメント側を grep 漏れで放置するのが典型）。3 端を超える時点で「文字列を直書きする端」を 1 つに減らす設計に倒す: (a) リソース JSON の該当 field を build 時に code 側 const から生成する、(b) CLI `default_value_t` を const 参照にする、(c) ドキュメントの値表記を生成済み JSON への hyperlink に置き換える、等。**「pin test を増やす」のではなく「直書きする端を減らす」が正解**。残った 1〜2 端を pin test + Keep-in-sync コメントで守る。

判定の追加: 「この literal を直書きしている端は何箇所あるか？」を数える。3 以上なら test を増やす前に literal の owner を 1 つに絞る (build-time codegen / 参照渡し)。

`f(string)` と `f(object)` を同一関数で受け、内部で `typeof` 判定して別ロジックに dispatch する設計は、(1) 型推論が `string | object` 起点になり caller 側の補完が弱い、(2) 引数取り違えが silent fail（誤った branch が走り戻り型だけ合う）、(3) 軸（生 SQL vs クエリ DSL、interval vs cron など）の違いが surface 名から消える。surface 名を別関数に分ける（例: `query(opts)` / `sql(sql, params)`、`trigger.interval(s)` / `trigger.cron(expr)`）。同じ動詞でも入力軸が違うなら名前を分ける。「軸が異なる値を同じ enum / union に混ぜない」の関数 surface 版。

## 観測軸が異なる出力チャネルは混ぜない（caller 種別ごとに別 surface に分ける）

同じ関数の出力でも、誰が観測するか（人間 UI / 機械 caller / 下流 pipeline）によって観測軸が違うなら、**1 つの戻り値 / log stream に多重化しない**。観測軸を 1 channel に潰すと、(1) 機械 caller が UI 装飾を parse する hack が生まれる、(2) 人間が機械向け payload を読まされる、(3) 下流 routing が想定外 field に反応する誤発火、が起きる。

観測軸ごとに別 surface を用意し、各 surface は単一の caller 種別を相手にする:

- 機械 caller (AI / 別プロセス / RPC) 向け = 関数 caller セマンティクス（`return` した値だけが見える）
- 人間 UI 向け = display sink（`render` / `print` / `log` 系。caller には届かない）
- 下流 pipeline 向け = routed channel（lane / topic / channel 名で dispatch、caller には届かない）

判定: 「この出力を読むのは誰か？」を出力ごとに自問する。答えが複数あるなら、それぞれを別 surface に分ける。共通の戻り値に「primary」「meta」「display」のような discriminator を載せて 1 channel で送ると、caller が自分に関係ない field を fan-out 先と取り違える事故が起きる。

例: ✅ Good — `return value` が機械 caller に届く tool result、別 API（`render` 系）が UI に届く display、別 channel（`output(name, data)` 系）が下流 pipeline に届く named lane。3 surface とも独立で、互いに泥が飛ばない。
例: ❌ Bad — `return { result, debug, ui }` で 1 channel に多重化し、caller 側で「自分に関係ない field は無視する契約」を docstring に書いて運用する。docstring 規約は型システムで守られないので必ず drift する。

## 機械 caller 向け error 応答は self-repair に必要な情報量を同梱する

LLM / 別プロセス / RPC など「機械 caller」が自律的にリトライする境界で、validation error を underlying serializer / parser の素エラー (`unknown field "X", expected one of "a", "b", ...`) のまま返すと、caller は「次に何を書けば動くか」を文字列推測に頼ることになり、同じ誤りで再試行ループに入る。特に LLM caller は「expected one of ...」を読んでも、自分の context window に残る最初の hallucination パターンに引きずられて同じ field 名を書き直しがち。

機械 caller 向け error 応答には、(1) underlying error 文言（debug 用）、(2) 「次に書くべき正解」を 1 文で示す hint、(3) **valid な minimal example JSON** の 3 点を同梱する。caller は example を mutate するだけで再試行できる。

実装は **catalog 集約方式** が drift しにくい:

- error site (handler / parser) ごとに hint を散らさず、1 ファイルに集約する catalog (`method 名 → InvalidParamsHint`) を作り、入口 helper (`format_invalid_params(method, err)`) 経由で組み立てる
- catalog の coverage は **positive list (AI-facing handler は entry 必須) + negative list (内部限定 handler は entry 禁止)** の両端 gate test で守る（「集合 SSOT は positive list と negative list の両端で gate する」原則の応用）
- catalog key の軸（registry method 名 / internal symbol）と hint テキストの軸（公開 surface 名 / 公開 field 名）は分けて良い: catalog は実装層で identify、hint は caller の観測軸で書く（「公開 surface と実装層は migration コストの非対称性で軸を分ける」原則の error 応答版）
- zero-arg / `unwrap_or` fallback で INVALID_PARAMS 経路を持たない handler は **catalog に dead entry を作らない** ため negative list 側に明示する。両端 gate でなければ気づかない

判定: 「この境界の caller は人間か機械か？」を自問する。機械 caller なら underlying error の素通しは「次に何を書けば動くか」の情報損失を意味する。狭い境界の修復責務を caller に押し付けず、応答側で 1 メッセージに self-repair 情報を畳み込む。

例: ✅ Good — `Invalid parameters: missing field 'foo'. Hint: this method uses 'foo' for the parent identifier; for new children use 'fromTempId' / 'toTempId'. Minimal example: {"foo":"...","children":[...]}`（field 名・典型誤りの言い換え・動く JSON snippet が揃っている）
例: ❌ Bad — `Invalid parameters: unknown field 'fooRef', expected one of 'foo', 'children'`（serde 素エラー素通し。caller は「`fooRef` ではない」しか学べず、別の hallucination に再試行で到達する）

「正誤判定は独立した cheap proof で行う」が**入力の正誤**を判定する原則なら、こちらは**入力が誤っていたときに caller の自己修復に必要な情報を返す**原則。両者は対称で、片方欠けると caller が serializer 素エラー or 副作用試行のどちらかで判定を肩代わりする羽目になる。

## 機械 caller 向け doc は truncate-safe に書く（先頭 N 字で primary API が拾えるか）

機械 caller (LLM / agent runtime) が doc を読むとき、context 節約のために `substring(0, N)` / `head -c N` で truncate される前提が現実的。primary API の (1) signature / (2) 最重要 invariant / (3) minimal example が冒頭 N 字 (~1000 字程度) に揃わないと、caller は API 全体を読めずに field 名を hallucinate する。

構造: `# title` → `## Purpose`（数行以内に圧縮）→ `## Quick Start`（10〜15 行以内、独立して動く example）→ `## API`（詳細）。Quick Start と `## API` 配下の example は **役割を分ける**（前者 = 短い canonical example 1 個 / 後者 = 変則ケース・edge case）。完全コピーを目視で守ると drift する。

判定: 「`head -c 1000` で冒頭を切ったとき、機械 caller が正しく書ける情報が揃うか？」を自問する。揃わないなら冒頭に Quick Start を挿入する。「観測軸が異なる出力チャネルは混ぜない」の doc 入口版で、人間が読むナラティブ doc と機械 caller が拾う fail-safe 冒頭を同じ位置に押し込もうとせず、冒頭は機械 caller 向けに最適化する。
