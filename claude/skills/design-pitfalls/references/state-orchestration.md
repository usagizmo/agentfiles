# 状態の所有 / orchestration / 通知 / cache

実行時状態の持ち主・event 駆動の orchestration・通知 fan-out・cache と view-binning の分離。

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

## RMW merge は previous の diff を 3 軸目に持つ（append-only ロジックを CRUD に流用しない）

複数プロセス / window が共有する store を Read-Modify-Write で永続化するとき、`current state ∪ latestDisk` の **2 軸 merge** は **append-only collection 専用**（LRU / 最近使った N 件 / event log の蓄積等）。

CRUD 対象（ユーザーが明示削除する model history / favorite list / pinned items 等）に **同じ 2 軸 merge を流用すると**、自プロセスで削除した entry が disk 側に残存していて、それを「他プロセスが追加した」と誤認して merge 結果に復活する silent drift を起こす。runtime error は出ず、UX が「削除しても次の save で蘇る」になって user が混乱する。

判定:

- merge 対象が **append-only か CRUD か** を `MERGE_*` registry の名前 / 型 / 責務として明示する。同じ for ループの分岐内に append-only と CRUD を並列に置くなら、それぞれ別 const + 別 merge 関数で分ける（`MERGE_ARRAY_KEYS` / `MERGE_OBJECT_ARRAY_KEYS` のような軸命名）
- CRUD 対象には `previous → current` の **3 軸目** を導入する。`previousIds - currentIds = deletedIds` を抽出し、`latestDisk` から `deletedIds` を除外する。これで「自プロセスで削除した entry」と「他プロセスがまだ追加していない entry」を区別できる
- merge ロジックは call site の closure 内に直書きせず、pure 関数 `mergeXForRmw(previous, current, latest, key)` に切り出して export し、削除 / 追加 / 衝突 / 全消去 / 初回 save の variant を unit test で SSOT pin する。closure 直書きは「append-only ロジックを後から CRUD 用にコピペ流用される」起点になりやすい

例: ✅ Good — `mergeObjectArrayForRmw(previous, current, latest, uniqueKey)` を pure に切り出し、`deletedIds = previousIds - currentIds` を `latest.filter` から除外。削除が永続化され、他 window の追加は保持される。
例: ❌ Bad — `[...current, ...latest.filter(item => !currentIds.includes(item.id))]` の 2 軸 merge を CRUD 対象に流用。自 window の削除が disk 側残存値で「他 window 追加」扱いされて復活する。
例: ❌ Bad — append-only LRU 用に書いた `MERGE_KEYS` を後から「同じ shared cache だから」と CRUD 対象 (model history 等) にも流用。型 / 責務軸が違うので別 const + 別 merge 関数に分ける必要がある。
