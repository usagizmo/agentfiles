---
name: dispatch
description: >-
  明示した harness（claude / codex 等）に実装・調査などの作業を interactive で渡す。
  「claude で実装して」「codex で調べて」など harness + 作業指示があるとき、
  または resolve が Herdr 無しで実装役を立てるときに使う。consult（助言）とは別層。
---

# 作業ディスパッチ

**consult は助言（read-only）。dispatch は作業（write 可）。** 混ぜない。

手順・backend 表・permission の差は `references/dispatch.md`（SSOT）。

```
DISPATCH_BACKEND=tmux DISPATCH_KIND=<kind> \
  <skills root>/dispatch/scripts/dispatch-backend.sh start <prompt-file>
# collect / ask / close も同様。DISPATCH_BACKEND を毎回明示する。
```

- `DISPATCH_BACKEND` 未設定・未知は fatal（silent fallback 禁止）
- Herdr 面の実装役は `resolve` skill の既存手順（本 script の `herdr` は未配線）
- interactive TUI のみ（`--print` は拒否。`-p` は Codex の `--profile` だけ）
