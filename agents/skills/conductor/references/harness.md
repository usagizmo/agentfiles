# harness adapter

conductor が terminal multiplexer に対して行う操作。**差し替えるときは「herdr での実現」以降だけを
書き換える。**conductor 本体はここ以外で multiplexer を知らない。

## 契約

手段によらず必要なもの。

### 名乗る

**起動したら最初に自分のセッションへ固定名を付ける。**多重起動の検知に要る。
名前が無いと自分を一覧から見つけられず、2 つ目が走っても気づけない。
tick の観測で同じ名前が自分以外にも居たら止まる。

### 人待ちを観測する

**セッションが「人の答え待ちで止まっている」ことを、中断と区別して返せること。**区別できないと
conductor が人待ちを中断と読んで再開を送り続ける。

**印は無くてもよい**（人待ちの SSOT は Issue の記録で、印は即時観測用のキャッシュ）。
印と記録が食い違ったときの判定は `../SKILL.md`。

### 停止中のセッションが自走できないこと

**禁じるのは自走**（外部入力なしに書き始めること）。止まっているセッションが誰にも触られずに
再開できる harness だと、write を返したはずの課題が勝手に再開して交差を作る。

**人がセッションへ直接答えるのは正常経路。**人待ちはそうやって解ける — 答えを受けた子が
記録を `cleared` にし、次の tick で `待機` として観測され、conductor が枠を渡し直す。
conductor が回答を仲介する必要はない（中身の解釈は conductor の領分ではない）。

このとき必要になるのは grant 世代を持つ fencing token だが、**入力が conductor 経由でしか
通らない限り不要**なので置かない。その前提が崩れる harness を足すときに入れる。

### 起こす

起こすものは 2 種類あり、**必要な隔離が違う**。

| 起こすもの | worktree | 渡すもの |
| --- | --- | --- |
| `refine` | **要らない**（読み取りのみ。既存の checkout で足りる） | `/refine <Issue 番号>` |
| `resolve` | claim した branch の worktree を作る（**既にあるなら pane だけ**） | `/resolve <代表> [成員…]`（group なら**対象集合の全番号**。復旧時も同じ） |

どちらも **完了を待たない。**次の tick へ戻る（完了検知は tick の観測で足りる）。
渡すのは Issue 番号だけで、起こされた側は Issue 本文を読んで自分で文脈を作る
（親セッションの文脈は引き継がれない前提で Issue 契約が要求されている）。

**セッション名は `refine-<番号>` / `resolve-<番号>` に固定する。**観測時に工程まで名前で分かる。

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

**渡したら、稼働したことを観測してから次へ進む。**確認しないと、まだ止まって見える課題へ同じ枠を
もう一度渡せる（資源キーが交差する 2 つが同時に書く）。

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

**worktree 一覧は repo を明示して取る。**conductor は複数 repo を跨ぐので、
「今いる場所」に依存する手段だと、別 repo を触った瞬間に対象が観測から消える。

セッションの状態表示だけでは `progress` は分からない。`progress` は git と PR からのみ引く。

### 起こされる

状態のスナップショットを定期的に取り、**前回と違ったときだけ conductor を起こす**手段が要る
（何を入れて何に丸めるかは `SKILL.md`）。

### 実行器だけ止める

**セッションを止め、worktree・workspace・branch・未コミットの変更は残せること。**差し戻しの前に
実行器を黙らせるために要る（止めずに枠を移すと、書き続ける実行器と新しい借り手が衝突する）。

**止まったことを観測できるまでは資源を解放しない。**止められない harness なら `Conflict` として
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

**例外は「計画が無効」の差し戻し。**claim を解くのが目的なので、**commit が無いことを確認して
から claim branch を消す**（残すと `progress` が `準備中` のままで台帳が押し戻される）。
commit があるなら差し戻さない。

### 差し替えの条件

上を写せる手段なら何でもよい。使えない手段を弾く条件は 2 つ。

- **起動が非同期であること**（親が子の完了をブロックしない）
- **稼働中のセッションを一覧で観測できること**（tick が現実を読めない手段は使えない）

## herdr での実現

CLI の構文と状態の読み方は `herdr` skill が SSOT。ここに複製しない。

