---
name: design-pitfalls
description: >
  設計レビューで、軸の混在、SSOT 違反、責務配置、非同期状態、型で固定できる不変条件、
  correctness / security 境界、出力チャネル混在などの典型的な落とし穴を疑うための薄いチェックリスト。
  詳細事例を読む skill ではなく、モデル自身の設計推論を起動するために使う。
---

# Design Pitfalls

設計レビューでは、細かい事例を暗記するのではなく、次の軸で「この設計はゼロベースで見ても自然か」を疑う。
本 skill は詳細事例集ではない。必要な具体化は、対象コード・既存パターン・モデル自身の推論で行う。

## 軸の混在

- 異なる責務、時間軸、観測軸、副作用軸を同じ enum / union / flag / API / store に混ぜない
- 名前や variant は経路名ではなく、ドメイン上の機能軸で切る
- 同じ名前空間に「似ているが責務が違うもの」を押し込まない

## SSOT

- 同じ事実を複数箇所で保持しない。派生値は authoritative source から再計算する
- cache、永続 store、UI state、外部プロセス間で、どれが正とする値かを明確にする
- positive list / negative list、allow / deny、上限 / 実値のような対になる gate は片側だけで判断しない

## Orchestration

- 副作用 chain、fan-out、状態更新の coordinator は event source に近い 1 箇所に集約する
- caller ごとに「必要なら準備する」「必要なら invalidate する」を散らさない
- lock 内では分類だけ行い、I/O や通知などの副作用は lock 解放後に実行する

## 型で固定

- 順序制約、readiness、production / test の差、不変条件はコメントや env var ではなく型・token・DI・chokepoint に押し込む
- 同型の primitive 値や secret bytes を positional に渡さない。構造化された型や object 引数で軸を明示する
- 1-variant enum や将来用 label のような dead abstraction は作らない

## Cache / Async

- cache invalidation、in-flight token、非同期 commit gate は単一 chokepoint に寄せる
- 非同期 read-then-commit は古い結果が新しい状態を上書きしないよう、monotonic token などで gate する
- 再生成可能な cache の corrupt は温存せず、削除して安全側に再生成する

## Correctness / Security

- 正誤判定は echo ではなく、独立した cheap proof や server-private な検証値で行う
- setup と verify、unwrap と検証は分離して散らさず、統合 chokepoint に寄せる
- 外向き error と内向き diagnostics は軸を分ける。存在秘匿が必要な resource は body まで同一の応答に畳む
- CORS / CSRF / CSP / allowlist は認証経路と実態に合わせて最小化する

## Output Channels

- 人間向け表示、機械 caller 向け応答、ログ、telemetry など観測軸が異なる出力を混ぜない
- filter は consume 出口ではなく produce 入口に置く
- 機械 caller 向け error / doc は self-repair 可能で、truncate されても意味が残る構造にする

## レビューの出力

問題を見つけたら、単なる好みではなく「どの軸が混ざっているか」「SSOT はどこに置くべきか」「どの chokepoint に寄せるべきか」を示す。
問題がなければ、無理に過去事例へ当てはめない。
