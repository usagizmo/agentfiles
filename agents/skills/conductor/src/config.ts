// tick の設定。**project 差分が持つものだけ**をここに置く。
//
// **既定値を置くのは、推測が外れても待ちが伸びるだけの項目まで。**
// 間違ったものを掴む項目（Status の対応・着地面の座標表）には置かず、欠けたら止まる。

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { TickConfig } from "./decide.ts";
import { DEFAULT_CONFIG } from "./decide.ts";
import { LEDGER_VALUES } from "./types.ts";
import type { Ledger } from "./types.ts";

/**
 * 面の座標。**checkout path を持たない** —— 端末ごとに違うので、設定 file へ入れると
 * その file が tracked にできない（マシン固有の絶対パスが commit される）。
 * path は起動時に `--surface-path <name>=<path>` で渡し、`ResolvedSurface` で束ねる。
 */
export type SurfaceConfig = {
  /** 面の名前（`<owner>/<repo>`）。claim の記録の `landing` と同じ字面 */
  readonly name: string;
  /** その面が PR で着地するか */
  readonly usesPr: boolean;
  /** 枠を消費するか。**変更の中身では決めない。**欠けたら止まる */
  readonly countsCapacity: boolean;
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
   * **省略できる。**省略時は `references/harness.md` のコマンド。
   * project へ手で写さない（写すと SSOT が 2 つになり、観測が黙ってずれる）。
   */
  readonly sessionsCmd: string;
  readonly workspacesCmd: string;
  readonly tick: TickConfig;
};

export type ExecutorSpec = {
  readonly kind: string;
  readonly args: readonly string[];
};

/** `--config` の隣の untracked `config.local.json`。座標キーを持たない。 */
export type WiringConfig = {
  readonly refine: ExecutorSpec;
  readonly resolve: ExecutorSpec;
};

/** 座標に checkout path を束ねたもの。`port` が実際に触るのはこちら。 */
export type ResolvedSurface = SurfaceConfig & { readonly repoPath: string };

/**
 * 座標と `--surface-path` を突き合わせる。**1 面でも欠けたら止まる**（fail-closed）——
 * 落ちた面は観測に出ないので、そこで書き進んでいる課題が成果ゼロの周として数えられる。
 */
export const resolveSurfaces = (
  surfaces: readonly SurfaceConfig[],
  paths: ReadonlyMap<string, string>,
): ResolvedSurface[] =>
  surfaces.map((s) => {
    const repoPath = paths.get(s.name);
    if (repoPath === undefined || repoPath === "") {
      throw new ConfigError(`--surface-path が無い面がある: ${s.name}`);
    }
    return { ...s, repoPath };
  });

export class ConfigError extends Error {}

const HARNESS_MD = `${import.meta.dir}/../references/harness.md`;

