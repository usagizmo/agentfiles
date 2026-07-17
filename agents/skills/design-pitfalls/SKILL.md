---
name: design-pitfalls
description: >-
  設計レビューで軸の混在、SSOT、責務配置、非同期、型で固定できる不変条件、
  correctness / security、出力チャネル混在などを疑う薄いチェックリスト。
  詳細事例集ではない。モデル自身の設計推論を起動するために使う。
---

# Design Pitfalls

細かい事例の暗記ではなく、ゼロベースで自然かを疑う。具体化は対象コード・既存パターン・自身の推論で行う。
判定基準の詳細は迷った軸だけ `references/deep-dives.md` を読む。原則本体は `~/.agents/AGENTS.md`。

## 軸の混在

- 異なる責務・時間軸・観測軸・副作用軸を同じ enum / union / flag / API / store に混ぜない
- 名前や variant は経路名ではなくドメインの機能軸で切る
- 似ていても責務が違うものを同じ名前空間に押し込まない

## SSOT

- 同じ事実を複数箇所に持たない。派生は authoritative source から再計算する
- cache / 永続 / UI / 外部プロセスのどれが正かを明確にする
- allow/deny・上限/実値のような対になる gate は片側だけで判断しない

## Orchestration

- 副作用 chain・fan-out・状態更新の coordinator は event source に近い 1 箇所に集約する
- caller ごとに「必要なら準備 / invalidate」を散らさない
- lock 内は分類のみ。I/O・通知は lock 解放後

## 型で固定

- 順序・readiness・production/test 差・不変条件はコメントや env ではなく型・token・DI・chokepoint へ
- 同型 primitive や secret bytes を positional に渡さない
- 1-variant enum / 将来用 label は作らない

## Cache / Async

- invalidation・in-flight token・非同期 commit gate は単一 chokepoint
- 古い非同期結果が新しい状態を上書きしないよう monotonic token 等で gate する
- 再生成可能な cache の corrupt は削除して再生成する

## Correctness / Security

- 正誤判定は echo ではなく独立した proof / server-private 検証値で行う
- setup と verify、unwrap と検証は統合 chokepoint に寄せる
- 外向き error と内向き diagnostics は分ける。存在秘匿が必要なら body まで同一応答に畳む
- CORS / CSRF / CSP / allowlist は認証経路と実態に合わせて最小化

## Output Channels

- 人間向け表示・機械応答・ログ・telemetry を混ぜない
- filter は consume 出口ではなく produce 入口
- 機械向け error / doc は truncate されても self-repair 可能な構造にする

## レビュー出力

「どの軸が混ざっているか」「SSOT はどこか」「どの chokepoint に寄せるか」を示す。問題がなければ過去事例へ無理に当てはめない。
