// アドバイザー候補表の検証と選出。gate は bun test。
//
// 実体の advisors.json 自身も対象。fixture だけ通して実体を外すと、
// 宣言 file が壊れていても緑のまま残る。

import { expect, test } from "bun:test";
import {
  MAX_ADVISORS,
  ROSTER_URL,
  RosterError,
  herdrStartArgv,
  parseRoster,
  readOnlyArgs,
  selectAdvisors,
  type Selection,
} from "../agents/shared/advisors.ts";

const rosterText = await Bun.file(ROSTER_URL).text();
const roster = parseRoster(rosterText);

const kinds = (result: Selection): string[] => result.chosen.map((s) => s.kind);

test("実体の宣言 file が検証を通る", () => {
  expect(roster.map((s) => s.kind)).toEqual(["claude", "codex", "grok"]);
  expect(roster[2]?.members).toEqual(["grok", "cursor"]);
  expect(roster[2]?.args).toEqual(["--model", "grok-4.6", "--effort", "high"]);
});

test("claude は codex + grok", () => {
  const r = selectAdvisors(roster, "claude");
  expect(kinds(r)).toEqual(["codex", "grok"]);
  expect(r.warning).toBe(false);
});

test("codex は claude + grok", () => {
  const r = selectAdvisors(roster, "codex");
  expect(kinds(r)).toEqual(["claude", "grok"]);
  expect(r.warning).toBe(false);
});

test("grok は claude + codex", () => {
  const r = selectAdvisors(roster, "grok");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(false);
});

test("cursor は grok 枠ごと外れ claude + codex", () => {
  const r = selectAdvisors(roster, "cursor");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(false);
});

test("表に無い kind は先頭 2 枠と警告", () => {
  const r = selectAdvisors(roster, "unknown");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(true);
  expect(r.chosen).toHaveLength(MAX_ADVISORS);
});

test("members 省略は kind 自身", () => {
  const slots = parseRoster('[{"kind":"claude","args":[]},{"kind":"codex","args":[]}]');
  expect(slots[0]?.members).toEqual(["claude"]);
});

test("起動されないキーは落とす", () => {
  expect(() => parseRoster('[{"kind":"claude","args":[],"model":"x"}]')).toThrow(RosterError);
});

test("members の交差は落とす", () => {
  const text = JSON.stringify([
    { kind: "claude", args: [], members: ["claude", "cursor"] },
    { kind: "grok", args: [], members: ["grok", "cursor"] },
  ]);
  expect(() => parseRoster(text)).toThrow(RosterError);
});

test("members に kind が無い枠は落とす", () => {
  expect(() => parseRoster('[{"kind":"grok","args":[],"members":["cursor"]}]')).toThrow(
    RosterError,
  );
});

test("read-only を打ち消す args は落とす", () => {
  expect(() => parseRoster('[{"kind":"claude","args":["--permission-mode","bypass"]}]')).toThrow(
    RosterError,
  );
});

test("= 連結と別名の bypass も落とす", () => {
  expect(() => parseRoster('[{"kind":"claude","args":["--permission-mode=bypass"]}]')).toThrow(
    RosterError,
  );
  expect(() => parseRoster('[{"kind":"codex","args":["--sandbox=workspace-write"]}]')).toThrow(
    RosterError,
  );
  expect(() =>
    parseRoster('[{"kind":"codex","args":["--dangerously-bypass-approvals-and-sandbox"]}]'),
  ).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"claude","args":["--"]}]')).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"claude","args":["--yolo"]}]')).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"cursor","args":["--force"]}]')).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"cursor","args":["--mode","agent"]}]')).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"codex","args":["-sdanger-full-access"]}]')).toThrow(
    RosterError,
  );
  expect(() =>
    parseRoster('[{"kind":"codex","args":["-c","sandbox_mode=danger-full-access"]}]'),
  ).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"codex","args":["--full-auto"]}]')).toThrow(RosterError);
  expect(() => parseRoster('[{"kind":"grok","args":["--no-plan"]}]')).toThrow(RosterError);
});

