# harness adapter

conductor が terminal multiplexer に対して行う操作。**差し替えるときは「herdr での実現」以降だけを書き換える**。conductor 本体はここ以外で multiplexer を知ら**ない**。

## 契約

手段によらず必要なもの。**差し替えるときは、この表を満たせるかで判定する。**

| 契約                                                                         | 満たせないと                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| 名乗る（起動したら自分のセッションへ固定名）                                 | 自分を一覧から見つけられず、2 つ目が走っても気づけない |
| 人待ちを中断と区別して返す                                                   | 人待ちを中断と読んで再開を送り続ける                   |
| 停止中のセッションが自走しない（外部入力なしに書き始めない）                 | write を返したはずの課題が勝手に再開して交差を作る     |
| 稼働に移ったことを観測できる                                                 | 起こした・渡したことを確認できないまま tick を終える   |
| snapshot を取り、tick が action を決めるのに使った観測と違ったときだけ起こす | ポーリングか待ちっぱなしになる                         |
| 実行器だけ止める（worktree・workspace・branch・未コミットの変更は残す）      | 書き続ける実行器と新しい借り手が衝突する               |
| 起動が非同期（親が子の完了をブロックしない）                                 | tick が子の完了まで返らない                            |
| 稼働中のセッションを一覧で観測できる                                         | tick が現実を読めない                                  |

- **「前回」は時点ではなく実体**。tick が読んだ観測そのものを起床側へ渡し、起床側は取り直さない
- 人待ちの印は無くてもよい（SSOT は Issue の記録で、印は即時観測用のキャッシュ）。食い違ったときの判定は `../SKILL.md`
- **止まったことを観測できるまでは資源を解放しない**。止められない harness なら `Conflict` として報告する

### 人が conductor 側に答えたとき

人がセッションへ直接答えるのは正常経路。conductor が回答を仲介する必要は**ない**。

**人が conductor 側に答えてしまったときだけ、当のセッションへそのまま渡す**。自分から宛先を選んで運ば**ない**。要約も言い換えもせず、action にも数えない。「別の pane で打ち直してください」と返さ**ない**。

fencing token（grant 世代つき）は、入力が conductor 経由でしか通らない限り不要なので置かない。

### 起こす

| 起こすもの | worktree                                                             | 渡すもの                                                                  |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `refine`   | 要ら**ない**（読み取りのみ）                                         | `/refine <Issue 番号>`                                                    |
| `resolve`  | **着地面ごとに** branch と worktree を作る（既にあるなら pane だけ） | `/resolve <代表> [成員…]`（group なら**対象集合の全番号**。復旧時も同じ） |

- 着地面が複数ある課題でも、**セッションを置くのは 1 面だけ**（どの面かは `landing-surface.md`。claim 後は記録の `landing` の先頭で、本文を引き直さない）。残りの面は checkout として作るだけで、pane は持たない
- **面ごとにセッションを起こさない**（1 課題 = 1 セッション = 1 計画）
- どちらも完了を待た**ない**。渡すのは Issue 番号だけで、起こされた側は Issue 本文を読んで自分で文脈を作る
- **セッション名は `refine-<番号>` / `resolve-<番号>` に固定する**
- **実行器のモデルは落とさない**（`--` 以降で渡す。conductor 自身とは別に指定する）

入れ物は 3 段で、上から「隔離が要る順」に選ぶ。

| 入れ物      | 使うとき                                                               |
| ----------- | ---------------------------------------------------------------------- |
| `workspace` | **作業する木が変わる**とき。`resolve` の worktree がこれ               |
| `tab`       | `refine`。**何枚開いても既存の pane の幅を削らない**                   |
| `pane`      | conductor から振られた作業（自分の領分ではないもの）。自分のタブへ割る |

- **`refine` を pane 分割で作らない**。幅は人が読むための資源
- **振られた作業のセッション名は `refine-` / `resolve-` で始めない**。内容が分かる名前を付ける（`investigate-ci-timeout` 等）

### 稼働中のセッションへ渡す

止まっているセッションにも動いているセッションにも、**新しいセッションを作らず同じセッションに渡す**。

