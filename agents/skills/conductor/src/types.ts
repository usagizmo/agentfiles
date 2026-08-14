// tick の domain 型。**観測値をここへ生のまま持ち込まない** —— `-`（読めなかった）や
// 空文字は `decode.ts` の境界で union へ写し、この層から先は「読めなかった」が
// 型として残るようにする。畳むと、壊れた checkout が `着地待ち` と write の解放を通す。

/** 観測できたか・値が在るかの 3 値 + 壊れている。**`unobservable` を `absent` へ畳まない。** */
export type Observed<T> =
  | { readonly kind: "present"; readonly value: T }
  | { readonly kind: "absent" }
  | { readonly kind: "unobservable"; readonly reason: string }
  | { readonly kind: "invalid"; readonly raw: string; readonly reason: string };

export const present = <T>(value: T): Observed<T> => ({ kind: "present", value });
export const absent = <T>(): Observed<T> => ({ kind: "absent" });
export const unobservable = <T>(reason: string): Observed<T> => ({ kind: "unobservable", reason });
export const invalid = <T>(raw: string, reason: string): Observed<T> => ({
  kind: "invalid",
  raw,
  reason,
});

// ---------------------------------------------------------------------------
// 正規化の 4 フィールド
// ---------------------------------------------------------------------------

/** 成果物がどこまで進んだか。**セッションを見ない。**配列の順がそのまま排他ラダー。 */
export const PROGRESS_LADDER = [
  "着地済み",
  "取り下げ",
  "着地待ち",
  "提出中",
  "実装中",
  "準備済み",
  "準備中",
  "未着手",
] as const;
export type Progress = (typeof PROGRESS_LADDER)[number];

/** 実行器がどうなっているか。配列の順がそのまま排他ラダー。 */
export const RUNTIME_LADDER = ["人待ち", "稼働中", "休止", "待機", "無し"] as const;
export type Runtime = (typeof RUNTIME_LADDER)[number];

/** 実体を持っているか。**値そのものが互いに素**なのでラダーではない。 */
export type Capacity = "あり" | "prunable" | "無し";

/** Project Status。対応表は project 必須（無ければ fail-closed）。 */
export const LEDGER_VALUES = ["未計画", "計画済み", "進行中", "完了", "退避先"] as const;
export type Ledger = (typeof LEDGER_VALUES)[number];

// ---------------------------------------------------------------------------
// Conflict
// ---------------------------------------------------------------------------

/**
 * `Conflict` はラダーで解決できないものだけ。「2 つの行に当たった」は含まない。
 * **reason code を増やすときは `scenarios` の該当行を先に足す。**
 */
export const CONFLICT_REASONS = [
  "観測できない",
  "証跡が矛盾している",
  "ledger が解釈不能",
  "ledger が期待より先",
  "group の終端が混在",
  "着地面が解決できない",
  "着地済みだが提出の証跡が無い",
  "live checkout が異常",
  "Issue 契約が欠けたまま成果物がある",
  "計画コメントが無いまま実装の証跡がある",
  "意図の確認が pending なのに人待ちが無い",
  "渡しの記録が複数",
  "退避先だがセッションが止まらない",
] as const;
export type ConflictReason = (typeof CONFLICT_REASONS)[number];

export type Conflict = {
  readonly reason: ConflictReason;
  /** 根拠になった観測。人へ出す説明はここから作る（LLM が読むのは文章化のときだけ） */
  readonly evidence: readonly string[];
  readonly issues: readonly number[];
};

// ---------------------------------------------------------------------------
// action
// ---------------------------------------------------------------------------

/**
 * **action 名の閉集合**。順序の実体は `decide.ts` の `LADDER`。
 * 配列の順は優先順では**ない**。
 */
export const ACTION_LADDER = [
  "報告して止める",
  "規約の穴を起票する",
  "片付ける",
  "計画セッションを片付ける",
  "差し戻す",
  "本文の変更を伝える",
  "計画の失効を伝える",
  "台帳を進める",
  "計画を起こし直す",
  "解決を起こし直す",
  "失効した記録を片付ける",
  "交差を解消する",
  "checks を引き直させる",
  "意図の確認を促す",
  "枠を渡す",
  "計画を起こす",
  "claim する",
] as const;
export type ActionName = (typeof ACTION_LADDER)[number];

/** 差し戻しの戻し先。**主命題のパラメータ**なので、`scenarios` の括弧と 1:1 で対応する。 */
export type RevertTarget = "未計画" | "計画済み" | "退避先";

