// Issue コメントの固定 marker を型付きの記録へ写す。
//
// **書式の SSOT は `references/*-record.md` と `protocols.md`。**ここはその読み取り側で、
// 書く側（`resolve` / `refine`）とも共有する相互運用契約なので、勝手に形を変えない。
//
// **壊れている記録を「無い」と読まない。**どちらも `Observed` の別の値で、
// 畳むと fail-closed の述語（意図の確認・人待ち・claim）が黙って通る。

import { parse } from "yaml";
import type { IntentRecord, WaitRecord } from "./observation.ts";
import type { Observed } from "./types.ts";
import { absent, invalid, present } from "./types.ts";

/** marker 名。**allowlist を増やしたらここだけ直す。** */
export const MARKERS = [
  "claim",
  "plan",
  "ready",
  "wait",
  "yield",
  "retry",
  "cycle",
  "intent",
  "integration",
  "report",
] as const;
export type Marker = (typeof MARKERS)[number];

/**
 * コメント本文から marker の中身（YAML）を取り出す。
 * **同じ marker が 2 つある本文は `invalid`** —— どちらを拾うか決まらない。
 */
export const extractMarker = (body: string, marker: Marker): Observed<string> => {
  const open = `<!-- ${marker} -->`;
  const close = `<!-- /${marker} -->`;
  const first = body.indexOf(open);
  if (first < 0) return absent();
  if (body.indexOf(open, first + open.length) >= 0) {
    return invalid(body, `marker ${marker} が 2 つある`);
  }
  const end = body.indexOf(close, first);
  if (end < 0) return invalid(body, `marker ${marker} が閉じていない`);
  const inner = body.slice(first + open.length, end);
  const fence = /```(?:yaml)?\n([\s\S]*?)```/.exec(inner);
  if (fence === null) return invalid(inner, `marker ${marker} に yaml ブロックが無い`);
  return present(fence[1] ?? "");
};

