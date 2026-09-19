// roster.toml の解釈と検証。consult の advisors と dispatch の実装役（worker）の kind / 起動 args を持つ。
//
//   bun roster.ts worker-launch-argv [--kind <kind>] [--roster <file>] [--print kind|argv]
//
// --kind は workers の表から引く。表に無い kind は起動しない（権限の SSOT を roster に置く）。
//
// worker-launch-argv の stdout は kind か起動 argv（行で返す）。kind の再解釈をさせない。
// consult 側の select / launch-argv は advisors.ts。

import { TOML } from "bun";

export const ROSTER_URL = new URL("./roster.toml", import.meta.url);
export type Slot = {
  readonly kind: string;
  readonly args: readonly string[];
};

export type Roster = {
  readonly advisors: readonly Slot[];
  /** dispatch の実装役の候補。先頭が既定で、`DISPATCH_KIND` はこの表から引く。 */
  readonly workers: readonly Slot[];
};

const SLOT_KEYS = new Set(["kind", "args"]);
const ROSTER_KEYS = new Set(["advisors", "workers"]);
// kind は tmux の session 名と socket 名（パス長に上限がある）の一部になる
const KIND_RE = /^[a-z][a-z0-9_-]{0,31}$/;
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

// 起動 argv は 1 行 1 要素で sh へ渡す。改行を含む arg はその境界を壊す
const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((a) => typeof a === "string" && !a.includes("\n"));

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

/**
 * 起動 argv の検査。どちらの枠でも interactive TUI 以外の起動は止める。
 *
 * readOnly（advisors）は承認を飛ばす指定と read-only を弱める指定も止める。
 * 実装役（worker）は止めない —— 背面の detached session で動き、承認 UI に
 * 応える人が居ない。権限の広さは `roster.toml` の `[[workers]]` が決める。
 */
const rejectBypass = (args: readonly string[], readOnly: boolean, kind: string): void => {
  for (let i = 0; i < args.length; i++) {
    const token = args[i] ?? "";
    if (token === "--") throw new RosterError("args に -- は置けない");
    const { name, value } = splitFlag(token, args[i + 1]);
    // interactive TUI のみ。--print は拒否。-p は Codex の --profile だけ許可
    if (name === "--print" || (name === "-p" && kind !== "codex")) {
      throw new RosterError(`interactive 以外の起動: ${token}`);
    }
    if (!readOnly) continue;
    const config =
      name === "-c" || name === "--config" ? ((value ?? "").split("=")[0] ?? "") : undefined;
    if (BYPASS.has(name)) throw new RosterError(`承認を飛ばす flag: ${token}`);
    if (name === "--permission-mode" && APPROVAL_SKIPPING_MODES.has(value ?? "")) {
      throw new RosterError(`承認を飛ばす --permission-mode: ${value}`);
    }
    if ((name === "-a" || name === "--ask-for-approval") && value === "never") {
      throw new RosterError("承認を飛ばす --ask-for-approval: never");
    }
    if (config === "approval_policy") {
      throw new RosterError(`承認を飛ばす config: ${value ?? "(無し)"}`);
    }
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

/** TOML を読む。壊れた TOML・未知のトップレベルキー・`advisors` / `workers` の欠落は止まる。 */
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
  if (doc["workers"] === undefined) throw new RosterError("roster に workers が無い");
  return {
    advisors: parseSlots(doc["advisors"], true),
    workers: parseSlots(doc["workers"], false),
  };
};

/**
 * 枠配列の検証。`parseRoster` が `advisors` と `workers` を、`launch-argv` が 1 枠を通す。
 *
 * readOnly な表（advisors）だけ read-only 手段のある kind に限る。
 */
const parseSlots = (data: unknown, readOnly: boolean): Slot[] => {
  if (!Array.isArray(data) || data.length === 0) {
    throw new RosterError("枠配列が空");
  }
  const slots: Slot[] = [];
  const seenKinds = new Set<string>();
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
    rejectBypass(rawArgs, readOnly, kind);
    slots.push({ kind, args: rawArgs });
  }
  if (readOnly) for (const slot of slots) readOnlyArgs(slot.kind);
  return slots;
};

/** 起動する実装役。`kind` 省略で先頭（既定）。表に無い kind は起動しない。 */
export const selectWorker = (workers: readonly Slot[], kind?: string): Slot => {
  if (kind === undefined || kind === "") {
    const head = workers[0];
    if (head === undefined) throw new RosterError("workers が空");
    return head;
  }
  const found = workers.find((worker) => worker.kind === kind);
  if (found === undefined) {
    throw new RosterError(`workers に無い kind: ${kind}（roster に足す）`);
  }
  return found;
};

/** tmux / 直接 CLI 起動時の実行ファイル名。kind とバイナリ名が違う枠だけ写す。 */
export const directBinary = (kind: string): string => {
  if (kind === "cursor") return "cursor-agent";
  return kind;
};

/** interactive CLI を起動する argv（read-only を末尾に足す）。 */
export const directLaunchArgv = (slot: Slot): string[] => {
  rejectBypass(slot.args, true, slot.kind);
  return [directBinary(slot.kind), ...slot.args, ...readOnlyArgs(slot.kind)];
};

/** dispatch 用。read-only を足さない（実装役。--print は拒否。-p は Codex の --profile だけ）。 */
export const directWorkerLaunchArgv = (worker: Slot): string[] => {
  rejectBypass(worker.args, false, worker.kind);
  return [directBinary(worker.kind), ...worker.args];
};

export const flag = (argv: readonly string[], name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i < 0 ? undefined : argv[i + 1];
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  try {
    if (argv[0] === "worker-launch-argv") {
      // tmux dispatch 用。--kind は workers の表から引く（起動 args は必ず roster が持つ）
      const kindOverride = flag(argv, "--kind");
      const rosterPath = flag(argv, "--roster");
      const roster = rosterPath === undefined ? Bun.file(ROSTER_URL) : Bun.file(rosterPath);
      const { workers } = parseRoster(await roster.text());
      const worker = selectWorker(workers, kindOverride);
      const print = flag(argv, "--print") ?? "argv";
      if (print !== "kind" && print !== "argv") {
        throw new RosterError(`--print は kind か argv: ${print}`);
      }
      // kind だけ要るときも argv を組む（args の検査を print で飛ばさない）
      // directBinary は argv[0] に使う（PATH 検査は呼び出し側）
      const launch = directWorkerLaunchArgv(worker);
      const lines = print === "kind" ? [worker.kind] : launch;
      process.stdout.write(lines.map((line) => `${line}\n`).join(""));
      return;
    }
    throw new RosterError("使い方: roster.ts worker-launch-argv [--print kind|argv]");
  } catch (error) {
    const message = error instanceof RosterError ? error.message : String(error);
    console.error(`FATAL\t${message}`);
    process.exit(2);
  }
};

if (import.meta.main) await main();
