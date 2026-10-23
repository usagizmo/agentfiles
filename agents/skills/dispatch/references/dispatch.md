# Dispatch（実装役）起動

consult（助言・read-only）とは別層。**コード変更を伴う作業**を、別 session の harness（既定は roster の `[[workers]]` の先頭。`DISPATCH_KIND` で指名）に interactive で渡す。

入口: `dispatch/scripts/dispatch-backend.sh`（session primitive は `agents/shared/tmux-session.sh`。入口 skill は `dispatch`）。

**起動できなくても別の起動方式へ倒さない。**

## Backend 選択

| `DISPATCH_BACKEND` | 実体             | 備考                                               |
| ------------------ | ---------------- | -------------------------------------------------- |
| `tmux`             | `worker-tmux.sh` | `$PWD` で interactive CLI を tmux 起動（write 可） |

```
DISPATCH_BACKEND=tmux DISPATCH_KIND=claude \
  <skills root>/dispatch/scripts/dispatch-backend.sh start <prompt-file>
DISPATCH_BACKEND=tmux \
  <skills root>/dispatch/scripts/dispatch-backend.sh collect <run-dir>
DISPATCH_BACKEND=tmux \
  <skills root>/dispatch/scripts/dispatch-backend.sh ask <run-dir> <prompt-file>
DISPATCH_BACKEND=tmux \
  <skills root>/dispatch/scripts/dispatch-backend.sh close <run-dir>
DISPATCH_BACKEND=tmux \
  <skills root>/dispatch/scripts/dispatch-backend.sh watch <registry> [wait-seconds]
```

- `DISPATCH_KIND` 省略時は `roster.toml` の `[[workers]]` の先頭。指名するとその kind の枠を引く。kind も argv も `worker-launch-argv --print kind|argv` が返す（toml を読み直さない）
- session primitive は `agents/shared/tmux-session.sh`（consult と同じ）
- `--print` は拒否（`roster.ts`）。`-p` は Codex の `--profile` だけ許可

## Permission（consult との差）

|        | Consult                     | Dispatch                                 |
| ------ | --------------------------- | ---------------------------------------- |
| 目的   | 助言・レビュー              | 実装・調査などの作業                     |
| argv   | `readOnlyArgs` を末尾に付与 | **付けない**（`directWorkerLaunchArgv`） |
| bypass | 拒否                        | `[[workers]]` の指定に従う               |
| trust  | trust 対話を自動 Yes        | trust 対話を自動 Yes（detached 前提）    |
| 完走   | marker + rc                 | 同じ（`WORKER-DONE-…`）                  |

承認で止めない起動は `[[workers]]` に置く。実装役の argv で roster 検証が落とすのは interactive 以外の起動だけ。advisors は承認スキップも read-only 解除も落とす。

trust 以外の承認 UI が出た巡は `collect` が `停滞` で戻る（終端しない）。人が `tmux -L <session> attach` して応える。

## 送り方

入力欄へは本文を貼らない。本文（と marker の指示）は run dir の `prompt.<巡>` に置き、入力欄へは本文のファイルを指す 1 行と marker の指示だけを送る。複数行の貼り付けは実行器が外部テキストとして扱い、そこに書かれた依頼を実行しない。

## 巡の終わり方

`collect` の回収ヘッダは `rc` と理由を持つ。`rc` を書かず再 `collect` できるのは `timeout` / `停滞` / `marker 無し`（出力にその時点の画面が付く）。`marker 無し`（入力待ちで未完走）の巡には `ask` で継続を送れる（その巡は `rc=1` で閉じる）。`抽出失敗` は完走した巡で応答を切り出せなかった場合で、`rc=0` のまま画面全体を付けて返す（`ask` できる）。終端（`dead`。以降 `ask` できない）は `消失` / `送信失敗` / `不通`。述語と既定値は `worker-tmux.sh`。

## 複数 run を見張る

並列の run は `watch` 1 本で見張る。`collect` を run ごとに巡回しない（巡回は 1 run の待ちが他を止め、入力待ちの run を見落とす）。

- registry は呼び出し元が持つ「key run-dir」の行。起動し直した run は同じ key で追記する（同じ key は最後の行だけを見る）
- `watch` は作業中でなくなった run を 1 件だけ `key<TAB>巡<TAB>状態<TAB>run-dir` で返して終わる。状態は `done` / `idle`（入力待ちで marker 無し）/ `blocked`（読めない画面で停滞）/ `dead`。同じ巡の同じ状態は 2 度返さない。何も起きなければ exit 3
- 返った run は `collect` で回収し、処理してから `watch` を起こし直す
- 同じ registry の `watch` は 1 本だけ（`<registry>.lock`）

## 呼び出し元との分担

worker への指示内容・diff の判定・fallback は呼び出し側 skill が持つ（resolve は「実装役へ渡す」）。ここが持つのは transport だけ。

人が harness を指名して `resolve` ごと渡すとき（「codex で #12 を resolve して」）: `resolve` step 2 の場所に worktree を切って cd し、prompt に「`resolve` を 2 を飛ばして 3 から」を含めて `DISPATCH_KIND=<kind>` で `start`。working を確認したら session 名と `tmux -L <session> attach` を報告して終える。`close` で殺さない。

`DISPATCH_KIND` は `[[workers]]` に宣言した kind だけ指名できる。表に無い kind は起動前に落ちる。

Codex の `-p`（`--profile`）は許可する。profile 内の `approval_policy` までは見ない（advisors の `-c` 拒否の限界）。
