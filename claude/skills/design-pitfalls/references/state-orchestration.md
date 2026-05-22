# 状態の所有 / orchestration / 通知 / cache

実行時状態の持ち主・event 駆動の orchestration・通知 fan-out・cache と view-binning の分離。

## 実行時状態の持ち主は 1 箇所に集約し、consumer は引数で受け取る

型・schema の SSOT と同じ原則は、**メモリ上の状態 instance**（キャッシュ・検索 index・接続プール等）にも当てはまる。load / persist / mutate を複数モジュールから独立に呼べる設計にすると、同じ state instance が並走してメモリ上の不整合（片方に upsert したのに他方は stale）を生む。

具体策: instance を生成・保持する「持ち主」を 1 モジュールに決め（orchestrator 等）、query / mutate 関数は instance を**引数で受け取る pure ロジック**にする。consumer（UI / 他モジュール）は持ち主越しにアクセスし、独自の load を持たない。lifecycle（初期化・persist debounce・破棄）は持ち主のみが責任を持つ。

判定: 「この state を load / persist できる入口は何箇所あるか？」を自問し、2 箇所以上なら入口を 1 つに寄せる。

**「ロード済み instance の取得」も 1 関数に集約する**: 「cache HIT 分岐」「load promise 待ち」「index resolve + 新規 instance 化」の 3 経路を caller ごとに inline で書くと、「不在時の戻り値」「例外時の挙動」「resolve 失敗時の扱い」が caller ごとに drift する。`ensureLoaded(id): Promise<T | undefined>` のような 1 入口に集約し、関数全体を try/catch で囲んで「entity 不在」「resolve 失敗」「load 失敗」をすべて `undefined` に揃える。caller は undefined チェック 1 軸だけ処理すればよい。

## 下位 SSOT への薄い delegate facade を上位 struct に置かない

下位 SSOT struct（orchestrator / store / repository / manager）の method を、上位 struct（`AppState` / `DaemonState` / `Context` 等）が `self.inner.X()` の 1 行で delegate するだけの薄い wrapper は **作らない**。

理由:

- 上位 struct の API surface が肥大化し、「同じ概念に名前が 2 つ」になる（`state.set_X(...)` と `state.inner.set_X(...)` が併存）
- rename / signature 変更のたびに 2 ファイル touch する drift コスト
- caller から見て「state.rs に並ぶ method の中で、どれが上位 struct が所有する state を触り、どれが下位 SSOT への pass-through か」が見えなくなる
- 下位 SSOT を「隠す」効果はほぼ無い（上位 struct の field を `pub` で expose する前提なら、caller が `state.inner_X.method()` を直接呼べる）

判定: 上位 struct に method を足す前に「この method は upper struct が所有する state を触るか？ それとも `self.inner.X()` を呼ぶだけか？」を自問する。後者なら field を `pub` にして caller に直接呼ばせる。「下位 SSOT を隠すこと」自体は目的にしない。別 module の caller を抑止したいなら下位 struct 側の `pub(crate)` で visibility を表現する（Rust の場合）。

例外: 上位 struct が「依存先 instance + 同期プリミティブ（lock / semaphore）」を組み合わせて atomic 操作を提供する場合は thin pass-through ではなく **意味ある合成** なので残す（`acquire_lock + inner.write + release` 等）。

例: ✅ Good — handler が `state.sync_orchestrator.set_version(key, v)` を直接呼ぶ。state.rs に薄い `state.set_sync_version(...)` wrapper は無く、上位 struct にはプロセス lifecycle に固有な field（秘密鍵 / device 識別子 / Arc 共有）だけが残る。
例: ❌ Bad — state.rs に N 個の `pub fn delegate_X(&self, ...) { self.inner.X(...) }` を並べ、caller を `state.X(...)` で揃える。rename 時に「下位 method 名と state.rs wrapper 名と caller N 箇所」の 3 軸で drift が発生する。

## 同じ collection を走査する propagation は走査骨格を helper 1 本に集約する

state owner が持つ collection (`Map<id, store>` 等) に対して複数の propagation 関数 (creation 反映 / deletion 反映 / rename 反映 / changes 反映) を書く場合、走査骨格 (entries iterate + skip 条件 chain) を各関数に個別に書くと、skip 条件 (self / not-loaded / 種別違い / 対象外 id 等) の 1 つを追加・修正したときに N 箇所の drift が起きる。skip 条件は SSOT として `forEachX(target, visit)` の helper に集約し、各 propagation は visit closure 内の差分 (mutation 内容) だけを表現する。

