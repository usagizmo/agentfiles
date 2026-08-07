# harness adapter

conductor が terminal multiplexer に対して行う操作。**差し替えるときは「herdr での実現」以降だけを
書き換える**。conductor 本体はここ以外で multiplexer を知らない。

## 契約

手段によらず必要なもの。

### 名乗る

**起動したら最初に自分のセッションへ固定名を付ける**。多重起動の検知に要る。
名前が無いと自分を一覧から見つけられず、2 つ目が走っても気づけない。
tick の観測で同じ名前が自分以外にも居たら止まる。

### 人待ちを観測する

**セッションが「人の答え待ちで止まっている」ことを、中断と区別して返せること**。区別できないと
conductor が人待ちを中断と読んで再開を送り続ける。

**印は無くてもよい**（人待ちの SSOT は Issue の記録で、印は即時観測用のキャッシュ）。
印と記録が食い違ったときの判定は `../SKILL.md`。

### 停止中のセッションが自走できないこと

**禁じるのは自走**（外部入力なしに書き始めること）。止まっているセッションが誰にも触られずに
再開できる harness だと、write を返したはずの課題が勝手に再開して交差を作る。

**人がセッションへ直接答えるのは正常経路**。人待ちはそうやって解ける — 答えを受けた子が
記録を `cleared` にし、次の tick で `待機` として観測され、conductor が枠を渡し直す。
conductor が回答を仲介する必要はない（中身の解釈は conductor の領分ではない）。

**人が conductor 側に答えてしまったときだけ、当のセッションへそのまま渡す。****起きる局面は
これ 1 つ** —— 自分から宛先を選んで運ぶことはしない**。要約も言い換えもせず、action にも数えない**
（宛先も中身も決めたのは人）。「別の pane で打ち直してください」と返さない —— 形だけ守って
人の手を止める動きになる。

このとき必要になるのは grant 世代を持つ fencing token だが、**入力が conductor 経由でしか
通らない限り不要**なので置かない。その前提が崩れる harness を足すときに入れる。

### 起こす

起こすものは 2 種類あり、**必要な隔離が違う**。

| 起こすもの | worktree | 渡すもの |
| --- | --- | --- |
| `refine` | **要らない**（読み取りのみ。既存の checkout で足りる） | `/refine <Issue 番号>` |
| `resolve` | claim した branch の worktree を作る（**既にあるなら pane だけ**） | `/resolve <代表> [成員…]`（group なら**対象集合の全番号**。復旧時も同じ） |

どちらも **完了を待たない**。次の tick へ戻る（完了検知は tick の観測で足りる）。
渡すのは Issue 番号だけで、起こされた側は Issue 本文を読んで自分で文脈を作る
（親セッションの文脈は引き継がれない前提で Issue 契約が要求されている）。

**セッション名は `refine-<番号>` / `resolve-<番号>` に固定する**。観測時に工程まで名前で分かる。

### 稼働中のセッションへ渡す

止まっているセッションにも動いているセッションにも、**新しいセッションを作らず同じセッションに渡す**。
prepare で読んだ文脈がそこに残っているのが、同一セッションで待たせる理由そのもの。

| 渡す理由 | 渡す内容 |
| --- | --- |
| write lease が空いた | 実装を始めてよいこと |
| integration lease が空いた | latest default へ追随してから着地してよいこと |
| API エラー等での中断 | 中断した事実と、続きから進めること |
| **計画が失効した** | 交差した変更範囲と、再 plan が要ること |
| **先行と資源が交差した** | 後発なので安全なチェックポイントで休止すること |

**稼働に移ったことを観測できる手段が要る**（使い道は `../SKILL.md`）。

セッションが失われていたら新規に起こす。その場合は Issue コメントの計画と人待ちの記録から
文脈を復元させる（**セッション文脈はキャッシュ、外部化した記録が復旧契約**）。
起こされた側が起動時に記録を読む契約なので、conductor が中身を解釈して渡す必要はない。

### 観測する

tick が読むもの。

| 見たいもの | 使い道 |
| --- | --- |
| 稼働中セッションの名前と状態 | `runtime` の判定・多重起動の検知 |
| **対象 repo の** worktree 一覧 | `capacity` が `あり` かの判定 |
| **所有している workspace の一覧** | `capacity` が `prunable` かの判定（checkout が消えた残骸） |

