// アドバイザー候補表の検証と選出。候補 kind の集合は advisors.json だけが持つ。
// 宣言 file は JSONC（コメントと末尾カンマ）。parse は jsonc.ts。
//
//   bun advisors.ts select --roster <file> --self <kind>
//   bun advisors.ts start-argv --slot <file> --name <name> --pane <id>
//   bun advisors.ts complete --output <file> --marker <token>
//
// select の stdout は選出した枠の JSON。表に無い self は先頭 2 枠 + stderr へ警告。
// start-argv の stdout は herdr agent start の argv JSON。read-only 手段を末尾に足す。

import { parseJsonc } from "./jsonc.ts";

export const MAX_ADVISORS = 2;
export const ROSTER_URL = new URL("./advisors.json", import.meta.url);

export type Slot = {
  readonly kind: string;
  readonly args: readonly string[];
  readonly members: readonly string[];
};

export type Selection = {
  readonly chosen: readonly Slot[];
  readonly warning: boolean;
};

export type CompleteReason = "出力なし" | "マーカー無し";

export type CompleteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: CompleteReason };

const BOX = /[\u2500-\u257F\u2580-\u259F╭╮╯╰❯]/u;
const BOX_STRIP = /[\u2500-\u257F\u2580-\u259F╭╮╯╰❯·]/gu;

const SLOT_KEYS = new Set(["kind", "args", "members"]);
const KIND_RE = /^[a-z][a-z0-9_-]*$/;
const BYPASS = new Set([
  "--dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
  "--full-auto",
  "--force",
  "-f",
  "--always-approve",
  "--trust",
  "--auto-review",
  "--approve-mcps",
  "--no-plan",
]);
const DENIED_CONFIG = new Set(["sandbox_mode", "approval_policy"]);

export class RosterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RosterError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((a) => typeof a === "string");

export const readOnlyArgs = (kind: string): readonly string[] => {
  if (kind === "codex") return ["-s", "read-only"];
  if (kind === "claude") return ["--permission-mode", "plan"];
  if (kind === "grok") return ["--permission-mode", "plan", "--no-subagents"];
  if (kind === "cursor") return ["--mode", "plan"];
  throw new RosterError(`read-only 手段が無い kind: ${kind}`);
};

const fail = (message: string, path: string): never => {
  throw new RosterError(`${path}: ${message}`);
};

const splitFlag = (
  token: string,
  next: string | undefined,
): { name: string; value: string | undefined } => {
  if (!token.startsWith("-") || token === "--") return { name: token, value: undefined };
  const eq = token.indexOf("=");
  if (eq >= 1) return { name: token.slice(0, eq), value: token.slice(eq + 1) };
  if (!token.startsWith("--") && token.length > 2) {
    return { name: token.slice(0, 2), value: token.slice(2) };
  }
  return { name: token, value: next };
};

const rejectBypass = (args: readonly string[]): void => {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (token === "--") throw new RosterError("args に -- は置けない");
    const { name, value } = splitFlag(token, args[i + 1]);
    if (BYPASS.has(name)) throw new RosterError(`read-only を打ち消す flag: ${token}`);
    if (name === "--permission-mode" && value !== "plan") {
      throw new RosterError(`--permission-mode は plan だけ: ${value ?? "(無し)"}`);
    }
    if (name === "--mode" && value !== "plan") {
      throw new RosterError(`--mode は plan だけ: ${value ?? "(無し)"}`);
    }
    if ((name === "-s" || name === "--sandbox") && value !== "read-only") {
      throw new RosterError(`sandbox は read-only だけ: ${value ?? "(無し)"}`);
    }
    if (name === "-c" || name === "--config") {
      const key = (value ?? "").split("=")[0] ?? "";
      if (DENIED_CONFIG.has(key) || key.startsWith("sandbox_")) {
        throw new RosterError(`read-only を打ち消す config: ${value ?? "(無し)"}`);
      }
    }
  }
};