判定: 「同じ collection を、同じ skip 条件 chain で走査する関数が 2 つ以上あるか？」を自問。Yes なら走査骨格を helper に切り出し、call site は mutation 差分だけを書く設計に倒す。新しい propagation 関数を増やすたびに 5 行の skip 条件をコピーしないこと。

## 並列 init path に inline bind を重複して書かない (one-time setup と per-execution reset を別 helper に分ける)

「同じ runtime contract (例: embedded script engine の global register / DB schema apply / IPC handler 登録 / mock injection) を bind する init path が物理的に 2 本以上ある」ときは、bind を inline で重複して書かず共通 helper に SSOT 化する。新しい contract を追加するとき、片方の init path にだけ追加して drift する事故が必ず起きる。

具体例: 「1 回限り使い捨ての runtime」と「複数 execution で reuse する runtime」(あるいは「per-request new connection」と「pooled connection」) のように物理的に並列な init path を持つケース。両 path で inline に同じ register block を書くと、新しい binding を追加する PR が片方にしか触らず、もう片方の経路で `not defined` 系 runtime error が出る。

判定: 「同じ contract を bind する init path が 2 本以上あるか？」を自問。Yes なら次の順で対処する:
1. **経路を 1 本に統合できるなら統合する** (helper SSOT は経路本数が物理的に複数必要な場合の妥協策)。例: 「使い捨て path」を内部で「reuse path」を 1 回呼ぶだけにできるなら統合
2. 統合できないなら、bind 行を `const SETUP: ... = "..."` / `fn register_X(...)` に切り出し、両 path から呼ぶ。helper の存在自体が次に追加する人への gate になる (helper のシグネチャを増やさないと binding は追加できない)
3. **one-time setup と per-execution reset を別 helper に分ける**。同じ block に混ぜると、「再利用経路で setup を毎回再実行 (重複 / 性能劣化)」「使い捨て経路で reset 呼び忘れ」の drift が起きる。具体的には:
   - one-time: runtime 生存期間中 stable な register (関数 binding / schema 定義 / handler 登録 / bridge 設置)
   - per-execution: バッファのリセット、per-call context (実行 ID / input / 認証情報 / trigger 種別) の inject

例: ✅ Good — `register_runtime_globals(ctx)` (one-time) + `reset_execution_state(ctx)` (per-execution) + `set_execution_input(ctx, input)` (per-execution) に分け、`run_once = register + reset + input + body`、`init_pool = register のみ`、`run_in_pool = reset + input + body` と組み立てる。3 経路すべてが同一シーケンスに揃う。

例: ❌ Bad — `run_once` と `init_pool` の中で 2 つの似た register block を inline で書く。新 binding 追加 PR が片方にしか追加されず drift。

regression test の張り方: 「片方の init path で動く」test は drift を catch しない。**両方の init path をそれぞれ exercise する test を pin として持つ** (例: `pool_path_binds_X_so_Y_works` のように経路と機能の組み合わせを名前に出す)。helper 化した後でも、helper を呼び忘れたケースを catch するために pin が必要。

## 対象を取る command / handler の入口は target を明示パラメータで受ける（implicit "current active" を黙って読まない）

per-row context menu / clicked tab / selected list item など、「ユーザーがクリックした対象」を起点に走る command は、target id / path を **caller が明示パラメータで渡す**。command 内で `manager.activeXxx` / `store.currentXxx` のような **implicit "current active" state を黙って読み込むと**、clicked target と active target がズレた瞬間に wrong-target で実行される silent bug を生む。

具体例: 行 N の右クリック context menu から開いた dialog が、`activeRow` (= 別の行 M) の id / path を渡してしまう。clicked row と active row が同じケースが多いため UI 上気付きにくく、active row が裏で他フローに切り替わったエッジケースだけで再現する。

対策: command の params に `targetId` / `path` のような target を required field として持たせ、caller (各 menu item の onSelect / 各 row click handler) が clicked target を確実に渡す。`activeXxx` fallback はキーバインディング入口（target が暗黙に「現在 focus している view」になるのが UX として正しい場合）にだけ残し、UI 上で target が一意に決まる入口（per-row menu / per-tab menu）には fallback を許さない。

判定: 「この command を呼び出す入口は target を一意に特定できるか？」を自問し、Yes（per-row / per-clicked-element）なら params に target を required で受ける。No（global keybinding / palette）なら active fallback を許可するが、その場合は params を `optional` にして「明示が無いことを caller が宣言する」極性に倒す。

