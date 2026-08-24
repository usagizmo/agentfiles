---
name: merge
description: >-
  PR を出さずにローカルでマージするときに必ずこの skill を経由する
  （`git merge` を直接実行しない）。PR を使わない面の着地と、人がローカル統合すると決めたとき。
---

# ローカル統合

引数は対象ブランチ。統合先と操作台は方向で決まる。

## 方向

| 方向     | 統合先            | 対象        | 操作台                 |
| -------- | ----------------- | ----------- | ---------------------- |
| 取り込み | cwd の作業 branch | 共有 branch | cwd                    |
| 着地     | 共有 branch       | 作業 branch | その面の live checkout |

判別できないときは人に聞く。統合先を推測し**ない**。

着地の既定の経路は PR。この skill で着地するのは、PR を経由しないと人が決めたときだ**け**。着地は自動では走らない。

## 形

本数は `git -C <操作台> rev-list --count HEAD..<対象>`。形は本数**だけ**で決まる。

| 本数   | 形                     |
| ------ | ---------------------- |
| 0      | しない。報告して終わる |
| 1      | `--ff-only`            |
| 2 以上 | `--no-ff`              |

`--ff-only` にメッセージを付け**ない**。`--no-ff` のメッセージは直前コミットの言語・スタイルに合わせ、gitmoji を 1 つ選ぶ（`references/gitmoji.md`）。タイトルを `Merge branch '...'` にしない。

## 衝突

方向を問わず、統合先の HEAD が対象ブランチの祖先なら、どちらの形も衝突しない。祖先で**ない**なら merge せず、自分の worktree で rebase してから出直す。

## 着地の検査

統合先の木は自分以外も読む（どの木かは project 差分の着地面の座標。live checkout）。着地なら、検査の前に `conductor/scripts/ensure-integration-ref.sh <操作台> <統合先 ref>` を呼ぶ（作成と条件付き switch。述語は script が SSOT）。統合先に居ることは ensure のあと、この検査で確かめる。次を 1 つでも観測したら、直さずに報告して止まる。

- dirty（`status --porcelain` が空でない）
- HEAD が統合先の branch でない（**両側とも full ref**。`symbolic-ref HEAD` と座標の `refs/heads/<name>` を比べる。`--short` / `git branch --show-current` は `temp` 対 `refs/heads/temp` で常に不一致になる）
- 姿勢を観測できない（`status --porcelain` または `symbolic-ref HEAD` が非 0。失敗を dirty=0 にも clean にも畳まない）

統合先が upstream より先行していることは、この検査に当たら**ない**。switch しなかったあとも、この検査は同じ。dirty を checkout / stash / reset で解消する経路は足さない。

その木で行ってよいのは fetch と merge と、上の ensure（作成と条件付き switch）**だけ**。作業中の cwd worktree を統合先へ切り替えない（live への条件付き switch は ensure）。

**例外は、自分が始めた `--no-ff` の `--abort` だけ**。`--abort` したらそこで止めて報告する。`--no-verify` / `--no-gpg-sign` で通し直さない。

## 手順

1. 方向を決め、対象ブランチと操作台を確定する
2. 操作台で `git log --oneline HEAD..<対象>` と `git diff HEAD...<対象>` を読む
3. 祖先関係を確かめる。着地なら ensure を呼んでから「着地の検査」も通す
4. 本数を取り、形の表に従う
5. 着地なら、merge 後に操作台が clean で統合先に居ることを確かめる

```
git -C <操作台> merge --ff-only <対象>
```

```
git -C <操作台> merge --no-ff <対象> -m "{gitmoji} {変更の本質}

- {サマリー1}
- {サマリー2}"
```