| 渡す理由                   | 渡す内容                                       |
| -------------------------- | ---------------------------------------------- |
| write lease が空いた       | 実装を始めてよいこと                           |
| integration lease が空いた | 各着地面の統合先へ追随してから着地してよいこと |
| API エラー等での中断       | 中断した事実と、続きから進めること             |
| 計画が失効した             | 交差した変更範囲と、再 plan が要ること         |
| 先行と資源が交差した       | 後発なので安全なチェックポイントで休止すること |

**稼働に移ったことを観測できる手段が要る**（使い道は `../SKILL.md`）。

セッションが失われていたら新規に起こす。文脈は Issue コメントの計画と人待ちの記録から**復元させる**（セッション文脈はキャッシュ、外部化した記録が復旧契約）。conductor が中身を解釈して渡す必要は**ない**。

### 観測する

| 見たいもの                    | 使い道                                                     |
| ----------------------------- | ---------------------------------------------------------- |
| 稼働中セッションの名前と状態  | `runtime` の判定・多重起動の検知                           |
| **全着地面の** worktree 一覧  | `capacity` が `あり` かの判定                              |
| 所有している workspace の一覧 | `capacity` が `prunable` かの判定（checkout が消えた残骸） |

- **worktree 一覧は repo を明示して取る**（「今いる場所」に依存する手段を使わない）
- 引く repo の集合は「制御面 + project 差分の座標表が持つ全着地面」。**「いま使われている面だけ」にも制御面だけにも絞らない**
- 座標表へ面を足すことは、その面を毎周観測すると決めること。使わなくなった面は表から外す
- 面ごとの失敗はその面を `-` にするだけで、ラウンドは捨て**ない**。**制御面の失敗だけがラウンドを無効にする**
- セッションの状態表示だけでは `progress` は分からない。`progress` は git と PR からのみ引く

### 片付ける

**起こしたものによって片付ける対象が違う。**

| 終わったもの                    | 片付けるもの                                                          |
| ------------------------------- | --------------------------------------------------------------------- |
| `refine`（`done`）              | セッションが載っている pane だけ                                      |
| `refine`（`idle`）              | **閉じない。**`retired-refine-<番号>` へ rename するだけ              |
| `resolve`（セッションを置く面） | 下記の 3 つ（workspace ごと消す）                                     |
| `resolve`（二次面）             | 下記の 3 つを **git だけで**行う（`remove-worktree.py` は当たらない） |

| 操作                       | herdr                                             |
| -------------------------- | ------------------------------------------------- |
| rename する                | `herdr agent rename <名前> retired-refine-<番号>` |
| 閉じる直前に生値を取り直す | `herdr agent get <名前>` の `agent_status`        |

**branch を作る述語は 1 つ —— 在れば checkout、無ければ統合先から作る**（`protocols.md` が SSOT）。契機では分かれ**ない**。

**起こし直しで `-b` を使わない**。`-B` や「消して作り直す」へ倒すと、その面に積んだ commit ごと捨てる。

**二次面の path は 1 つの式で決める** —— `<置き場>/<owner>/<repo>/<slug>`。

- `<置き場>` はセッションを置く面の worktree から**2 段上**。「worktree の親」と書か**ない**
- `<owner>` と `<repo>` は面の名前をそのまま 2 段に置く。**owner を落とさない**
- `<slug>` は branch 名の `/` を `-` に置き換えたもの
- **式を 2 通り持たない。その場で決めない**（作る側と消す側が同じ式を使う。容量の帰属も path で引く）

**二次面に `worktree create` を使わない**（worktree・workspace・root pane を一度に作るので pane が増える）。素の `git worktree add` で作り、片付けも git 側の 3 手で行う。**作る手段と消す手段を面ごとに一致させる。**

既存の worktree でセッションだけを起こし直すときは pane を作るだけ（`worktree create` は checkout 済みの branch には使えない）。

着地した worktree は放置すると容量の判定を狂わせる。**checkout を消すだけでは足りない**ので、次の 3 つを 1 手で行う。

1. 重いディレクトリ（`node_modules` / `target` / `dist` / `.turbo`）を退避して background で消す
2. worktree の checkout を消す
3. branch を消す（**merge 済みのときだけ**。未マージなら残す）