export const parseRoster = (text: string): Slot[] => {
  let data: unknown;
  try {
    data = parseJsonc(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RosterError(`JSONC として読めない: ${detail}`);
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new RosterError("枠配列が空");
  }
  const slots: Slot[] = [];
  const seenKinds = new Set<string>();
  const seenMembers = new Set<string>();
  for (let i = 0; i < data.length; i++) {
    const item: unknown = data[i];
    const at = `[${i}]`;
    if (!isRecord(item)) return fail("object ではない", at);
    for (const key of Object.keys(item)) {
      if (!SLOT_KEYS.has(key)) throw new RosterError(`${at}: 起動されないキー: ${key}`);
    }
    const kind = item["kind"];
    if (typeof kind !== "string" || !KIND_RE.test(kind)) return fail("kind が不正", at);
    if (seenKinds.has(kind)) throw new RosterError(`${at}: kind が重複: ${kind}`);
    seenKinds.add(kind);
    const rawArgs = item["args"];
    if (!isStringArray(rawArgs)) return fail("args が string[] ではない", at);
    rejectBypass(rawArgs);
    const rawMembers = item["members"] === undefined ? [kind] : item["members"];
    if (!isStringArray(rawMembers) || rawMembers.length === 0) return fail("members が空", at);
    if (!rawMembers.every((m) => KIND_RE.test(m))) return fail("members が不正", at);
    if (!rawMembers.includes(kind)) {
      throw new RosterError(`${at}: members に kind が無い`);
    }
    for (const member of rawMembers) {
      if (seenMembers.has(member)) {
        throw new RosterError(`${at}: members が交差: ${member}`);
      }
      seenMembers.add(member);
    }
    slots.push({ kind, args: rawArgs, members: rawMembers });
  }
  for (const slot of slots) readOnlyArgs(slot.kind);
  return slots;
};

const normalizeSnapshotLine = (line: string): string => line.replace(/\s*█?\s*$/u, "").trimEnd();

export const isChromeLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (trimmed.startsWith("Shift+Tab:")) return true;
  const stripped = trimmed.replace(BOX_STRIP, "").trim();
  if (stripped === "") return true;
  return BOX.test(line) && /always-approve|shortcuts/.test(line);
};

export const lastContentLine = (text: string): string | undefined => {
  const lines = text.split(/\r?\n/).map(normalizeSnapshotLine);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] ?? "";
    if (!isChromeLine(line)) return line;
  }
  return undefined;
};

export const advisorComplete = (text: string, marker: string): CompleteResult => {
  const last = lastContentLine(text);
  if (last === undefined) return { ok: false, reason: "出力なし" };
  if (last !== marker) return { ok: false, reason: "マーカー無し" };
  return { ok: true };
};

export const selectAdvisors = (slots: readonly Slot[], selfKind: string): Selection => {
  const matched = slots.find((s) => s.members.includes(selfKind));
  const remaining = matched === undefined ? slots : slots.filter((s) => s !== matched);
  const chosen = remaining.slice(0, MAX_ADVISORS);
  if (chosen.length === 0) throw new RosterError("選出できる枠が無い");
  return { chosen, warning: matched === undefined };
};

export const herdrStartArgv = (slot: Slot, start: { name: string; pane: string }): string[] => {
  rejectBypass(slot.args);
  return [
    "herdr",
    "agent",
    "start",
    start.name,
    "--kind",
    slot.kind,
    "--pane",
    start.pane,
    "--timeout",
    "90000",
    "--",
    ...slot.args,
    ...readOnlyArgs(slot.kind),
  ];
};

const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
};

const parseSlot = (raw: unknown): Slot => {
  const [slot] = parseRoster(JSON.stringify([raw]));
  if (slot === undefined) throw new RosterError("slot が無い");
  return slot;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  try {
    if (cmd === "select") {
      const rosterPath = flag(argv, "--roster");
      const selfKind = flag(argv, "--self");
      if (rosterPath === undefined) throw new RosterError("--roster が無い");
      if (selfKind === undefined || selfKind === "") throw new RosterError("--self が無い");
      const slots = parseRoster(await Bun.file(rosterPath).text());
      const { chosen, warning } = selectAdvisors(slots, selfKind);
      if (warning) {
        console.error(`WARN\t自己 kind が候補表に無い: ${selfKind}`);
      }
      process.stdout.write(`${JSON.stringify(chosen)}\n`);
      return;
    }
    if (cmd === "complete") {
      const outputPath = flag(argv, "--output");
      const marker = flag(argv, "--marker");
      if (outputPath === undefined || marker === undefined || marker === "") {
        throw new RosterError("--output / --marker が必要");
      }
      const file = Bun.file(outputPath);
      const text = (await file.exists()) ? await file.text() : "";
      const result = advisorComplete(text, marker);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.ok ? 0 : 1);
      return;
    }
    if (cmd === "start-argv") {
      const slotPath = flag(argv, "--slot");
      const name = flag(argv, "--name");
      const pane = flag(argv, "--pane");
      if (slotPath === undefined || name === undefined || pane === undefined) {
        throw new RosterError("--slot / --name / --pane が必要");
      }
      const raw: unknown = JSON.parse(await Bun.file(slotPath).text());
      const slot = parseSlot(raw);
      process.stdout.write(`${JSON.stringify(herdrStartArgv(slot, { name, pane }))}\n`);
      return;
    }
    throw new RosterError("使い方: advisors.ts select | start-argv | complete");
  } catch (error) {
    const message = error instanceof RosterError ? error.message : String(error);
    console.error(`FATAL\t${message}`);
    process.exit(2);
  }
};

if (import.meta.main) await main();
