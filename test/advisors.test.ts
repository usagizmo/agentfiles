// アドバイザー候補表の検証と選出。gate は bun test。
//
// 実体の roster.toml 自身も対象。fixture だけ通して実体を外すと、
// 宣言 file が壊れていても緑のまま残る。

import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  MAX_ADVISORS,
  ROSTER_URL,
  RosterError,
  advisorComplete,
  isChromeLine,
  herdrStartArgv,
  parseRoster,
  readOnlyArgs,
  selectAdvisors,
  type Selection,
} from "../agents/shared/advisors.ts";

const rosterText = await Bun.file(ROSTER_URL).text();
const roster = parseRoster(rosterText);

/** JSON の枠配列を TOML の `advisors` へ写す（テスト入力を短く保つ）。 */
const toml = (json: string): string => {
  const slots = JSON.parse(json) as Record<string, unknown>[];
  const tables = slots.map(
    (slot) =>
      `{ ${Object.entries(slot)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(", ")} }`,
  );
  return `advisors = [${tables.join(", ")}]\n[executors]\n`;
};

const kinds = (result: Selection): string[] => result.chosen.map((s) => s.kind);

test("実体の宣言 file が検証を通る", () => {
  expect(roster.map((s) => s.kind)).toEqual(["claude", "codex", "cursor"]);
  expect(roster[2]?.members).toEqual(["grok", "cursor"]);
  expect(roster[2]?.args).toEqual(["--model", "cursor-grok-4.6-high"]);
});

test("claude は codex + cursor", () => {
  const r = selectAdvisors(roster, "claude");
  expect(kinds(r)).toEqual(["codex", "cursor"]);
  expect(r.warning).toBe(false);
});

test("codex は claude + cursor", () => {
  const r = selectAdvisors(roster, "codex");
  expect(kinds(r)).toEqual(["claude", "cursor"]);
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
  const slots = parseRoster(toml('[{"kind":"claude","args":[]},{"kind":"codex","args":[]}]'));
  expect(slots[0]?.members).toEqual(["claude"]);
});

test("起動されないキーは落とす", () => {
  expect(() => parseRoster(toml('[{"kind":"claude","args":[],"model":"x"}]'))).toThrow(RosterError);
});

test("members の交差は落とす", () => {
  const text = JSON.stringify([
    { kind: "claude", args: [], members: ["claude", "cursor"] },
    { kind: "grok", args: [], members: ["grok", "cursor"] },
  ]);
  expect(() => parseRoster(toml(text))).toThrow(RosterError);
});

test("members に kind が無い枠は落とす", () => {
  expect(() => parseRoster(toml('[{"kind":"grok","args":[],"members":["cursor"]}]'))).toThrow(
    RosterError,
  );
});

test("read-only を打ち消す args は落とす", () => {
  expect(() =>
    parseRoster(toml('[{"kind":"claude","args":["--permission-mode","bypass"]}]')),
  ).toThrow(RosterError);
});

test("= 連結と別名の bypass も落とす", () => {
  expect(() =>
    parseRoster(toml('[{"kind":"claude","args":["--permission-mode=bypass"]}]')),
  ).toThrow(RosterError);
  expect(() =>
    parseRoster(toml('[{"kind":"codex","args":["--sandbox=workspace-write"]}]')),
  ).toThrow(RosterError);
  expect(() =>
    parseRoster(toml('[{"kind":"codex","args":["--dangerously-bypass-approvals-and-sandbox"]}]')),
  ).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"claude","args":["--"]}]'))).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"claude","args":["--yolo"]}]'))).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"cursor","args":["--force"]}]'))).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"cursor","args":["--mode","agent"]}]'))).toThrow(
    RosterError,
  );
  expect(() => parseRoster(toml('[{"kind":"codex","args":["-sdanger-full-access"]}]'))).toThrow(
    RosterError,
  );
  expect(() =>
    parseRoster(toml('[{"kind":"codex","args":["-c","sandbox_mode=danger-full-access"]}]')),
  ).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"codex","args":["--full-auto"]}]'))).toThrow(RosterError);
  expect(() => parseRoster(toml('[{"kind":"grok","args":["--no-plan"]}]'))).toThrow(RosterError);
});

test("read-only 手段が無い kind は宣言時に落とす", () => {
  expect(() => parseRoster(toml('[{"kind":"gemini","args":[]}]'))).toThrow(RosterError);
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
  const slots = parseRoster(toml('[{"kind":"codex","args":["-c","model_reasoning_effort=high"]}]'));
  expect(slots[0]?.args).toEqual(["-c", "model_reasoning_effort=high"]);
});

test("壊れた TOML はパーサの位置を残す", () => {
  let message = "";
  try {
    parseRoster("advisors = [invalid");
  } catch (error) {
    if (error instanceof RosterError) message = error.message;
  }
  expect(message.startsWith("TOML として読めない:")).toBe(true);
  expect(message.length).toBeGreaterThan("TOML として読めない:".length);
});