**worktree 一覧は repo を明示して取る**。conductor は複数 repo を跨ぐので、
「今いる場所」に依存する手段だと、別 repo を触った瞬間に対象が観測から消える。

セッションの状態表示だけでは `progress` は分からない。`progress` は git と PR からのみ引く。

### 起こされる

状態のスナップショットを定期的に取り、**前回と違ったときだけ conductor を起こす**手段が要る
（何を入れて何に丸めるかは `../SKILL.md`）。

### 実行器だけ止める

**セッションを止め、worktree・workspace・branch・未コミットの変更は残せること**。差し戻しの前に
実行器を黙らせるために要る（止めずに枠を移すと、書き続ける実行器と新しい借り手が衝突する）。

**止まったことを観測できるまでは資源を解放しない**。止められない harness なら `Conflict` として
報告する（黙って進めない）。

### 片付ける

**起こしたものによって片付ける対象が違う。**`refine` は worktree を持たないので、
worktree 前提の手順をそのまま当てると何も片付かない。

| 終わったもの | 片付けるもの |
| --- | --- |
| `refine` | セッションが載っている pane だけ |
| `resolve` | 下記の 3 つ |

**既存の worktree でセッションだけを起こし直すときは pane を作るだけ**（`worktree create` は
既に checkout 済みの branch には使えない）。実装を残したまま実行器だけ差し替える経路がこれ。

着地した worktree は放置すると容量の判定を狂わせる。**checkout を消すだけでは足りない**
（branch と `node_modules` が残る）ので、次の 3 つを 1 手で行う。

1. 重いディレクトリ（`node_modules` / `target` / `dist` / `.turbo`）を退避して background で消す
2. worktree の checkout を消す
3. branch を消す（**merge 済みのときだけ**。未マージなら残す）

**例外は「計画が無効」の差し戻し**。claim を解くのが目的なので、**claim branch も消す**
（残すと `progress` が `準備中` のままで台帳が押し戻される）。
**差し戻してよいかの述語は `../SKILL.md` の差し戻し表**。ここは消し方だけを持つ
—— 述語を 2 箇所に置くと、片方だけ直したときに実装を消す経路が残る。

### 差し替えの条件

上を写せる手段なら何でもよい。使えない手段を弾く条件は 2 つ。

- **起動が非同期であること**（親が子の完了をブロックしない）
- **稼働中のセッションを一覧で観測できること**（tick が現実を読めない手段は使えない）

## herdr での実現

CLI の構文と状態の読み方は `herdr` skill が SSOT。ここに複製しない。

| 契約 | herdr |
| --- | --- |
| 名乗る | `herdr agent rename "$HERDR_PANE_ID" conductor`（`--current` は無い。pane ID を渡す） |
| worktree を作る（resolve のみ） | `herdr worktree create --cwd <repo> --branch <名> --base <default> --label "#<番号>" --no-focus` |
| pane を作る（refine） | `herdr pane split --current --direction right --cwd "$PWD" --no-focus` |
| pane_id を得る | `pane split` は応答が返す。**`worktree create` は返さない**（`workspace` と `worktree` だけ）ので `herdr pane list --workspace <id>` で引く |
| セッションを起こす | `herdr agent start <名前> --kind claude --pane <id> --timeout 90000`（`--pane` 以外の受け口は無い） |
| 課題を渡す・再開する | `herdr agent prompt <名前> "/refine <番号>"` |
| セッションを観測する | `herdr agent list`（`name` / `agent_status` / `cwd`） |
| worktree を観測する | **`git -C <repo> worktree list --porcelain`** |
| 実行器だけ止める | `herdr agent send-keys <名前> esc`（効かなければ `ctrl+c`）の後 `herdr agent get <名前>` で `agent_status` を読む。**pane・worktree・branch・未コミットの変更は残る。`agent stop` は無い**（割り込みは `send-keys`）。**送っても `agent_status` が変わらないときだけ `Conflict`** |
| 片付ける（`refine`） | `herdr pane close <id>` |
| 片付ける（`resolve`） | `python3 ~/.config/herdr/remove-worktree.py --workspace <id> --yes` |
| 片付けに要る workspace ID | **`herdr worktree list --cwd <repo>`** の `open_workspace_id` |
| 孤児 workspace を洗う | **`herdr workspace list`**（repo 非依存） |

