---
name: pr
description: PR を作成する。タイトルの先頭に gitmoji を付ける以外はデフォルトの `gh pr create` フローに従う。ユーザーが「PR を作成して」「pr 出して」と言ったときに使う。
---

PR を作成し、auto-merge でマージされるまで面倒を見る。PR タイトルの先頭には適切な gitmoji を付ける。それ以外はデフォルトの PR 作成フローに従う。

## 事前確認（承認ゲート）

PR を出す前（`/commit` まで完了した段階）に行う:

- **積み残しの確認**: 当初の課題・プランに対して未実装・未解決のものがないか確認する。あれば、同スコープで追加実装するか、Issue 化して切り離すかを判断する

この提示に対してユーザーの GO を得てから PR を作成する。ユーザーが既に内容を確認済みで PR 作成だけを指示している場合は省略してよい。

## フロー

マージされるまで以下を繰り返す:

1. **push**: current branch が origin と同期していなければ `git push` する（未 push コミットがある場合は `-u` 付きで push）
2. **PR 作成 / 更新**: PR が無ければ `gh pr create`。既にあれば、最新の変更内容に合わせて PR の title / body を `gh pr edit` で更新する
3. **auto-merge 有効化**: マージコミットのメッセージを組み立てて有効化する:
   ```
   gh pr merge --merge --auto --subject "{PR タイトル} (#{PR 番号})" --body "{マージコミットの body}"
   ```
4. **CI 待ち**: `gh pr checks --watch` などで CI の完了を待つ
5. **CI エラー対応**: 失敗した check のログを確認して修正し、コミットして手順 1 に戻る。すべて pass すれば auto-merge により自動でマージされて完了

## PR タイトルの形式

```
{gitmoji} {変更内容を凝縮した説明}
```

gitmoji の選び方は `../commit/references/gitmoji.md` を参照。

## auto-merge の詳細

この PR は merge commit（`--no-ff` 相当）でマージする。

- `--subject` では PR 番号が自動付与されないため、必ず `(#N)` を自分で付ける
- マージコミットの body は、PR に含まれるコミット群の変更を簡潔な箇条書きにまとめる:
  ```
  - {マージ内容のサマリー1}
  - {マージ内容のサマリー2}
  - ...
  ```
- コミットが綺麗に分かれていて、コミット一覧を見れば内容が十分伝わる場合など、マージコミットの body が不要なら `--body ""` でよい
- 修正コミットを積んだ場合は、マージコミットの body を最新の内容に更新して有効化し直す

### フォールバック: CLI で直接マージ

auto-merge の有効化に失敗した場合（リポジトリで Allow auto-merge が無効、required checks が無い等）は、CI がすべて pass したのを確認してから `--auto` を外した同じコマンドで直接マージする:

```
gh pr merge --merge --subject "{PR タイトル} (#{PR 番号})" --body "{マージコミットの body}"
```

`--subject` / `--body` を明示すればリポジトリの Default commit message 設定に関係なくその内容でコミットされる（body 不要なら `--body ""`）。フォールバック時も CI エラーの修正対応は行う。