例: ✅ Good — `command.open({ targetId, path })` を context menu の onSelect から「clicked row 自身が持つ id / path」を直接渡す。clicked row と active row が異なっていても wrong-target にならない。
例: ❌ Bad — `command.open({ targetId })` の中で `manager.active.row.path` を読む。clicked row ≠ active row のときに別 entity を対象にする silent bug。

関連: per-row context menu の各 item の visibility は、その item が呼ぶ command の前提条件（必須 field を持つか / 特定 kind 限定か など）と一致させる。前提条件を満たさない target で item が見えていると、click で no-op / throw する dead button になる。Svelte なら `{#if precondition}` で gate するのが SSOT。

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

## lazy singleton cache は success だけ永続 cache、rejection は捨てて再試行可能にする

「app 起動中固定の値を IPC で 1 度だけ取って以降は cached promise を返す」 lazy singleton（render server URL、daemon 設定、user profile 等の一度きり init data）で、**rejection した promise も永続 cache すると、初期化順 race で 1 度失敗したら復旧できない**。Tauri setup での state 登録が WebView load より遅れる、daemon 接続が起動直後に間に合わない等の transient な失敗で、その後の全 consumer が永続的に rejected を握る故障モード。

正しい polarity: **成功した promise だけ永続 cache、rejection は cache を捨てる**。最初の caller は失敗を観測するが、次の caller (= 次の component mount / 次の invoke) は新しい promise を試せる。「再試行」の責務を caller に委ねず cache layer 側で「次回呼び出しは init からやり直す」を表現する。

```ts
let cached: Promise<T> | undefined;

export function getValue(): Promise<T> {
  if (!cached) {
    const pending = invokeOnce();
    cached = pending;
    // rejection 時は cache を捨てる。pending を await 中の caller は失敗を観測するが、
    // 次の getValue() 呼び出しは新しい invoke を発火できる。
    pending.catch(() => {
      if (cached === pending) cached = undefined;
    });
  }
  return cached;
}
```

判定: 「この cache は初期化 race / transient failure からの自己復旧が必要か？」を自問。Yes（init 順依存・daemon 接続待ち・filesystem 一時的 unavailable 等）なら success-only cache に倒す。No（pure 計算結果 / 同一入力で常に同じ結果）なら rejection も含めて cache してよい。

注意: `pending.catch(...)` での cache clear は **pending を直接 await している caller の rejection 観測を妨げない**（`pending.catch(handler)` は新しい promise を返すだけで元 promise の状態を変えない）。catch handler 内の `if (cached === pending)` は、catch が走るまでの間に別の caller が成功 invoke を cache に上書きしているケース（極稀）を守る。

## 削除 / 送信 intent の outbox は一時的失敗で物理削除しない（backoff schedule で durable retain）

remote 側に「削除して欲しい」「送信して欲しい」という intent を保持する local outbox（例: remote 同期対象の delete outbox / push queue）は、**一時的失敗（network / 429 / 5xx）と恒久的 ack（200 / 404 / 410）を異なる軸で扱う**。前者は attempts cap で物理削除してはいけない — 削除すると local の正本（trash / clear）と remote の状態が恒久的に分岐する。

正しい設計:

- **物理削除してよいのは server ack のみ**: 200 (削除成功) / 404 / 410 (server に既に無い = idempotent ack) で row を消す。これ以外は intent を残し続ける
- **一時的失敗は backoff schedule で row を保持**: `attempts` を +1 し `last_attempt_at = now()` を更新。次の polling では backoff が経過した row のみ pull する
- **backoff schedule の SSOT 1 つから派生**: Rust const `&[(min_attempts, wait_secs)]` を SSOT にし、Rust の `backoff_secs(attempts)` と SQL の `WHERE last_attempt_at IS NULL OR julianday(...) >= CASE WHEN attempts >= N THEN ...` の両方を同じ const から生成する（手書きで二重管理しない）
- **dead-letter table は作らない**: 「outbox か dead-letter か」を caller が判別する必要が出て複雑度が増す。同 table で attempts に応じて retry 間隔を伸ばすだけで quiet retry 化（例: ≥10 attempts → 24h backoff）に倒せば、intent durability と運用 noise の両立ができる
- **threshold 跨ぎで 1 度だけ CRITICAL log**: `entry.attempts < THRESHOLD && new_attempts >= THRESHOLD` で初回到達を検出し、運用通知に拾わせる。以降は backoff で quiet retry が続くため、log は撃たない

