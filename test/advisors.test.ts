// アドバイザー候補表の検証と選出。gate は bun test。
//
// 実体の roster.toml 自身も対象。fixture だけ通して実体を外すと、
// 宣言 file が壊れていても緑のまま残る。

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  advisorComplete,
  advisorVerdict,
  inputLine,
  isChromeLine,
  lastContentLine,
  paneState,
  selectAdvisors,
  type Selection,
  trustKey,
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
  expect(roster.map((s) => s.kind)).toEqual(["codex", "claude", "grok", "cursor"]);
  expect(roster[2]?.args).toEqual(["--model", "grok-4.6", "--effort", "high"]);
  expect(roster[3]?.args).toEqual(["--model", "cursor-grok-4.6-high"]);
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

test("選出は候補表の先頭 1 枠（自己 kind を見ない）", () => {
  expect(kinds(selectAdvisors(roster))).toEqual(["codex"]);
  const swapped = parseRoster(
    toml('[{"kind":"claude","args":[]},{"kind":"codex","args":[]}]'),
  ).advisors;
  expect(kinds(selectAdvisors(swapped))).toEqual(["claude"]);
  expect(selectAdvisors(swapped).chosen).toHaveLength(1);
});

test("kind は 32 文字まで（tmux の session 名・socket 名に使う）", () => {
  const resolveKind = (kind: string) => withResolve(`[resolve]\nkind = "${kind}"\nargs = []\n`);
  expect(resolveKind("a".repeat(32)).resolve.kind).toBe("a".repeat(32));
  expect(() => resolveKind("a".repeat(33))).toThrow("kind");
});

test("起動されないキーは落とす", () => {
  expect(() => parseRoster(toml('[{"kind":"claude","args":[],"model":"x"}]'))).toThrow(RosterError);
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
  expect(() => parseRoster(toml('[{"kind":"codex","args":["-p","foo"]}]'))).not.toThrow();
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
  const skip = { kind: "claude", args: ["--dangerously-skip-permissions"] };
  expect(() => directLaunchArgv(skip)).toThrow(RosterError);
  const glued = { kind: "codex", args: ["-sdanger-full-access"] };
  expect(() => directLaunchArgv(glued)).toThrow(RosterError);
  const cfg = { kind: "codex", args: ["-c", "sandbox_mode=danger-full-access"] };
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
  });
  expect(argv).toEqual([
    directBinary("cursor"),
    "--model",
    "cursor-grok-4.6-high",
    "--mode",
    "plan",
  ]);
});