- **3 つの経路は、それぞれ別の問いに対して権威**。1 つに寄せない。
  - **checkout があるか**（`capacity` が `あり`）は git。**herdr はそのキャッシュ**で、
    conductor は着地を PR の `merged`、claim を remote branch と、常に権威側を見る。ここだけ
    multiplexer に寄せると、socket が落ちた瞬間に全 tick が止まる
  - **worktree と workspace の対応**は herdr しか知らない。**`open_workspace_id` を直接引き、
    パスで join しない** — 文字列一致は symlink 解決差や `/private` 前置で silent に外れ、
    外れると片付けが workspace を見つけられずに worktree が残る（容量が漏れる）。
    **null なら開いている workspace が無い**。片付けの 3 手は変わらず要るので、
    workspace ID を取る経路だけ落として git で 3 手を行う（**checkout を消すだけで済ませない**）
  - **孤児 workspace**（checkout が消えた残骸）は repo 非依存に列挙するしかない。
    `worktree list --cwd` は repo スコープなので、repo ごと消えたものが見えない。
    **判定は `worktree.is_linked_worktree` が真かつ `checkout_path` が実在しないものだけ。**
    `worktree` キーが無い workspace は repo の本体 checkout であって孤児ではない
    （実測で 16 中 9 がこれ。混同すると生きた workspace を片付けにいく）
- **`herdr worktree list` に `--cwd` を必ず付ける**。省くと返るのは「UI がフォーカスしている
  workspace の repo」で、conductor の cwd とは無関係。別 repo にフォーカスが移った瞬間、対象 repo の
  worktree が観測から丸ごと消え、片付け済みと誤判定する
- `worktree create` は worktree・workspace・root pane を**一度に作る**。pane を別途 split しない
- **`--json` を付けない**。socket API 経由のコマンドは既定で JSON を返す。
  `agent start` に付けると exit 2 の構文エラーになる
- `agent_status` は `idle` / `working` / `done` / `blocked` の 4 値しか返らない
- **`blocked` は人待ち**（選択肢の提示で止まっている）。詰まりの検知はここで引き、
  何を聞かれているかは `herdr pane read <id> --source visible` で読む
- **入力欄への送信は `agent prompt` 以外を使わない。**`pane send-keys <id> enter` も
  `pane send-text` の改行も agent の入力欄を submit しない（キーは届くが送信されない）。
  未送信の下書きが残っていても `agent prompt` はそれを捨てて自分の本文だけを送るので、
  事前に消そうとしなくてよい
- **入力欄の文字列は観測材料ではない**。Claude Code のサジェストか人の未送信入力かを、
  **見ただけでは区別できない。**だから**どちらの理由にも使わない**。
  - **「人の入力かもしれない」で送信を控えない**。控えると、その pane へ渡す action が
    **永久に選べなくなる**（実測で 11 tick 止めた）
  - **見えた文字列を自分の本文へ写さない。**サジェストだった場合、
    **誰も決めていないものを conductor が指示として確定させてしまう**
  送るのは自分の本文だけでよい。`agent prompt` が入力欄を捨てるのは正しい挙動で、
  サジェストなら捨てられるべきもの、人の入力なら本人が送り直せる。
  中身が判断に関わりそうに見えたら、渡すのではなく**状況ボードへ出して人へ返す**
- **`agent prompt` の引数順は `<名前> <本文>` で、option は本文の後。**`--no-focus` は
  `worktree create` / `pane split` にはあるが `agent prompt` には無い。前に置くと
  **本文が unknown option として弾かれる**（`/refine ...` が option 名として報告されるので、
  slash command のせいに見えて紛らわしい）
- 稼働の確認は `agent prompt <名前> <本文> --wait --until working`
- 組み込みの `herdr worktree remove` は片付けの **1 だけ**しか行わない。単体で使わない
- 片付けは**標準出力から成否が読めない**（返る JSON は通知のエンベロープで、削除の結果ではない）。worktree 一覧と
  remote branch が両方消えたことで確認する。同じスクリプトは popup（`prefix+shift+X`）からも呼べる

