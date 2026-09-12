// アドバイザー候補表の検証と選出。gate は bun test。
//
// 実体の roster.toml 自身も対象。fixture だけ通して実体を外すと、
// 宣言 file が壊れていても緑のまま残る。

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  MAX_ADVISORS,
  advisorComplete,
  isChromeLine,
  selectAdvisors,
  type Selection,
} from "../agents/shared/advisors.ts";
import {
  ROSTER_URL,
  RosterError,
  directBinary,
  directLaunchArgv,
  directResolveLaunchArgv,
  parseRoster,
  readOnlyArgs,
  type Roster,
} from "../agents/shared/roster.ts";

const rosterText = await Bun.file(ROSTER_URL).text();
const parsed = parseRoster(rosterText);
const roster = parsed.advisors;

const RESOLVE_TOML = '[resolve]\nkind = "claude"\nargs = []\n';

/** JSON の枠配列を TOML の `advisors` へ写し、resolve を添える（テスト入力を短く保つ）。 */
const toml = (json: string): string => {
  const slots = JSON.parse(json) as Record<string, unknown>[];
  const tables = slots.map(
    (slot) =>
      `{ ${Object.entries(slot)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join(", ")} }`,
  );
  return `advisors = [${tables.join(", ")}]\n${RESOLVE_TOML}`;
};

/** resolve table だけ差し替えて読む。 */
const withResolve = (resolve: string): Roster =>
  parseRoster(
    `${toml('[{"kind":"claude","args":[]},{"kind":"codex","args":[]}]').replace(RESOLVE_TOML, "")}${resolve}`,
  );

const kinds = (result: Selection): string[] => result.chosen.map((s) => s.kind);

test("実体の宣言 file が検証を通る", () => {
  expect(roster.map((s) => s.kind)).toEqual(["claude", "codex", "cursor"]);
  expect(roster[2]?.members).toEqual(["grok", "cursor", "opencode", "command-code"]);
  expect(roster[2]?.args).toEqual(["--model", "cursor-grok-4.6-high"]);
  expect(parsed.resolve).toEqual({
    kind: "grok",
    args: ["--model", "grok-4.6", "--effort", "high"],
  });
});

test("resolve は無いと止まり、未知キー・承認を飛ばす flag も止まる", () => {
  expect(() => withResolve("")).toThrow("resolve");
  expect(() => withResolve('[resolve]\nkind = "grok"\nargs = []\nmodel = "x"\n')).toThrow("model");
  expect(() => withResolve('[resolve]\nkind = "Grok"\nargs = []\n')).toThrow("kind");
  expect(() => withResolve('[resolve]\nkind = "grok"\nargs = ["--yolo"]\n')).toThrow("--yolo");
  expect(() => withResolve('[resolve]\nkind = "grok"\nargs = ["--"]\n')).toThrow(RosterError);
});

test("resolve でも承認を飛ばす指定は止まる", () => {
  expect(() =>
    withResolve('[resolve]\nkind = "codex"\nargs = ["-c", "approval_policy=never"]\n'),
  ).toThrow("approval_policy");
  expect(() =>
    withResolve('[resolve]\nkind = "claude"\nargs = ["--permission-mode", "bypassPermissions"]\n'),
  ).toThrow("bypassPermissions");
  expect(() =>
    withResolve('[resolve]\nkind = "claude"\nargs = ["--permission-mode=dontAsk"]\n'),
  ).toThrow("dontAsk");
  expect(() => withResolve('[resolve]\nkind = "codex"\nargs = ["-a", "never"]\n')).toThrow(
    "ask-for-approval",
  );
  expect(() =>
    directResolveLaunchArgv({
      kind: "claude",
      args: ["--permission-mode", "bypassPermissions"],
    }),
  ).toThrow(RosterError);
});

test("resolve の起動 argv は binary + args で read-only を足さない", () => {
  const argv = directResolveLaunchArgv(parsed.resolve);
  expect(argv).toEqual([directBinary(parsed.resolve.kind), ...parsed.resolve.args]);
});