/** `references/harness.md` の `--sessions-cmd` / `--workspaces-cmd` code block を切る。 */
export const extractHarnessCmd = (md: string, heading: string): string => {
  const start = md.indexOf(`# --${heading}\n`);
  if (start < 0) throw new ConfigError(`harness.md に # --${heading} が無い`);
  const after = md.slice(start + `# --${heading}\n`.length);
  const end = after.search(/\n# --|\n```/);
  if (end < 0) throw new ConfigError(`harness.md の # --${heading} が閉じていない`);
  const body = after.slice(0, end).trimEnd();
  if (body === "") throw new ConfigError(`harness.md の # --${heading} が空`);
  return body;
};

const readHarnessCmds = (): { readonly sessionsCmd: string; readonly workspacesCmd: string } => {
  let md: string;
  try {
    md = readFileSync(HARNESS_MD, "utf8");
  } catch {
    throw new ConfigError(`harness.md を読めない: ${HARNESS_MD}`);
  }
  return {
    sessionsCmd: extractHarnessCmd(md, "sessions-cmd"),
    workspacesCmd: extractHarnessCmd(md, "workspaces-cmd"),
  };
};

const isLedger = (v: unknown): v is Ledger => LEDGER_VALUES.includes(v as Ledger);

const TRACKED_KEYS = new Set([
  "ghRepo",
  "projectOrg",
  "projectNumber",
  "statusField",
  "statusMap",
  "surfaces",
  "sessionsCmd",
  "workspacesCmd",
  "tick",
]);

const WIRING_KEYS = new Set(["refine", "resolve"]);

const TRACKED_REQUIRED = "ghRepo, projectOrg, projectNumber, statusField, statusMap, surfaces";
const WIRING_REQUIRED = "refine.kind, refine.args, resolve.kind, resolve.args";

const wrapLoadError = (label: "設定" | "配線", abs: string, detail: unknown): ConfigError => {
  const needed = label === "設定" ? TRACKED_REQUIRED : WIRING_REQUIRED;
  const msg = detail instanceof ConfigError ? detail.message : String(detail);
  return new ConfigError(`${label}を読めない: ${abs}\n${msg}\n必要なキー: ${needed}`);
};

/**
 * 設定 JSON を読む。**欠けたら止まる**（fail-closed）——
 * 既定へ倒すと、対応表に無い Status を持つ Issue が黙って `未計画` として計画される。
 */
export const parseConfig = (raw: unknown): ProjectConfig => {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("設定が object ではない");
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!TRACKED_KEYS.has(key)) throw new ConfigError(`設定の ${key} は未知`);
  }

  const required = (key: string): unknown => {
    const v = o[key];
    if (v === undefined) throw new ConfigError(`設定に ${key} が無い`);
    return v;
  };

  const optionalCmd = (key: string, fallback: () => string): string => {
    const v = o[key];
    if (v === undefined) return fallback();
    if (typeof v !== "string" || v === "") throw new ConfigError(`設定の ${key} が空`);
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
    for (const key of ["name", "integrationRef"]) {
      if (typeof e[key] !== "string" || e[key] === "")
        throw new ConfigError(`surfaces の ${key} が無い`);
    }
    if (typeof e["usesPr"] !== "boolean")
      throw new ConfigError("surfaces の usesPr が boolean ではない");
    if (typeof e["countsCapacity"] !== "boolean")
      throw new ConfigError("surfaces の countsCapacity が boolean ではない");
    return {
      name: e["name"] as string,
      usesPr: e["usesPr"],
      countsCapacity: e["countsCapacity"],
      integrationRef: e["integrationRef"] as string,
    };
  });
  const seenNames = new Set<string>();
  for (const s of surfaces) {
    if (seenNames.has(s.name)) throw new ConfigError(`surfaces の name が重複: ${s.name}`);
    seenNames.add(s.name);
  }

  return {
    ghRepo: String(required("ghRepo")),
    projectOrg: String(required("projectOrg")),
    projectNumber: Number(required("projectNumber")),
    statusField: String(required("statusField")),
    statusMap,
    surfaces,
    sessionsCmd: optionalCmd("sessionsCmd", () => readHarnessCmds().sessionsCmd),
    workspacesCmd: optionalCmd("workspacesCmd", () => readHarnessCmds().workspacesCmd),
    // 硬い上限は既定を持つ（推測が外れても待ちが伸びるだけ）。
    tick: (() => {
      const rawTick = o["tick"];
      if (rawTick === undefined) return { ...DEFAULT_CONFIG };
      if (typeof rawTick !== "object" || rawTick === null)
        throw new ConfigError("tick が object ではない");
      const allowed = new Set(Object.keys(DEFAULT_CONFIG));
      const parsed: Partial<TickConfig> = {};
      for (const [key, val] of Object.entries(rawTick)) {
        if (!allowed.has(key)) throw new ConfigError(`tick の ${key} は未知`);
        if (typeof val !== "number") throw new ConfigError(`tick.${key} が number ではない`);
        (parsed as Record<string, number>)[key] = val;
      }
      return { ...DEFAULT_CONFIG, ...parsed };
    })(),
  };
};