const parseYaml = <T>(source: Observed<string>, check: (v: unknown) => v is T): Observed<T> => {
  if (source.kind !== "present") return source as Observed<T>;
  let parsed: unknown;
  try {
    parsed = parse(source.value);
  } catch (error) {
    return invalid(source.value, `yaml として読めない: ${String(error)}`);
  }
  return check(parsed) ? present(parsed) : invalid(source.value, "必須の欄が欠けている");
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isNumberArray = (v: unknown): v is number[] =>
  Array.isArray(v) && v.every((x) => typeof x === "number");

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

// ---------------------------------------------------------------------------

export type ClaimRecord = {
  readonly representative: number;
  readonly members: readonly number[];
  /** **欠落・空を既定へ丸めない**（`Conflict` の材料になる） */
  readonly landing: readonly string[];
};

const isClaim = (v: unknown): v is ClaimRecord =>
  isRecord(v) &&
  typeof v["representative"] === "number" &&
  isNumberArray(v["members"]) &&
  isStringArray(v["landing"]);

export const claimRecord = (body: string): Observed<ClaimRecord> =>
  parseYaml(extractMarker(body, "claim"), isClaim);

export type RetryRecord = { readonly count: number; readonly lastAction: string | null };

const isRetry = (v: unknown): v is RetryRecord => isRecord(v) && typeof v["count"] === "number";

export const retryRecord = (body: string): Observed<RetryRecord> => {
  const parsed = parseYaml(extractMarker(body, "retry"), isRetry);
  if (parsed.kind !== "present") return parsed;
  return present({ count: parsed.value.count, lastAction: parsed.value.lastAction ?? null });
};

export type CycleRecord = { readonly count: number; readonly mark: string | null };

const isCycle = (v: unknown): v is CycleRecord => isRecord(v) && typeof v["count"] === "number";

export const cycleRecord = (body: string): Observed<CycleRecord> => {
  const parsed = parseYaml(extractMarker(body, "cycle"), isCycle);
  if (parsed.kind !== "present") return parsed;
  return present({ count: parsed.value.count, mark: parsed.value.mark ?? null });
};

export type IntegrationRecord = { readonly issues: readonly number[]; readonly pr: number | null };

const isIntegration = (v: unknown): v is { issues: number[] } =>
  isRecord(v) && isNumberArray(v["issues"]);

export const integrationRecord = (body: string): Observed<IntegrationRecord> => {
  const parsed = parseYaml(extractMarker(body, "integration"), isIntegration);
  if (parsed.kind !== "present") return parsed;
  const pr = (parsed.value as { pr?: unknown }).pr;
  return present({ issues: parsed.value.issues, pr: typeof pr === "number" ? pr : null });
};

/**
 * 人待ちの記録。**有効かどうかの判定は呼ぶ側**（休止の記録の有無が要る）。
 * ここは `state` と質問の本文の有無までを返す。
 */
export const waitRecord = (body: string, hasPauseRecord: boolean): WaitRecord => {
  const extracted = extractMarker(body, "wait");
  if (extracted.kind === "absent") return { kind: "absent" };
  if (extracted.kind !== "present") return { kind: "broken", reason: "marker を読めない" };

  let parsed: unknown;
  try {
    parsed = parse(extracted.value);
  } catch (error) {
    return { kind: "broken", reason: `yaml として読めない: ${String(error)}` };
  }
  if (!isRecord(parsed)) return { kind: "broken", reason: "yaml が map でない" };

  const state = parsed["state"];
  if (state === "cleared") return { kind: "cleared" };
  if (state !== "waiting")
    return { kind: "broken", reason: `state が waiting / cleared でない: ${String(state)}` };

  const reason = parsed["reason"];
  const hasQuestion = typeof reason === "string" && reason.trim() !== "";
  if (hasQuestion) return { kind: "waiting", validity: { kind: "valid" } };
  // **本文の欠落だけで解除しない。**実行資源待ちの証跡があるときだけ失効として扱う。
  return {
    kind: "waiting",
    validity: hasPauseRecord ? { kind: "resource-wait-mislabeled" } : { kind: "undecidable" },
  };
};

/** 意図の確認。**`not-required` と推測しない**（無い / 壊れているはそのまま返す）。 */
export const intentRecord = (body: string): IntentRecord => {
  const extracted = extractMarker(body, "intent");
  if (extracted.kind === "absent") return { kind: "absent" };
  if (extracted.kind !== "present") return { kind: "broken", reason: "marker を読めない" };

  let parsed: unknown;
  try {
    parsed = parse(extracted.value);
  } catch (error) {
    return { kind: "broken", reason: `yaml として読めない: ${String(error)}` };
  }
  if (!isRecord(parsed)) return { kind: "broken", reason: "yaml が map でない" };

  const state = parsed["state"];
  if (state === "pending") return { kind: "pending" };
  if (state === "confirmed") return { kind: "confirmed" };
  if (state === "not-required") return { kind: "not-required" };
  return { kind: "broken", reason: `state が 3 値のどれでもない: ${String(state)}` };
};

export type ReportRecord = {
  readonly heads: Readonly<Record<string, string>>;
  readonly bases: Readonly<Record<string, string>>;
};

const isStringMap = (v: unknown): v is Record<string, string> =>
  isRecord(v) && Object.values(v).every((x) => typeof x === "string");

const isReport = (v: unknown): v is ReportRecord =>
  isRecord(v) && isStringMap(v["heads"]) && isStringMap(v["bases"]);

export const reportRecord = (body: string): Observed<ReportRecord> =>
  parseYaml(extractMarker(body, "report"), isReport);

export type ReadyRecord = {
  readonly readySha: string;
  readonly issueDigest: string;
  readonly invalidationScope: readonly string[];
};

const isReady = (v: unknown): v is ReadyRecord =>
  isRecord(v) &&
  typeof v["readySha"] === "string" &&
  typeof v["issueDigest"] === "string" &&
  // **空にしない**（空だと何も失効しないので、陳腐化が永久に検出されない）
  isStringArray(v["invalidationScope"]) &&
  v["invalidationScope"].length > 0;

export const readyRecord = (body: string): Observed<ReadyRecord> =>
  parseYaml(extractMarker(body, "ready"), isReady);

export type YieldRecord = {
  readonly issues: readonly number[];
  readonly to: number;
  readonly keys: readonly string[];
};

const isYield = (v: unknown): v is YieldRecord =>
  isRecord(v) &&
  isNumberArray(v["issues"]) &&
  typeof v["to"] === "number" &&
  isStringArray(v["keys"]);

export const yieldRecord = (body: string): Observed<YieldRecord> =>
  parseYaml(extractMarker(body, "yield"), isYield);