**例外は「計画が無効」の差し戻し**。claim を解くのが目的なので claim branch も消す。差し戻してよいかの述語は `../SKILL.md`。ここは消し方だけを持つ。

## herdr での実現

CLI の構文と状態の読み方は `herdr` skill が SSOT。ここに複製しない。

| 契約                                         | herdr                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 名乗る                                       | `herdr agent rename "$HERDR_PANE_ID" conductor`（`--current` は無い。pane ID を渡す）                                                                                                                                                                                         |
| worktree を作る（claim。セッションを置く面） | `herdr worktree create --cwd <その面の checkout> --branch <名> --base <その面の統合先> --label "#<番号>" --no-focus`（**1 課題に 1 回**）                                                                                                                                     |
| tab を作る（refine）                         | `herdr tab create --workspace <id> --cwd <repo> --label "refine-<番号>" --no-focus`                                                                                                                                                                                           |
| pane を作る（振られた作業）                  | `herdr pane split --current --direction right --cwd "$PWD" --no-focus`                                                                                                                                                                                                        |
| pane_id を得る                               | `pane split` は応答が返す。**`worktree create` と `tab create` は返さない**ので `herdr pane list --workspace <id>` で引く                                                                                                                                                     |
| セッションを起こす                           | `herdr agent start <名前> --kind claude --pane <id> --timeout 90000 -- --model <名前>`（`--pane` 以外の受け口は無い。`--` 以降が実行器へ渡る）                                                                                                                                |
| 課題を渡す・再開する                         | `herdr agent prompt <名前> "/refine <番号>"`                                                                                                                                                                                                                                  |
| セッションを観測する                         | `herdr agent list`（`name` / `agent_status` / `cwd`）                                                                                                                                                                                                                         |
| worktree を作る（claim。二次面）             | **`git -C <その面の checkout> worktree add -b <名> <path> <その面の統合先>`**（**pane を作らない**。`<path>` の決め方は下記）                                                                                                                                                 |
| worktree を作り直す（起こし直し。二次面）    | **`git -C <その面の checkout> worktree add <path> <名>`**（**`-b` を付けない。base も渡さない** —— 既存の branch を出すだけ）                                                                                                                                                 |
| worktree を観測する                          | **`git -C <面の checkout> worktree list --porcelain`**（**面ごとに 1 回**）                                                                                                                                                                                                   |
| 実行器だけ止める                             | `herdr agent send-keys <名前> esc`（効かなければ `ctrl+c`）の後 `herdr agent get <名前>` で `agent_status` を読む。**pane・worktree・branch・未コミットの変更は残る。`agent stop` は無い**（割り込みは `send-keys`）。送っても `agent_status` が変わらないときだけ `Conflict` |
| 片付ける（`refine`）                         | `herdr tab close <id>`（**`agent list` の `tab_id` を使う**。pane を閉じても tab は残る）                                                                                                                                                                                     |
| 片付ける（`resolve`）                        | `python3 ~/.config/herdr/remove-worktree.py --workspace <id> --yes`                                                                                                                                                                                                           |
| 片付けに要る workspace ID                    | **`herdr worktree list --cwd <面の checkout>`** の `open_workspace_id`                                                                                                                                                                                                        |
| 孤児 workspace を洗う                        | **`herdr workspace list`**（repo 非依存）                                                                                                                                                                                                                                     |

**3 つの経路は、それぞれ別の問いに対して権威。1 つに寄せない。**

| 問い                                    | 権威                                                 |
| --------------------------------------- | ---------------------------------------------------- |
| checkout があるか                       | git。herdr はそのキャッシュ                          |
| worktree と workspace の対応            | herdr の `open_workspace_id`。**パスで join しない** |
| 孤児 workspace（checkout が消えた残骸） | `workspace list`（repo 非依存）                      |

- `open_workspace_id` が null なら開いている workspace が無いので、その経路だけ落として git で 3 手を行う（checkout を消すだけで済ませ**ない**）
- 孤児の判定は **`worktree.is_linked_worktree` が真かつ `checkout_path` が実在しないものだけ**。`worktree` キーが無い workspace は repo の本体 checkout であって孤児ではない

