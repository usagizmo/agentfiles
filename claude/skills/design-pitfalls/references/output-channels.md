# 出力チャネル / 機械 caller 向け応答

観測軸ごとの surface 分離・error 応答の self-repair 情報・truncate-safe doc。

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
