# 設計原則 deep-dives

`~/.agents/rules/design-principles.md` の各原則の詳細な判定基準・事例。該当する軸の設計判断に迷ったとき、必要な項目だけ読む。

## 抽象化は variant が 2 つ以上の分岐ロジックを実際に持つ時点で導入する

1-variant enum / 将来の variant を予約する enum / dead label は YAGNI 違反。Plan 段階で「将来 X を追加する前提で抽象化を入れる」と合意していても、実装後に trivial dispatch / dead label に落ちたら tidy 段階で容赦なく削る。フラットな field の組み合わせで決定論的に導出できるラベルは struct field のままにし、enum を作らない。

## primitive の base 前提を override で打ち消す回数が増えたら、抽象を 1 段上げて wrapper を作る

共有 primitive (Button / Input / Card 等) が base に焼き込んだ前提 (height / padding / radius / font-weight / gap) と衝突する用途を「variant 追加で SSOT 化する」と、variant 数だけ override 戦略が増えて primitive の SSOT 価値が薄れる。同 feature 内で 2 例以上繰り返される pattern は、primitive の variant を増やすのではなく **feature-local wrapper** に切り出す。

- 判定: 「override で base の 2 つ以上を打ち消す」状況が 2 例以上 → wrapper を新設する
- 軸: primitive は「視覚的・機能的に最小単位の base 前提」を表現し、wrapper は「feature が要求する base 前提の組み替え」を表現する。同じ base 前提なら primitive に variant、違う base 前提なら wrapper
- これは前項 (YAGNI) の裏側ペアで、「2 例集まったら抽象化を導入する」軸は同じだが、抽象化の入れ先 (primitive の variant vs wrapper) を base 前提の整合性で切り分ける

## 順序制約は docstring ではなく型で固定する

「A → B の順で呼ぶ必要がある」「lock を取った後でないと X を read してはいけない」のような順序制約は、コメント規約 / レビュアー記憶に依存させると将来 codepath 追加時に regression が混入する。代わりに guard / token / session を struct に束ね、後続値を field として持たせる (例: `SyncSession { _lifecycle: RwLockReadGuard<'a, ()>, master_key, cfg }` で guard と取得物を 1 helper にまとめる) ことで、Rust borrow checker / TS 型システムが「guard が生きている間しか field を読めない」を compile time で強制する。builder pattern / branded readiness token (`SetupCompleteToken`) / `Result<Session, Locked>` 返却型も同じ axis。docstring に「必ず A の後で B」と書くのは最後の手段で、まず型に押し込めないか考える。

## UI gate を撤去するときは、それが下位 layer の非同期 readiness を副次的に隠していなかったか確認する

auth / loading / offline などの「表示 gate」は、本来の責務 (表示の出し分け) とは別に「下位 layer (daemon / background task / 非同期 populate される config) が準備完了するまでの時間稼ぎ」を**たまたま**兼ねていることがある。gate がある間はロード待ち等で下位の cold-start race が時間的に覆い隠され、gate を外した瞬間に「準備完了前の操作が未 populate state に直撃する」race が露出する。

対策は gate 撤去と同時に下位 layer 側で readiness を明示担保すること: 同じ前提 (config / state) を読む**全解決経路の解決直前**に単一 preflight helper (chokepoint) を通し、「未準備のときだけ 1 回 populate を完遂させ、準備済みは no-op」に倒す。各 caller に「未 load なら準備して」を散らすと 1 経路必ず忘れる (「副作用 chain は単一 Coordinator に集約」と同 axis)。preflight 要否の判定 (準備完了の SSOT) は 1 helper に集約し、軸が違う経路 (例: 前提を使う想定かの判定軸が違う複数経路) は要否判定だけ共有して「その前提を使う想定か」の判定は経路ごとに分ける。

## 「表示 gate / active-implicit」撤去時は時間軸 (readiness) だけでなく空間軸 (owner-awareness) の漏れも確認する

前項は「gate が下位 layer の*準備完了まで*の時間稼ぎを兼ねていた」時間軸の罠。同型の空間軸の罠として、multi-tenant / multi-root 化で「現在 active な対象 (active library / current tenant)」を暗黙参照していた下位 helper が、非 active の対象を扱った瞬間に間違った tenant の DB / cache / runtime を触る。`fn do_x(path)` が内部で `active_*()` を読んでいると、active ≠ owner のとき owner でなく active の state を駆動して silent に混線する (例: 非 focused library のノートを観測したら index は owner の DB に書くのに CRDT seed / push pending / shelf-resolver は active library を使い、副作用が非対称な owner に分裂する。後者は `node.path` 未 populate / CRDT cross-library 混線として表面化する)。

対策は「対象を引数で受け取った helper は、その対象から owner を 1 回解決し全副作用を同一 owner で駆動する」を型 / 引数で固定すること (owner 解決を bundle で渡し、active fallback は owner 未解決時のみの明示分岐に閉じる)。gate / active-implicit を撤去するときは「この下位経路が暗黙に active を読んでいないか」を全 caller chain で確認する (「副作用 chain は単一 Coordinator に集約」「全解決経路の解決直前に単一 preflight」と同 axis の owner 版)。

## trust boundary を跨ぐ操作は専用 transaction を新設せず、既存 lifecycle SSOT の合成で表現する

別 tenant / 別 library / 別 trust boundary へ entity を移す操作を「専用の durable journal + state machine」で実装すると、crash-safety のための重い機構を 1 から作ることになる。多くの場合これは既存の **delete + create lifecycle の合成**で表現でき (移動元で teardown SSOT、移動先で create SSOT を再利用)、crash recovery は「FS rename / DB write の atomicity + boot 時 reconcile (orphan 掃除 / catch-up scan)」が既に担保している。**B-first 順序** (先に移動先を作ってから移動元を消す) にすれば途中 crash は data loss でなく benign な重複に倒れ、boot reconcile が収束させる。専用 journal を作る前に「既存の delete arm / create arm を再利用 + FS/DB atomicity + reconcile で足りないか」を必ず問う (priority #1「中途半端な併存を選ばない」とは別軸で、こちらは「重い新機構を作らず既存 SSOT を合成する」軸。over-engineering を避ける YAGNI の crash-safety 版)。

## production / test の振る舞いの差は env var ではなく型 (DI) で表現する

`DISABLE_X=1` のような env var bypass は (a) production と test で同じ code が走り env でだけ挙動が変わる「magic」で意図が型に現れない、(b) test 実行時の env 立て忘れで silent に副作用 (OS keychain access / 外部 network / 実 file system 書き込み / 実 secret store 読み出し) が混入する、の 2 つの fragility を抱える。代わりに trait + DI 引数で実装を切り分け、`fn create_daemon_state(..., library_key_store: Arc<dyn LibraryKeyStore>, secret_vault: Arc<SecretVault>)` のように依存を必須引数として明示する。production main は OS 実装 (`OsLibraryKeyStore` / `os_secret_store()`) を渡し、test fixture は in-memory 実装 (`InMemoryLibraryKeyStore` / `SecretVault::in_memory()`) を渡す。これにより「test 経路に副作用が混入する」状態は **新 caller が明示渡しを書かない限り compile error** で構造的に排除される。pollution の事後 reset (`state.clear_*()` を test fixture に追加する pattern) や env var による runtime 分岐より「そもそも load しない構造」を選ぶ (「順序制約は型で固定する」と同じ axis: 規約 / コメント / 環境依存より型で強制する)。
