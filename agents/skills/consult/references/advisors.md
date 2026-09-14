# アドバイザー起動表

候補表は起動スクリプトと同じディレクトリの `roster.toml` の `advisors`。表の解釈と検証は `roster.ts`、選出・完走判定・画面判定は `advisors.ts`。選出は `selectAdvisors`（表の順が優先順。quota 切れ・不通は表を並べ替える）。

TS が返すのは常に**行**（選出 kind・起動 argv・応答）。sh は行を読むだけで、JSON を解釈しない。

アドバイザーは consult を起動しない。agent を start しない。判断を応答に出す。

**起動できなくても別の起動方式へ倒さない**。

## Backend 選択

入口は `consult-backend.sh`。`CONSULT_BACKEND` で経路を明示する（未設定・未知は fatal。黙って切替しない）。

| `CONSULT_BACKEND` | script             | transport              |
| ----------------- | ------------------ | ---------------------- |
| `tmux`            | `advisors-tmux.sh` | tmux / pty interactive |

```
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh start <prompt-file>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh collect <run-dir>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh ask <run-dir> <prompt-file>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh close <run-dir>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh verify <run-dir>
```

`advisors-tmux.sh` を直接呼んでもよい（その場合も `CONSULT_BACKEND` 経由と同じ契約）。

tmux backend の session primitive は `agents/shared/tmux-session.sh`（consult / dispatch が共有）。実装役は `dispatch` skill。

## 起動・対話・回収・終了

```
<skills root>/consult/scripts/consult-backend.sh start <prompt-file>      # run dir を stdout へ返し、巡 1 を送る
<skills root>/consult/scripts/consult-backend.sh collect <run-dir> [秒]   # 今の巡が出揃うまで待って出力
<skills root>/consult/scripts/consult-backend.sh ask <run-dir> <prompt-file>  # 次の巡を同じ agent へ送る
<skills root>/consult/scripts/consult-backend.sh close <run-dir>          # session / tab を閉じる
<skills root>/consult/scripts/consult-backend.sh verify <run-dir>         # 今の巡の判定を出す。「指摘なし」で 0
```

- **prompt は `mktemp` で作ったファイルに書いて渡す**。`PROMPT=$(mktemp "${TMPDIR:-/tmp}/consult-prompt.XXXXXX"); printf '%s\n' "$PROMPT"` で作り、**出力されたパスを控えて**本文をそのファイルへ書き込む（shell 変数はコマンド間で消えるため、以降の各コマンドで再設定する）
- **kind の位置引数は渡さない**
- **`start` が返した run dir を控え、以降のコマンドにそのまま渡す**
- 巡は `start` が 1、`ask` のたびに +1。**`ask` は今の巡を `collect` してから**。timeout した agent は確定せず、再 `collect` で続きを待てる。`ask` は、timeout した agent が止まったまま完走していなければ終端して残りで進み、完走していれば `collect` を要求し、まだ働いていれば止まる
- agent は文脈を保っている。`ask` の本文は 採否と理由 / 問い / 修正の要約 だけでよく、diff は agent に取り直させる
- 完走の述語は今の巡の marker（`advisors.ts` の `complete`）。idle / done は読むきっかけであって完了ではない
- 回収ヘッダの `rc≠0` は未完了。`消失`（session/agent が居なくなった）・`送信失敗`・`ask` が終端した `timeout` はその agent の終端で、次の巡には居ない。`不在` は起こせなかった agent
- timeout の巡は pane / `tmux capture` で状態を確認し、作業中なら同じ run を再 `collect` する。短い待機の終了だけで失敗と判定しない
- **どのモードでも最後に `close` を呼ぶ**。完了・終端を確認してから閉じる
- `verify` は `close` 済みでも読める。1 行目から `run:` / `round:` / `closed:` / `<kind>: <判定>`… / `verify: pass|fail`。判定は応答末尾の `判定: …` 行だけから取る（`advisors.ts` の `verdict`）。判定行が無い完走は `不明`、回収前は `未回収`、終端した agent は `終端` で判定に数えない。rc 0 で判定行あり以外が 1 つでもあれば fail、数える agent が 0 でも fail（未レビュー）

## レイアウト

選出した kind の **独立した tmux session**（`c-<kind>-<id>`）。split しない。cwd は呼び出し元の `$PWD`。tmux server は session ごとに分かれ（socket 名 = session 名）、人が `tmux -L <session> attach` で覗ける。起動待ち（workspace trust 対話の Yes・起こせない理由）は `tmux-session.sh open` が持つ。

## 不変条件

**アドバイザーにコードを変更させない**。read-only 手段と、それを打ち消す args の棄却は `roster.ts` の `readOnlyArgs` / `rejectBypass`。tmux 経路の起動 argv は `directLaunchArgv`（`launch-argv`）。`--tools` は調査に使うツールの絞り込みであって担保ではない。起動は interactive TUI のみ。

実行器の状態行と、それを引用した応答本文が同じ文字列になることがある（codex の `• Working (…)`）。分けられないので `working` 側に倒す —— `ask` は `working` でも `unknown` でも終端しないので、巡が進まないときは `close` で閉じる。

**画面の読み方は `advisors.ts` だけが持つ**（`paneState` / `trustKey`）。判定に渡すのは表示中の 1 画面（`tmux-session.sh screen` / `state`）で、履歴ではない。`unknown` は「読めない」であって「停止」ではないので、`ask` は `ready` のときだけ終端する。trust 対話は Yes の選択肢番号を画面から読んで送り、消えたことを確かめる（初期選択に依存しない）。

## 失敗時

- `rc` が 0 以外 → 回収ヘッダの理由と log の末尾を見る。**失敗・未完了は隠さない**
- 揃わないときの次手は呼び出し側 skill
