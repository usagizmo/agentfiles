# 正誤判定 / setup+verify 統合 / プラットフォームレール

正誤の独立 proof・setup と verify の単一 API・公式構造への準拠。

## ユーザーに「上限 / ceiling」として見せる値は per-field の真の上限で出す

「最大 $X」「up to $X」「上限」のように **超えないことを示唆する値**を、blend / 代表要素の選定のような **単一スカラ集約**で出すと ceiling 保証が壊れる。複数次元（input 単価 / output 単価など）が独立にコストへ効く系で「blended 1:1 が最大の単一要素を選び、その要素の各次元値を表示」すると、実利用の比率が偏ったとき別要素の当該次元単価が表示を超えうる（表示は「実在する 1 要素の代表値」だが「天井」ではない）。billing / quota など信頼が金銭に直結する文脈で致命的。

正しくは **field-wise max**: 各次元を独立に全候補の最大で取る。`Σ usageᵢ × max(priceᵢ) ≥ 任意の実構成の Σ usageᵢ × priceᵢ` が常に成立し、真の上限になる（表示値が実在しない要素の組み合わせ＝合成でも、天井保証が優先）。routing 先や構成が事前確定しない系では、単一値ではなく **per-field レンジ（min〜max）** で持ち、UI は min を主表示・max を補助（hover / aria-label 等）で出すのも誠実な選択。

判定: 「この表示を見たユーザーは『これ以上は請求されない』と読むか？」が Yes なら、集約方法が field-wise に真の上限を保証するか / レンジで両端を見せるかを確認する。「概算 / est.」のようなヘッジ語を外すなら、なおさら値そのものが ceiling 保証を満たす必要がある（語が担っていた逃げが消えるため）。

## 正誤判定は独立した cheap proof で行う（副作用の成否に依存させない）

鍵・トークン・構成の「正しさ」を、それを使った実行（復号・通信・I/O）の成功/失敗で間接的に判定する設計は、実行対象が存在しない初期状態で機能しない上、成否の原因が正誤以外（マイグレーション境界・ネットワーク・プロバイダー側のエラー）と混在して区別不能になる。正誤判定専用の **deterministic で cheap な proof**（HMAC・署名・既知平文の検証値など）を別軸で持ち、実行前に判定を完結させる。

E2EE の passphrase 正誤を blob 復号の成否で判定するアンチパターンが典型例: blob 未作成の新規ユーザーでは誤 passphrase を検出できず、silent に不整合 state を量産する。代わりに `HMAC-SHA256(derived_key, context_constant)` を server に保管すれば、鍵そのものを server に送らずに (E2EE 維持) 1 回の HMAC 突合で正誤判定できる。context 定数に version suffix (`-v1`) を付けておけば、将来アルゴリズム変更時に無停止で切り替えられる。

## setup + verify を同じ API に統合する（呼び分けを caller に漏らさない）

「X が未初期化なら setup、初期化済みなら verify」のような分岐は、内部状態の問題であって caller の関心事ではない。setup と verify を別 API / 別 IPC に分けて caller に「hasSetup を先に判定して正しい方を呼べ」と要求すると、呼び忘れ・順序ミスでサイレント故障する（「呼び忘れ・順序ミスで破綻する API を作らない」の具体形）。

単一 API の内部で state を fetch → 分岐 (`None` / `Some + valid` / `Some + invalid` / `Some + stale`) し、caller から見える surface は 1 入力・1 出力に保つ。migration grace のような過渡的 state も分岐の 1 ケースとして内部で吸収する。

## セキュリティ validation のエラー応答は「外向き generic / 内向き構造化」で軸を分ける

allowlist / 認可 / 入力検証で reject した時、reject 理由（種別 enum）をそのまま HTTP / IPC レスポンスに返すと、attacker は失敗応答を観測しながら入力を変えて allowlist の正規 mapping を **enumerate** できる。種別ごとに UI 文言を出し分ける UX 要件と、攻撃面の最小化は両立しない。

