# 型システム / SSOT 派生

軸の混在・schema 表現・SSOT の置き場所に関する落とし穴。

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

## 関数 surface も入力軸ごとに分ける

`f(string)` と `f(object)` を同一関数で受け、内部で `typeof` 判定して別ロジックに dispatch する設計は、(1) 型推論が `string | object` 起点になり caller 側の補完が弱い、(2) 引数取り違えが silent fail（誤った branch が走り戻り型だけ合う）、(3) 軸（生 SQL vs クエリ DSL、interval vs cron など）の違いが surface 名から消える。surface 名を別関数に分ける（例: `query(opts)` / `sql(sql, params)`、`trigger.interval(s)` / `trigger.cron(expr)`）。同じ動詞でも入力軸が違うなら名前を分ける。「軸が異なる値を同じ enum / union に混ぜない」の関数 surface 版。