判定: 「retry を諦めた瞬間に local と remote の整合は復旧できるか？」を自問。No なら attempts cap で物理削除する設計は invariant 違反。failure mode が「永久に retry が続く noise」になっても intent を残す方が、不整合より遥かに修復しやすい。

例: ❌ Bad — `if attempts > MAX { DELETE FROM outbox WHERE ... }`。network 障害 10 回連続で intent が消え、対象 entity が remote に残り続ける（他端末から「削除済みのはずの note が pull される」恒久分岐）。
例: ✅ Good — `UPDATE outbox SET attempts = attempts + 1, last_attempt_at = now() WHERE ...` のみ。物理削除は ack 経路だけ。`SELECT ... WHERE julianday(now()) - julianday(last_attempt_at) >= backoff(attempts)` で due な row だけ pull する。

## cache / 展開状態 / in-flight token は 1 つの invalidate 入口で同時 purge する

event 駆動 cache を持つ component で、commit 済み cache・UI 展開状態 (expanded set)・非同期 read の in-flight token を別々の lifecycle で扱うと、subtree purge 漏れ・展開状態の後追い復活・古い read 結果のゾンビ commit が並走 race として露呈する。「event を受けたら cache を invalidate」だけ書いて expanded set / in-flight token を放置すると、subtree 削除後にユーザーが folder を再 toggle した瞬間に古い children が "expanded だから" の理由で復活する。

判定:

- path / id 単位の invalidate 入口を 1 関数 (`invalidateForPath(p)` / `purgeSubtree(id)` 等) に集約し、cache・展開状態・in-flight token の 3 state を **prefix match で同時 subtree purge** する。「key 一致のみ」だと subtree の孫が残る
- 親 dir / 親 entity の reload 対象判定は `cache.has(parent) || inFlight.has(parent)` で「commit 済み + in-flight 両方」を「UI が関心を持つ対象」に含める。片方だけだと in-flight 中の event を取りこぼし、reload が走らない

例: ✅ Good — filesystem watcher (or 同等の外部 event 源) が emit したら `invalidateForPath(eventPath)` で 3 state を subtree prefix purge。親 reload は `dataCache.has(parent) || inFlightTokens.has(parent)` で判定。
例: ❌ Bad — `dataCache.delete(eventPath)` のみ。展開状態の Set に残った旧エントリで再 toggle 時に古い children が復活、in-flight token Map に残った read が後から commit してゾンビ表示。

## 非同期 read-then-commit pipeline は monotonic global token で commit gate する

per-path / per-id counter は delete + reuse で token 衝突する (同 path で複数回 invalidate → readDir すると token 値が一致して古い結果が "最新" と誤認)。`++nextToken` の **global 単調増加 token** を `Map<path, latestToken>` に保存し、async read の commit 時に `currentMap.get(path) === capturedAtStart` を check する。

判定:

- token は global monotonic にする。per-key counter は reuse で衝突する
- invalidate 時に `tokenMap.delete(path)` しても安全。新規 read は必ずより大きい token を取るため、in-flight な古い結果は commit gate で必ず弾かれる
- commit 直前の check は `tokenMap.get(path) === captured` (strict equality)。`>` 比較は「invalidate 中に値が下がる」前提を要求し fragile

例: ✅ Good — `let token = ++nextToken; tokens.set(key, token); const result = await read(key); if (tokens.get(key) !== token) return; cache.set(key, result)`
例: ❌ Bad — per-key counter `tokens.set(key, (tokens.get(key) ?? 0) + 1)`。delete + reuse で token 1 が複数 invocation に重複し、古い読みが新しい invocation の token で commit される

**独立軸は token を分ける**: 同一 entity の中で「存在軸 (create / delete / restore)」と「title / metadata 軸 (rename)」のように独立して変化する次元が複数ある場合、単一 generation でまとめると片軸の bump で他軸の async commit を過剰廃棄する (例: rename のたびに進行中の create resolve を全捨て)。軸ごとに別 sentinel (`existenceGen` / `titleEpoch`) を持ち、async commit 時に「自分が依存した軸の sentinel」だけを check する。content commit は existence 一致のみ要求し、title 反映行に追加で title epoch を check して stale title 上書きだけを防ぐ。

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

## lock 内では分類のみ実行し、副作用関数は lock 解放後に呼ぶ

複数 callback / 副作用関数を順次呼ぶ処理 (filesystem watcher の 2-pass 分類 → 種別ごとの handler 呼び出し、event loop の dispatch、scheduler tick の trigger 実行 等) で、**state lock を保持したまま callback を呼ぶ**と、callback の内部から同じ lock を再取得する経路で deadlock する。`std::sync::Mutex` は re-entrant ではないため、callback が深い call stack を経て state を mutate する関数を呼んだ瞬間に hang する。