両立させる軸分離:

- **クライアント返却**: 単一の generic 文言（定数化、例: `UPLOAD_REJECTED_MESSAGE`）に固定する。種別を返さない
- **server / daemon log**: 構造化ログに種別 + 入力 echo を出す（運用者は log で原因特定できる）
- **エラー種別 enum 自体は internal SSOT として保持**: server 内部の分岐・metric tag・log 構造化に使う。外向き API には漏らさない

判定: 「この種別を attacker が観測できると、何 bit の情報が漏れるか？」を自問する。allowlist の存在 / 正規入力の集合 / 認可境界の位置などが推測できる種別はすべて外向き応答から外す。UI 出し分けが必要なら、reject 種別ではなく **caller 側で事前検証**（同じ allowlist を client にも持たせる）して error にする前に分岐する設計に倒す。

## プラットフォームの推奨レールから外れない

ツール・フレームワーク・SDK が公式に推奨する構造（ディレクトリ配置、設定ファイル、ライフサイクル API 等）があるなら、独自の並行構造を作らない。公式レールから外れると、アップデート時の drift・他ツール連携時の不整合・新メンバーの学習コストが累積する。独自構造を選ぶなら「公式では解決できない明確な理由」を docs に明示する。

## 並列 counter check は INSERT-then-check + ROLLBACK で atomic にする

「N 件以下なら受理、超過なら拒否」型の API（rate limiter / quota / 在庫引当 / 同時接続数制限）を `SELECT count → if ok then INSERT` の 2-step で実装すると、並列リクエストが両方とも `count = N - 1` を観測してから両方 INSERT し、上限を 1 件突破する。**check と consume の間に他者が consume できる時間窓がある**のが故障の本質。

正しい polarity は **INSERT-then-check + ROLLBACK**: transaction 内で `expired clean → INSERT で先に枠を予約 → SELECT count → 超過なら throw で auto rollback`。書き込みを serial 化する DB の write lock（SQLite / libSQL の `BEGIN IMMEDIATE`、Postgres の `SELECT ... FOR UPDATE`）に乗ると、並列リクエストは順番に INSERT してそれぞれ自分込みの count を観測する。`N+1` 番目だけが超過判定で rollback され、上限が atomic に守られる。

判定: 「check と書き込みの間に他者が同じ check に通れる時間窓があるか？」を自問。Yes なら必ず write tx 内で書き込み先行 + count 検証 + 超過時 rollback の構造に倒す。`UNIQUE` 制約 + `INSERT OR IGNORE` で代用できるケース（重複拒否）はそちらの方が単純だが、count 上限は INSERT-then-check が定型。

## CORS / CSRF は認証経路ごとに検証軸を分ける

「Bearer / Cookie / 認証なし」のような複数の認証経路を持つ API で、CORS allowlist や CSRF Origin 検証を **全経路一律** に適用すると、経路ごとの脅威モデルの違いを無視して誤判定する。Bearer token 経路は browser CORS レールに乗らない（Authorization ヘッダ自体が認可の証明、credentials は cookie ではない）ので CORS / CSRF 検証は意味を持たない。Cookie 経路だけが CSRF の対象（被害者の browser に勝手に credentials を持たせて第三者 origin から発火させる攻撃モデル）。

経路判定（例: `isBearerAuth = authHeader?.startsWith('Bearer ')` を context / middleware で 1 度評価）を 1 箇所の SSOT に置き、その値で `if (cookiePath) { allowlist 検証 } else { skip }` のように discriminate する。「全 request に CORS ヘッダを反射する」ような経路無視の実装は、Bearer 経路に不要な反射を出して脅威面を広げる。

### 反射型 CORS + credentials は CSRF の前段リスク