コマンドの使い方:

- **`herdr worktree list` に `--cwd` を必ず付ける**。省くと返るのは「UI がフォーカスしている workspace の repo」
- `worktree create` は worktree・workspace・root pane を一度に作る。pane を別途 split し**ない**
- **`--json` を付けない**。socket API 経由のコマンドは既定で JSON を返す（`agent start` に付けると exit 2）
- **入力欄への送信は `agent prompt` 以外を使わない**。`pane send-keys <id> enter` も `pane send-text` の改行も submit しない。未送信の下書きは `agent prompt` が捨てるので、事前に消そうとしなくてよい
- **`agent prompt` の引数順は `<名前> <本文>` で、option は本文の後**。`--no-focus` は `agent prompt` には無い
- 稼働の確認は `agent prompt <名前> <本文> --wait --until working`。**既に `working` のセッションに使うと返らず timeout する**ので、**その timeout を失敗として数えない**
- 組み込みの `herdr worktree remove` は片付けの **1 だけ**しか行わない。単体で使わ**ない**

`agent_status` は `idle` / `working` / `done` / `blocked` / `unknown` の 5 値。意味は `herdr` skill が SSOT。

- **`idle` と `done` は別物** —— `idle` は「入力待ち かつ そのタブが focused UI で seen」、`done` は「未 seen のまま background 作業が終わった」。CLI から読んでも seen にはならない
- **`unknown` は「agent は居るが分類できない」**。完了の証明ではないので `Conflict` へ写す（`../SKILL.md` の `runtime`）
- **`blocked` は人待ち**。何を聞かれているかは `herdr pane read <id> --source visible` で読む

**入力欄の文字列は観測材料ではない**。サジェストか人の未送信入力かを区別できないので、どちらの理由にも使わ**ない**。

- 「人の入力かもしれない」で送信を控え**ない**
- **見えた文字列を自分の本文へ写さない**。判断に関わりそうに見えたら、渡すのではなく状況ボードへ出す

片付けは**標準出力から成否が読めない**（返る JSON は通知のエンベロープ）。確認するのは、実際に消す対象にしたものだけ —— 面ごとの worktree 一覧、merge 済みで消したローカル branch、制御面の claim remote branch。

- **未マージのまま残した branch の消滅を条件にしない**（`取り下げ` は意図的に残す）
- **remote branch の消滅だけで確認しない**（二次面の branch はローカルにしか無い）

`HERDR_ENV` が 1 でなければ herdr の外なので、conductor は起動できない。その旨を報告して止まる。

### 起こされる仕組み

**`scripts/watch.sh` は 2 mode で、同じ実装が tick の観測と起床の監視の両方を作る**。同じ形の出力なので、baseline と「tick が action を決めるのに使った観測」が定義上おなじ実体になる（近い時刻ではなく、同じもの）。

| mode                | 走らせ方   | 何を返すか                                                             |
| ------------------- | ---------- | ---------------------------------------------------------------------- |
| `--snapshot <path>` | 前景       | 1 回だけ観測して `<path>` へ書き、stdout にも出す。**tick の観測入口** |
| `--baseline <path>` | background | `<path>` を「前回」として監視する。違ったら exit 0。**取り直さない**   |

**どちらか一方が必須。**

**渡し先の path は tick をまたいで固定する**（conductor は 1 つなので 1 本で足りる）。**世代は持たせない**（走っている watcher は起動時に自分の作業領域へ複製する）。

終了コードで受け方が変わる。

| mode         | exit | 意味                                            | conductor がすること                                           |
| ------------ | ---- | ----------------------------------------------- | -------------------------------------------------------------- |
| `--baseline` | 0    | 変化を検知した / fallback / 観測不能が続いた    | 次の tick に入る                                               |
| `--snapshot` | 0    | 観測できた                                      | **この tick を続ける**（正規化 → action 選択）。終わりではない |
| `--snapshot` | 1    | 観測に失敗した                                  | tick を終える。**直前に成功した snapshot を渡して張る**        |
| どちらも     | 2    | 引数不足・baseline が読めない・コスト gate 超過 | **再起動しない**。状況ボードの「制約・異常」へ出して止まる     |