判定:

- 分類フェーズ (model 更新 + 決定済み action のリストアップ) を lock 内、副作用フェーズ (emit / IO / handler dispatch) を lock 解放後の 2 段階に分ける。`Action` enum で決定済み action を表現し、`Vec<Action>` に積んでから lock を drop して iterate する
- 「副作用関数の中で何の lock を取りうるか」を caller 側で把握する必要がある状態は脆い。**副作用関数は lock を持たない前提で書く**契約にすれば caller の知識量を最小化できる
- 内部 model を mutate する callback も、引数で `&mut HashMap` を渡すと caller が lock を保持し続ける羽目になる。代わりに `&Arc<Mutex<HashMap>>` を渡して内部で **短期間 lock** する設計にすれば、callback chain の途中で長 lock を持ち回さない

例: ✅ Good — `let actions = { let mut state = lock.lock().unwrap(); /* classify, mutate model */ actions }; for a in actions { dispatch(a) }` の 2 フェーズ分離。
例: ❌ Bad — `for event in events { let state = lock.lock().unwrap(); handler(event); /* handler 内で state を別 lock 経由で再取得 → deadlock */ }`
例: ❌ Bad — rename 系 callback に `&mut HashMap` を引数で渡し、callback 内で「再帰的に子の callback を呼ぶ + 子 callback 内で global registry の mutate 関数を呼ぶ」と同 lock 再取得で hang する。代わりに `&Arc<Mutex<HashMap>>` を渡し、callback が必要なときだけ短期間 lock する。

## flag は時間軸の状態のみ。「self / external」識別は外部の観測可能な状態と併用する

「自プロセスが操作中」を示す flag (`is_self_writing` / `is_self_deleting` 等) だけで「self event か external event か」を判別すると、**flag 立ち中に外部 event が来たときに self と誤判定する**。flag は時間軸の状態（「今操作中である」）しか持たないため、「self の操作で起きた event」と「self 操作中に並行で来た外部 event」を識別できない。

判定:

- flag に加えて、OS / disk / 外部 store から取れる **独立した観測可能な状態** を併用する。例: `path.exists()` (path が消えたか) / `mtime` (誰が最後に書いたか) / `version 番号` (連続書き込みの何回目か) / `inode` (file 実体が同じか)
- 「self の操作の signature」をできるだけ強く identify する。`atomic_write` なら新 inode に変わるので `inode == registered_inode` で「自分の書いた版か」を判別、外部削除なら `path 不在` で「自分の操作と path 状態が矛盾している」を検出
- flag を抜けるタイミング (unignore の遅延 window) を長く取ると外部 event の取りこぼし window が広がる。flag の役割を「副作用 (emit / sync) を抑制」のみに限定し、「内部 model 更新」は別経路で同期する（前項「lock 内では分類のみ」と組み合わせる）

例: ✅ Good — filesystem watcher の Remove handler で `is_self_remove || (is_self_write && path.exists())`。write flag 中でも path 不在なら「自分が書こうとしていたが外部が消した」シナリオを通常処理する。
例: ❌ Bad — `if is_self_write { skip }` で全 Remove event を flag 単独で skip。新規作成 → unignore 遅延 window 内に外部削除で関連 UI (tab / list) が閉じない silent drop。
例: ❌ Bad — flag を「自分の操作の全効果を抑制する」目的で多用途化。Modify / Create / Remove / Rename のどれも同じ flag で skip すると、event 種別と外部状態の組み合わせ matrix が爆発し漏れが必然化する。

## snapshot stack の transaction は内部 trigger を suppression で吸収 + 過去 entries の不変条件も同時に維持する

undo / redo / history / event log stack で「mutation 1 回 = entry 1 件」を保証したい場合、**複合 mutation (内部で他の mutation を呼ぶ操作)** が通常 trigger 経由で push して 1 操作が複数 entry に分裂する。また irreversible event (別コンテナへの移動 / 永続削除 / migration 不可能な schema 変更) を「entry を積むだけ」で済ませると、過去 entries が「移動済み entity」「削除済み entity」を参照したまま残って apply 時の幽霊復元 / 二重表示を起こす。

判定:

