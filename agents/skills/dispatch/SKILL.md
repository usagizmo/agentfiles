---
name: dispatch
description: >-
  作業（実装・調査）を別 session の harness に interactive で渡す transport。
  「claude で実装して」「codex で調べて」など harness + 作業指示があるとき（DISPATCH_KIND で指名）、
  または resolve が実装役（roster の [resolve]）を起動するときに使う。consult（助言）とは別層。
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
- interactive TUI のみ（`--print` は拒否。`-p` は Codex の `--profile` だけ）
