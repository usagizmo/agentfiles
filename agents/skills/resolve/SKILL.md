---
name: resolve
description: >-
  課題 1 件を計画 → 実装 → 仕上げ → 検証 → 着地まで一気通貫で進める。
  ユーザーが /resolve で課題（Issue 番号・タスク説明）を渡したとき、
  または「次を進めて」のように暗黙で課題対応を頼まれたときに、課題 1 件ごとに実行する。
---

# 課題解決

1. **選出**: 引数が無ければ計画済みの先頭を取る（並びと Status 名は project 差分。無ければ聞く）
2. **場所**: 計画も実装も課題用の worktree で行う。subagent（Agent tool）に委譲しない。cwd が本 step で課題用に作られた linked worktree（`git rev-parse --git-dir` と `--git-common-dir` が異なり、prompt に「2 を飛ばして 3 から」がある）なら既にその場所にいるので 3 へ
   - `git worktree add` で切って cd し、3 へ。実装役を別 harness に渡すときは `dispatch` skill（`DISPATCH_BACKEND=tmux`。手順は `dispatch/references/dispatch.md`。長い作業は start 後に attach 案内して終え、close で殺さない）
   - 複数 repo を変える課題は、主 repo の worktree から `git worktree add` で他 repo の worktree を切る（workspace は増やさない）
3. **計画**: Issue と関連コードを読み、`consult`（深い・事前）で GO を得る。既に方針が本文にあるなら、書く範囲と検証方針だけを出す
4. **実装**
5. **仕上げ**: 編集した repo ごとに、その worktree を cwd にして `finish`。規模の判定は課題全体で 1 回
6. **検証**: project の検証 skill があればそれ。無ければ CI と同じ検査をローカルで通す。**CI を検査の代わりに使わない**
7. **実物の承認**: 人に見せる面（UI・公開 API・設計骨格）を変えたなら、push 前にローカルの実物を見せて明示承認を待つ。**沈黙は承認ではない**。承認後に対象を変えたら再確認する
8. **着地**: 統合先へ追随してから、project が定める経路で着地する。PR を使う面は `pr` → `ship`、使わない面は `merge`。追随で前提が変わったら 3 に戻る。**複数 repo なら主 repo を最後に着地する**。依存順がそれを許さないなら止めて確認する

受入条件を満たし検証が pass したら着地を先延ばししない。今回変更由来の回帰は直しきる。スコープを超える発見は `~/.agents/AGENTS.md` のボーイスカウトルール。

## 止まる条件

- 製品境界を越える（機能の追加・削除 / 新しいユーザー可視挙動 / 新たな永続形式・migration / 認証・決済・外部送信・公開・破壊的操作の追加 / 設計骨格が変わる新事実）→ 止めて確認する。判定表があれば project 差分が持つ
- 実装中に Issue 本文が変わった → 止めて再承認を待つ
- CI が詰まって進まない → 止めて報告する
