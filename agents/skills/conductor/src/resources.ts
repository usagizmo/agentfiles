// 資源の保持と交差。**論理 lease（write / integration）の保持者は課題、
// 物理枠（容量 / 計画枠）の保持者は実体**なので、1 語にまとめない。

import type { IssueObservation, SurfaceObservation } from "./observation.ts";
import type { NormalizedIssue, Observed } from "./types.ts";

const value = <T>(o: Observed<T>): T | undefined => (o.kind === "present" ? o.value : undefined);

/**
 * write を保持しているか。**「保持している条件」が唯一の復元式**で、取得と解放を別に書かない。
 *
 * **非保持へ倒すのは記録と台帳で裏の取れる 3 つだけ**（`人待ち` / `休止` / `退避先`）。
 * `待機` を非保持に使わない —— 「渡された直後」と「渡される前」が同じ観測になる。
 * `準備中` を保持側に入れない —— 計画コメントを持たないので必ず全交差になり、
 * claim した瞬間に実効並列が 1 に潰れる。
 */
export const holdsWrite = (r: NormalizedIssue): boolean => {
  if (r.runtime === "人待ち" || r.runtime === "休止") return false;
  if (r.ledger === "退避先") return false;
  return r.progress === "準備済み" || r.progress === "実装中" || r.progress === "提出中";
};

/**
 * integration を保持しているか。**渡しの記録の存在だけで決まる**
 * （`着地待ち` に居なくてよい —— 追随中の `提出中` を含む）。
 */
export const holdsIntegration = (o: IssueObservation): boolean =>
  o.integrationRecordCount.kind !== "present" || o.integrationRecordCount.value >= 1;

/** 交差の判定は 3 値。**`unknown` は `incompatible` として扱う。** */
export type Compatibility = "compatible" | "incompatible" | "unknown";

/**
 * 資源キーの交差。**キーの一覧を project が持っていなくてよい** ——
 * 無ければ全部 `unknown` = 全直列になり、遅いだけで壊れない。
 */
export const intersect = (
  a: Observed<readonly string[]>,
  b: Observed<readonly string[]>,
): Compatibility => {
  const left = value(a);
  const right = value(b);
  if (left === undefined || right === undefined) return "unknown";
  return left.some((key) => right.includes(key)) ? "incompatible" : "compatible";
};

/** 並列にしてよいのは `compatible` だけ。 */
export const blocks = (c: Compatibility): boolean => c !== "compatible";

/**
 * 実 checkout。属性も runtime も見ない。**上限の数値は置かない。**
 * **`あり` の数で数えない** —— 2 面持つ課題が 1 面の課題と同じ重さになる。
 */
export const checkoutCount = (observations: readonly IssueObservation[]): number =>
  observations.reduce(
    (total, o) => total + o.surfaces.filter((s) => value(s.hasCheckout) === true).length,
    0,
  );

/**
 * その課題の代表について、数える本数に入れる面か。
 * 人待ち・退避先は数えず、休止は数える。
 */
export const surfaceCountsTowardCapacity = (r: NormalizedIssue, s: SurfaceObservation): boolean => {
  if (r.runtime === "人待ち" || r.ledger === "退避先") return false;
  return s.countsCapacity && value(s.hasCheckout) === true;
};

/**
 * 計画枠は**生存している `refine-<番号>` のセッション数**（完全一致）。
 * `retired-refine-<番号>` は数えない。**人待ちでも返らない。**
 */
export const planSlotUsage = (observations: readonly IssueObservation[]): number =>
  observations.filter((o) => o.refineSession.kind !== "none").length;