`Access-Control-Allow-Origin: <request の Origin を反射>` + `Access-Control-Allow-Credentials: true` の組は、任意 Origin から credentials 付き request を許可する設定と等価で、CSRF 対策の最終防壁が消える。allowlist で Origin を絞り、allowlist 外は反射しない（preflight も 403）。env-driven の allowlist は **module 初期化時に 1 度だけ Set 化** し、request 毎に再構築しない。

### Origin ヘッダの有無で browser 起点 vs server-to-server を識別する

CSRF 対策で「Origin が allowlist 外なら拒否」を実装するとき、**Origin 不在を一律 403 にすると server-to-server (curl / Stripe webhook / 他サービスからの callback) が全件死ぬ**。Origin ヘッダは browser がクロスオリジン context でのみ自動付与する識別子で、server-to-server クライアントは送らない。CSRF は「browser に credentials を持たせて第三者 origin から発火」の攻撃モデルなので、Origin 不在 = browser 起点ではない = CSRF 対象外で通してよい。各 endpoint が HMAC / signature 検証で別軸の防御を持つ責務。

判定: state-changing method（POST / PUT / PATCH / DELETE）で `Origin` ヘッダが **存在し かつ allowlist 外** のときだけ拒否。`Origin === undefined` は通す。GET / HEAD / OPTIONS は state を変えないので対象外（OPTIONS は preflight 用に別経路で allowlist 検証）。

## build 時に値が不明な allowlist は runtime narrow gate で締める（CSP wide + navigation exact の二段 gate）

CSP / origin allowlist 等の許可リストには build 時に決定する宣言と、runtime まで値が決まらないリソースの両方が現れる。例: WebView の `frame-src` は build (manifest / config) 時に決定するが、loopback HTTP server を `127.0.0.1:0` で ephemeral port にすると **bind するまで実 port が分からない**。CSP は `http://127.0.0.1:*` 等の wildcard で広く書かざるを得ない。

このとき「CSP wide = 攻撃面 wide」と諦めず、**runtime に値が分かる時点で別 gate を狭く絞る** 設計に倒す。たとえば Tauri の `on_navigation` ハンドラは runtime で実 bind URL を知っているので、`url == "http://127.0.0.1:<実 port>/index.html"` の **完全一致** だけを通す closure を作る。CSP（build 時）と navigation gate（runtime）の二段で gate し、defense-in-depth を保つ。

判定: 「この allowlist は build 時に最終値が決まるか？」を自問する。No（runtime に決まる）なら、build 時宣言は wildcard で許容しつつ、runtime に実値が分かるレイヤーで別 gate を入れる。runtime gate を入れずに build 宣言だけ wide にすると、攻撃面は build 宣言の wildcard 幅で固定される。「先取り allow をしない」原則と同じ動機（不要な surface を開けない）を、別の時間軸（runtime）で適用する。

## CSP allowlist は実態に合わせて最小化、先取り allow をしない

Content-Security-Policy の `script-src` / `connect-src` / `img-src` / `font-src` 等の allowlist に「将来使うかも」で外部 origin を先取りで載せると、攻撃面を実装の現状より広げる。CSP の価値は「実際にロードしている origin だけ許可する」ことで、未使用 origin を追加した瞬間にその origin への redirect / DNS 乗っ取り / sub-resource hijack を新しい攻撃ベクタとして開放する (実害がなければ気付かない silent な攻撃面拡大)。

判定: 「この origin を allowlist に載せる前に、現在のコードで request が実際に発火しているか？」を `grep` で確認する。発火していないなら **追加しない**。必要になった瞬間に PR で 1 行追加すれば良い (CSP は declarative で diff が小さいので追従コストはほぼゼロ)。allowlist の SSOT は config file (`svelte.config.js` の `kit.csp` 等) であり、コメントで「将来用に」と記述して載せたままにしない。

ユーザー入力で任意 URL を扱う経路 (公開コンテンツ内の markdown image, avatar 等) は例外で、機能維持のために `'img-src': ['self', 'data:', 'https:']` のように schema レベルで広く許容する判断が要る。これは「先取り allow」ではなく「ユーザー入力 surface の機能要件」軸で記録し、攻撃面増との trade-off を docs に明示する。

