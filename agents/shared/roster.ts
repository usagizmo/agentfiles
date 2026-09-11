// roster.toml の解釈と検証。consult の advisors と resolve の実装役の kind / 起動 args を持つ。
//
//   bun roster.ts resolve-argv --name <name> --pane <id>
//
// resolve-argv の stdout は実装役を起動する herdr agent start の argv JSON。
// consult 側の select / start-argv は advisors.ts。

import { TOML } from "bun";

export const ROSTER_URL = new URL("./roster.toml", import.meta.url);
export const START_TIMEOUT_MS = 90000;

export type Slot = {
  readonly kind: string;
  readonly args: readonly string[];
  readonly members: readonly string[];
};

/** resolve の実装役。read-only にはしない（実装する agent）。 */
export type Worker = {
  readonly kind: string;
  readonly args: readonly string[];
};

export type Roster = {
  readonly advisors: readonly Slot[];
  readonly resolve: Worker;
};

const SLOT_KEYS = new Set(["kind", "args", "members"]);
const WORKER_KEYS = new Set(["kind", "args"]);
const ROSTER_KEYS = new Set(["advisors", "resolve"]);
const KIND_RE = /^[a-z][a-z0-9_-]*$/;
const APPROVAL_SKIPPING_MODES = new Set(["bypassPermissions", "dontAsk"]);
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

/** 承認を飛ばす flag を止める。readOnly なら read-only を弱める指定も止める。 */
const rejectBypass = (args: readonly string[], readOnly: boolean): void => {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (token === "--") throw new RosterError("args に -- は置けない");
    const { name, value } = splitFlag(token, args[i + 1]);
    if (BYPASS.has(name)) throw new RosterError(`承認を飛ばす flag: ${token}`);
    if (name === "-p" || name === "--print") {
      throw new RosterError(`interactive 以外の起動: ${token}`);
    }
    if (name === "--permission-mode" && APPROVAL_SKIPPING_MODES.has(value ?? "")) {
      throw new RosterError(`承認を飛ばす --permission-mode: ${value}`);
    }
    if ((name === "-a" || name === "--ask-for-approval") && value === "never") {
      throw new RosterError("承認を飛ばす --ask-for-approval: never");
    }
    const config =
      name === "-c" || name === "--config" ? ((value ?? "").split("=")[0] ?? "") : undefined;
    if (config === "approval_policy") {
      throw new RosterError(`承認を飛ばす config: ${value ?? "(無し)"}`);
    }
    if (!readOnly) continue;
    if (name === "--permission-mode" && value !== "plan") {
      throw new RosterError(`--permission-mode は plan だけ: ${value ?? "(無し)"}`);
    }
    if (name === "--mode" && value !== "plan") {
      throw new RosterError(`--mode は plan だけ: ${value ?? "(無し)"}`);
    }
    if ((name === "-s" || name === "--sandbox") && value !== "read-only") {
      throw new RosterError(`sandbox は read-only だけ: ${value ?? "(無し)"}`);
    }
    if (config !== undefined && config.startsWith("sandbox_")) {
      throw new RosterError(`read-only を打ち消す config: ${value ?? "(無し)"}`);
    }
  }
};

/** TOML を読む。壊れた TOML・未知のトップレベルキー・`advisors` / `resolve` の欠落は止まる。 */
export const parseRoster = (text: string): Roster => {
  let doc: unknown;
  try {
    doc = TOML.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new RosterError(`TOML として読めない: ${detail}`);
  }
  if (!isRecord(doc)) throw new RosterError("roster が table ではない");
  for (const key of Object.keys(doc)) {
    if (!ROSTER_KEYS.has(key)) throw new RosterError(`roster の ${key} は未知`);
  }
  if (doc["advisors"] === undefined) throw new RosterError("roster に advisors が無い");
  if (doc["resolve"] === undefined) throw new RosterError("roster に resolve が無い");
  return { advisors: parseSlots(doc["advisors"]), resolve: parseWorker(doc["resolve"]) };
};

