// tick の設定。**project 差分が持つものだけ**をここに置く。
//
// **既定値を置くのは、推測が外れても待ちが伸びるだけの項目まで。**
// 間違ったものを掴む項目（Status の対応・着地面の座標表）には置かず、欠けたら止まる。

import type { TickConfig } from "./decide.ts";
import { DEFAULT_CONFIG } from "./decide.ts";
import { LEDGER_VALUES } from "./types.ts";
import type { Ledger } from "./types.ts";

export type SurfaceConfig = {
  /** 面の名前（`<owner>/<repo>`）。claim の記録の `landing` と同じ字面 */
  readonly name: string;
  /** その面が PR で着地するか */
  readonly usesPr: boolean;
  /** その面の checkout path。**端末ごとに違うので座標表ではなく呼び出し側が渡す** */
  readonly repoPath: string;
  /** 統合先の ref（base と追随の基準。**終端の判定には使わない**） */
  readonly integrationRef: string;
};

export type ProjectConfig = {
  readonly ghRepo: string;
  readonly projectOrg: string;
  readonly projectNumber: number;
  readonly statusField: string;
  /** **project 必須**。対応が無ければ何も選出せずに報告して止まる */
  readonly statusMap: ReadonlyMap<string, Ledger>;
  /** **座標表。先頭が制御面。**空にできない */
  readonly surfaces: readonly SurfaceConfig[];
  /**
   * `watch.sh` へ注入するセッション / workspace の一覧コマンド。
   * **どちらも必須**（`watch.sh` が要求する）。既定を持たせると multiplexer を
   * 共通側が知ることになり、adapter の境界が崩れる。
   */
  readonly sessionsCmd: string;
  readonly workspacesCmd: string;
  readonly tick: TickConfig;
};

export class ConfigError extends Error {}

const isLedger = (v: unknown): v is Ledger => LEDGER_VALUES.includes(v as Ledger);

/**
 * 設定 JSON を読む。**欠けたら止まる**（fail-closed）——
 * 既定へ倒すと、対応表に無い Status を持つ Issue が黙って `未計画` として計画される。
 */
export const parseConfig = (raw: unknown): ProjectConfig => {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("設定が object ではない");
  const o = raw as Record<string, unknown>;

  const required = (key: string): unknown => {
    const v = o[key];
    if (v === undefined) throw new ConfigError(`設定に ${key} が無い`);
    return v;
  };

  const statusRaw = required("statusMap");
  if (typeof statusRaw !== "object" || statusRaw === null)
    throw new ConfigError("statusMap が map ではない");
  const statusMap = new Map<string, Ledger>();
  for (const [name, ledger] of Object.entries(statusRaw)) {
    if (!isLedger(ledger))
      throw new ConfigError(`statusMap の ${name} が 5 値のどれでもない: ${String(ledger)}`);
    statusMap.set(name, ledger);
  }
  // **対応表に要るのは 5 つ。**claim と着地の判定が `進行中` と `完了` に依存するので 3 つでは足りない。
  for (const ledger of LEDGER_VALUES) {
    if (![...statusMap.values()].includes(ledger)) {
      throw new ConfigError(`statusMap に ${ledger} へ写る Status が無い`);
    }
  }

  const surfacesRaw = required("surfaces");
  if (!Array.isArray(surfacesRaw) || surfacesRaw.length === 0) {
    throw new ConfigError("surfaces が空（着地面の座標表は空にできない）");
  }
  const surfaces = surfacesRaw.map((s: unknown): SurfaceConfig => {
    if (typeof s !== "object" || s === null)
      throw new ConfigError("surfaces の要素が object ではない");
    const e = s as Record<string, unknown>;
    for (const key of ["name", "repoPath", "integrationRef"]) {
      if (typeof e[key] !== "string" || e[key] === "")
        throw new ConfigError(`surfaces の ${key} が無い`);
    }
    if (typeof e["usesPr"] !== "boolean")
      throw new ConfigError("surfaces の usesPr が boolean ではない");
    return {
      name: e["name"] as string,
      usesPr: e["usesPr"],
      repoPath: e["repoPath"] as string,
      integrationRef: e["integrationRef"] as string,
    };
  });

  return {
    ghRepo: String(required("ghRepo")),
    projectOrg: String(required("projectOrg")),
    projectNumber: Number(required("projectNumber")),
    statusField: String(required("statusField")),
    statusMap,
    surfaces,
    sessionsCmd: String(required("sessionsCmd")),
    workspacesCmd: String(required("workspacesCmd")),
    // 硬い上限は既定を持つ（推測が外れても待ちが伸びるだけ）。
    tick: {
      ...DEFAULT_CONFIG,
      ...(typeof o["tick"] === "object" && o["tick"] !== null ? o["tick"] : {}),
    },
  };
};