test("起動 argv は宣言の args のあとに read-only を足す", () => {
  const cursor = roster.find((s) => s.kind === "cursor");
  if (cursor === undefined) throw new Error("cursor 枠が無い");
  const argv = herdrStartArgv(cursor, { name: "a-cursor-x", pane: "w1:p1" });
  expect(argv).toContain("--");
  const extra = argv.slice(argv.indexOf("--") + 1);
  expect(extra).toEqual([...cursor.args, ...readOnlyArgs("cursor")]);
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
    { kind: "cursor", args: ["--model", "cursor-grok-4.6-high"], members: ["grok", "cursor"] },
    { name: "a-cursor-x", pane: "w1:p1" },
  );
  expect(argv.slice(argv.indexOf("--") + 1)).toEqual([
    "--model",
    "cursor-grok-4.6-high",
    "--mode",
    "plan",
  ]);
});

test("実体 file のコメントに grok 差し替えが残っている", () => {
  expect(roster.map((s) => s.kind)).not.toContain("grok");
  expect(rosterText).toContain(
    "# grok を起こすときは [executors.resolve] の kind と args に差し替える",
  );
  expect(rosterText).not.toContain("_comment");
});

test("TOML のコメントは枠にならず、args の文字列は残す", () => {
  const text = `
# kind = "ghost"
[[advisors]]
kind = "claude"
args = []

[[advisors]]
kind = "cursor"
args = ["--model", "x # not a comment"]

[executors]
`;
  const slots = parseRoster(text);
  expect(slots.map((s) => s.kind)).toEqual(["claude", "cursor"]);
  expect(slots[1]?.args).toEqual(["--model", "x # not a comment"]);
});

test("advisors が無ければ止まる", () => {
  expect(() => parseRoster('[executors.refine]\nkind = "claude"\nargs = []')).toThrow("advisors");
});

test("トップレベルの未知キーは止まる", () => {
  expect(() =>
    parseRoster(`${toml('[{"kind":"claude","args":[]}]')}\n[executor.refine]\nkind = "x"`),
  ).toThrow("executor");
});

const ROOT = new URL("..", import.meta.url).pathname;

const MARKER = "ADVISOR-DONE-test";

const PREAMBLE = `あなたはコードレビュアーです。コードは変更しないでください。

## 必読

- ~/.agents/AGENTS.md（設計原則）

## 観点

設計原則からの逸脱。

## 出力

重要度順「ファイル:行 / 問題 / 推奨修正」。なければ「指摘なし」のみ。
`;

const MARKER_SNAPSHOT = `指摘なし
ADVISOR-DONE-test

  ╭─────────────────────────────────────────╮
  │ ❯                                       │
  ╰───────────────────────────────────────── Grok 4.6 (high) · always-approve ─╯

  Shift+Tab:mode  │  Ctrl+.:shortcuts
`;

test("preamble のみは未完", () => {
  expect(advisorComplete(PREAMBLE, MARKER)).toEqual({ ok: false, reason: "マーカー無し" });
});

test("空出力は未完", () => {
  expect(advisorComplete("", MARKER)).toEqual({ ok: false, reason: "出力なし" });
});

test("マーカー付きは完走", () => {
  expect(advisorComplete(MARKER_SNAPSHOT, MARKER)).toEqual({ ok: true });
});

test("空の入力欄と完了時間の脚注がある pane から marker を読める", () => {
  const snapshot = `指摘なし
  ${MARKER}

✻ Churned for 2m 27s · done 11:00 PM

────────────────────
❯
────────────────────
  Model · context 7%
  ⏸ plan mode on
`;
  expect(advisorComplete(snapshot, MARKER)).toEqual({ ok: true });
});

test("指令行はマーカーと一致しない", () => {
  const text = `応答の最後の行に ${MARKER} をそのまま書け。この指令行は書かない。`;
  expect(advisorComplete(text, MARKER)).toEqual({ ok: false, reason: "マーカー無し" });
});

test("marker を本文の行末へ続けても完走", () => {
  expect(advisorComplete(`指摘なし ${MARKER}`, MARKER)).toEqual({ ok: true });
});