## inline は CSP の主敵 → 静的化できるなら codegen で外す

`{@html `<style>${...}</style>`}` や inline `<script>` で動的注入したくなったとき、注入する内容が **build 時に決定する静的データ** なら CSP `unsafe-inline` を導入せず、build 時 codegen で static CSS / JS file に書き出して `@import` / `<script src>` 経由に置き換える。`unsafe-inline` を 1 つ許すと CSP の defense-in-depth が大幅に弱体化する (XSS 経由で任意 inline script が実行可能になり、他の directive がほぼ意味を成さなくなる)。

判定基準: 「inline で注入したい中身は、ビルド時に確定するか / リクエスト時にユーザー入力を反映するか？」

- ビルド時確定 → codegen で static file に書き出す。生成物は git commit + build dependency に乗せて再生成忘れを CI diff で検知。**最も多い**
- リクエスト時にユーザー固有値 (CSRF token / user-id 等) を反映 → SvelteKit `kit.csp` (mode: 'nonce') 等の **プラットフォーム標準 nonce 機構** を使う。`app.html` 等の inline は `nonce="%placeholder%"` 属性を手書きで付与する規約に従う (placeholder 単体形式では認識されないツールが多い)
- 真に動的 + nonce が使えない → 設計を見直す。`unsafe-inline` 導入は最後の手段

## fail-open / fail-closed のスイッチは環境で明示分岐する

「依存サービス未設定 / 接続失敗時にどう振る舞うか」は production と dev / test で要件が逆になることが多い。production では config 漏れで security gate（rate limit / 認可 / signature 検証）が **無言で無効化** されるのが最大の事故源 → fail-closed（503 等で停止）に倒す。dev / test では同じ条件で停止すると開発体験を破壊し、サービス起動すらできない → fail-open（gate を skip して通す）。

両立させる骨格:

```ts
if (!service) {
  if (!dev) {
    console.error('[Gate] dependency missing in production');
    throw error(503, { message: 'Service temporarily unavailable' });
  }
  return permissive_default;
}
```

判定: 「config が抜けたとき、(a) attacker が gate を素通りする / (b) ユーザーが何も触れない の被害が大きいのはどちらか？」を自問する。production は (a)、dev は (b) が大きいケースが多いので極性が反転する。境界 polarity（allowlist vs denylist）と同じく「リストに書き忘れた場合 safe か？」の判定を **環境ごとに別答え** で持つ設計。dev で fail-open にする場合も「dev は permissive、production は restrictive」を 1 行の `if (!dev)` で表現し、condition の引数を増やさない（環境分岐は単一フラグに集約）。

## 双方向参照を持つ load 経路は fire-and-forget で cycle を断つ

loading-state を共有 promise として持つモジュール（一度走った load の promise を 2 回目以降の caller が `await` で待つ仕組み）が、参照関係で互いを load し合うと、A→B / B→A の `await` が循環して deadlock する。A の load 完了 hook の中で B を `await load` する経路を作らない。先読み / catch-up / warm up 系の経路は **意図的に fire-and-forget で kick off** し、整合性が必須な経路（ユーザー click / jump 等）で個別に `await load` して fresh state を取る、という二段構造に倒す。

判定: 「A の load 完了の中で B を load する経路があるか？ かつ B 側にも同じ経路があるか？」を双方向で自問。Yes なら低優先度の経路（preload / catch-up）を fire-and-forget に倒し、cycle を断つ。

例: ✅ Good — preload 系関数は `void ensureLoaded(refId)` で kick off のみ。ユーザー操作 (jump / open) 側で別途 `await ensureLoaded(targetId)` して fresh state を取る。
例: ❌ Bad — load 完了 hook の末尾で参照先 entity を `await ensureLoaded` で warm up。mutual ref（A が B を参照、B が A を参照）で共有 loading promise の await が循環し deadlock。
