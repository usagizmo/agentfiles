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
    # create の検査用。absent があれば「session はまだ無い」
    raise SystemExit(1 if (root / "absent").exists() else 0)
if args[0] == "list-panes":
    sys.stdout.write("%3\\n")
    raise SystemExit(0)
if args[0] == "capture-pane":
    if args[args.index("-t") + 1] != "%3":
        raise SystemExit("capture-pane: unexpected target " + args[args.index("-t") + 1])
    sys.stdout.write((root / "screen").read_text())
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
  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return { stdout, exitCode };
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

test("state: 表示中の画面の状態語を返す", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "working-codex"), "utf8"));
  try {
    expect(await runScript(dir, ["state", "s"])).toEqual({ stdout: "working\n", exitCode: 0 });
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
