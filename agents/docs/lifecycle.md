# 課題 1 件のライフサイクル

規約の本体は `conductor` / `refine` / `resolve` の各 `SKILL.md`。ここは導出した図。
**知らない語が出てきたら** [`glossary.md`](glossary.md)。

課題 1 件は **4 つの軸**で表される。図はこの軸ごとに分かれている。

| 軸 | 何を表すか |
| --- | --- |
| `progress` | **成果物がどこまで進んだか**（branch・PR・commit から決まる） |
| `runtime` | **実行しているセッションの様子**（動いている / 止まっている / 人を待っている） |
| `capacity` | **作業場所（worktree）を持っているか** |
| `ledger` | **ボード上の表示**（Project Status） |

## 状態遷移（conductor から見た `progress`）

観測から一意に決まる。**worktree とセッションの「有無」は `progress` に入らない**（それぞれ
`capacity` と `runtime`）ので、着地待ちの実体が消えても状態は退行しない。
見るのは worktree の**中身**（dirty かどうか）だけ。

```mermaid
stateDiagram-v2
    [*] --> 未着手: Issue が open
    未着手 --> 準備中: claim（branch を作る）
    準備中 --> 準備済み: 計画コメントを書く
    準備済み --> 実装中: commit があるか worktree が dirty
    実装中 --> 準備済み: worktree ごと失われた（commit 前）
    実装中 --> 提出中: PR を作る
    提出中 --> 着地待ち: checks が緑
    着地待ち --> 提出中: checks が緑でなくなった
    着地待ち --> 着地済み: merged
    実装中 --> 着地済み: PR を経由しない着地

    提出中 --> 取り下げ: PR が unmerged で closed
    着地待ち --> 取り下げ: PR が unmerged で closed
    準備中 --> 取り下げ: Issue が closed

    着地済み --> [*]: 実体を片付ける
    取り下げ --> [*]: 実体を片付ける

    note left of 未着手
        期待する ledger は
        未計画 または 計画済み
        （refine 済みで claim 前）
    end note
    note right of 準備中
        ここから着地待ちまでが
        ledger = 進行中
    end note
    note right of 着地待ち
        integration は
        この状態のうち 1 件だけ
    end note
```

**判定は上から読んで最初に当たった行**（終端が最上段）。`ship` は remote branch を消さないので、
merge 直後は「branch あり + commit あり」も同時に真になる。**終端を先に確定しないと、正常な着地の
たびに `Conflict` で止まって片付けに到達しない。**

**計画セッション（`refine`）は `progress` に現れない。**成果物は進んでいないので `未着手` のまま
で、セッションの有無は `runtime` 側の話。

**複数の行に当たるのは正常**（上から読んで先に当たった方が勝つ、という決め方なので）。
`Conflict`（**判断がつかない状態**。該当条件は `conductor/SKILL.md`）はどの状態からも起こりうる。
遷移せず、状況ボードへ出して止まる。

**`ledger` が期待より「手前」なら `Conflict` にしない** — 前進で直せる（claim 直後に Status 更新が
失敗した `準備中 × 計画済み` がこれ）。

## 実行器と資源（同じ課題の別の軸）

`progress` が同じでも、実行器と実体は独立に消えたり戻ったりする。

```mermaid
stateDiagram-v2
    direction LR
    state "runtime" as R {
        無し --> 稼働中: 起こす / 起こし直す
        稼働中 --> 待機: 資源を待って応答を終える
        待機 --> 稼働中: 資源を渡す
        稼働中 --> 人待ち: 記録を waiting にする
        人待ち --> 待機: 人が答える → 記録を cleared に
        人待ち --> 人待ち: セッションが死ぬ（記録が残るので値は変わらない）
        稼働中 --> 無し: セッションが死ぬ
        待機 --> 無し: セッションが死ぬ
    }
```

**`人待ち` はセッションの有無を問わない。**記録が `waiting` である限り `人待ち`。だから人待ち中に
セッションが死んでも値は割れず、`Conflict` にならない。**起こし直された側は起動時に記録を読み**、
まだ答えが無ければ質問を出し直し、答えが返っていれば解釈して `cleared` にする。

