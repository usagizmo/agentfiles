# アドバイザー起動表

候補表は起動スクリプトと同じディレクトリの `roster.toml` の `advisors`。表の解釈と起動 args の検証は `roster.ts`、選出・上限は `advisors.ts`、自己 kind の観測と起動条件は `advisors.sh` が SSOT。実行中の LLM の自己申告では判定しない。

アドバイザーは consult を起動しない。agent を start しない。判断を応答に出す。

**起動できなくても別の起動方式へ倒さない**。

## 起動・対話・回収・終了

```
<skills root>/consult/scripts/advisors.sh start <prompt-file>      # run dir を stdout へ返し、巡 1 を送る
<skills root>/consult/scripts/advisors.sh collect <run-dir> [秒]   # 今の巡が出揃うまで待って出力
<skills root>/consult/scripts/advisors.sh ask <run-dir> <prompt-file>  # 次の巡を同じ agent へ送る
<skills root>/consult/scripts/advisors.sh close <run-dir>          # tab を閉じる
```

- **prompt は `mktemp` で作ったファイルに書いて渡す**。`PROMPT=$(mktemp "${TMPDIR:-/tmp}/consult-prompt.XXXXXX"); printf '%s\n' "$PROMPT"` で作り、**出力されたパスを控えて**本文をそのファイルへ書き込む（shell 変数はコマンド間で消えるため、以降の各コマンドで再設定する）
- **kind の位置引数は渡さない**
- **`start` が返した run dir を控え、以降のコマンドにそのまま渡す**
- 巡は `start` が 1、`ask` のたびに +1。**`ask` は今の巡を `collect` してから**。timeout した agent は確定せず、再 `collect` で続きを待てる。`ask` は、timeout した agent が止まったまま完走していなければ終端して残りで進み、完走していれば `collect` を要求し、まだ働いていれば止まる
- agent は文脈を保っている。`ask` の本文は 採否と理由 / 問い / 修正の要約 だけでよく、diff は agent に取り直させる
- 完走の述語は今の巡の marker（`advisors.ts` の `complete`）。idle は読むきっかけであって完了ではない
- 回収ヘッダの `rc≠0` は未完了。`blocked`（承認待ち）・`done`（pane 喪失）・`送信失敗`・`ask` が終端した `timeout` はその agent の終端で、次の巡には居ない。`不在` は起こせなかった agent
- **どのモードでも最後に `close` を呼ぶ**。失敗で抜けるときも同じ

## レイアウト

新しい tab を 1 つ。今の会話 pane を**分割しない**。

| 人数 | 中身                                |
| ---- | ----------------------------------- |
| 2    | 左右 2 pane。選出の先頭が左、次が右 |
| 1    | root pane だけ                      |

`--no-focus`。cwd は呼び出し元の `$PWD`。

エージェント名は `a-<kind>-<id>`。セッション全体で一意。

## 不変条件

**アドバイザーにコードを変更させない**。read-only 手段と、それを打ち消す args の棄却は `roster.ts` の `readOnlyArgs` / `rejectBypass`。`--tools` は調査に使うツールの絞り込みであって担保ではない。

## 失敗時

- `rc` が 0 以外 → 回収ヘッダの理由と log の末尾を見る。**失敗・未完了は隠さない**
- 片方失敗でも成功側で統合する。1 つも揃わないときの次手は呼び出し側 skill

## 出典表記

1 本に統合するとき、各論点に使ったアドバイザーの出典タグを付す（例: `[Codex+Grok]` / `[Codex]` / `[Grok]`）。