- 複合 mutation 本体全体を `withSuppression(fn)` で囲み、 `suppressDepth > 0` の間は push を skip する。 **bool ではなく depth counter** で多重 suppression (transaction の中で別 transaction を呼ぶ等) を整合させる。 bool だと内側 suppression が解除した瞬間に外側がまだ動いてる中で push が走る
- suppression 抜けた直後に fixed order: **(1) prune (irreversible reference の除去 + cursor 補正) → (2) normalize (空 entry / 不整合 field の整理) → (3) future clear (`entries.slice(0, cursor + 1)`) → (4) `recordSnapshot()`**。 future clear を cursor 補正の **後** に置くのが鍵。 prune で cursor 左側 entry が落ちた状態のまま slice すると stale cursor で future entry が紛れる
- 事後条件は「**新規 entry が必ず 1 件積まれる**」ではなく「**`stack.entries[stack.cursor]` が現在 state と一致 + future が空**」。 `recordSnapshot()` は同一性 skip を持つ (= 通常操作で重複 entry を積まない原則) ので、 非 active 側のみを mutate する複合操作では transaction 末尾の push が no-op skip される。 「1 entry 必ず push」と「同一性 skip」は両立しないので、 事後条件側を緩めて両機能を維持する
- stale entry 防御は二重化: (a) 削除操作で prune + cursor 補正、 (b) apply 側でも `entityExists(id)` 防御 check + `findValidEntryIndex(direction)` で stale を skip して valid な隣 entry を探す。 (a) の prune 漏れの保険として (b) を必ず残す
- **transaction の規律は API surface に閉じ込め、 caller に「suppression 開始 → mutation → commit」のペア手順を覚えさせない**。 `withSuppression(fn) + recordSnapshot()` を caller に書かせる代わりに `runTransaction(body)` を 1 関数として公開し、 caller は body 内で複数 mutation を実行するだけで規律が守られる形にする。 caller 側に手順順序を委ねると、 「commit を忘れる」「順序を逆にする」「branch ごとに片方しか書かない」drift が時間と共に必ず生まれる
- **複合操作は単一 mutation の組み合わせ + 1 transaction として表現する。 「複合操作専用 API」を作らない**。 「複数の単一 mutation の組み合わせ」(例: N 個の `removeChild` / 「空コンテナ作成 + detach + attach + source 整合」) のような操作は、 単一 mutation API の組み合わせを `runTransaction` で 1 entry に圧縮するのが clean。 専用 monolithic API (`closeOthersAsBatch` 等) を新設すると、 単一 mutation 側で increment した skip 条件 / event fan-out / lock 取得 logic が monolithic 側で重複して drift する
- **観察可能な中間状態を経由する経路では中間 snapshot を積まない (final state だけを history boundary とする)**。 crossfade animation のように UI 上「新要素が存在するが active は旧要素」のような intermediate state を経由する経路で、 完成途中で `recordSnapshot()` を呼ぶと undo がその中途半端な state に戻れてしまう (undo で半端な遷移状態に飛ぶ)。 history boundary は **user の mental model における operation 境界** であって、 内部の transition phase ではない。 transition 完了 hook (`completeTransition()` 等) でだけ snapshot を積む。 抽象化すると「history snapshot は user-visible な完了 boundary でのみ積む。 system-internal な intermediate state は積まない」

例: ✅ Good — `delete(id) { withSuppression(async () => { ...; await internal.switch(...) }); commitMutationToHistory(() => pruneEntriesByContainerId(id)) }`。 transaction tail (`prune → normalize → future clear → recordSnapshot`) を 1 helper に括る。
例: ❌ Bad — `delete(id) { internal.switch(other); records.filter(e => e.id !== id); recordSnapshot() }`。 `switch` が history trigger で先に entry を 1 件積み、 続く record で計 2 件が「delete 1 回」で増える。 さらに過去 entries が削除済み container id を参照したままなので undo で missing container に switch しようとして失敗 → 失敗後に stale な子 state が現在 container に上書きされる事故。

## collection の mutation ヘルパは index / cursor 補正も内包する責務にする

`entries[]` + `cursor: number` のような index ベース state で、 mutation ヘルパが生 collection だけ mutate して cursor 補正を caller に委ねると、 後続工程が **stale index** を引き渡されて silent off-by-one を起こす。 「ヘルパ呼んだあと cursor を見直す」を口頭契約で配ると複数 caller が増えたとき必ず誰かが忘れる。

判定:

- mutation ヘルパは自身が触る field の不変条件まで責務範囲とする。 「drop された entries 数」と「cursor の追従」を atomic に行い、 ヘルパ単体で `cursor >= -1 && cursor < entries.length` を pin する
- 「全 entry が drop された場合は `cursor = -1`」のような edge case もヘルパ内で完結させる。 caller に「空 stack のときは cursor を別途リセット」を要求しない
- prune (filter 述語) と normalize (entry 内部の浄化 + 空 entry drop) を別ヘルパに分けても、 cursor 補正は両者で完結させる。 後続の future clear (`entries.slice(0, cursor + 1)`) が常に valid cursor で走る前提を保つ
- **「cursor 左の drop」と「cursor 位置 (current) の drop」は別軸として count する**。 「cursor 左の drop 数」だけ shift して `cursor = beforeCursor - droppedBefore` で済ませると、 current entry 自体が drop されたケースで「shift 後の cursor が future 領域 (drop された entry の右隣) を指す」silent off-by-one が起きる。 後続の future clear が effective に効かず「過去 (undo) に戻ろうとすると削除前の future が見える」regression。 cursor 位置の drop は **直前の surviving entry に寄せる** (= `droppedBefore + 1` 相当だけ左にずらす) のが正解

例: ✅ Good — `pruneEntries(predicate) { const beforeCursor = stack.cursor; let droppedBefore = 0; let cursorEntryDropped = false; entries = entries.filter((e, i) => { if (predicate(e)) return true; if (i < beforeCursor) droppedBefore++; else if (i === beforeCursor) cursorEntryDropped = true; return false; }); if (entries.length === 0) { stack.cursor = -1; return } const adjusted = cursorEntryDropped ? beforeCursor - droppedBefore - 1 : beforeCursor - droppedBefore; stack.cursor = Math.max(0, Math.min(entries.length - 1, adjusted)) }`。 cursor 位置の drop を別軸で扱い直前の surviving entry に寄せる。
例: ❌ Bad — `entries = entries.filter(predicate); /* caller 側で cursor 補正 */`。 caller A は補正、 caller B は忘れる、 を時間と共に必ず生む。 さらに「entries が空になった時」の cursor 値が caller ごとにバラバラ (`0` / `-1` / `undefined`) になる。
例: ❌ Bad — `cursor = beforeCursor - droppedBefore` だけで cursor 位置 drop を独立 count しない。 current entry が drop されると cursor が future 領域に滑り込み、 後続の `entries.slice(0, cursor + 1)` で future entry が漏れて undo で削除前の future state が露呈する。

## 生成順序が制約される DI graph は callback setter で配線し、循環方向を非同期化する

依存方向 `A ← B` で B が後生成なのに、 A の constructor で B を要求すると DI graph が回らない (例: A = 子 Manager / 子 Store は B = 上位 Manager より先生成だが、 各 mutation 完了時に `owner.recordSnapshot()` を呼びたい)。 直接 `import` / globalThis 参照で誤魔化すと「生成順序の偶然」「test 時の差し替え不能」になりやすい。

判定:

- A 側に `setXxxCallback(fn: () => void)` を持たせ、 配線前は **noop default** で受ける。 B 生成後の `finalize()` / `wire()` phase で `a.setXxxCallback(() => b.method())` を呼んで配線する
- 配線済み判定 flag (`isWired: boolean`) は持ち込まず、 noop default で「初期化中の mutation は積まれない」を素直に表現する。 caller 側に「配線済みか確認してから呼ぶ」を要求しない
- 「callback を呼ぶ軸 (A の責務)」と「callback の中身軸 (B の責務)」を分離する。 A は「mutation 完了 boundary で recorder を呼ぶ」だけ知っていれば良く、 B が history を持つか / event bus か / no-op かは A の関心外
- A 内部で複数の sub-instance を生成する場合 (親 Manager が子 Store を新規追加する等) は、 A が受け取った callback を **新 sub-instance にも伝播する責務**を持つ。 「caller が新 sub-instance ごとに setXxxCallback を呼ぶ」を要求すると忘れる

例: ✅ Good — `class ChildOwner { private historyRecorder: () => void = () => {}; setHistoryRecorder(fn: () => void) { this.historyRecorder = fn; for (const child of this.children) child.setHistoryRecorder(fn) } addChild() { const c = ...; c.setHistoryRecorder(this.historyRecorder); return c } }`。 配線前は noop で動き、 finalize で配線後は新 child も自動的に同じ recorder を持つ。
例: ❌ Bad — `import { ownerInstance } from './owner'` を 子 Manager 側で直接書く。 単独 unit test で 上位 Manager を mock できない + 生成順序 (子 Manager のほうが先生成) と矛盾するので循環 import エラー or 初期化中の undefined 参照になる。
例: ❌ Bad — `if (this.owner) this.owner.recordSnapshot()` のような optional chain で「まだ繋がってないかも」を毎呼出 check する。 配線完了の責務が caller / setter どちらにあるか曖昧になり、 後から「sometimes nil」を許容する hack が増殖する。

