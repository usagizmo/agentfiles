# 状態の所有 / orchestration / 通知 / cache

実行時状態の持ち主・event 駆動の orchestration・通知 fan-out・cache と view-binning の分離。

## 実行時状態の持ち主は 1 箇所に集約し、consumer は引数で受け取る

型・schema の SSOT と同じ原則は、**メモリ上の状態 instance**（キャッシュ・検索 index・接続プール等）にも当てはまる。load / persist / mutate を複数モジュールから独立に呼べる設計にすると、同じ state instance が並走してメモリ上の不整合（片方に upsert したのに他方は stale）を生む。

具体策: instance を生成・保持する「持ち主」を 1 モジュールに決め（orchestrator 等）、query / mutate 関数は instance を**引数で受け取る pure ロジック**にする。consumer（UI / 他モジュール）は持ち主越しにアクセスし、独自の load を持たない。lifecycle（初期化・persist debounce・破棄）は持ち主のみが責任を持つ。

判定: 「この state を load / persist できる入口は何箇所あるか？」を自問し、2 箇所以上なら入口を 1 つに寄せる。

**「ロード済み instance の取得」も 1 関数に集約する**: 「cache HIT 分岐」「load promise 待ち」「index resolve + 新規 instance 化」の 3 経路を caller ごとに inline で書くと、「不在時の戻り値」「例外時の挙動」「resolve 失敗時の扱い」が caller ごとに drift する。`ensureLoaded(id): Promise<T | undefined>` のような 1 入口に集約し、関数全体を try/catch で囲んで「entity 不在」「resolve 失敗」「load 失敗」をすべて `undefined` に揃える。caller は undefined チェック 1 軸だけ処理すればよい。

## 同じ collection を走査する propagation は走査骨格を helper 1 本に集約する

state owner が持つ collection (`Map<id, store>` 等) に対して複数の propagation 関数 (creation 反映 / deletion 反映 / rename 反映 / changes 反映) を書く場合、走査骨格 (entries iterate + skip 条件 chain) を各関数に個別に書くと、skip 条件 (self / not-loaded / 種別違い / 対象外 id 等) の 1 つを追加・修正したときに N 箇所の drift が起きる。skip 条件は SSOT として `forEachX(target, visit)` の helper に集約し、各 propagation は visit closure 内の差分 (mutation 内容) だけを表現する。

判定: 「同じ collection を、同じ skip 条件 chain で走査する関数が 2 つ以上あるか？」を自問。Yes なら走査骨格を helper に切り出し、call site は mutation 差分だけを書く設計に倒す。新しい propagation 関数を増やすたびに 5 行の skip 条件をコピーしないこと。

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