- **観測は 1 tick に何度も走る**（action のあと・記録を書いたあとのやり直し）。exit 0 で tick を終え**ない**
- **baseline が読めないときも 2 に倒す**（自分で取り直す側へ倒すと窓ができる）
- 1 でも張る。`--snapshot` は失敗しても既存の file を壊さない

**観測の実装 SSOT はスクリプト。**prose から同等物を書き直さ**ない**。変えたいことがあるならスクリプトを直す。

project 固有値は引数で渡す（**座標は project 差分が持ち、実装は共通側が持つ**）。

```
scripts/watch.sh (--snapshot <path> | --baseline <path>)
                 --repo <path> --gh-repo <owner/name>
                 [--landing <owner/name>:<統合先 ref>:<checkout>]...
                 --project-org <org> --project-number <n> --status-field <name>
                 --sessions-cmd <cmd> --workspaces-cmd <cmd>
```

- `--repo` は制御面。`--landing` は**制御面以外の着地面を面の数だけ**渡す（制御面は重ねて渡さない）
- **渡し忘れた面は観測に出ない** —— そこで書き進んでいる課題が成果ゼロの周として数えられる
- `--landing` は**checkout を最後に置く**。repo 名と ref に `:` は現れないので、最初の 2 つの `:` だけで切れば `:` を含む path が通る。**順序を入れ替えて書き写さない**
- **`--interval` と `--max` は渡さない**（既定のまま使う）。窓を抑えるために縮めるものでは**ない**

`--sessions-cmd` / `--workspaces-cmd` を引数にしているのは、スクリプトに multiplexer を知らせないため。注入するコマンドの契約は 3 つ。

1. 整列済みの行を出す
2. 取得に失敗したら非 0
3. 空になり得ない一覧なら、**空のときも非 0**（`| grep .` を末尾に付ける）

herdr なら:

```bash
# --sessions-cmd
herdr agent list | jq -S -r '.result.agents[]? | select(.name != null)
  | if .name == "conductor" then "conductor present"
    elif (.name | test("^(retired-)?(refine|resolve)-[0-9]+$")) then "\(.name) \(.agent_status)"
    else empty end' | sort | grep .

# --workspaces-cmd
herdr workspace list | jq -S -r '.result.workspaces[]? | "\(.workspace_id) \(.worktree.checkout_path // "-")"' | sort | grep .
```

**何を入れて何に畳むかは `../SKILL.md` の「いつ打つか」が SSOT。ここで省かない**。ここは herdr での写し方だけ。

**この 2 つはそのまま渡す。手で書き直さない。**

- **`.name // .pane_id` を使わない**（無名 pane まで拾う）
- conductor の存在は `conductor present` という固定文字列で残す（状態は落とす）。2 本目が居れば同じ行が 2 つ並ぶ
- **`done` と `idle` を畳まない**（片付け方が違う）
- **`retired-refine-<番号>` も拾う**（rename しても対象 Issue の再計画は塞ぐ）

worktree 一覧は面ごとの checkout から取る（スクリプトが `--repo` と `--landing` から行う）。

#### コストは「リクエスト数」ではなくノード数で決まる

**GraphQL のコスト = ceil(要求ノード総数 ÷ 100)**（最小 1）。

- **`gh project item-list` を使わない —— 観測でも書き込みでも**。item ごとに全 field 値を取る（`fieldValues(first:100)`）のでノード数が `件数 × 100` になる。`fieldValueByName` は単一ノードで `件数`。`item-add` など mutation 系はそのままでよい
- **書き込みに要る item ID は、ボードではなく Issue 側から引く**（`repository.issue(number:)` の `projectItems` を project 番号で絞る。具体のクエリは project 側のボード規約）
- **`--limit` で回避しない** —— コストが上がるうえ、「打ち切られた」と「そもそも載っていない」がどちらも空で返る
- 引けなかったら**書かずに止める**
- **REST は GraphQL とは別枠で 0 pt**。Issue 一覧を REST 経由にしてあるのは取りこぼしを塞ぐため（`--limit N` は N を超えると不完全なまま非 0 件で返る）
- 1 周のコストは O(items)。Project の item は単調増加する

