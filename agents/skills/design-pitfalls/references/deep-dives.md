# 設計原則 deep-dives

`design-principles.md` の判定基準・事例。迷った軸だけ読む。

## 抽象化は実際の分岐が 2 つ以上あるときだけ入れる

1-variant enum / 将来予約 / dead label は作らない。Plan で将来用に入れても、trivial dispatch に落ちたら tidy で削る。field の組み合わせで導出できるラベルは enum にしない。

## primitive の override が繰り返されたら feature-local wrapper

共有 primitive の base 前提と衝突する用途を variant で増やすと SSOT が薄れる。同 feature で「override で base を 2 つ以上打ち消す」が 2 例以上なら wrapper を新設する。同じ base 前提なら primitive に variant、違う base 前提なら wrapper。

## 順序制約は型で固定する

「A の後でしか B できない」をコメントに頼らない。guard / token / session を struct に束ね、compile time で強制する。builder / branded readiness / `Result<Session, Locked>` も同軸。

## 表示 gate 撤去時は下位の readiness 漏れを確認する

表示 gate が下位 layer の準備完了までの時間稼ぎを兼ねていることがある。撤去と同時に、同じ前提を読む全解決経路の直前に単一 preflight を置く。caller ごとに「未 load なら準備」を散らさない。

## gate 撤去時は owner-awareness も確認する

下位 helper が暗黙に active tenant を読むと、非 active 対象で副作用が分裂する。対象から owner を 1 回解決し、全副作用を同一 owner で駆動する。active fallback は owner 未解決時のみ。

## trust boundary 跨ぎは既存 delete + create の合成

専用 journal / state machine を新設する前に、既存 teardown / create SSOT + FS/DB atomicity + boot reconcile で足りるか問う。B-first（先に移動先を作る）なら途中 crash は重複に倒れ、reconcile が収束させる。

## production / test 差は型 (DI) で表す

env bypass は意図が型に出ず、test の立て忘れで副作用が混入する。依存は必須引数の trait / DI で渡し、production は OS 実装、test は in-memory。新 caller が明示渡しを書かない限り compile error になる構造にする。