test("read-only 手段が無い kind は宣言時に落とす", () => {
  expect(() => parseRoster('[{"kind":"gemini","args":[]}]')).toThrow(RosterError);
});

test("起動 argv も bypass を落とす", () => {
  const skip = { kind: "claude", args: ["--dangerously-skip-permissions"], members: ["claude"] };
  expect(() => herdrStartArgv(skip, { name: "a-claude-x", pane: "w1:p1" })).toThrow(RosterError);
  const glued = { kind: "codex", args: ["-sdanger-full-access"], members: ["codex"] };
  expect(() => herdrStartArgv(glued, { name: "a-codex-x", pane: "w1:p1" })).toThrow(RosterError);
  const cfg = {
    kind: "codex",
    args: ["-c", "sandbox_mode=danger-full-access"],
    members: ["codex"],
  };
  expect(() => herdrStartArgv(cfg, { name: "a-codex-x", pane: "w1:p1" })).toThrow(RosterError);
});

test("effort 用の -c は通る", () => {
  const slots = parseRoster('[{"kind":"codex","args":["-c","model_reasoning_effort=high"]}]');
  expect(slots[0]?.args).toEqual(["-c", "model_reasoning_effort=high"]);
});

test("壊れた JSONC はパーサの位置を残す", () => {
  let message = "";
  try {
    parseRoster("[invalid");
  } catch (error) {
    if (error instanceof RosterError) message = error.message;
  }
  expect(message.startsWith("JSONC として読めない:")).toBe(true);
  expect(message.length).toBeGreaterThan("JSONC として読めない:".length);
});

test("起動 argv は宣言の args のあとに read-only を足す", () => {
  const grok = roster.find((s) => s.kind === "grok");
  if (grok === undefined) throw new Error("grok 枠が無い");
  const argv = herdrStartArgv(grok, { name: "a-grok-x", pane: "w1:p1" });
  expect(argv).toContain("--");
  const extra = argv.slice(argv.indexOf("--") + 1);
  expect(extra).toEqual([...grok.args, ...readOnlyArgs("grok")]);
});

test("空の args でも read-only は付く", () => {
  const claude = roster.find((s) => s.kind === "claude");
  if (claude === undefined) throw new Error("claude 枠が無い");
  const argv = herdrStartArgv(claude, { name: "a-claude-x", pane: "w1:p1" });
  expect(argv.slice(argv.indexOf("--") + 1)).toEqual([...readOnlyArgs("claude")]);
});

test("codex の read-only は -s read-only", () => {
  expect(readOnlyArgs("codex")).toEqual(["-s", "read-only"]);
});

test("grok の read-only は plan と --no-subagents", () => {
  expect(readOnlyArgs("grok")).toEqual(["--permission-mode", "plan", "--no-subagents"]);
});

test("cursor の read-only は --mode plan", () => {
  expect(readOnlyArgs("cursor")).toEqual(["--mode", "plan"]);
  const argv = herdrStartArgv(
    { kind: "cursor", args: ["--model", "grok-4.6[effort=high]"], members: ["grok", "cursor"] },
    { name: "a-cursor-x", pane: "w1:p1" },
  );
  expect(argv.slice(argv.indexOf("--") + 1)).toEqual([
    "--model",
    "grok-4.6[effort=high]",
    "--mode",
    "plan",
  ]);
});

test("実体 file のコメントに cursor 差し替えが残っている", () => {
  expect(roster.map((s) => s.kind)).not.toContain("cursor");
  expect(rosterText).toContain('"kind": "cursor"');
  expect(rosterText).toContain("grok-4.6[effort=high]");
  expect(rosterText).not.toContain("_comment");
});

test("JSONC のコメントと末尾カンマは枠にならない", () => {
  const text = `
[
  // kind: ghost
  { "kind": "claude", "args": [] },
  { "kind": "cursor", "args": ["--model", "x // not a comment"] },
]
`;
  const slots = parseRoster(text);
  expect(slots.map((s) => s.kind)).toEqual(["claude", "cursor"]);
  expect(slots[1]?.args).toEqual(["--model", "x // not a comment"]);
});
