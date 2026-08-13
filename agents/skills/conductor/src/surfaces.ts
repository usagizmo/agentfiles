// 着地面 1 面の「終端している」「着地してよい」を導く純関数。
//
// **着地の条件は面の型で決まる**（`references/landing-surface.md` が SSOT）。
// **連言にする** —— 観測できない面が 1 つでもあれば終端に達しない。片付けは実体を消すので、
// 倒す向きは「完了と判定しない」側でなければならない。
//
// **dirty はここで見ない。**「全面が dirty でない」は面の述語ではなく課題の述語で、
// 面の側に埋めると課題の連言から落ちる（落ちると、書かなかった面の未コミットを片付けが消す）。

import type { ReportRecord } from "./records.ts";
import type { SurfaceObservation } from "./observation.ts";
import type { Observed } from "./types.ts";
import { present, unobservable } from "./types.ts";

const value = <T>(o: Observed<T>): T | undefined => (o.kind === "present" ? o.value : undefined);

/** 面 1 つぶんの生の観測。**`終端` / `着地してよい` はここから導く。** */
export type SurfaceFacts = {
  readonly name: string;
  readonly usesPr: boolean;
  /** `統合先..branch` が非空か */
  readonly aheadOfIntegration: Observed<boolean>;
  /** その面の branch の head。提出の証跡の照合に使う */
  readonly head: Observed<string>;
  readonly dirty: Observed<boolean>;
  readonly hasCheckout: Observed<boolean>;
  readonly liveCheckoutHealthy: Observed<boolean>;
  /** PR を使う面のみ */
  readonly prMerged: Observed<boolean>;
  readonly openPr: Observed<boolean>;
  readonly checksGreen: Observed<boolean>;
};

/**
 * その面が「提出済み」か。**まとめは追随や rebase では生まれない**ので、
 * `heads` が現在の head と一致することまで見る —— 一致を落とすと、提出のあとに
 * 書き足した面が `着地待ち` のまま固定され、merge も再提出も退避も発火しない。
 */
export const surfaceReported = (
  name: string,
  head: Observed<string>,
  report: Observed<ReportRecord>,
): Observed<boolean> => {
  if (report.kind === "absent") return present(false);
  if (report.kind !== "present") return unobservable("提出のまとめを読めない");
  const current = value(head);
  if (current === undefined) return unobservable("面の head を読めない");
  const recorded = report.value.heads[name];
  return present(recorded !== undefined && recorded === current);
};

/**
 * 面の型ごとの着地の条件。
 *
 * | 面の型          | 着地した                          | 着地してよい               |
 * | --------------- | --------------------------------- | -------------------------- |
 * | PR を使う面     | PR が `merged`                    | open PR があり checks が緑 |
 * | PR を使わない面 | commit があり、その面が提出済み   | 同じ（2 つが一致する）     |
 *
 * **PR を使わない面で merge を条件にしない** —— push も merge も人の領分なので、
 * 条件にすると人が動かすまで終端に到達せず、worktree が枠を焼き続ける。
 */
export const deriveSurface = (
  f: SurfaceFacts,
  report: Observed<ReportRecord>,
): SurfaceObservation => {
  const base = {
    name: f.name,
    usesPr: f.usesPr,
    aheadOfIntegration: f.aheadOfIntegration,
    dirty: f.dirty,
    hasCheckout: f.hasCheckout,
    liveCheckoutHealthy: f.liveCheckoutHealthy,
  };

  if (f.usesPr) {
    const merged = value(f.prMerged);
    const open = value(f.openPr);
    const green = value(f.checksGreen);
    return {
      ...base,
      terminal: merged === undefined ? unobservable("PR の merged を読めない") : present(merged),
      // **「PR が無い」は既知の事実で、読めなかったのとは違う。**checks は PR が無ければ
      // そもそも存在しないので `absent` になる。そこを「読めない」へ畳むと、claim 済みで
      // PR 前の課題（`準備中`・`実装中` の全部）が `着地面が解決できない` に落ち、
      // キューがそこで止まる。checks を要るのは open PR があるときだけ。
      landable:
        open === undefined
          ? unobservable("open PR を読めない")
          : open === false
            ? present(false)
            : green === undefined
              ? unobservable("checks を読めない")
              : present(green),
    };
  }

  const ahead = value(f.aheadOfIntegration);
  const reported = surfaceReported(f.name, f.head, report);
  if (ahead === undefined || reported.kind !== "present") {
    const reason = ahead === undefined ? "面の commit を読めない" : "提出の証跡を読めない";
    return { ...base, terminal: unobservable(reason), landable: unobservable(reason) };
  }
  // **`着地待ち` と `着地済み` が一致する型があってよい。**分けるために merge を持ち込まない。
  const landed = present(ahead && reported.value);
  return { ...base, terminal: landed, landable: landed };
};
