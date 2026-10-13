---
name: report-to-desk
description: >-
  作業結果をデスクへメールで報告する。ユーザーが「デスクに報告して」と言ったとき、
  または /report-to-desk と言ったときだけ実行する。作業が終わっただけでは発動しない。
---

# デスクに報告

作業結果を 1 通のメールにまとめ、ユーザーの OK を得てから送る。

## 制約

- 送信元・宛先は `~/.config/report-to-desk/config.json` が SSOT。**ほかの宛先へは送らない**（cc / bcc も付けない）。別の送信手段で**代替しない**
- config を**書き換えない**。中身（アドレス・OAuth client）を tracked ファイル・commit message・報告本文に**写さない**
- `auth` は人が実行する。agent は**実行しない**
- **ユーザーが件名と本文を見て OK と言うまで送らない。**修正を受けたら、直した全文を見せて OK を取り直す
- OK 1 回につき 1 通。別の報告には流用しない
- パスワード・トークン・API キー・`.env` の中身を**書かない**。認証情報を含む URL（query の token、`user:pass@`）も書かない

## 手順

1. 材料を集める。実物を見て書き、推測で埋めない
   - リポ名とブランチ（repo での作業のとき）: `git remote get-url origin` / `git branch --show-current`
   - やったこと: この会話の作業と `git log`
   - PR の URL: `gh pr view --json url -q .url`（無ければ「なし」）
   - 確認用 URL: この会話で実際に使ったローカル・テスト環境の URL
2. 下の形式で件名と本文を組み、そのままユーザーに見せて OK を待つ
3. OK を得たら、本文を一時ファイルへ書いて送る

   ```bash
   bun scripts/report-to-desk.ts send "<件名>" <本文ファイル>
   ```

4. 終了コード 0 なら送信済みと報告する。非 0 なら stderr の文言をそのまま伝え、**送れたことにしない**

## 初回設定（人が行う）

送信は Gmail API。config と認可が無ければ script が止まり、足りないものを stderr に出す。

1. Google Cloud で project を作り、Gmail API を有効にする
2. OAuth 同意画面を **Internal** で作る（External のテスト公開は refresh token が 7 日で失効する）
3. OAuth client を「デスクトップアプリ」で作る
4. `~/.config/report-to-desk/config.json` を mode 600 で置く。key は `from` / `to` / `clientId` / `clientSecret` の 4 つだけ
5. `bun scripts/report-to-desk.ts auth` を実行し、browser で `from` の account を認可する

refresh token は macOS の Keychain に入る。scope は送信のみで、受信箱は読めない。

## 形式

件名:

```
【完了報告】<リポ名> <作業の短い要約>
```

本文（日本語・箇条書き・プレーンテキスト）:

```
■ リポ / ブランチ
- <owner/repo> / <branch>

■ やったこと
- ...

■ PR
- <URL>

■ 確認用 URL
- <URL>（ローカル / テスト環境 など）

■ 要確認・未対応の点
- ...

■ 先方への連絡が必要なこと
- ...
```

- 「やったこと」は必ず書く
- repo の外の作業では、件名の `<リポ名>` と「リポ / ブランチ」を省く
- 「PR」「先方への連絡が必要なこと」は、無ければ項目ごと省く
- 「確認用 URL」「要確認・未対応の点」は、無ければ「なし」と書く
