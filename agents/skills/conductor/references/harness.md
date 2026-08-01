# harness adapter

conductor が terminal multiplexer に対して行う操作。**差し替えるときは「herdr での実現」以降だけを
書き換える。**conductor 本体はここ以外で multiplexer を知らない。

## 契約

手段によらず必要なもの。

### 名乗る

**起動したら最初に自分のセッションへ固定名を付ける。**多重起動の検知に要る。
名前が無いと自分を一覧から見つけられず、2 つ目が走っても気づけない。
tick の観測で同じ名前が自分以外にも居たら止まる。

### 起こす

起こすものは 2 種類あり、**必要な隔離が違う**。

| 起こすもの | worktree | 渡すもの |
| --- | --- | --- |
| `refine` | **要らない**（読み取りのみ。既存の checkout で足りる） | `/refine <Issue 番号>` |
| `resolve` | claim した branch の worktree を作る | `/resolve <Issue 番号>` |

どちらも **完了を待たない。**次の tick へ戻る（完了検知は tick の観測で足りる）。
渡すのは Issue 番号だけで、起こされた側は Issue 本文を読んで自分で文脈を作る
（親セッションの文脈は引き継がれない前提で Issue 契約が要求されている）。

**セッション名は `refine-<番号>` / `resolve-<番号>` に固定する。**観測時に工程まで名前で分かる。

### 再開する

lease 待ちで止まっているセッションには、**新しいセッションを作らず同じセッションに渡す**。
prepare で読んだ文脈がそこに残っているのが、同一セッションで待たせる理由そのもの。

| 再開の理由 | 渡す内容 |
| --- | --- |
| write lease が空いた | 実装を始めてよいこと |
| integration lease が空いた | latest default へ追随してから着地してよいこと |
| API エラー等での中断 | 中断した事実と、続きから進めること |

セッションが失われていたら新規に起こす。その場合は Issue コメントの計画から文脈を復元させる
（**セッション文脈はキャッシュ、外部化した計画は復旧契約**）。

### 観測する

tick が読むもの。

| 見たいもの | 使い道 |
| --- | --- |
| 稼働中セッションの名前と状態 | 工程の判定・多重起動の検知・人待ちの検知 |
| **対象 repo の** worktree 一覧 | 容量の計算・stale の回収 |

**worktree 一覧は repo を明示して取る。**conductor は複数 repo を跨ぐので、
「今いる場所」に依存する手段だと、別 repo を触った瞬間に対象が観測から消える。

セッションの状態表示だけでは工程は分からない。conductor 側の判定表（git と PR から引く）と
必ず組み合わせる。

### 起こされる

状態のスナップショットを定期的に取り、**前回と違ったときだけ conductor を起こす**手段が要る
（何を入れて何に丸めるかは `SKILL.md`）。

### 片付ける

**起こしたものによって片付ける対象が違う。**`refine` は worktree を持たないので、
worktree 前提の手順をそのまま当てると何も片付かない。

| 終わったもの | 片付けるもの |
| --- | --- |
| `refine` | セッションが載っている pane だけ |
| `resolve` | 下記の 3 つ |

着地した worktree は放置すると容量の判定を狂わせる。**checkout を消すだけでは足りない**
（branch と `node_modules` が残る）ので、次の 3 つを 1 手で行う。

1. 重いディレクトリ（`node_modules` / `target` / `dist` / `.turbo`）を退避して background で消す
2. worktree の checkout を消す
3. branch を消す（**merge 済みのときだけ**。未マージなら残す）

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
- `agent prompt <名前> <本文> --wait --until working` は送信が通ったことの確認に使ってよい
  （完了を待つのとは別）
- 組み込みの `herdr worktree remove` は片付けの **1 だけ**しか行わない。単体で使わない
- 片付けは**標準出力から成否が読めない**（通知の JSON しか返らない）。worktree 一覧と
  remote branch が両方消えたことで確認する。同じスクリプトは popup（`prefix+shift+X`）からも呼べる

`HERDR_ENV` が 1 でなければ herdr の外なので、conductor は起動できない。その旨を報告して止まる。

### 起こされる仕組み

スナップショットを 60 秒ごとに取り、前回と違ったときだけ 1 行出すプロセスを background で走らせる。

- worktree 一覧は上記のとおり `git -C <repo>` で取る
- **conductor 自身を除外する**（`.name != "conductor"`）。応答のたびに `working` ⇄ `idle` する
- **Project の Status は毎回見ない。**GitHub の GraphQL 枠は他セッションと共有で、60 秒間隔で
  叩くと枯渇する。Status が動くのは子セッションが終わったときなので、セッションの消滅で足りる
- 観測が丸ごと空になった回は握りつぶす（一時的な API 断で誤検知しない）