`HERDR_ENV` が 1 でなければ herdr の外なので、conductor は起動できない。その旨を報告して止まる。

### 起こされる仕組み

**`scripts/watch.sh` を background で走らせる**。終了コードで受け方が変わる。

| exit | 意味 | conductor がすること |
| --- | --- | --- |
| 0 | 変化を検知した / fallback / 観測不能が続いた | 次の tick に入る |
| 2 | 引数不足・**コスト gate 超過** | **再起動しない**。状況ボードの「制約・異常」へ出して止まる |

**2 で再起動しない**のが要点。形状バグを直さないまま起こし直すと、1 ラウンドずつ枠を焼きながら
同じところで落ち続ける（gate が「止める」にならない）。

**観測の実装 SSOT はスクリプト**。prose から同等物を書き直さない —— 毎セッション書き直すと、
そのたびに別の形へ崩れる。**変えたいことがあるならスクリプトを直す。**

project 固有値は引数で渡す（**座標は project 差分が持ち、実装は共通側が持つ**）。

```
scripts/watch.sh --repo <path> --gh-repo <owner/name>
                 --project-org <org> --project-number <n> --status-field <name>
                 --sessions-cmd <cmd> --workspaces-cmd <cmd>
```

`--sessions-cmd` / `--workspaces-cmd` を引数にしているのは、**スクリプトに multiplexer を
知らせないため**（conductor 本体がここ以外で multiplexer を知らないのと同じ理由）。
注入するコマンドの契約は 3 つ —— 整列済みの行を出す、**取得に失敗したら非 0**、
**空になり得ない一覧なら空のときも非 0**（`| grep .` を末尾に付ける）。
3 つ目が要るのは、**exit 0 で空が返るのが実際に起きる**から。
Project の Status が一時的に空で返り、全 Issue の Status が消えたように見えて誤起床した。

herdr なら:

```bash
# --sessions-cmd
herdr agent list | jq -S -r '.result.agents[]? | select(.name != null)
  | if .name == "conductor" then "conductor present"
    elif (.name | test("^(refine|resolve)-[0-9]+$")) then
      "\(.name) \(if .agent_status == "done" or .agent_status == "idle" then "waiting" else .agent_status end)"
    else empty end' | sort | grep .

# --workspaces-cmd
herdr workspace list | jq -S -r '.result.workspaces[]? | "\(.workspace_id) \(.worktree.checkout_path // "-")"' | sort | grep .
```

**何を入れて何に畳むかは `../SKILL.md` の「いつ打つか」が SSOT。ここで省かない**
（省いた項目だけが変わる遷移は永久に起きない）。ここは herdr での写し方だけ。

- **`.name // .pane_id` を使わない**。無名 pane まで拾ってしまい、別 repo の pane の状態変化で起床する
- conductor の存在は `conductor present` という固定文字列で残す（状態は落とす）。
  2 本目が居れば同じ行が 2 つ並ぶ
- `done` と `idle` は `waiting` へ畳む。`working` と `blocked` はそのまま

worktree 一覧は上記のとおり `git -C <repo>` で取る（スクリプトが `--repo` から行う）。

#### コストは「リクエスト数」ではなくノード数で決まる

**GraphQL のコスト = ceil(要求ノード総数 ÷ 100)**（最小 1）。ここを知らないと、正しい項目を
正しい回数で取っていても枯れる。

- **`gh project item-list` を観測に使わない。**item ごとに全 field 値を取る（`fieldValues(first:100)`）
  ので**ノード数が `件数 × 100`** になる。実測で 300 件 = **406 pt**（枠 5,000 の 8%）。
  `fieldValueByName` は connection ではなく単一ノードなので**ノード数が `件数`** で、
  同じ 187 行が **2 pt**。`item-add` など mutation 系はそのままでよい
- **REST は GraphQL とは別枠で 0 pt。**Issue 一覧を REST 経由にしてあるのは取りこぼしを塞ぐため
  （`--limit N` は N を超えると**不完全なまま非 0 件で返る**ので使わない）。枠の節約は副次