test("resolve は read-only を要求しない", () => {
  const r = withResolve('[resolve]\nkind = "codex"\nargs = ["-s", "workspace-write"]\n');
  expect(r.resolve.args).toEqual(["-s", "workspace-write"]);
  const c = withResolve(
    '[resolve]\nkind = "claude"\nargs = ["--permission-mode", "acceptEdits"]\n',
  );
  expect(c.resolve.kind).toBe("claude");
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

test("grok は cursor 枠ごと外れ claude + codex", () => {
  const r = selectAdvisors(roster, "grok");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(false);
});

test("cursor は claude + codex", () => {
  const r = selectAdvisors(roster, "cursor");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(false);
});

test("opencode は cursor 枠ごと外れ claude + codex", () => {
  const r = selectAdvisors(roster, "opencode");
  expect(kinds(r)).toEqual(["claude", "codex"]);
  expect(r.warning).toBe(false);
});

test("command-code は cursor 枠ごと外れ claude + codex", () => {
  const r = selectAdvisors(roster, "command-code");
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
  const slots = parseRoster(
    toml('[{"kind":"claude","args":[]},{"kind":"codex","args":[]}]'),
  ).advisors;
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

test("--print は拒否し、-p は Codex の --profile だけ通す", () => {
  expect(() => parseRoster(toml('[{"kind":"claude","args":["-p"]}]'))).toThrow(/interactive/);
  expect(() => parseRoster(toml('[{"kind":"claude","args":["--print"]}]'))).toThrow(/interactive/);
  expect(() => parseRoster(toml('[{"kind":"cursor","args":["-p"]}]'))).toThrow(/interactive/);
  expect(() => parseRoster(toml('[{"kind":"grok","args":["-p"]}]'))).toThrow(/interactive/);
  expect(() =>
    parseRoster(toml('[{"kind":"codex","args":["-p","foo"],"members":["codex"]}]')),
  ).not.toThrow();
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
  expect(() => directLaunchArgv(skip)).toThrow(RosterError);
  const glued = { kind: "codex", args: ["-sdanger-full-access"], members: ["codex"] };
  expect(() => directLaunchArgv(glued)).toThrow(RosterError);
  const cfg = {
    kind: "codex",
    args: ["-c", "sandbox_mode=danger-full-access"],
    members: ["codex"],
  };
  expect(() => directLaunchArgv(cfg)).toThrow(RosterError);
});

test("effort 用の -c は通る", () => {
  const slots = parseRoster(
    toml('[{"kind":"codex","args":["-c","model_reasoning_effort=high"]}]'),
  ).advisors;
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
  const argv = directLaunchArgv(cursor);
  expect(argv).toEqual([directBinary("cursor"), ...cursor.args, ...readOnlyArgs("cursor")]);
});

test("空の args でも read-only は付く", () => {
  const claude = roster.find((s) => s.kind === "claude");
  if (claude === undefined) throw new Error("claude 枠が無い");
  const argv = directLaunchArgv(claude);
  expect(argv).toEqual([directBinary("claude"), ...readOnlyArgs("claude")]);
});

test("directLaunchArgv は kind バイナリ + args + read-only", () => {
  const claude = roster.find((s) => s.kind === "claude");
  if (claude === undefined) throw new Error("claude 枠が無い");
  expect(directLaunchArgv(claude)).toEqual(["claude", ...readOnlyArgs("claude")]);
  expect(directBinary("cursor")).toBe("cursor-agent");
  const cursor = roster.find((s) => s.kind === "cursor");
  if (cursor === undefined) throw new Error("cursor 枠が無い");
  expect(directLaunchArgv(cursor)).toEqual([
    "cursor-agent",
    ...cursor.args,
    ...readOnlyArgs("cursor"),
  ]);
});

test("directResolveLaunchArgv は read-only を付けない（dispatch / 実装役）", () => {
  expect(directResolveLaunchArgv({ kind: "claude", args: ["--model", "claude-opus-5"] })).toEqual([
    "claude",
    "--model",
    "claude-opus-5",
  ]);
  expect(directResolveLaunchArgv({ kind: "grok", args: [] })).toEqual(["grok"]);
});

test("codex の read-only は -s read-only", () => {
  expect(readOnlyArgs("codex")).toEqual(["-s", "read-only"]);
});

test("grok の read-only は plan と --no-subagents", () => {
  expect(readOnlyArgs("grok")).toEqual(["--permission-mode", "plan", "--no-subagents"]);
});

test("cursor の read-only は --mode plan", () => {
  expect(readOnlyArgs("cursor")).toEqual(["--mode", "plan"]);
  const argv = directLaunchArgv({
    kind: "cursor",
    args: ["--model", "cursor-grok-4.6-high"],
    members: ["grok", "cursor", "opencode", "command-code"],
  });
  expect(argv).toEqual([
    directBinary("cursor"),
    "--model",
    "cursor-grok-4.6-high",
    "--mode",
    "plan",
  ]);
});

test("実体 file のコメントに grok 直への差し替えが残っている", () => {
  expect(roster.map((s) => s.kind)).not.toContain("grok");
  expect(rosterText).toContain('#   args = ["--model", "grok-4.6", "--effort", "high"]');
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
${RESOLVE_TOML}`;
  const slots = parseRoster(text).advisors;
  expect(slots.map((s) => s.kind)).toEqual(["claude", "cursor"]);
  expect(slots[1]?.args).toEqual(["--model", "x # not a comment"]);
});

test("advisors が無ければ止まる", () => {
  expect(() => parseRoster("# nothing\n")).toThrow("advisors");
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
test.each(["codex", "grok"] as const)("%s の pane から marker を読める", async (kind) => {
  const pane = await Bun.file(`${ROOT}test/fixtures/advisor-pane/${kind}`).text();
  expect(advisorComplete(pane, "ADVISOR-DONE-heaaqd")).toEqual({ ok: true });
});

const CURSOR_MARKER = "ADVISOR-DONE-gmjsqm";
// 実 pane の応答以降を採録し、作業ディレクトリだけ匿名化する。
const CURSOR_SNAPSHOT = await Bun.file(`${ROOT}test/fixtures/advisor-pane/cursor`).text();

const CLAUDE_MARKER = "ADVISOR-DONE-a4ql68";
// 実 pane の marker 以降を採録する。
const CLAUDE_SNAPSHOT = await Bun.file(`${ROOT}test/fixtures/advisor-pane/claude`).text();

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