test("マーカーのあとに本文が続くと未完", () => {
  expect(advisorComplete(`指摘なし\n${MARKER}\n追加`, MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test("語彙ゆれは未完", () => {
  expect(advisorComplete("指摘なし", MARKER)).toEqual({ ok: false, reason: "マーカー無し" });
  expect(advisorComplete("LGTM", MARKER)).toEqual({ ok: false, reason: "マーカー無し" });
});

test("行末の幅埋めは落としてから照合する", () => {
  expect(advisorComplete(`${MARKER}   █\n`, MARKER)).toEqual({ ok: true });
});

test("枠行の判定は繰り返し呼んでも同じ", () => {
  const footer = "╰───────────────────────────────────────── Grok 4.6 (high) · always-approve ─╯";
  for (let i = 0; i < 5; i++) {
    expect(isChromeLine(footer)).toBe(true);
  }
});

// 手で書いた snapshot は TUI の実物とずれる。実行器から取った pane をそのまま置く
test.each(["codex", "grok"] as const)("%s の pane から marker を読める", (kind) => {
  const pane = readFileSync(`${ROOT}test/fixtures/advisor-pane/${kind}`, "utf8");
  expect(advisorComplete(pane, "ADVISOR-DONE-heaaqd")).toEqual({ ok: true });
});

const CURSOR_MARKER = "ADVISOR-DONE-gmjsqm";
// 実 pane の応答以降を採録し、作業ディレクトリだけ匿名化する。
const CURSOR_SNAPSHOT = readFileSync(`${ROOT}test/fixtures/advisor-pane/cursor`, "utf8");

const CLAUDE_MARKER = "ADVISOR-DONE-a4ql68";
// 実 pane の marker 以降を採録する。
const CLAUDE_SNAPSHOT = readFileSync(`${ROOT}test/fixtures/advisor-pane/claude`, "utf8");

test.each(["NFC", "NFD"] as const)("%s のアクセント付き完了時間を応答から除く", (form) => {
  expect(advisorComplete(CLAUDE_SNAPSHOT.normalize(form), CLAUDE_MARKER)).toEqual({ ok: true });
});

test("完了時間の脚注だけでは marker の欠落を補えない", () => {
  expect(
    advisorComplete(CLAUDE_SNAPSHOT.replace(CLAUDE_MARKER, "追加の指摘"), CLAUDE_MARKER),
  ).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test.each(["before", "after"] as const)("完了時間の %s に続く本文は省略しない", (position) => {
  const elapsed = "✻ Sautéed for 11m 26s · done 8:38 AM";
  const content = position === "before" ? `追加の指摘\n${elapsed}` : `${elapsed}\n追加の指摘`;
  expect(advisorComplete(CLAUDE_SNAPSHOT.replace(elapsed, content), CLAUDE_MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test.each([
  "✻ Sautéed for 11m 26s",
  "✻ Sautéed for 11m 26s · done",
  "✻ Sautéed for 11m 26s · done 8:38 AM 追加の指摘",
])("完了時間の形が揃わない行は本文: %s", (content) => {
  expect(advisorComplete(`${CLAUDE_MARKER}\n${content}`, CLAUDE_MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test("上下の罫線に囲まれた矢印入力欄から応答の末尾を読める", () => {
  expect(advisorComplete(CURSOR_SNAPSHOT, CURSOR_MARKER)).toEqual({ ok: true });
});

test("矢印入力欄があっても marker の無い応答は未完", () => {
  expect(advisorComplete(CURSOR_SNAPSHOT.replace(CURSOR_MARKER, ""), CURSOR_MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test("marker の後から矢印入力欄までの本文は省略しない", () => {
  const snapshot = CURSOR_SNAPSHOT.replace(CURSOR_MARKER, `${CURSOR_MARKER}\n  追加の指摘`);
  expect(advisorComplete(snapshot, CURSOR_MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test.each([
  "→ 本文の続きを確認する",
  "▄▄▄▄\n→ 本文の続きを確認する",
  "→ 本文の続きを確認する\n▀▀▀▀",
])("上下の罫線が揃わない矢印行は本文: %s", (content) => {
  expect(advisorComplete(`${CURSOR_MARKER}\n${content}`, CURSOR_MARKER)).toEqual({
    ok: false,
    reason: "マーカー無し",
  });
});

test("TUI 枠だけは出力なし", () => {
  const chrome = `
  ╭─────────────────────────────────────────╮
  │ ❯                                       │
  ╰───────────────────────────────────────── Grok 4.6 (high) · always-approve ─╯

  Shift+Tab:mode  │  Ctrl+.:shortcuts
`;
  expect(advisorComplete(chrome, MARKER)).toEqual({ ok: false, reason: "出力なし" });
});

test("complete CLI は JSON と終了コードを返す", async () => {
  const dir = await mkdtemp(join(tmpdir(), "advisors-complete-"));
  const output = join(dir, "out");
  await Bun.write(output, MARKER_SNAPSHOT);
  const proc = Bun.spawn(
    ["bun", "agents/shared/advisors.ts", "complete", "--output", output, "--marker", MARKER],
    { stdout: "pipe", stderr: "pipe", cwd: import.meta.dir + "/.." },
  );
  const [stdout, exited] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  expect(exited).toBe(0);
  expect(JSON.parse(stdout)).toEqual({ ok: true });
});