/** 渡す資源。write と integration は別の資源で、条件を共有しない。 */
export type LeaseKind = "write" | "integration";

/** action のパラメータ。**括弧の中身も照合対象**なので型で持つ。 */
export type ActionParams =
  | { readonly action: Exclude<ActionName, "差し戻す" | "枠を渡す"> }
  | { readonly action: "差し戻す"; readonly to: RevertTarget }
  | {
      readonly action: "枠を渡す";
      readonly lease: LeaseKind;
      readonly missing?: "report";
    };

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * 制約の下位分類。**閉じている**（`scenarios.md` の「期待欄の形」が SSOT）。
 * 遷移で書ける行を制約へ落とさないため、型でも分けておく。
 */
export const CONSTRAINT_KINDS = [
  "選ばれない action",
  "受け手・候補の資格",
  "資源境界",
  "手段の不在",
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

/** action 外の下位分類。同じく閉じている。 */
export const NON_ACTION_KINDS = [
  "起床",
  "人から渡されたものの処理",
  "action の選択と独立な精算",
] as const;
export type NonActionKind = (typeof NON_ACTION_KINDS)[number];

/**
 * tick が 1 周で選ぶ 1 手。**`Action | null` にしない** —— 表は遷移 / 制約 / action 外の
 * 3 形を強度順で使い分けており、制約行を「何も選ばない」へ潰すと回帰がそのぶん薄くなる。
 */
export type Outcome =
  | {
      readonly kind: "action";
      readonly params: ActionParams;
      readonly target: Target;
      readonly evidence: Evidence;
    }
  | { readonly kind: "settle-record"; readonly settlement: Settlement }
  | { readonly kind: "constraint"; readonly constraint: ConstraintKind; readonly detail: string }
  | { readonly kind: "non-action"; readonly nonAction: NonActionKind; readonly detail: string }
  | { readonly kind: "idle" };

/**
 * tick が 1 周で出す結論。
 *
 * **`Conflict` は 1 手の選択と直交する。**当たった課題を選出対象外にするだけで、他の課題は
 * 回す。1 件を止める / 全体を止めるの切り分けは `SKILL.md`「硬い上限」。
 *
 * **選出対象外にしても資源の数え上げからは外さない**（write / integration lease）ので、
 * その課題の実体は他の課題の action から守られたまま。
 */
export type Decision = {
  /** 当たった課題を選出対象外にする。1 手を選べた周でも落とさ**ない**。応答への出し方は `SKILL.md` */
  readonly conflicts: readonly Conflict[];
  readonly outcome: Outcome;
};

/**
 * action の選択とは独立に行う精算。**action として書かない** ——
 * `退避先` にはどの action も当たらないことがあるので、action にすると
 * 「選択 → 無し → 終了」に落ちて一度も揃わない。
 *
 * **action 上限には数えない。ただし実際に書いたら観測からやり直す**（記録は指紋に入る）。
 */
export type Settlement = {
  readonly target: Target;
  /** `退避先` を観測したので、失敗の記録と周回の記録の `count` を 0 に揃える */
  readonly kind: "退避先の count を 0 に揃える";
  readonly detail: string;
};

/** action の対象。**実体を触る action は代表の番号で 1 回**なので、group ごと持つ。 */
export type Target = {
  /** 代表の Issue 番号 */
  readonly representative: number;
  /** 対象集合の全番号（単独課題なら代表 1 件） */
  readonly members: readonly number[];
};

/**
 * 決定から実行までに外部状態が動く。実行の直前に precondition を引き直すため、
 * **何を根拠に選んだか**を持ち回る。
 */
export type Evidence = {
  readonly progress: Progress;
  readonly runtime: Runtime;
  readonly capacity: Capacity;
  readonly ledger: Ledger;
  /** その action を選んだ理由。状況ボードの「この tick の action」がそのまま読む */
  readonly why: string;
};

// ---------------------------------------------------------------------------
// 正規化レコード
// ---------------------------------------------------------------------------

/** **正規化は Issue 単位で行う**。group へ畳むのは選出と資源の集約だけ。 */
export type NormalizedIssue = {
  readonly issue: number;
  readonly progress: Progress;
  readonly runtime: Runtime;
  readonly capacity: Capacity;
  readonly ledger: Ledger;
  /** ラダーで解決できなかったもの。空でなければ `報告して止める` が最上位で当たる */
  readonly conflicts: readonly Conflict[];
};
