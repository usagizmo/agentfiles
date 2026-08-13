# 状況ボードのデータ

`scripts/board.mjs` へ渡す JSON。**盤面の HTML を書かない。**

構造は `src/board.ts` の `toBoard` が、その tick の観測と Decision から毎回フル生成する。前の盤面は読ま**ない**。

描画は `assets/board.html`。見た目とレーンの並びはそこが持つので、色も並び順もここへ書か**ない**。

欄と `issues[]` の形は `toBoard` の戻り。`tick.why` と PR 番号と面の数の取り方は `src/board.ts` と `src/observe.ts`。

## overlay

観測外の行だけ `--board-overlay` で足す。完成済みの盤面 JSON を編集し**ない**。載せ先は `humanTodo[]`。

```json
{
  "humanTodo": [
    {
      "title": "指定の pane へ送れない",
      "detail": "herdr agent prompt が agent_not_ready",
      "unblocks": "対象 pane で実行器が idle になる",
      "issues": [],
      "kind": "env"
    }
  ]
}
```

入力の検査は `parseOverlay`。
