// tmux-session.sh の画面まわり。trust 対話の受理と、pane id の引き方。
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = new URL("../", import.meta.url).pathname;
const SCRIPT = `${ROOT}agents/shared/tmux-session.sh`;
const FIXTURE = `${ROOT}test/fixtures/pane-state`;

// 実物の tmux は base-index / pane-base-index の設定で session:0.0 が無いことがある。
// 偽物も pane id でしか答えない（固定 target へ戻す回帰を落とす）。
const FAKE = `#!/usr/bin/env python3
import pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
if args[:1] == ["-L"]:
    args = args[2:]

if args[0] == "has-session":
    # absent: create 前でまだ無い。gone: 起動した harness が終了して消えた
    raise SystemExit(1 if (root / "absent").exists() or (root / "gone").exists() else 0)
if args[0] == "list-panes":
    if not (root / "gone").exists():
        sys.stdout.write("%3\\n")
    raise SystemExit(0)
if args[0] == "capture-pane":
    if (root / "gone").exists():
        raise SystemExit("can't find pane: " + args[args.index("-t") + 1])
    if args[args.index("-t") + 1] != "%3":
        raise SystemExit("capture-pane: unexpected target " + args[args.index("-t") + 1])
    sys.stdout.write((root / "screen").read_text())
    # vanish: 1 画面を返した直後に harness が終了する
    if (root / "vanish").exists():
        (root / "gone").write_text("")
    raise SystemExit(0)
if args[0] == "new-session":
    (root / "new-session").write_text("\\n".join(args) + "\\n")
    raise SystemExit(0)
if args[0] == "show-environment":
    # server の global env（この client の env には無い印が残っている）
    sys.stdout.write("CLAUDE_CODE_SESSION_ID=from-server\\n")
    raise SystemExit(0)
if args[0] == "send-keys":
    keys = args[args.index("-t") + 2:]
    with (root / "keys").open("a") as f:
        f.write(" ".join(keys) + "\\n")
    # Enter を受け取ったら対話が消えて入力待ちへ変わる
    if keys == ["C-m"] and (root / "accept").exists():
        (root / "screen").write_text((root / "accept").read_text())
    raise SystemExit(0)
raise SystemExit("unexpected: " + repr(args))
`;

const setup = async (screen: string, accept?: string) => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-session-"));
  await writeFile(join(dir, "tmux"), FAKE, { mode: 0o755 });
  await writeFile(join(dir, "screen"), screen);
  if (accept !== undefined) await writeFile(join(dir, "accept"), accept);
  return dir;
};

const runScript = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const TRUST_SCREEN = `Do you trust the files in this folder?

~/workspace

❯ 1. Yes, I trust this folder
  2. No, exit

`;

test("wait-ready: trust 対話中は exit 3（ready にしない）", async () => {
  const dir = await setup(TRUST_SCREEN);
  try {
    expect((await runScript(dir, ["wait-ready", "s", "2"])).exitCode).toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each(["ready-claude", "ready-codex", "ready-cursor", "startup-cursor"] as const)(
  "wait-ready: %s の実画面は exit 0",
  async (name) => {
    const dir = await setup(await readFile(join(FIXTURE, name), "utf8"));
    try {
      expect((await runScript(dir, ["wait-ready", "s", "2"])).exitCode).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test.each(["working-claude", "working-codex", "working-cursor"] as const)(
  "wait-ready: %s の実画面は ready にしない",
  async (name) => {
    const dir = await setup(await readFile(join(FIXTURE, name), "utf8"));
    try {
      expect((await runScript(dir, ["wait-ready", "s", "1"])).exitCode).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("accept-trust: Yes の番号と Enter だけを送る（Down を送らない）", async () => {
  const dir = await setup(TRUST_SCREEN, await readFile(join(FIXTURE, "ready-claude"), "utf8"));
  try {
    expect((await runScript(dir, ["accept-trust", "s", "5"])).exitCode).toBe(0);
    expect(await readFile(join(dir, "keys"), "utf8")).toBe("1\nC-m\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("accept-trust: 対話が消えなければ失敗（勝手に選び直さない）", async () => {
  const dir = await setup(TRUST_SCREEN);
  try {
    expect((await runScript(dir, ["accept-trust", "s", "2"])).exitCode).toBe(1);
    expect(await readFile(join(dir, "keys"), "utf8")).toBe("1\nC-m\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 起動直後に終了した harness を timeout まで待たない
test.each(["wait-ready", "accept-trust"] as const)(
  "%s: session が消えたら timeout を待たず exit 2",
  async (cmd) => {
    const dir = await setup("Loading\n");
    try {
      await writeFile(join(dir, "vanish"), "");
      const started = Date.now();
      const result = await runScript(dir, [cmd, "s", "8"]);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
        exitCode: 2,
        stderr: "FATAL\tsession が消えた（起動した harness が終了した）: s\n",
      });
      expect(Date.now() - started).toBeLessThan(6_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);

// 画面を読めないまま timeout まで待たない（unknown と区別する）
test.each(["wait-ready", "accept-trust"] as const)(
  "%s: 画面判定が失敗したら timeout を待たず exit 2",
  async (cmd) => {
    const dir = await setup("Loading\n");
    try {
      await writeFile(join(dir, "bun"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      const started = Date.now();
      const result = await runScript(dir, [cmd, "s", "8"]);
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
        exitCode: 2,
        stderr: "FATAL\t画面を判定できない: s\n",
      });
      expect(Date.now() - started).toBeLessThan(6_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);

test("state: 表示中の画面の状態語を返す", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "working-codex"), "utf8"));
  try {
    expect(await runScript(dir, ["state", "s"])).toEqual({
      stdout: "working\n",
      stderr: "",
      exitCode: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("create: cwd は server の状態に依らず起動 argv で固定する", async () => {
  const dir = await setup("");
  try {
    await writeFile(join(dir, "absent"), "");
    expect((await runScript(dir, ["create", "s", dir, "--", "tmux", "a"])).exitCode).toBe(0);
    const args = await readFile(join(dir, "new-session"), "utf8");
    expect(args).toEndWith(`\n--\n/usr/bin/env\n-C\n${dir}\n--\n${dir}/tmux\na\n`);
    expect(args).not.toContain("-c\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("create: 呼び出し元にも server にも残る印を空にして渡す", async () => {
  const dir = await setup("");
  try {
    await writeFile(join(dir, "absent"), "");
    const proc = Bun.spawn(["sh", SCRIPT, "create", "s", dir, "--", "tmux"], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, CLAUDECODE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await proc.exited).toBe(0);
    const args = await readFile(join(dir, "new-session"), "utf8");
    // 呼び出し元の env にある印
    expect(args).toContain("-e\nCLAUDECODE=\n");
    // server の global env にだけ残る印
    expect(args).toContain("-e\nCLAUDE_CODE_SESSION_ID=\n");
    expect(args).toContain(`-e\nPATH=`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