**間隔は遅延の調整であって、形状バグの吸収に使わない。直すのはクエリの形状。**

**GraphQL 枠は全セッションの共有資源**（conductor と並走する `refine` / `resolve` が同じトークン）。1 周のコストはスクリプト自身が `rateLimit { cost }` で申告し、`--cost-limit` を超えたら起動を止める。**`graphql.used` の差分では測らない**（並走セッション分が混ざる）。

#### 間隔を決めるのは枠ではない

**間隔を縮めても tick の回数は増えない**（watcher は指紋が変わったときだけ起こす）。増えるのは安い側だけなので、**「枠の節約」を理由に間隔を伸ばさない**。

既定の 60 秒を決めているのは 1 周の所要時間。**`--deadline` を典型値と読み違えない** —— あれはハングを切る上限。

**GitHub の webhook でポーリングを置き換えない**。指紋のうち sessions・workspaces・worktree の dirty は GitHub に何も起こさず、**そのうち sessions が「枠が空いた」を伝える唯一の経路**。イベント化するとしたら multiplexer 側から。

#### ラウンドの有効判定

**判定は各取得の成功可否であって、空集合の有無ではない。**「非空 = 成功」にしない。

**観測できない状態が続いても fallback 起床は発火させる**。縮退の仕方（backoff・項目を間引かない・観測不能を状況ボードへ出す）は `../SKILL.md`。

## 交代

**context が尽きる前に、別 pane の後継へ渡して自分は退く**。tick は冪等で観測から組み立て直せるので、**渡すのは観測に出ないものだけ**。

手順（既存の受け口だけで足りる。新しい仕組みを作らない）:

1. `pane split` で pane を作り、`conductor-next` で `agent start`（**同名で立てない**。多重起動の判定に触れる）
2. `agent prompt` で `/conductor` を渡す。引き継ぎ本文は原則として付け**ない**
3. 後継が観測を始めたことを `agent list` で確認する
4. **自分を `conductor-prev` へ rename してから、後継を `conductor` へ rename する**（逆順だと同名が 2 本並ぶ）
5. 引き継ぎを応答に残して idle になる。**自分の pane は閉じない**

後継の側:

- **毎 tick、`agent list` で `conductor-prev` を探し、居たら pane を閉じる**（`tab_id` ではなく `pane_id`。交代は pane 単位）
- **「起動直後に 1 回だけ」にしない**。rename は後継が観測を始めた後なので、起動直後には `conductor-prev` はまだ存在しない
- **`agent list` を直接引く**。起床 snapshot は conductor 自身の状態を `conductor present` へ畳むので、`conductor-prev` はそこに現れない

### 引き継ぎに何も書かないのが既定

**`/conductor` だけで立ち上がることを目標にする**。書きたくなったものが出たら、まず永続化できないかを疑う。

| 書きたくなったもの                     | 本来の行き先                             |
| -------------------------------------- | ---------------------------------------- |
| 優先順位・次に着手するもの             | ボードの並び順（規約上そこが SSOT）      |
| 依存・同居の関係                       | Issue 本文の宣言行                       |
| 伝えた休止・人待ち・渡した merge の枠  | Issue の固定 marker 付きコメント         |
| 渡した write の枠                      | 記録を作らない（保持は観測から導出する） |
| 踏んだ失敗の型・規約の穴               | Issue（起票の条件は `../SKILL.md`）      |
| 座標（org / Project 番号 / Status 名） | project 側の skill                       |

**それでも残るのは 2 つだけ**。どちらも観測に出ないので、これだけは書く。

- 人が口頭で示した判断で、まだ Issue にもボードにも落ちていないもの（落とせるなら落として、書かずに済ませる）
- **人の領分だと明示されたもの**（未 push の commit 等。触らないこと自体が指示なので、観測できても実行してはいけない）

**「観測すれば分かるが探す手間を省く」ものは書かない**。探す手間は tick 1 周ぶんで、誤った前提は全 tick に効く。
