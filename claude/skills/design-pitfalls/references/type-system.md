# 型システム / SSOT 派生

軸の混在・schema 表現・SSOT の置き場所に関する落とし穴。

## 軸が異なる値を同じ enum / union に混ぜない

discriminated union の variant は「同一の軸」上の分類でなければならない。「種別」と「伝搬形態」と「不在」など異なる次元を同じ union に混ぜると、境界ごとに `Exclude` が必要になり、nested 情報の型が unknown に落ちる。異なる軸は外側で discriminate し、各軸内で独立した union として閉じる。

## variant / constructor の命名軸は経路名ではなく機能軸で取る

discriminated union の variant 名、struct constructor 名 (`for_X` / `non_X` / `from_X`)、enum case 名を「呼び出し経路の名前」(`for_cli` / `for_http` / `for_job`) で取ると、将来「経路 A でも機能 B を扱う」第 3 ケースが来たとき軸が崩れる。「機能軸」(`read_only` / `mutating`、`non_tx` / `in_tx`) で取れば、経路は組み合わせとして導出される。

判定: 「この variant 名を、後から第 3 ケースが来たら何と命名する？」を自問。経路名軸だと「`for_X` の中で『B でない』ケース」のような曖昧な分類になる。機能軸だと「`non_X` を共有して、別軸 (Y / Z) は外側で discriminate」と明示できる。

例: ✅ Good — `Operation::ReadOnly(...)` / `Operation::Mutating(...)`。「副作用の有無」という機能軸。CLI 経路の参照系も HTTP 経路の参照系も同じ `ReadOnly` を共有し、新経路 (job runner / scheduled task 等) が増えても軸は崩れない。
例: ❌ Bad — `Operation::FromCli(...)` / `Operation::FromHttp(...)`。「経路」軸。CLI も HTTP も内部で read / write 両方を扱う事実が名前から読めず、将来「HTTP で mutation を解禁」「CLI に read-only モードを追加」が来たとき名前と意味が drift する。

関連: ファイル名 / モジュール名 / ディレクトリ名も同じ。識別子名は「何をするか」(機能軸) で取り「どこから呼ばれるか」(経路軸) では取らない。同じ機能を複数経路で共有できる事実を名前から読めるようにする。

## 公開 surface と実装層は migration コストの非対称性で軸を分ける

同じドメインでも、公開 surface（IPC method 名 / CLI command / URL path）と実装層（DB column / event key / module ディレクトリ）では rename コストが非対称。surface は dispatch table を 1 つ書き換えれば終わるが、実装層 (DB column / event key / migration を伴う file 名) は version compatibility / migration script が要る。drift を恐れて全層を一斉 rename しようとせず、層ごとに rename タイミングを分けて良い。

ただし命名軸が分かれた事実を **rules SSOT に明記**しないと、次の人が「全層が同じ prefix で揃っている」と誤認する。「公開 surface = X 軸」「実装層 = Y 軸」と表で対比し、grep / 一括 rename を走らせる前に「どの軸の話か」を分類するルールを書き残す。

判定: 「この識別子を rename すると、他端 (DB / 別プロセス / 永続化された設定) との互換性が壊れるか？」を自問し、Yes なら surface と実装層を別軸として運用する。No なら全層揃えて良い。

## スキーマライブラリが表現できるものは手書きしない

serde の `#[serde(tag, rename_all)]`、Valibot の `v.variant` / `v.transform` 等で表現できる JSON shape を、手書きの `to_json()` や手動変換で書かない。手書きは variant 追加時のフィールド名 typo・漏れを型が守らない。schema 属性で自動導出すれば JSON shape が型定義から一意に決まる。

## SSOT は契約層に置き、利用側は派生させる

型と schema を複数箇所で独立に定義すると drift が起きる。schema を契約層（contracts / IPC schema）に集約し、利用側は `v.InferOutput<...>` や `typeof XXX[number]` で派生させる。同じ概念の型を複数モジュールから export しない。

## 関数 surface も入力軸ごとに分ける

`f(string)` と `f(object)` を同一関数で受け、内部で `typeof` 判定して別ロジックに dispatch する設計は、(1) 型推論が `string | object` 起点になり caller 側の補完が弱い、(2) 引数取り違えが silent fail（誤った branch が走り戻り型だけ合う）、(3) 軸（生 SQL vs クエリ DSL、interval vs cron など）の違いが surface 名から消える。surface 名を別関数に分ける（例: `query(opts)` / `sql(sql, params)`、`trigger.interval(s)` / `trigger.cron(expr)`）。同じ動詞でも入力軸が違うなら名前を分ける。「軸が異なる値を同じ enum / union に混ぜない」の関数 surface 版。

## 再生成可能な cache の派生 metadata は per-field tolerant に parse する（締めるのは SSOT 入力だけ）

「Schema 境界は両端対称に締める」は **SSOT 入力**（ユーザー編集ファイル / IPC / API レスポンス）の話で、source of truth ではない **再生成可能な runtime cache**（recents / 展開状態 / 履歴 entry に同梱した外部 catalog 由来の派生メタ — 単価 / capability 等）には別軸で考える。cache 全体を 1 つの strict schema で `safeParse` し、失敗で `{}` に倒す設計だと、nested optional な派生メタ 1 フィールドが schema 進化で旧形式のまま残っただけで、無関係な兄弟フィールド（recents 等）まで連鎖破棄される。

派生メタは `v.fallback(v.optional(X), undefined)` で per-field tolerant にし、**そのフィールドだけ drop して entry / cache 全体は残す**。締めるべきは外部境界の SSOT 入力、緩めてよいのは再生成可能な derived cache メタ、と軸を分ける。判定: 「この値が消えても再取得 / 再計算で復元できるか？ かつ同じ container に無関係な兄弟フィールドが居るか？」が Yes なら fallback で隔離する。これは「互換 shim を書かない」原則とは別物で、特定旧形式を変換するのではなく「未知形式を一律 drop」する一般則。回帰 test で「旧形式 1 件混入 → 当該フィールドだけ undefined・兄弟フィールド生存」の両方向を固定する（fallback を外す regression を構造的に防ぐ）。

## 永続化する identity と volatile な派生 metadata は軸を分け、metadata は persist せず read 時に authoritative source から再水和する

recents / 履歴のような「最近触れた entity」を永続化するとき、entity の **identity（`{id, name}` 等の不変キー）** と、その entity に紐づく **volatile な派生 metadata（pricing / capability / quota 等、別 source が権威で時間変化する値）** を同じ slot に同梱して保存しない。同梱すると (1) metadata が source 側の変化に追従できず stale 化する、(2) 同じ history slot を複数 context が共有する場合、ある context の metadata（例: ある算出方式の集計レンジ値）が別 context（別方式の確定値）へ slot 経由で混入する。

設計の正解は **identity のみ persist し、metadata は read 時に authoritative runtime catalog から毎回再水和する**。書き込み入口（`addToHistory`）で identity に絞り、読み出し入口（`getHistory`）でも旧形式に残った metadata を落とす（identity-only を露出）。consumer（表示 / capability 解決）は authoritative catalog を毎回引いて metadata を組み立てる。前項「per-field tolerant に parse」が *保存はするが parse で drop* なのに対し、本項は *そもそも保存しない* 上位対策で、drift の起点と cross-context 混入を構造的に消す。判定: 「この値の権威 source は history slot 自身か、別の runtime catalog / API か？」が後者なら persist せず再水和に倒す。
