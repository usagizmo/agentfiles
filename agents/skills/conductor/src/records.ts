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
import { absent, invalid, present, unobservable } from "./types.ts";

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

/** 単独行として `tag` が立っているか。散文の字面は拾わない。 */
export const hasStandaloneLine = (body: string, tag: string): boolean =>
  standaloneLines(body, tag).length > 0;

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

/**
 * 面の接頭辞を持ちうる項目の列（`invalidationScope` / `expectedWrites`）を、
 * `<面>: <path>` の文字列へ揃える。
 *
 * **yaml では `- <面>: <path>` は文字列ではなく 1 要素の map。**`landing-surface.md` と
 * `ready-record.md` が定める書式はその形なので、文字列の配列だけを受けると
 * **面をまたぐ課題の記録が必ず壊れていると読まれる**（在庫は計画した瞬間に陳腐化扱いになり、
 * 計画 → 差し戻し → 計画 の往復から出られない）。
 *
 * **2 つ以上のキーを持つ map は読めない**（どちらが面か決まらない）。
 */
const scopeList = (v: unknown): readonly string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (!isRecord(item)) return undefined;
    const pairs = Object.entries(item);
    const only = pairs[0];
    if (pairs.length !== 1 || only === undefined || typeof only[1] !== "string") return undefined;
    out.push(`${only[0]}: ${only[1]}`);
  }
  return out;
};

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

/** 渡しの記録の件数。**2 件を 0 に畳まない**（畳むと Conflict も保持も消える）。 */
export const integrationRecordCount = (body: string): Observed<number> => {
  const n = standaloneLines(body, "<!-- integration -->").length;
  if (n >= 2) return present(n);
  const rec = integrationRecord(body);
  if (rec.kind === "present") return present(1);
  if (rec.kind === "absent") return present(0);
  return rec.kind === "invalid" ? invalid(rec.raw, rec.reason) : unobservable(rec.reason);
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

/** 単独行の `report` / `halt` を持つコメントか。散文の字面は拾わない。 */
export const carriesReportOrHalt = (body: string): boolean =>
  hasStandaloneLine(body, "<!-- report -->") || hasStandaloneLine(body, "<!-- halt -->");

export type LinkedPull = {
  readonly number: number;
  readonly state: string;
  readonly mergedAt: string | null;
  readonly headRef: string;
};

/** head が `{prefix}/{番号}-` の open / merged。closed-unmerged は入れない。 */
export const liveOwnedPrs = (issue: number, prs: readonly LinkedPull[]): readonly LinkedPull[] => {
  const owned = new RegExp(`^[^/]+/${issue}-`);
  return prs.filter((p) => owned.test(p.headRef) && (p.state === "open" || p.mergedAt !== null));
};

/**
 * Issue コメントと、紐づく PR の `report` / `halt` コメントから提出の記録を読む。
 * **PR 一覧が読めなければ unobservable** —— `absent` に倒すと提出証跡が「無い」になる。
 */
export const reportFromSources = (
  issueCommentText: string,
  linkedPrComments: Observed<readonly string[]>,
): Observed<ReportRecord> => {
  if (linkedPrComments.kind !== "present") {
    return unobservable(
      linkedPrComments.kind === "unobservable" ? linkedPrComments.reason : "PR 一覧を読めない",
    );
  }
  const text = [issueCommentText, ...linkedPrComments.value].filter((s) => s !== "").join("\n\n");
  return reportRecord(text);
};

export type ReadyRecord = {
  /** **制御面の** base。他の面は `landingReadyShas` */
  readonly readySha: string;
  /** 制御面以外の着地面の base。**無いキーは判定不能**（`ready-record.md`） */
  readonly landingReadyShas: Readonly<Record<string, string>>;
  readonly issueDigest: string;
  /** `<面>: <path>` へ揃えた列（素の path は制御面のもの） */
  readonly invalidationScope: readonly string[];
};

const isReady = (v: unknown): v is ReadyRecord =>
  isRecord(v) &&
  typeof v["readySha"] === "string" &&
  typeof v["issueDigest"] === "string" &&
  // **空にしない**（空だと何も失効しないので、陳腐化が永久に検出されない）
  (scopeList(v["invalidationScope"])?.length ?? 0) > 0;

export const readyRecord = (body: string): Observed<ReadyRecord> => {
  const parsed = parseYaml(extractMarker(body, "ready"), isReady);
  if (parsed.kind !== "present") return parsed;
  const raw = parsed.value as { invalidationScope?: unknown; landingReadyShas?: unknown };
  return present({
    ...parsed.value,
    invalidationScope: scopeList(raw.invalidationScope) ?? [],
    landingReadyShas: isStringMap(raw.landingReadyShas) ? raw.landingReadyShas : {},
  });
};

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
  /** **制御面の** base。他の面は `landingBaseShas`（形式は `resolve` の計画コメント） */
  readonly baseSha: string;
  /** 制御面以外の着地面の base。**面ごとに引く**（制御面の SHA を他 repo で使えない） */
  readonly landingBaseShas: Readonly<Record<string, string>>;
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
  (scopeList(v["invalidationScope"])?.length ?? 0) > 0 &&
  isStringArray(v["resourceKeys"]);

/**
 * 計画コメントから資源キーを取り出す。**`invalid` / `unobservable` を `absent` へ畳まない。**
 * 畳むと全体停止と一時失敗が同じ観測になり、倒す先が選べない。
 */
export const keysOfPlan = (plan: Observed<PlanRecord>): Observed<readonly string[]> =>
  plan.kind === "present" ? present(plan.value.resourceKeys) : plan;

export const planRecord = (body: string): Observed<PlanRecord> => {
  const parsed = parseYaml(extractMarker(body, "plan"), isPlan);
  if (parsed.kind !== "present") return parsed;
  const raw = parsed.value as {
    alsoResolves?: unknown;
    landingBaseShas?: unknown;
    invalidationScope?: unknown;
  };
  // **どちらも省略できる**（制御面だけの課題・同居しない課題）。**無いことを異常にしない。**
  return present({
    ...parsed.value,
    alsoResolves: isNumberArray(raw.alsoResolves) ? raw.alsoResolves : [],
    landingBaseShas: isStringMap(raw.landingBaseShas) ? raw.landingBaseShas : {},
    invalidationScope: scopeList(raw.invalidationScope) ?? [],
  });
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