| 契約 | herdr |
| --- | --- |
| 名乗る | `herdr agent rename "$HERDR_PANE_ID" conductor`（`--current` は無い。pane ID を渡す） |
| worktree を作る（resolve のみ） | `herdr worktree create --cwd <repo> --branch <名> --base <default> --label "#<番号>" --no-focus --json` |
| pane を作る（refine） | `herdr pane split --current --direction right --cwd "$PWD" --no-focus` |
| セッションを起こす | 得た pane_id に `herdr agent start <名前> --kind claude --pane <id> --timeout 90000` |
| 課題を渡す・再開する | `herdr agent prompt <名前> "/refine <番号>"` |
| セッションを観測する | `herdr agent list`（`name` / `agent_status` / `cwd`） |
| worktree を観測する | **`git -C <repo> worktree list --porcelain`** |
| 実行器だけ止める | `herdr agent stop <名前>` の後 `herdr agent list` で `agent_status` が消えたことを確認（pane は閉じない） |
| 片付ける（`refine`） | `herdr pane close <id>` |
| 片付ける（`resolve`） | `python3 ~/.config/herdr/remove-worktree.py --workspace <id> --yes` |
| 片付けに要る workspace ID | **`herdr workspace list`**（`worktree.checkout_path` で絞る） |

- **`herdr worktree list` は使わない。**返るのは「UI がフォーカスしている workspace の repo」で、
  conductor の cwd とは無関係。別 repo にフォーカスが移った瞬間、対象 repo の worktree が観測から
  丸ごと消え、片付け済みと誤判定する。一覧は `git -C <repo>`、workspace ID は
  **`herdr workspace list`**（repo に依存せず全 workspace を返す）から引く
- `worktree create` は worktree・workspace・root pane を**一度に作る**。pane を別途 split しない
- `agent start` に `--json` は無い（付けると exit 2 の構文エラー）。既定で JSON が返る
- `agent_status` は `idle` / `working` / `done` / `blocked` の 4 値しか返らない
- **`blocked` は人待ち**（選択肢の提示で止まっている）。詰まりの検知はここで引き、
  何を聞かれているかは `herdr pane read <id> --source visible` で読む
- **入力欄への送信は `agent prompt` 以外を使わない。**`pane send-keys <id> enter` も
  `pane send-text` の改行も agent の入力欄を submit しない（キーは届くが送信されない）。
  未送信の下書きが残っていても `agent prompt` はそれを捨てて自分の本文だけを送るので、
  事前に消そうとしなくてよい
- **`agent prompt` の引数順は `<名前> <本文>` で、option は本文の後。**`--no-focus` は
  `worktree create` / `pane split` にはあるが `agent prompt` には無い。前に置くと
  **本文が unknown option として弾かれる**（`/refine ...` が option 名として報告されるので、
  slash command のせいに見えて紛らわしい）
- **`agent prompt <名前> <本文> --wait --until working` で稼働を確認してから tick を終える**
  （完了を待つのとは別。確認しないと、まだ `待機` に見える課題へ同じ枠をもう一度渡せる）
- 組み込みの `herdr worktree remove` は片付けの **1 だけ**しか行わない。単体で使わない
- 片付けは**標準出力から成否が読めない**（通知の JSON しか返らない）。worktree 一覧と
  remote branch が両方消えたことで確認する。同じスクリプトは popup（`prefix+shift+X`）からも呼べる

`HERDR_ENV` が 1 でなければ herdr の外なので、conductor は起動できない。その旨を報告して止まる。

### 起こされる仕組み

スナップショットを 60 秒ごとに取り、前回と違ったときだけ 1 行出すプロセスを background で走らせる。

**入れる項目は `../SKILL.md` の「いつ打つか」が SSOT。ここで省かない。**省いた項目だけが変わる
遷移は永久に起きない（checks が緑になっても起床しなければ integration は一生出ない）。

- worktree 一覧は上記のとおり `git -C <repo>` で取る
- **conductor 自身を除外する**（`.name != "conductor"`）。応答のたびに `working` ⇄ `idle` する
- **GitHub 側は 1 回のクエリにまとめる。**Issue の state と Status、PR の state と checks、
  固定 marker のコメントを個別に叩くと GraphQL 枠が枯渇する。**枠が足りないなら間隔を延ばす**
  （項目を落とすと遷移が止まるが、間隔なら遅れるだけで済む）
- 観測が丸ごと空になった回は握りつぶす（一時的な API 断で誤検知しない）
