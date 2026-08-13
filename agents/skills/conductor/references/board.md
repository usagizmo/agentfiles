# 状況ボードのデータ

`scripts/board.mjs` へ渡す JSON。**盤面の HTML を書かない** —— この JSON だけを毎 tick 作り直す。

描画は `assets/board.html`。見た目とレーンの並びはそこが持つので、色も並び順もここへ書か**ない**。

## 形

| 欄            | 中身                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------ |
| `meta`        | `board` `source` `observedAt`（観測した絶対時刻）`tick`                                    |
| `vocab`       | `progress` `runtime` `ledger` `capacity` の語彙。各行は `{ key, tone }`                    |
| `limits[]`    | `{ key, used, limit, soft?, unit?, note? }`。硬い上限と目安                                |
| `tick`        | `{ outcome, action?: { name, target, members[] }, why, note? }`                            |
| `humanTodo[]` | `{ title, detail, unblocks, issues[], kind, since? }`                                      |
| `surfaces[]`  | `{ name, repo, live: { branch, dirty, ahead, behind }, health, usesPR, worktrees, note? }` |
| `leases`      | `{ write: [{ holder, keys[], since }], integration: [...] }`。保持者は代表の番号           |
| `issues[]`    | 下記                                                                                       |
| `conflicts[]` | `{ reason, evidence[], issues[] }`                                                         |
| `log[]`       | `{ at, outcome, action?, target[], detail }`。新しい順                                     |

`issues[]` の 1 件:

| 欄                                             | 中身                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| `n` `title` `repo`                             | Issue 番号・題・repo                                |
| `group[]` `rep`                                | 同一ブランチ group の全番号と代表                   |
| `ledger` `progress` `runtime` `capacity`       | 正規化の 4 フィールド                               |
| `branch` `session` `pr` `claimedAt` `landedAt` | 実体                                                |
| `surfaces[]`                                   | `{ name, dirty, ahead, behind }`。**面ごとに 1 行** |
| `landsIn[]`                                    | claim 前の宣言された着地面                          |
| `leases[]` `keys[]` `yieldTo`                  | 保持している資源・資源キー・yield 先                |
| `dependsOn[]`                                  | `Depends on` の番号                                 |
| `waiting`                                      | `{ since, question }`。人待ちの記録があるときだけ   |
| `conflict`                                     | 選出対象外に当たっているか                          |
| `note`                                         | 1 行の添え書き                                      |

## 規則

- **語彙を増やすときは `vocab` に行を足す**。レーンもバッジも自動で増える。盤面は触ら**ない**
- `tone` は `idle` `prep` `active` `review` `human` `hold` `done` `dropped` `parked` のどれか
- 語彙に無い値・観測できない依存先・座標表に無い面は、盤面の「データの綻び」へ出る。**消さずに出す**
- 時刻は ISO 8601（オフセット付き）
- `group` は成員全員を並べる。畳んで代表 1 件にし**ない**
- 面ごとの数字を合計に畳ま**ない**
