# worktree + セッションの起こし方

conductor が 1 件を起こすときの手段。**multiplexer を差し替えるときはこのファイルだけ書き換える。**
conductor 本体はここ以外で multiplexer を知らない。

## 名乗る

**起動したら最初に自分のセッションへ固定名を付ける。**多重起動の検知に要る。
名前が無いと自分を一覧から見つけられず、2 つ目が走っても気づけない。

herdr: `herdr agent rename "$HERDR_PANE_ID" conductor`（`--current` は無い。pane ID を渡す）。
tick の観測で `conductor` という名前が自分以外にも居たら止まる。

## 起こす（手段によらない意味）

起こすものは 2 種類あり、**必要な隔離が違う**。

| 起こすもの | worktree | 渡すもの |
| --- | --- | --- |
| `refine` | **要らない**（読み取りのみ。既存の checkout で足りる） | `/refine <Issue 番号>` |
| `resolve` | claim した branch の worktree を作る | `/resolve <Issue 番号>` |

どちらも **完了を待たない。**次の tick へ戻る（完了検知は tick の観測で足りる）。
渡すのは Issue 番号だけで、起こされた側は Issue 本文を読んで自分で文脈を作る
（親セッションの文脈は引き継がれない前提で Issue 契約が要求されている）。

## 再開する

lease 待ちで idle になっているセッションには、**新しいセッションを作らず同じセッションに渡す**。
prepare で読んだ文脈がそこに残っているのが、同一セッションで待たせる理由そのもの。

| 再開の理由 | 渡す内容 |
| --- | --- |
| write lease が空いた | 実装を始めてよいこと |
| integration lease が空いた | latest default へ追随してから着地してよいこと |
| API エラー等での中断 | 中断した事実と、続きから進めること |

セッションが失われていたら新規に起こす。その場合は Issue コメントの計画から文脈を復元させる
（**セッション文脈はキャッシュ、外部化した計画は復旧契約**）。

## 現在の実装: herdr

CLI の構文と状態の読み方は `herdr` skill が SSOT。ここに複製しない。対応は次のとおり。

| 手順 | herdr での実現 |
| --- | --- |
| worktree を作る（resolve のみ） | `herdr worktree create --cwd <repo> --branch <名> --base <default> --label "#<番号>" --no-focus --json` |
| pane を作る（refine） | `herdr pane split --current --direction right --cwd "$PWD" --no-focus` |
| セッションを起こす | 得た pane_id に `herdr agent start <名前> --kind claude --pane <id> --timeout 90000` |
| 課題を渡す | `herdr agent prompt <名前> "/refine <番号>"` または `"/resolve <番号>"` |
| 待たない | `--wait` を使わない。`--no-focus` でユーザーの focus を奪わない |

観測に使うもの:

| 見たいもの | コマンド |
| --- | --- |
| worktree 一覧 | `herdr worktree list --json`（`branch` / `path` / `is_prunable`） |
| セッション一覧 | `herdr agent list`（`name` / `agent_status` / `cwd`） |

- `worktree create` は worktree・workspace・root pane を**一度に作る**。pane を別途 split しない
- `agent start` に `--json` は無い（付けると exit 2 の構文エラー）。既定で JSON が返る
- **agent 名は `refine-<番号>` / `resolve-<番号>`** に固定する。観測時に工程まで名前で分かる
- `agent_status` は `idle` / `working` / `done` / `blocked` の 4 値しか返らない。**どの工程にいるかは
  分からない**ので、conductor 側の判定表（git と PR から引く）と必ず組み合わせる

`HERDR_ENV` が 1 でなければ herdr の外なので、conductor は起動できない。その旨を報告して止まる。

## 片付ける

着地した worktree は放置すると容量の判定を狂わせる。**checkout を消すだけでは足りない**
（branch と `node_modules` が残る）ので、次の 3 つを 1 手で行う手段を使う。

1. 重いディレクトリ（`node_modules` / `target` / `dist` / `.turbo`）を退避して background で消す
2. worktree の checkout を消す
3. branch を消す（**merge 済みのときだけ**。未マージなら残す）

herdr での実現: `python3 ~/.config/herdr/remove-worktree.py --workspace <id> --yes`

- 組み込みの `herdr worktree remove` は **1 だけ**しか行わない。単体で使わない
- 未マージ branch が残った場合は非ゼロで終わる。着地済みだけを対象にしていれば起きない
- 同じスクリプトは popup（`prefix+shift+X`）からも対話つきで呼べる

## 差し替えるとき

上の 4 手順を、その multiplexer の CLI で同じ意味に写せばよい。判断基準は 2 つ。

- **起動が非同期であること**（親が子の完了をブロックしない）
- **稼働中のセッションを一覧で観測できること**（tick が現実を読めない手段は使えない）
