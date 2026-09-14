# Dispatch（実装役）起動

consult（助言・read-only）とは別層。**コード変更を伴う作業**を、明示した harness（+ 任意で kind）に interactive で渡す。

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

- `DISPATCH_KIND` 省略時は `roster.toml` の `[resolve]`。kind も argv も `resolve-launch-argv --print kind|argv` が返す（toml を読み直さない）
- session primitive は `agents/shared/tmux-session.sh`（consult と同じ）
- `--print` は拒否（`roster.ts`）。`-p` は Codex の `--profile` だけ許可

## Permission（consult との差）

|        | Consult                     | Dispatch                                     |
| ------ | --------------------------- | -------------------------------------------- |
| 目的   | 助言・レビュー              | 実装・調査などの作業                         |
| argv   | `readOnlyArgs` を末尾に付与 | **付けない**（`directResolveLaunchArgv`）    |
| bypass | 拒否                        | 拒否（承認スキップ flag は同様に禁止）       |
| trust  | Claude trust 対話を自動 Yes | Claude trust 対話を自動 Yes（detached 前提） |
| 完走   | marker + rc                 | 同じ（`WORKER-DONE-…`）                      |

過剰権限（yolo / bypassPermissions 等）は roster 検証で落とす。workspace trust 以外の承認 UI は harness 既定に任せ、人が `tmux -L <session> attach` する。

## resolve からの使い方

実装役を立てるとき（長い実装・人の GO を挟む作業）:

1. worktree を切って cd
2. 作業指示を prompt ファイルへ書く（「2 を飛ばして 3 から」を含める）
3. `DISPATCH_BACKEND=tmux`（必要なら `DISPATCH_KIND=…`）で `start`
4. working を確認したら session 名と `tmux -L <session> attach` を報告して終える（呼び出し側はこの session を `close` で殺さない）
5. 短い往復だけに `collect` / `ask` / `close` を使う。`close` は実装中の worker を破棄する

Codex の `-p`（`--profile`）は許可する。profile 内の `approval_policy` までは見ない（明示の `-c` 拒否の限界）。