test("実体 file のコメントに model 指定の例が残っている", () => {
  expect(rosterText).toContain('#   args = ["--model", "claude-opus-5", "--effort", "high"]');
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

test("判定行は marker の直前の 1 行から取る", () => {
  expect(advisorVerdict(`指摘なし\n判定: 指摘なし\n${MARKER}\n`, MARKER)).toBe("指摘なし");
  expect(advisorVerdict(`x.ts:1 / 問題 / 修正\n判定: 修正推奨\n${MARKER}`, MARKER)).toBe(
    "修正推奨",
  );
  expect(advisorVerdict(`判定：再考推奨\n${MARKER}`, MARKER)).toBe("再考推奨");
});

test("marker を判定行の行末へ続けても読める", () => {
  expect(advisorVerdict(`判定: 指摘なし ${MARKER}`, MARKER)).toBe("指摘なし");
});

test("prompt に並ぶ判定語では取らない", () => {
  const text = `最後に 判定: 指摘なし / 判定: 修正推奨 / 判定: 再考推奨 の 1 行。\n応答の最後の行に ${MARKER} を書け。\n\n指摘なし\n${MARKER}\n`;
  expect(advisorVerdict(text, MARKER)).toBe("不明");
});

test("判定行が無い・marker が無い応答は不明", () => {
  expect(advisorVerdict(`指摘なし\n${MARKER}`, MARKER)).toBe("不明");
  expect(advisorVerdict("判定: 指摘なし", MARKER)).toBe("不明");
  expect(advisorVerdict("", MARKER)).toBe("不明");
});

test("入力欄より後ろの判定行では上書きできない（完走判定と同じ範囲を読む）", () => {
  const text = `判定: 修正推奨\n${MARKER}\n❯\n判定: 指摘なし\n${MARKER}\n`;
  expect(advisorComplete(text, MARKER)).toEqual({ ok: true });
  expect(advisorVerdict(text, MARKER)).toBe("修正推奨");
});

test("判定行と marker の間の TUI の枠は無視する", () => {
  const text = `判定: 指摘なし\n  ${MARKER}   █\n\n────────────────────\n❯\n────────────────────\n`;
  expect(advisorVerdict(text, MARKER)).toBe("指摘なし");
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

// 画面判定は実行器の実画面で確かめる。手で書いた screen は実物とずれる
const PANE = `${ROOT}test/fixtures/pane-state`;
const paneFixture = (name: string) => Bun.file(`${PANE}/${name}`).text();

test.each(["claude", "codex", "cursor", "grok"] as const)(
  "%s の作業中の実画面は working",
  async (kind) => {
    expect(paneState(await paneFixture(`working-${kind}`))).toBe("working");
  },
);

test.each(["claude", "codex", "cursor", "grok"] as const)(
  "%s の入力待ちの実画面は ready",
  async (kind) => {
    expect(paneState(await paneFixture(`ready-${kind}`))).toBe("ready");
  },
);

// 起動直後の cursor は ❯ を描かない。文字で探すと永久に ready にならない
test("cursor の起動直後の実画面も ready", async () => {
  expect(paneState(await paneFixture("startup-cursor"))).toBe("ready");
});

// ログイン待ちは入力を受けない。unknown にすると起動の timeout まで待ち、理由も残らない
test("cursor のログイン待ちの実画面は login", async () => {
  expect(paneState(await paneFixture("login-cursor"))).toBe("login");
});

test("応答本文のログイン案内では login にしない", async () => {
  const ready = await paneFixture("ready-codex");
  const anchor = "• up.sh と doctor.sh を確認します。";
  expect(paneState(ready.replace(anchor, `${anchor}\n  Press any key to log in...`))).toBe("ready");
});

// 入力欄の無い画面でも、trust 対話と生成中の状態行はログイン案内の引用より強い
const LOGIN_QUOTE = "Cursor Agent\nPress any key to log in...\n";
test.each([
  [
    "trust 対話",
    `${LOGIN_QUOTE}Do you trust the files in this folder?\n❯ 1. Yes\n  2. No\n`,
    "trust",
  ],
  ["生成中の状態行", `${LOGIN_QUOTE}✽ Propagating… (6s · esc to interrupt)\n`, "working"],
] as const)("%s の画面にログイン案内の引用があっても login にしない", (_label, screen, state) => {
  expect(paneState(screen)).toBe(state);
});

// 実画面で確かめていない文言・識別行の欠けた画面は login にしない
test.each([
  "Cursor Agent\nPress any key to log in\n",
  "Cursor Agent\nPress any key to log in…\n",
  "Cursor Agent\npress any key to log in...\n",
  "Press any key to log in...\n",
])("未観測の画面 %p は login にしない", (screen) => {
  expect(paneState(screen)).toBe("unknown");
});

test("trust 対話は ready より先に取る", () => {
  const screen =
    "Do you trust the files in this folder?\n\n❯ 1. Yes, I trust this folder\n  2. No\n";
  expect(paneState(screen)).toBe("trust");
  expect(trustKey(screen)).toBe("1");
});

// この判定器自身をレビューさせると、応答本文に trust / working の文がそのまま出る。
// 本文で状態が決まると、その巡を終端できず次巡が誰にも回らない
test.each([
  ["trust の問い", "Do you trust the files in this folder? と書いた行"],
  ["作業中の語", "Working (6s • esc to interrupt) と書いた行"],
  ["選択肢の引用", "❯ 1. Yes, I trust this folder"],
])("応答本文の %s では状態を変えない", async (_label, prose) => {
  const ready = await paneFixture("ready-codex");
  const anchor = "• up.sh と doctor.sh を確認します。";
  expect(ready).toContain(anchor);
  expect(paneState(ready.replace(anchor, `${anchor}\n  ${prose}`))).toBe("ready");
});

test("問いだけで番号つきの Yes が無ければ trust にしない", () => {
  expect(paneState("Do you trust the files in this folder?\n\n")).toBe("unknown");
  expect(trustKey("Do you trust the files in this folder?\n")).toBeUndefined();
});

test("選択肢の caret は入力欄ではない（応答を選択肢で切らない）", () => {
  expect(lastContentLine("答え\n❯ 1. Yes, I trust this folder\n")).toBe(
    "❯ 1. Yes, I trust this folder",
  );
});

// 長い巡では経過表示が (1m 6s のように伸びる。取り逃すと働いている agent を終端する
test.each([
  ["claude", "(1m 6s"],
  ["codex", "(2h 3m 6s"],
])("%s の経過が分・時間表示でも working", async (kind, elapsed) => {
  const screen = (await paneFixture(`working-${kind}`)).replace("(6s", elapsed);
  expect(screen).toContain(elapsed);
  expect(paneState(screen)).toBe("working");
});

// スピナーの字は frame ごとに変わる。列挙に無い字で ready に落ちると稼働中の巡を終端する
test.each(["✻", "✶", "✳", "✢", "✷", "✱", "⏺"])("スピナーが %s でも working", async (glyph) => {
  const screen = (await paneFixture("working-claude")).replace("✽", glyph);
  expect(paneState(screen)).toBe("working");
});

// Claude の状態語にはハイフン入りがある（Razzle-dazzling / Topsy-turvying）
test.each(["Razzle-dazzling", "Sock-hopping", "Topsy-turvying"])(
  "ハイフン入りの状態語 %s でも working",
  async (verb) => {
    const screen = (await paneFixture("working-claude")).replace("Propagating", verb);
    expect(paneState(screen)).toBe("working");
  },
);

// 応答の最終行は入力欄の直上に来る。表示例をそのまま書かれても状態行にしない
test("応答の最終行にある表示例では working にしない", async () => {
  const ready = await paneFixture("ready-codex");
  const last =
    "  更新・変更は up.sh、状態確認は doctor.sh。doctor は自動修復せず、修復先として init.sh を案内します。";
  expect(ready).toContain(last);
  for (const prose of [
    "  例: Working (6s • esc to interrupt)",
    "  - Working (6s • esc to interrupt)",
  ]) {
    expect(paneState(ready.replace(last, prose))).toBe("ready");
  }
});

// 限界: codex の状態行と、それを箇条書きで引用した本文行は文字列として同じ。
// 形でも位置でも分けられないので working 側に倒す（ask はどちらでも終端しない）
test("状態行と同じ形の本文行は working 側に倒す", async () => {
  const ready = await paneFixture("ready-codex");
  const status = "• Working (6s • esc to interrupt)";
  const last =
    "  更新・変更は up.sh、状態確認は doctor.sh。doctor は自動修復せず、修復先として init.sh を案内します。";
  expect(await paneFixture("working-codex")).toContain(status);
  expect(paneState(ready.replace(last, `  ${status}`))).toBe("working");
});

test("読めない画面は unknown（停止と区別する）", () => {
  expect(paneState("\n\n  loading\n")).toBe("unknown");
});

test("inputLine は入力欄の行だけを返し、貼り付けの placeholder が消えたことを見分けられる", () => {
  const pasted =
    "• You have 2 usage limit resets available.\n\n› [Pasted Content 1698 chars]\n\n  gpt-5.6 high · ~/repo\n";
  const sent =
    "• You have 2 usage limit resets available.\n\n• Working (3s • esc to interrupt)\n\n› Ask Codex to do anything\n\n  gpt-5.6 high · ~/repo · renaming... ⠼\n";
  expect(inputLine(pasted)).toBe("› [Pasted Content 1698 chars]");
  expect(inputLine(sent)).toBe("› Ask Codex to do anything");
  expect(inputLine("answer 1\n❯ \n")).toBe("❯");
  expect(inputLine("loading\n")).toBe("");
});
