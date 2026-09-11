# アドバイザー起動表

候補表は起動スクリプトと同じディレクトリの `roster.toml` の `advisors`。表の解釈と検証は `roster.ts`、選出・上限・完走判定は `advisors.ts`。自己 kind は **観測または明示 env**（LLM の自己申告では判定しない）。

アドバイザーは consult を起動しない。agent を start しない。判断を応答に出す。

**起動できなくても別の起動方式へ倒さない**。

## Backend 選択

入口は `consult-backend.sh`。`CONSULT_BACKEND` で経路を明示する（未設定・未知は fatal。黙って切替しない）。
選び方: `HERDR_ENV=1` なら `herdr`、それ以外は `tmux`。`CONSULT_SELF_KIND` は呼び出し側が明示する（harness overlay の env 注入が揃うまでの間。LLM の自己申告では決めない）。

| `CONSULT_BACKEND` | script             | 追加の必須 env                       | transport                                  |
| ----------------- | ------------------ | ------------------------------------ | ------------------------------------------ |
| `tmux`            | `advisors-tmux.sh` | `CONSULT_SELF_KIND`（自己 kind）     | tmux / pty interactive（Claude `-p` 不可） |
| `herdr`           | `advisors.sh`      | `HERDR_ENV=1` / `HERDR_WORKSPACE_ID` | Herdr pane                                 |

```
CONSULT_BACKEND=tmux CONSULT_SELF_KIND=cursor \
  <skills root>/consult/scripts/consult-backend.sh start <prompt-file>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh collect <run-dir>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh ask <run-dir> <prompt-file>
CONSULT_BACKEND=tmux \
  <skills root>/consult/scripts/consult-backend.sh close <run-dir>
```

`advisors.sh` / `advisors-tmux.sh` を直接呼んでもよい。直接呼ぶ場合も、もう一方へ**倒さない**。

tmux backend の session primitive は `agents/shared/tmux-session.sh`（consult / dispatch が共有）。実装役は `dispatch` skill。

## 起動・対話・回収・終了

```
<skills root>/consult/scripts/consult-backend.sh start <prompt-file>      # run dir を stdout へ返し、巡 1 を送る
<skills root>/consult/scripts/consult-backend.sh collect <run-dir> [秒]   # 今の巡が出揃うまで待って出力
<skills root>/consult/scripts/consult-backend.sh ask <run-dir> <prompt-file>  # 次の巡を同じ agent へ送る
<skills root>/consult/scripts/consult-backend.sh close <run-dir>          # session / tab を閉じる
```

- **prompt は `mktemp` で作ったファイルに書いて渡す**。`PROMPT=$(mktemp "${TMPDIR:-/tmp}/consult-prompt.XXXXXX"); printf '%s\n' "$PROMPT"` で作り、**出力されたパスを控えて**本文をそのファイルへ書き込む（shell 変数はコマンド間で消えるため、以降の各コマンドで再設定する）
- **kind の位置引数は渡さない**
- **`start` が返した run dir を控え、以降のコマンドにそのまま渡す**
- 巡は `start` が 1、`ask` のたびに +1。**`ask` は今の巡を `collect` してから**。timeout した agent は確定せず、再 `collect` で続きを待てる。`ask` は、timeout した agent が止まったまま完走していなければ終端して残りで進み、完走していれば `collect` を要求し、まだ働いていれば止まる
- agent は文脈を保っている。`ask` の本文は 採否と理由 / 問い / 修正の要約 だけでよく、diff は agent に取り直させる
- 完走の述語は今の巡の marker（`advisors.ts` の `complete`）。idle / done は読むきっかけであって完了ではない
- 回収ヘッダの `rc≠0` は未完了。`blocked`（承認待ち・herdr）・`消失`（session/agent が居なくなった）・`送信失敗`・`ask` が終端した `timeout` はその agent の終端で、次の巡には居ない。`不在` は起こせなかった agent
- timeout の巡は pane / `tmux capture` で状態を確認し、作業中なら同じ run を再 `collect` する。短い待機の終了だけで失敗と判定しない
- **どのモードでも最後に `close` を呼ぶ**。完了・終端を確認してから閉じる

## レイアウト

### herdr

新しい tab を 1 つ。今の会話 pane を**分割しない**。

| 人数 | 中身                                |
| ---- | ----------------------------------- |
| 2    | 左右 2 pane。選出の先頭が左、次が右 |
| 1    | root pane だけ                      |

`--no-focus`。cwd は呼び出し元の `$PWD`。エージェント名は `a-<kind>-<id>`。

### tmux

選出された kind ごとに **独立した tmux session**（`c-<kind>-<id>`）。split しない。cwd は呼び出し元の `$PWD`（herdr と同じ）。人が `tmux -L agentfiles attach -t <session>` で覗ける。Claude の workspace trust 対話が出た場合は `tmux-session.sh accept-trust` が Yes を選ぶ。

## 不変条件

**アドバイザーにコードを変更させない**。read-only 手段と、それを打ち消す args の棄却は `roster.ts` の `readOnlyArgs` / `rejectBypass`。tmux 経路の起動 argv は `directLaunchArgv`（`launch-argv`）。`--tools` は調査に使うツールの絞り込みであって担保ではない。起動は interactive TUI のみ。

## 失敗時

- `rc` が 0 以外 → 回収ヘッダの理由と log の末尾を見る。**失敗・未完了は隠さない**
- 片方失敗でも成功側で統合する。1 つも揃わないときの次手は呼び出し側 skill

## 出典表記

1 本に統合するとき、各論点に使ったアドバイザーの出典タグを付す（例: `[Codex+Grok]` / `[Codex]` / `[Grok]`）。
