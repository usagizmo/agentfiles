// `report` の妥当性。**SSOT は `references/session-report.md`。**
// YAML の存在は提出ではない。

import type { ReportRecord } from "./records.ts";
import type { Observed } from "./types.ts";
import { present, unobservable } from "./types.ts";

/** `git merge-base --is-ancestor` の結果。解決できない SHA は `present(false)`。 */
export type Ancestry = (
  surface: string,
  ancestor: string,
  descendant: string,
) => Observed<boolean> | Promise<Observed<boolean>>;

const sameKeys = (got: Readonly<Record<string, unknown>>, landing: readonly string[]): boolean => {
  if (Object.keys(got).length !== landing.length) return false;
  return landing.every((name) => Object.hasOwn(got, name));
};

/**
 * 記録が妥当なら `present(true)`。YAML はあるが妥当でないなら `present(false)`。
 * 祖先判定が読めないときだけ `unobservable`。
 */
export const reportValid = async (
  report: ReportRecord,
  landing: readonly string[],
  tips: ReadonlyMap<string, string>,
  isAncestor: Ancestry,
): Promise<Observed<boolean>> => {
  if (!sameKeys(report.heads, landing) || !sameKeys(report.bases, landing)) return present(false);

  let someProof = false;
  for (const name of landing) {
    const head = report.heads[name];
    const base = report.bases[name];
    if (head === undefined || base === undefined) return present(false);

    if (base === head) {
      // 同一は祖先か同一を満たす。厳密な祖先ではない。
    } else {
      const rel = await isAncestor(name, base, head);
      if (rel.kind === "unobservable") return unobservable(rel.reason);
      if (rel.kind !== "present" || !rel.value) return present(false);
      someProof = true;
    }

    for (const sha of report.written[name] ?? []) {
      const tip = tips.get(name);
      if (tip === undefined || tip === "-") {
        return unobservable(`面 ${name} の統合先 tip を読めない`);
      }
      if (sha === tip) {
        someProof = true;
        continue;
      }
      const rel = await isAncestor(name, sha, tip);
      if (rel.kind === "unobservable") return unobservable(rel.reason);
      if (rel.kind !== "present") return present(false);
      if (rel.value) someProof = true;
    }
  }
  return present(someProof);
};
