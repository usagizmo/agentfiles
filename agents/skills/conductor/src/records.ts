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
  "entry-block",
] as const;
export type Marker = (typeof MARKERS)[number];

/**
 * marker が**行として単独で立っている**位置。
 *
 * **散文の中の字面を拾わない。**記録の説明をする文（再計画の報告・経緯のまとめ・移行の告知）は
 * 運用で必ず出るので、行の途中や code span の中を marker として数えると、**正しい記録がある
 * 課題が「壊れている」に化けて**ラダー最上段に固定される。書く側の規約では塞がらない ——
 * 既に書かれたコメントは残るし、記録について説明する文は今後も書かれる。
 *
 * **行末の `\r` は許す** —— CRLF の本文が実データに混在する。
 */
const standaloneLines = (body: string, tag: string): { start: number; end: number }[] => {
  const found: { start: number; end: number }[] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (bare === tag) found.push({ start: offset, end: offset + line.length });
    offset += line.length + 1;
  }
  return found;
};

/**
 * コメント本文から marker の中身（YAML）を取り出す。
 * **同じ marker が 2 つある本文は `invalid`** —— どちらを拾うか決まらない。
 */
export const extractMarker = (body: string, marker: Marker): Observed<string> => {
  const opens = standaloneLines(body, `<!-- ${marker} -->`);
  const open = opens[0];
  if (open === undefined) return absent();
  if (opens.length >= 2) return invalid(body, `marker ${marker} が 2 つある`);
  const close = standaloneLines(body, `<!-- /${marker} -->`).find((c) => c.start >= open.end);
  if (close === undefined) return invalid(body, `marker ${marker} が閉じていない`);
  const inner = body.slice(open.end, close.start);
  const fence = /```(?:yaml)?\r?\n([\s\S]*?)```/.exec(inner);
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

export type PlanRecord = {
  readonly baseSha: string;
  /** 対象集合の全件。**キーが無いものは不一致として扱う**（fail-closed） */
  readonly issueDigests: Readonly<Record<string, string>>;
  /** ここが変わったら計画が無効になる。**空にしない** */
  readonly invalidationScope: readonly string[];
  /** 同時に触ると壊れるものの名前。**path ではない** */
  readonly resourceKeys: readonly string[];
  /** このブランチで一緒に片付ける Issue */
  readonly alsoResolves: readonly number[];
};

const isPlan = (v: unknown): v is PlanRecord =>
  isRecord(v) &&
  typeof v["baseSha"] === "string" &&
  isStringMap(v["issueDigests"]) &&
  isStringArray(v["invalidationScope"]) &&
  v["invalidationScope"].length > 0 &&
  isStringArray(v["resourceKeys"]);

export const planRecord = (body: string): Observed<PlanRecord> => {
  const parsed = parseYaml(extractMarker(body, "plan"), isPlan);
  if (parsed.kind !== "present") return parsed;
  const also = (parsed.value as { alsoResolves?: unknown }).alsoResolves;
  return present({ ...parsed.value, alsoResolves: isNumberArray(also) ? also : [] });
};

/**
 * 入場を止める宣言。**運び方は `issue-contract.md` が固定し、いつ置くかは project の領分。**
 * **壊れている宣言を「無い」と読まない** —— 読むと、止めているつもりの課題の横で claim が進む。
 */
export type EntryBlockRecord = { readonly issues: readonly number[]; readonly reason: string };

const isEntryBlock = (v: unknown): v is EntryBlockRecord =>
  isRecord(v) &&
  isNumberArray(v["issues"]) &&
  typeof v["reason"] === "string" &&
  v["reason"] !== "";

export const entryBlockRecord = (body: string): Observed<EntryBlockRecord> =>
  parseYaml(extractMarker(body, "entry-block"), isEntryBlock);