const parseWorker = (data: unknown): Worker => {
  const at = "resolve";
  if (!isRecord(data)) return fail("table ではない", at);
  for (const key of Object.keys(data)) {
    if (!WORKER_KEYS.has(key)) throw new RosterError(`${at}: 起動されないキー: ${key}`);
  }
  const kind = data["kind"];
  if (typeof kind !== "string" || !KIND_RE.test(kind)) return fail("kind が不正", at);
  const args = data["args"];
  if (!isStringArray(args)) return fail("args が string[] ではない", at);
  rejectBypass(args, false);
  return { kind, args };
};

/** 枠配列の検証。`parseRoster` が `advisors` を、`start-argv` が 1 枠を通す。 */
const parseSlots = (data: unknown): Slot[] => {
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
    rejectBypass(rawArgs, true);
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

export const herdrStartArgv = (slot: Slot, start: { name: string; pane: string }): string[] => {
  rejectBypass(slot.args, true);
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
    String(START_TIMEOUT_MS),
    "--",
    ...slot.args,
    ...readOnlyArgs(slot.kind),
  ];
};

/** tmux / 直接 CLI 起動時の実行ファイル名。kind とバイナリ名が違う枠だけ写す。 */
export const directBinary = (kind: string): string => {
  if (kind === "cursor") return "cursor-agent";
  return kind;
};

/** Herdr を経由せず interactive CLI を起動する argv（read-only を末尾に足す）。 */
export const directLaunchArgv = (slot: Slot): string[] => {
  rejectBypass(slot.args, true);
  return [directBinary(slot.kind), ...slot.args, ...readOnlyArgs(slot.kind)];
};

/** resolve / dispatch 用。read-only を足さない（実装役。bypass と -p は拒否）。 */
export const directResolveLaunchArgv = (worker: Worker): string[] => {
  rejectBypass(worker.args, false);
  return [directBinary(worker.kind), ...worker.args];
};

/** JSON 1 枠を advisors と同じ検証で通す。 */
export const parseSlot = (raw: unknown): Slot => {
  const [slot] = parseSlots([raw]);
  if (slot === undefined) throw new RosterError("slot が無い");
  return slot;
};

export const herdrResolveArgv = (
  worker: Worker,
  start: { name: string; pane: string },
): string[] => {
  rejectBypass(worker.args, false);
  return [
    "herdr",
    "agent",
    "start",
    start.name,
    "--kind",
    worker.kind,
    "--pane",
    start.pane,
    "--timeout",
    String(START_TIMEOUT_MS),
    "--",
    ...worker.args,
  ];
};

export const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === "resolve-argv") {
      const name = flag(argv, "--name");
      const pane = flag(argv, "--pane");
      if (name === undefined || pane === undefined) throw new RosterError("--name / --pane が必要");
      const { resolve } = parseRoster(await Bun.file(ROSTER_URL).text());
      process.stdout.write(`${JSON.stringify(herdrResolveArgv(resolve, { name, pane }))}\n`);
      return;
    }
    if (argv[0] === "resolve-launch-argv") {
      // tmux dispatch 用。--kind があればその kind を空 args で起動（roster resolve を上書き）
      const kindOverride = flag(argv, "--kind");
      const rosterPath = flag(argv, "--roster") ?? ROSTER_URL.pathname;
      const { resolve } = parseRoster(await Bun.file(rosterPath).text());
      const worker: Worker =
        kindOverride === undefined || kindOverride === ""
          ? resolve
          : { kind: kindOverride, args: [] };
      if (kindOverride !== undefined && kindOverride !== "") {
        // kind の形式だけ先に検証（read-only 表は dispatch では使わない）
        if (!/^[a-z][a-z0-9_-]*$/.test(kindOverride)) {
          throw new RosterError(`kind が不正: ${kindOverride}`);
        }
        directBinary(worker.kind);
      }
      process.stdout.write(`${JSON.stringify(directResolveLaunchArgv(worker))}\n`);
      return;
    }
    throw new RosterError("使い方: roster.ts resolve-argv | resolve-launch-argv");
  } catch (error) {
    const message = error instanceof RosterError ? error.message : String(error);
    console.error(`FATAL\t${message}`);
    process.exit(2);
  }
};

if (import.meta.main) await main();
