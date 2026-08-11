// 計画コメントと現在の観測の突き合わせ。
//
// **どちらも fail-closed。**digest のキーが無ければ不一致、失効の判定材料が無ければ交差扱い ——
// 倒す向きを逆にすると、古い前提のまま書き続ける課題を止められない。

import type { PlanRecord } from "./records.ts";
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

/**
 * 計画が失効したか。**どの面かの base から統合先までの変更**が `invalidationScope` か
 * `resourceKeys` に交差するかで見る。
 *
 * **面のキーが欠けていれば判定不能として交差扱い** —— 判定できないことを「交差していない」
 * へ倒すと、統合先が動いた面で古い前提のまま書き続ける。
 */
export const planInvalidated = (
  plan: Observed<PlanRecord>,
  /** 面ごとの `base..統合先` で変わった path。読めなかった面は含めず `unreadableSurfaces` に載せる */
  changedPaths: Observed<readonly string[]>,
): Observed<boolean> => {
  if (plan.kind === "absent") return present(false);
  if (plan.kind !== "present") return unobservable("計画コメントを読めない");
  if (changedPaths.kind !== "present") return present(true); // 判定不能は交差扱い

  const scope = [...plan.value.invalidationScope, ...plan.value.resourceKeys];
  return present(changedPaths.value.some((path) => scope.some((entry) => matches(path, entry))));
};

/**
 * `invalidationScope` の 1 項目が path に当たるか。
 *
 * **項目は path か契約の名前**で、`<owner>/<repo>: <path>` の形も取る。
 * **前方一致で見る** —— ディレクトリを書いた項目がその下の変更に当たらないと、
 * 「読んで前提にした範囲」が失効判定から抜ける。
 */
const matches = (path: string, entry: string): boolean => {
  const bare = entry.includes(": ") ? (entry.split(": ")[1] ?? entry) : entry;
  if (bare === "") return false;
  return path === bare || path.startsWith(bare.endsWith("/") ? bare : `${bare}/`);
};