## observer / hook が走る mutation を呼ぶ前に、 observer から見える state を整える

mutation の途中で動く observer / hook / recorder (history recorder, change listener, audit log, derived store recompute 等) が **現状の state を読み込んで snapshot する** 設計の場合、 observer から見える state を mutation 前に整えておかないと「初期化途中の空 / 欠落 snapshot」が永続化される。 「register → mutate」順序を「mutate → register」に逆転させると、 mutate 中に走った observer が「自分はまだ registry に居ない」前提で空 snapshot を積む silent corruption が起きる。

判定:

- mutation 中に走る observer が「state owner の global registry / index」を読むなら、 **mutation 開始前に owner を registry に register + selected/active を設定** してから mutate を呼ぶ。 mutation 完了後に register すると「mutation 中の observer 発火」で空 entry が積まれる
- 新規 entity の初期化フローは: (1) entity 生成 → (2) registry に register + active 設定 → (3) **state-affecting な初期 mutation** (子 entity 追加 / lazy load 等) を呼ぶ、 の固定順序。 (3) に失敗したら (2) を rollback する (= 次項参照)
- observer 側で「自分が registry に居ない場合 = 静かに skip」と書きたくなるが、 これは bug を隠す方向。 observer は「registry に居る前提」で書き、 caller 側が順序を守る規律にする

例: ✅ Good — `registry.set(id, child); setActiveId(id); await child.initialMutation(...)`。 `initialMutation` 中に走る historyRecorder は `registry` から `activeId` の entity を引いて snapshot するため、 register 後の mutation で正しい snapshot が積まれる。
例: ❌ Bad — `await child.initialMutation(...); registry.set(id, child); setActiveId(id)`。 initialMutation 中に historyRecorder が `registry.get(activeId)` を引くと未登録のため空 `[]` が返り、 空の子 state の壊れた history entry が永続化される。

## 初期化失敗時の rollback は try/catch + 明示 cleanup + rethrow

複数 step (entity 生成 → registry 登録 → active 設定 → 初期 mutation) を持つ初期化フローで、 後半 step が throw した場合、 前半 step で作った side effect (registry entry / selected state / event listener / 開いた resource) を巻き戻さないと「空の壊れた entity が registry に残る」「selected が存在しない id を指す」「resource leak」が永続化する。 try/finally で「成功時も走る cleanup」を書くと「成功時に何もしない条件分岐」が混入して意図不明になりがち。

判定:

- **try/catch + 明示 cleanup + rethrow** で書く。 失敗時のみ走る cleanup を catch 内に局所化し、 成功時の log / 通常処理を try block 内に置く。 finally に cleanup を置くと「成功時も走らせる必要がある」誤読を招く
- cleanup は前半 step を**逆順に**巻き戻す: 新規 register した entry を `delete`、 切り替えた selected を `previousSelected` に戻す、 取得した resource を release。 caller に rollback を委ねず初期化関数内で完結させる
- caller に失敗を伝えるため **必ず rethrow** する。 catch で握り潰すと「半端な状態が残ったまま success と誤認される」最悪パターンになる
- 「成功 path で走る side effect (event emit / log)」と「失敗 path で走る cleanup」を別軸として扱う。 try block 内で前者、 catch block 内で後者を完結させ、 同じ block に混ぜない

例: ✅ Good
```ts
const previousSelectedId = getSelectedId();
registry.set(newId, entity);
setSelectedId(newId);
try {
  await entity.initialMutation();  // 失敗するかもしれない
} catch (error) {
  // 逆順に rollback: selected → registry → entity
  registry.delete(newId);
  entity.destroy();
  setSelectedId(previousSelectedId);
  throw error;  // caller に伝える
}
```

例: ❌ Bad — `try { await entity.initialMutation() } finally { /* 何か cleanup */ }`。 finally は成功時も走るため、 cleanup ぽい処理を書くと成功時に意図しない副作用が走る。 「成功時は何もしない if 分岐」を書く羽目になり読みづらい。
例: ❌ Bad — try/catch で catch 内が空 (= error を握り潰す) または log だけ。 半端な registry entry / selected state が残ったまま「初期化成功」と誤認される。 失敗時の registry / state が next mutation で読まれて二次故障する。
