---
name: new-repo
description: >-
  クライアント静的サイト用プライベートリポの新規作成は理由を問わずこの skill を経由する
  （`gh repo create` や GitHub 設定の手打ちを直接しない）。
  「テンプレからリポ作って」「dev-template で」「ghq して設定まで」系はすべてここ。
---

`usagizmo/dev-template` から private repo を作り、ghq 取得と GitHub 設定まで揃える。

## 入力

| 項目             | 決め方                                             |
| ---------------- | -------------------------------------------------- |
| `<owner>/<name>` | ユーザーが言う。推測しない                         |
| Issue            | ユーザーが起票を求めたときだけ。`issue` skill 経由 |

## 手順

1. リポ作成（clone しない）:
   ```
   gh repo create <owner>/<name> --private --template usagizmo/dev-template
   ```
2. ghq 取得（SSH）:
   ```
   ghq get git@github.com:<owner>/<name>.git
   ```
3. GitHub 設定（Wiki / マージ / ルールセット）:
   ```
   bash <skills root>/new-repo/scripts/apply-github-settings.sh <owner>/<name>
   ```
4. 必要なら `issue` skill で起票する（この skill は Issue 本文を書かない）

## 完了条件

- private で template 由来のリポがある
- `ghq list -p <owner>/<name>` が 1 行ある
- Wiki オフ、通常マージのみ、auto-merge オン、ヘッドブランチ自動削除オン
- default branch に名前 `main` の ruleset があり、必須 status が template CI のジョブ名と一致する

## 設定の正

`scripts/apply-github-settings.sh` が SSOT。本文へ値を写さない。