const parseExecutor = (stage: "refine" | "resolve", raw: unknown): ExecutorSpec => {
  if (raw === undefined) throw new ConfigError(`配線に ${stage} が無い`);
  if (typeof raw !== "object" || raw === null)
    throw new ConfigError(`配線の ${stage} が object ではない`);
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== "kind" && key !== "args") throw new ConfigError(`配線の ${stage}.${key} は未知`);
  }
  const kind = o["kind"];
  if (typeof kind !== "string" || kind === "") throw new ConfigError(`配線の ${stage}.kind が無い`);
  const argsRaw = o["args"];
  if (!Array.isArray(argsRaw)) throw new ConfigError(`配線の ${stage}.args が配列ではない`);
  const args: string[] = [];
  for (const item of argsRaw) {
    if (typeof item !== "string" || item === "")
      throw new ConfigError(`配線の ${stage}.args に空がある`);
    args.push(item);
  }
  return { kind, args };
};

/** 配線は JSONC。行コメントとブロックコメント、末尾カンマを許す。文字列の中は触らない。 */
export const parseJsonc = (text: string): unknown => JSON.parse(toJson(text));

const toJson = (text: string): string => {
  let out = "";
  let i = 0;
  const n = text.length;
  const skipIdle = (from: number): number => {
    let j = from;
    while (j < n) {
      const ch = text[j];
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        j += 1;
        continue;
      }
      if (ch === "/" && text[j + 1] === "/") {
        j += 2;
        while (j < n && text[j] !== "\n") j += 1;
        continue;
      }
      if (ch === "/" && text[j + 1] === "*") {
        j += 2;
        while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j += 1;
        if (j < n) j += 2;
        continue;
      }
      break;
    }
    return j;
  };
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      out += c;
      i += 1;
      while (i < n) {
        const s = text[i];
        out += s;
        i += 1;
        if (s === "\\") {
          if (i < n) {
            out += text[i];
            i += 1;
          }
          continue;
        }
        if (s === '"') break;
      }
      continue;
    }
    if (c === "/" && text[i + 1] === "/") {
      i = skipIdle(i);
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i = skipIdle(i);
      continue;
    }
    if (c === ",") {
      const next = skipIdle(i + 1);
      if (text[next] === "}" || text[next] === "]") {
        i += 1;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
};

/** 配線を読む。工程は kind と args の object。文字列は受けない。kind 既定へ倒さない。 */
export const parseWiring = (raw: unknown): WiringConfig => {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("配線が object ではない");
  const o = raw as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (!WIRING_KEYS.has(key)) throw new ConfigError(`配線の ${key} は未知`);
  }
  return {
    refine: parseExecutor("refine", o["refine"]),
    resolve: parseExecutor("resolve", o["resolve"]),
  };
};

export const WIRING_FILE = "config.local.json";

/**
 * `--config` と隣の配線を読む。片方に他方のキー、欠落・破損・工程欠けは止まる。
 * 返すのは座標だけ。配線は検証して捨てる（Decision は参照しない）。
 */
export const loadProjectFiles = (configPath: string): ProjectConfig => {
  const configAbs = resolve(configPath);
  const wiringAbs = join(dirname(configAbs), WIRING_FILE);

  const readJson = (abs: string, label: "設定" | "配線"): unknown => {
    if (!existsSync(abs)) throw wrapLoadError(label, abs, "file が無い");
    try {
      const text = readFileSync(abs, "utf8");
      return (label === "配線" ? parseJsonc(text) : JSON.parse(text)) as unknown;
    } catch (error) {
      throw wrapLoadError(label, abs, error);
    }
  };

  const trackedRaw = readJson(configAbs, "設定");
  let config: ProjectConfig;
  try {
    config = parseConfig(trackedRaw);
  } catch (error) {
    throw wrapLoadError("設定", configAbs, error);
  }

  const wiringRaw = readJson(wiringAbs, "配線");
  try {
    parseWiring(wiringRaw);
  } catch (error) {
    throw wrapLoadError("配線", wiringAbs, error);
  }
  return config;
};
