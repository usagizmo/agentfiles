# 状況ボードのデータ

`cli.ts` が毎 tick 書く JSON。**盤面の HTML を書かない。エージェントは読まない。**

構造は `src/board.ts` の `toBoard` が、その tick の観測と Decision から毎回フル生成する。前の盤面は読ま**ない**。

描画は `assets/board.html`。見た目とレーンの並びはそこが持つので、色も並び順もここへ書か**ない**。

欄と `issues[]` の形は `toBoard` の戻り。`tick.why` と PR 番号と面の数の取り方は `src/board.ts` と `src/observe.ts`。`recent` は `src/journal.ts`。**判断の入力にしない。**

## 事実コマンド

観測外の行と実行結果は `cli.ts` が合成する。完成済みの盤面 JSON を編集し**ない**。

```bash
bun run src/cli.ts note --title ... --detail ... --unblocks ... --kind env
bun run src/cli.ts clear --id <id>
bun run src/cli.ts result --status ok|env|gap
```

`note` は id を 1 行返す。載せ先は `humanTodo[]`。入力の検査は `parseOverlay`。id が手元に無いときだけ `cli.ts notes`。

`result` は実行した直後の 1 語。idle では呼ばない。置き場は journal（NDJSON）。選出にも交代にも読まない。旧 overlay JSON は journal が空のとき一度だけ取り込む。
