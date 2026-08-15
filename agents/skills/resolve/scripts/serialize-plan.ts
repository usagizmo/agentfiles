// 計画コメントを投稿する直前の機械ゲート。
// marker 抽出と YAML parse を通し、path は生の pathname を YAML scalar として直列化する。
// git の quoted path は拒否する。YAML パーサに git octal 互換は足さない。

import { parse, stringify } from "yaml";

const GIT_OCTAL = /\\[0-7]{3}/;

export type PlanFields = {
  readonly baseSha: string;
  readonly landingBaseShas?: Readonly<Record<string, string>>;
  readonly issueDigests: Readonly<Record<string, string>>;
  readonly size: string;
  readonly expectedWrites: readonly string[];
  readonly invalidationScope: readonly string[];
  readonly resourceKeys: readonly string[];
  readonly dependsOn?: readonly number[];
  readonly alsoResolves?: readonly number[];
};

export type CheckResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export const wrapPlan = (yaml: string): string =>
  `<!-- plan -->\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n<!-- /plan -->\n`;

const standalone = (body: string, tag: string): number[] => {
  const found: number[] = [];
  let offset = 0;
  for (const line of body.split("\n")) {
    const bare = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (bare === tag) found.push(offset);
    offset += line.length + 1;
  }
  return found;
};

const extractPlanYaml = (body: string): CheckResult & { yaml?: string } => {
  const opens = standalone(body, "<!-- plan -->");
  if (opens.length === 0) return { ok: false, reason: "計画コメントが absent" };
  if (opens.length >= 2) return { ok: false, reason: "marker plan が 2 つある" };
  const open = opens[0] ?? 0;
  const close = standalone(body, "<!-- /plan -->").find((c) => c >= open);
  if (close === undefined) return { ok: false, reason: "marker plan が閉じていない" };
  const inner = body.slice(open + "<!-- plan -->".length, close);
  const fence = /```(?:yaml)?\r?\n([\s\S]*?)```/.exec(inner);
  if (fence === null) return { ok: false, reason: "marker plan に yaml ブロックが無い" };
  return { ok: true, yaml: fence[1] ?? "" };
};

const rejectQuoted = (paths: readonly string[]): CheckResult => {
  for (const path of paths) {
    if (GIT_OCTAL.test(path) || (path.startsWith('"') && path.endsWith('"'))) {
      return { ok: false, reason: `git の quoted path は載せない: ${path}` };
    }
  }
  return { ok: true };
};

const scopeList = (v: unknown): readonly string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (typeof item !== "object" || item === null) return undefined;
    const pairs = Object.entries(item);
    const only = pairs[0];
    if (pairs.length !== 1 || only === undefined || typeof only[1] !== "string") return undefined;
    out.push(`${only[0]}: ${only[1]}`);
  }
  return out;
};

export const emitPlan = (fields: PlanFields): string => {
  const doc: Record<string, unknown> = {
    baseSha: fields.baseSha,
    issueDigests: fields.issueDigests,
    size: fields.size,
    expectedWrites: [...fields.expectedWrites],
    invalidationScope: [...fields.invalidationScope],
    resourceKeys: [...fields.resourceKeys],
  };
  if (fields.landingBaseShas !== undefined) doc["landingBaseShas"] = fields.landingBaseShas;
  if (fields.dependsOn !== undefined) doc["dependsOn"] = [...fields.dependsOn];
  if (fields.alsoResolves !== undefined) doc["alsoResolves"] = [...fields.alsoResolves];
  return wrapPlan(stringify(doc).trimEnd());
};

export const checkPlan = (body: string): CheckResult => {
  const extracted = extractPlanYaml(body);
  if (!extracted.ok) return extracted;
  try {
    parse(extracted.yaml ?? "");
  } catch (error) {
    return { ok: false, reason: `yaml として読めない: ${String(error)}` };
  }
  return { ok: true };
};

export const emitAndCheck = (
  fields: PlanFields,
):
  | { readonly ok: true; readonly body: string }
  | { readonly ok: false; readonly reason: string } => {
  const quoted = rejectQuoted([...fields.expectedWrites, ...fields.invalidationScope]);
  if (!quoted.ok) return quoted;
  const body = emitPlan(fields);
  const checked = checkPlan(body);
  if (!checked.ok) return checked;
  const extracted = extractPlanYaml(body);
  if (!extracted.ok) return extracted;
  let parsed: unknown;
  try {
    parsed = parse(extracted.yaml ?? "");
  } catch (error) {
    return { ok: false, reason: `yaml として読めない: ${String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "round-trip できない" };
  }
  const got = scopeList((parsed as { invalidationScope?: unknown }).invalidationScope);
  if (got === undefined || got.length !== fields.invalidationScope.length) {
    return { ok: false, reason: "invalidationScope が round-trip できない" };
  }
  for (let i = 0; i < got.length; i++) {
    if (got[i] !== fields.invalidationScope[i]) {
      return {
        ok: false,
        reason: `invalidationScope が round-trip できない: ${fields.invalidationScope[i]}`,
      };
    }
  }
  return { ok: true, body };
};

const usage = "usage: serialize-plan.ts --check <file> | --emit  (JSON on stdin)";

const main = async (): Promise<void> => {
  const mode = Bun.argv[2];
  if (mode === "--check") {
    const file = Bun.argv[3];
    if (file === undefined) {
      console.error(usage);
      process.exit(2);
    }
    const result = checkPlan(await Bun.file(file).text());
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    return;
  }
  if (mode === "--emit") {
    const fields = (await new Response(Bun.stdin).json()) as PlanFields;
    const result = emitAndCheck(fields);
    if (!result.ok) {
      console.error(result.reason);
      process.exit(1);
    }
    process.stdout.write(result.body);
    return;
  }
  console.error(usage);
  process.exit(2);
};

if (import.meta.main) await main();
