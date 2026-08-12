// 計画コメントと現在の観測の突き合わせ。
//
// **どちらも fail-closed。**digest のキーが無ければ不一致、失効の判定材料が無ければ交差扱い ——
// 倒す向きを逆にすると、古い前提のまま書き続ける課題を止められない。

import type { PlanRecord, ReadyRecord } from "./records.ts";
import type { Observed } from "./types.ts";
import { present, unobservable } from "./types.ts";

/**
 * 本文が計画の記録と一致しているか。**キーが無いものは不一致として扱う**（`body-digest.md`）。
 * **`updatedAt` で代用しない** —— コメントを付けただけでも動くので収束しない。
 */
export const bodyMatchesPlan = (
  plan: Observed<PlanRecord>,
  /** 対象集合の番号 → いまの本文の SHA-256 */
  digests: ReadonlyMap<number, Observed<string>>,
): Observed<boolean> => {
  if (plan.kind === "absent") return present(true); // 計画がまだ無い段では突き合わせる相手が無い
  if (plan.kind !== "present") return unobservable("計画コメントを読めない");

  for (const [issue, digest] of digests) {
    if (digest.kind !== "present") return unobservable(`Issue ${issue} の本文を読めない`);
    const recorded = plan.value.issueDigests[String(issue)];
    if (recorded === undefined || recorded !== digest.value) return present(false);
  }
  return present(true);
};

/** 面ごとの base。`base` が `undefined` なら判定不能（呼ぶ側が交差扱いへ倒す）。 */
export type PlanBase = { readonly surface: string; readonly base: string | undefined };

/**
 * どの面を、どの base から測るか。
 *
 * **回すのはその課題の着地面だけ。座標表の全面ではない** —— 制御面の SHA は他 repo に
 * 存在しないので `git diff` が必ず落ち、判定不能 = 交差扱いになる。着地面が 2 面以上ある
 * 座標表では、それだけで**全課題が常に失効扱い**になる。
 *
 * **制御面は着地面に含まれなくても必ず見る**（`landing-surface.md`）—— project 差分と
 * 共有ファイルがそこにあるので、外すとその範囲が動いても永久に失効しない。
 *
 * **キーが無い面は `undefined` のまま返す**（fail-closed の材料であって、既定へ倒す場所ではない）。
 */
const surfaceBases = (
  controlBase: string,
  otherBases: Readonly<Record<string, string>>,
  landing: readonly string[],
  control: string,
): readonly PlanBase[] =>
  [control, ...landing.filter((n) => n !== control)].map((surface) => ({
    surface,
    base: surface === control ? controlBase : otherBases[surface],
  }));

export const planBases = (
  plan: PlanRecord,
  landing: readonly string[],
  control: string,
): readonly PlanBase[] => surfaceBases(plan.baseSha, plan.landingBaseShas, landing, control);

export const readyBases = (
  record: ReadyRecord,
  landing: readonly string[],
  control: string,
): readonly PlanBase[] => surfaceBases(record.readySha, record.landingReadyShas, landing, control);

/** 面ごとの `base..統合先` で変わった path。 */
export type ChangedPath = { readonly surface: string; readonly path: string };

/**
 * 計画が失効したか。**どの面かの base から統合先までの変更**が `invalidationScope` か
 * `resourceKeys` に交差するかで見る。
 *
 * **面のキーが欠けていれば判定不能として交差扱い** —— 判定できないことを「交差していない」
 * へ倒すと、統合先が動いた面で古い前提のまま書き続ける。
 */
export const planInvalidated = (
  plan: Observed<PlanRecord>,
  changedPaths: Observed<readonly ChangedPath[]>,
  /** 制御面の名前。**接頭辞の無い項目はこの面の path** */
  control: string,
): Observed<boolean> => {
  if (plan.kind === "absent") return present(false);
  if (plan.kind !== "present") return unobservable("計画コメントを読めない");
  if (changedPaths.kind !== "present") return present(true); // 判定不能は交差扱い

  const scope = [...plan.value.invalidationScope, ...plan.value.resourceKeys];
  return present(changedPaths.value.some((c) => scope.some((entry) => matches(c, entry, control))));
};

/**
 * `invalidationScope` の 1 項目が、ある面の変更に当たるか（`landing-surface.md`
 * 「面をまたぐ path の突き合わせ」）。
 *
 * | scope の書き方        | 面 S の評価で                    |
 * | --------------------- | -------------------------------- |
 * | `S: <path>`           | 接頭辞を外し `<path>` として使う |
 * | 接頭辞の無い path     | **制御面**の path とみなす       |
 * | `T: <path>`（S 以外） | 使わ**ない**                     |
 *
 * **前方一致で見る** —— ディレクトリを書いた項目がその下の変更に当たらないと、
 * 「読んで前提にした範囲」が失効判定から抜ける。
 */
const matches = (changed: ChangedPath, entry: string, control: string): boolean => {
  const at = entry.indexOf(": ");
  if ((at < 0 ? control : entry.slice(0, at)) !== changed.surface) return false;
  const bare = at < 0 ? entry : entry.slice(at + 2);
  if (bare === "") return false;
  const path = changed.path;
  return path === bare || path.startsWith(bare.endsWith("/") ? bare : `${bare}/`);
};

/**
 * 在庫が陳腐化したか。判定の 5 つは `ready-record.md`「読むときの判定」が SSOT。
 *
 * **記録が読めるかどうかだけで決めない** —— 決めると、統合先が進んでも本文が変わっても
 * 計画済みのまま claim される。**判定できないものは陳腐化**（fail-closed）。
 */
export const readyStale = (
  record: Observed<ReadyRecord>,
  /** 面ごとの `readySha..統合先` で変わった path */
  changedPaths: Observed<readonly ChangedPath[]>,
  /** いまの本文の digest */
  bodyDigest: Observed<string>,
  control: string,
): Observed<boolean> => {
  if (record.kind !== "present") return present(true);
  if (changedPaths.kind !== "present") return present(true);
  if (bodyDigest.kind !== "present") return present(true);
  if (bodyDigest.value !== record.value.issueDigest) return present(true);
  const scope = record.value.invalidationScope;
  return present(changedPaths.value.some((c) => scope.some((entry) => matches(c, entry, control))));
};