**`待機` は「記録が無い」と「`cleared`」の両方を含む。**片方だけにすると、答えを解釈した直後の
「動いていない」がどの値にも当たらず、人待ちからの復帰が止まる。

**`人待ち` から直接 `稼働中` へ戻らない。**答えが返っても write は別の課題へ回っている可能性が
あるので、`待機` を経由して渡し直しを待つ。

**セッションが死んでも `progress` は動かない。**だから `runtime` を `無し` から起こし直すだけで
続きから再開できる（実装は worktree に、計画と人待ちは Issue に残っている）。
唯一の例外は commit 前に worktree ごと失われたときで、そのときは実装自体が無いので
`準備済み` へ戻るのが正しい。

## 着地までのやりとり

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant C as conductor
    participant M as multiplexer
    participant R as resolve セッション
    participant GH as GitHub

    C->>GH: 観測（Issue / branch / PR / コメント）
    C->>C: 正規化 → action を 1 つ選ぶ
    C->>GH: branch を作る（claim の防壁）
    C->>GH: Status を進行中にする
    Note over C,GH: 失敗したら起こさない。<br/>台帳がずれたまま起こすと interactive に落ちる
    C->>M: worktree を作ってセッションを起こす
    M->>R: /resolve #N

    R->>GH: 計画コメント（plan:v1）
    R-->>C: 応答を終えて待機（何を待つか 1 行）
    C->>C: write が空いた
    C->>M: 実装を始めてよい
    M->>R: 再開

    alt Issue 本文に無い判断が必要
        R->>GH: 人待ちの記録（wait:v1 / waiting）
        R-->>C: 待機
        C->>C: write を返す。詰まりとして出す
        C-->>U: 状況ボードに「何を答えれば進むか」
        U->>R: 答える
        R->>GH: 記録を cleared に
        R-->>C: 待機（write の渡し直しを待つ）
        C->>M: 実装を続けてよい
    end

    R->>R: finish（規模別）→ 検証
    opt 機械が正解を持たない成果物
        R->>U: 実物を見せて意図を確認
    end
    R->>GH: PR を作る（CI が緑になるまでここ）
    R->>GH: セッションまとめを PR へコメント（着地の前）
    Note over R,C: PR 作成と CI は integration の外。<br/>write を持ったまま進む
    R-->>C: 待機
    C->>C: integration は PR 作成が最も早い 1 件
    C->>M: 着地してよい
    M->>R: 再開
    R->>GH: latest default へ追随 → merge

    C->>GH: 観測 → progress が着地済み
    C->>M: 成果を確認してから実体を片付ける
    Note over C: 片付けは台帳より先<br/>（action の優先順）
    C->>GH: Status を完了へ
```

**片付けの前に必ず成果を確認する。**worktree とセッションを消すとセッションまとめが一緒に消え、
**git にも Issue にも残らない**。PR に載っていなければ pane から回収し、どこにも無ければ
片付けずに報告する。

## 計画済みになるまで

```mermaid
sequenceDiagram
    autonumber
    actor U as ユーザー
    participant C as conductor
    participant F as refine セッション
    participant GH as GitHub

    C->>C: ledger が未計画 かつ progress が未着手
    Note over C: 在庫の上限と計画枠を見る。<br/>揃っていない group の残りは<br/>在庫の上限を超えて起こす
    C->>F: /refine #N
    F->>GH: Issue と関連コードを読む
    F->>F: consult で方針を確定

    alt 製品判断が要る項目が埋まらない
        F->>GH: 人待ちの記録（waiting）
        F-->>C: 待機
        C-->>U: 状況ボードに出す
        U->>F: 答える
        F->>GH: 記録を cleared に
    end

    F->>GH: Issue 契約を本文へ（6 項目）
    F->>GH: 同じブランチで直るものに Same branch as を相互に書く
    F->>GH: Status を計画済みへ
    Note over F,GH: これが着手承認そのもの。<br/>conductor は自分で積めない
    C->>C: 観測 → 計画セッションが終わっている
    C->>C: pane を閉じる（計画枠を空ける）
```
