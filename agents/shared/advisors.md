# アドバイザー起動表

候補表は起動スクリプトと同じディレクトリの `advisors.json`（JSONC）。選出は `advisors.ts`。自己 kind は herdr の pane 観測。実行中の LLM の自己申告では判定しない。

枠の `kind` が起こす実行器、`args` がモデルと effort、`members` は同一視（省略時は kind 自身）。自己 kind を含む枠は丸ごと選出から外れる。観測できないとき（`pane.agent` が空）は start が失敗する。表に無い kind は選出上限まで取り、警告する。上限は `advisors.ts` の `MAX_ADVISORS`。

アドバイザーは consult を起動しない。agent を start しない。判断を応答に出す。

Herdr の外では立てない。`HERDR_ENV` が 1 でない、または `herdr` が無いときは start が失敗する。`claude -p` / `codex exec` へ倒さ**ない**。

## 起動と回収

**起動と回収は別コマンドで実行する**。

この skill の `scripts/advisors.sh` を使う。

```
scripts/advisors.sh start <prompt-file>    # run dir を stdout へ返す
scripts/advisors.sh collect <run-dir> [秒] # 出揃うまで待って出力
```

- **prompt は `mktemp` で作ったファイルに書いて渡す**。`PROMPT=$(mktemp "${TMPDIR:-/tmp}/<skill 名>-prompt.XXXXXX"); printf '%s\n' "$PROMPT"` で作り、**出力されたパスを控えて**本文をそのファイルへ書き込む（shell 変数はコマンド間で消えるため、以降の各コマンドで再設定する）
- **kind の位置引数は渡さない**
- **`start` が返した run dir を控え、`collect` にそのまま渡す**（shell 変数はコマンド間で保持されない）
- **1 run 1 回**。回収済みの run dir を渡すと落ちる。古いパスを貼っても前回の出力は返らない
- 待ち時間の既定はスクリプト側。足りなければ第 2 引数で伸ばす
- 完走の述語と未完理由は `advisors.ts` の `complete` と `advisors.sh` の collect
- 未完了があれば非ゼロで終了する。呼び出し側はマーカーを知らなくてよい
- 回収したら run dir は消してよい（prompt と各出力が残る）
- **作った tab は collect が閉じる**

## レイアウト

新しい tab を 1 つ。今の会話 pane を分割し**ない**。

| 人数 | 中身                                |
| ---- | ----------------------------------- |
| 2    | 左右 2 pane。選出の先頭が左、次が右 |
| 1    | root pane だけ                      |

`--no-focus`。cwd は呼び出し元の `$PWD`。

エージェント名は `a-<kind>-<id>`。セッション全体で一意。

## 不変条件

**アドバイザーにコードを変更させない**。read-only 手段と、それを打ち消す args の棄却は `advisors.ts` の `readOnlyArgs` / `rejectBypass`。`--tools` は調査に使うツールの絞り込みであって担保ではない。

## 失敗時

- `rc` が 0 以外 → 回収ヘッダの理由と log の末尾を見る。**失敗・未完了は隠さない**
- 片方失敗でも成功側で統合する。1 つも揃わないときの次手は呼び出し側 skill

## 出典表記

1 本に統合するとき、各論点に使ったアドバイザーの出典タグを付す（例: `[Codex+Grok]` / `[Codex]` / `[Grok]`）。
