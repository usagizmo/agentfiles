# Dispatch（実装役）起動

consult（助言・read-only）とは別層。**コード変更を伴う作業**を、明示した harness（+ 任意で kind）に interactive で渡す。

入口: `consult/scripts/dispatch-backend.sh`（session 実装は consult と共有。入口 skill は `dispatch`）。

**起動できなくても別の起動方式へ倒さない。**

## Backend 選択

| `DISPATCH_BACKEND` | 実体             | 備考                                                        |
| ------------------ | ---------------- | ----------------------------------------------------------- |
| `tmux`             | `worker-tmux.sh` | 本命。`$PWD` で interactive CLI を tmux 起動（write 可）    |
| `herdr`            | （セレクタのみ） | script 未配線。`resolve` skill の `HERDR_ENV=1` 手順が SSOT |

```
DISPATCH_BACKEND=tmux DISPATCH_KIND=claude \
  <skills root>/consult/scripts/dispatch-backend.sh start <prompt-file>
DISPATCH_BACKEND=tmux \
  <skills root>/consult/scripts/dispatch-backend.sh collect <run-dir>
DISPATCH_BACKEND=tmux \
  <skills root>/consult/scripts/dispatch-backend.sh ask <run-dir> <prompt-file>
DISPATCH_BACKEND=tmux \
  <skills root>/consult/scripts/dispatch-backend.sh close <run-dir>
```

- `DISPATCH_KIND` 省略時は `roster.toml` の `[resolve]`
- session primitive は `agents/shared/tmux-session.sh`（consult と同じ）
- Claude `-p` / headless は拒否（`roster.ts`）

## Permission（consult との差）

|        | Consult                     | Dispatch                                  |
| ------ | --------------------------- | ----------------------------------------- |
| 目的   | 助言・レビュー              | 実装・調査などの作業                      |
| argv   | `readOnlyArgs` を末尾に付与 | **付けない**（`directResolveLaunchArgv`） |
| bypass | 拒否                        | 拒否（承認スキップ flag は同様に禁止）    |
| 完走   | marker + rc                 | 同じ（`WORKER-DONE-…`）                   |

過剰権限（yolo / bypassPermissions 等）は roster 検証で落とす。必要なら harness 既定の承認 UI に任せる。

## resolve からの使い方

Herdr 外で実装役を立てるとき:

1. worktree を切って cd
2. 作業指示を prompt ファイルへ書く
3. `DISPATCH_BACKEND=tmux`（必要なら `DISPATCH_KIND=…`）で `start` → 作業を進める → `collect` / `ask` → `close`
4. Herdr 内は従来どおり `resolve` skill の Herdr 手順（`DISPATCH_BACKEND=herdr` を script で呼ばない）