- **1 周のコストは O(items)**。Project の item は単調増加するので、いずれ効いてくる
  （1,000 件でも 10 pt/周なので当面は問題にならない）

**間隔は遅延の調整であって、形状バグの吸収に使わない**。間隔を倍にしても形状が悪ければ半分にしか
ならず、枯れるものは枯れる（406 pt/周は間隔を 2 倍にしても 6,150 pt/時で枠を超える）。
**直すのはクエリの形状。**

**GraphQL 枠は全セッションの共有資源。**conductor 1 本と、並走する `refine` / `resolve` が
同じトークンを使う。watcher が焼き切ると**`gh` を使う全セッションが同時に止まる**ので、
1 周のコストはスクリプト自身が `rateLimit { cost }` で申告し、`--cost-limit` を超えたら起動を止める
（`graphql.used` の差分では並走セッション分が混ざって自分のコストを測れない）。

#### 間隔を決めるのは枠ではない

**間隔を縮めても tick の回数は増えない。**watcher は指紋が変わったときだけ起こすので、
増えるのは観測の回数だけで、tick の回数は盤面が実際に変わった回数で決まる。
**増えるのは安い側（GitHub API と `git fetch`）だけで、高い側（conductor の context）は増えない。**
だから**「枠の節約」を理由に間隔を伸ばさない** —— 伸ばして得るものは無く、失うのは検知の遅延だけ。

既定の 60 秒を決めているのは **1 周の所要時間**（Project の GraphQL・Issue とコメントの REST・
`gh pr list`・`git fetch`・worktree ごとの `git status`）。間隔がこれに近づくと実質常時観測になり、
遅延の短縮が頭打ちになる。**`--deadline` を典型値と読み違えない** —— あれはハングを切る上限で、
1 周の所要時間ではない。

**GitHub の webhook でポーリングを置き換えない**。指紋のうち sessions・workspaces・worktree の
dirty は GitHub に何も起こさず、**そのうち sessions が「枠が空いた」を伝える唯一の経路**。
GitHub 側だけイベント化しても実効の間隔はローカル側が決めたままで、**いちばん速くしたい遷移が
1 秒も縮まない**（受け口として公開 endpoint が要り、private repo の Issue 本文が第三者を経由する
点も別途重い）。イベント化するとしたら multiplexer 側から。

#### ラウンドの有効判定

**判定は各取得の成功可否であって、空集合の有無ではない。**「非空 = 成功」にすると、
子セッションが 0 件のときの一覧や open PR が無いときの一覧を失敗と読んで毎回無効化し、
逆に**失敗して空を返した取得を正常として受理する。**

**観測できない状態が続いても fallback 起床は発火させる**。失敗を握りつぶして次の周へ送り続けると、
rate limit 中に盲目のまま再試行し、**永久に起きない**。縮退の仕方（backoff・項目を間引かない・
観測不能を状況ボードへ出す）は `../SKILL.md`。

## 交代

**context が尽きる前に、別 pane の後継へ渡して自分は退く**。tick は冪等で観測から組み立て直せるので、
**渡すのは観測に出ないものだけ**。それ以外を書くと、後継が読むのに時間と context を二重に使う。

**手順**（既存の受け口だけで足りる。新しい仕組みを作らない）。

1. `pane split` で pane を作り、**別名**で `agent start`（同名で立てると多重起動の判定に触れる）
2. `agent prompt` で `/conductor <引き継ぎ本文>` を渡す
3. 後継が観測を始めたことを `agent list` で確認する
4. **自分を別名へ rename してから、後継を本来の名前へ rename する**（逆順だと同名が 2 本並ぶ）
5. 引き継ぎを応答に残して idle になる。**pane を閉じるのは人**

| 引き継ぎに書く                                             | 書かない                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| 外部化していない判断（渡した枠・伝えた休止・次に伝えること） | Issue / Status / branch / PR / 記録から読めるもの |
| 自分が踏んだ失敗の型                                       | 成功した tick の履歴                           |
| 未 push の commit（**人の領分なので触らない**）            | 状況ボードに出ている内容                       |

**「観測すれば分かるが探す手間を省く」ものは、書いてよいが最後に置く**。先頭に置くと後継が
**観測より先にそれを信じる** —— 「前回の続きを仮定しない」が崩れる。
