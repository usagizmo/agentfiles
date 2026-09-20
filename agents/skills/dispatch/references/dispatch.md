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

承認で止めない起動は `[[workers]]` に置く（grok は `--permission-mode bypassPermissions`）。実装役の argv で roster 検証が落とすのは interactive 以外の起動だけ。advisors は承認スキップも read-only 解除も落とす。

trust 以外の承認 UI が出た巡は `collect` が `停滞` で戻る（終端しない）。人が `tmux -L <session> attach` して応える。

## 巡の終わり方

`collect` の回収ヘッダは `rc` と理由を持つ。`rc` を書かず再 `collect` できるのは `timeout` と `停滞`（出力にその時点の画面が付く）。終端（`dead`。以降 `ask` できない）は `消失` / `送信失敗` / `marker 無し` / `不通`。述語と既定値は `worker-tmux.sh`。

## 呼び出し元との分担

worker への指示内容・diff の判定・fallback は呼び出し側 skill が持つ（resolve は「実装役へ渡す」）。ここが持つのは transport だけ。

人が harness を指名して `resolve` ごと渡すとき（「codex で #12 を resolve して」）: worktree を切って cd し、prompt に「`resolve` を 2 を飛ばして 3 から」を含めて `DISPATCH_KIND=<kind>` で `start`。working を確認したら session 名と `tmux -L <session> attach` を報告して終える。`close` で殺さない。

`DISPATCH_KIND` は `[[workers]]` に宣言した kind だけ指名できる。表に無い kind は起動前に落ちる。

Codex の `-p`（`--profile`）は許可する。profile 内の `approval_policy` までは見ない（advisors の `-c` 拒否の限界）。
