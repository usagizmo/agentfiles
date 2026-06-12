# 設計原則

トップエンジニアが目指す、理想的で美しく合理的な設計を追求する。

## 優先順位（上位が優先）

1. **破壊的変更の推奨**: 部分的パッチより、根本的な改善を優先。不調なコードは完全に削除し、新しい実装に置き換える。動く状態を一時的に犠牲にしても、中途半端な併存（古い実装の温存、feature flag での棚上げ）は選ばない
2. **構造の美しさ**: ドメインに沿った設計、重複の一元管理（SSOT）、既存パターンとの整合性

## 実装方針

- エッジケースまで考慮した完全な実装を目指す
- **抽象化は variant が 2 つ以上の分岐ロジックを実際に持つ時点で導入する**: 1-variant enum / 将来の variant を予約する enum / dead label は YAGNI 違反。Plan 段階で「将来 X を追加する前提で抽象化を入れる」と合意していても、実装後に trivial dispatch / dead label に落ちたら tidy 段階で容赦なく削る。フラットな field の組み合わせで決定論的に導出できるラベルは struct field のままにし、enum を作らない
- **primitive の base 前提を override で打ち消す回数が増えたら、抽象を 1 段上げて wrapper を作る**: 共有 primitive (Button / Input / Card 等) が base に焼き込んだ前提 (height / padding / radius / font-weight / gap) と衝突する用途を「variant 追加で SSOT 化する」と、variant 数だけ override 戦略が増えて primitive の SSOT 価値が薄れる。同 feature 内で 2 例以上繰り返される pattern は、primitive の variant を増やすのではなく **feature-local wrapper** に切り出す。判定: 「override で base の 2 つ以上を打ち消す」状況が 2 例以上 → wrapper を新設する。軸: primitive は「視覚的・機能的に最小単位の base 前提」を表現し、wrapper は「feature が要求する base 前提の組み替え」を表現する。同じ base 前提なら primitive に variant、違う base 前提なら wrapper。これは前項 (YAGNI) の裏側ペアで、「2 例集まったら抽象化を導入する」軸は同じだが、抽象化の入れ先 (primitive の variant vs wrapper) を base 前提の整合性で切り分ける
- **順序制約は docstring ではなく型で固定する**: 「A → B の順で呼ぶ必要がある」「lock を取った後でないと X を read してはいけない」のような順序制約は、コメント規約 / レビュアー記憶に依存させると将来 codepath 追加時に reggression が混入する。代わりに guard / token / session を struct に束ね、後続値を field として持たせる (例: `SyncSession { _lifecycle: RwLockReadGuard<'a, ()>, master_key, cfg }` で guard と取得物を 1 helper にまとめる) ことで、Rust borrow checker / TS 型システムが「guard が生きている間しか field を読めない」を compile time で強制する。builder pattern / branded readiness token (`SetupCompleteToken`) / `Result<Session, Locked>` 返却型も同じ axis。docstring に「必ず A の後で B」と書くのは最後の手段で、まず型に押し込めないか考える
- **UI gate を撤去するときは、それが下位 layer の非同期 readiness を副次的に隠していなかったか確認する**: auth / loading / offline などの「表示 gate」は、本来の責務 (表示の出し分け) とは別に「下位 layer (daemon / background task / 非同期 populate される config) が準備完了するまでの時間稼ぎ」を**たまたま**兼ねていることがある。gate がある間はロード待ち等で下位の cold-start race が時間的に覆い隠され、gate を外した瞬間に「準備完了前の操作が未 populate state に直撃する」race が露出する。対策は gate 撤去と同時に下位 layer 側で readiness を明示担保すること: 同じ前提 (config / state) を読む**全解決経路の解決直前**に単一 preflight helper (chokepoint) を通し、「未準備のときだけ 1 回 populate を完遂させ、準備済みは no-op」に倒す。各 caller に「未 load なら準備して」を散らすと 1 経路必ず忘れる (「副作用 chain は単一 Coordinator に集約」と同 axis)。preflight 要否の判定 (準備完了の SSOT) は 1 helper に集約し、軸が違う経路 (例: 前提を使う想定かの判定軸が違う複数経路) は要否判定だけ共有して「その前提を使う想定か」の判定は経路ごとに分ける
- **production / test の振る舞いの差は env var ではなく型 (DI) で表現する**: `DISABLE_X=1` のような env var bypass は (a) production と test で同じ code が走り env でだけ挙動が変わる「magic」で意図が型に現れない、(b) test 実行時の env 立て忘れで silent に副作用 (OS keychain access / 外部 network / 実 file system 書き込み / 実 secret store 読み出し) が混入する、の 2 つの fragility を抱える。代わりに trait + DI 引数で実装を切り分け、`fn create_daemon_state(..., library_key_store: Arc<dyn LibraryKeyStore>, secret_vault: Arc<SecretVault>)` のように依存を必須引数として明示する。production main は OS 実装 (`OsLibraryKeyStore` / `os_secret_store()`) を渡し、test fixture は in-memory 実装 (`InMemoryLibraryKeyStore` / `SecretVault::in_memory()`) を渡す。これにより「test 経路に副作用が混入する」状態は **新 caller が明示渡しを書かない限り compile error** で構造的に排除される。pollution の事後 reset (`state.clear_*()` を test fixture に追加する pattern) や env var による runtime 分岐より「そもそも load しない構造」を選ぶ (前項の「型で固定」と同じ axis: 規約 / コメント / 環境依存より型で強制する)

## 設計の落とし穴

軸の混在 / SSOT / orchestration 配置 / cache と view-binning / 正誤判定 / クロスプロセス契約など、設計上の典型的な落とし穴は `design-pitfalls` skill に集約。設計レビュー時・落とし穴の判定が必要なときは skill を参照する。
