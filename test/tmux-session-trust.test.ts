// tmux-session.sh の画面まわり。open の起動待ち（trust 対話の受理・失敗理由）と、pane id の引き方。
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
# server の振る舞いをユーザー設定に左右させない呼び出しだけを受ける
if args[:2] != ["-f", "/dev/null"]:
    raise SystemExit("tmux: -f /dev/null が無い: " + repr(args))
args = args[2:]
# どの server へ向けた呼び出しかを残す（socket は session ごと）
with (root / "sockets").open("a") as f:
    f.write((args[1] if args[:1] == ["-L"] else "-") + "\\n")
if args[:1] == ["-L"]:
    args = args[2:]

if args[0] == "has-session":
    # absent: まだ作っていない。gone: 起動した harness が終了して消えた
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
    (root / "absent").unlink()
    raise SystemExit(0)
if args[0] == "kill-server":
    # unkillable: server を止められない
    if (root / "unkillable").exists():
        raise SystemExit(1)
    # racing: kill-server が届く前に server が自分で終わる
    if (root / "racing").exists():
        (root / "gone").write_text("")
        raise SystemExit(1)
    (root / "killed").write_text("")
    (root / "gone").write_text("")
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
  await writeFile(join(dir, "absent"), "");
  if (accept !== undefined) await writeFile(join(dir, "accept"), accept);
  return dir;
};

const runScript = async (dir: string, argv: string[], env: Record<string, string> = {}) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, ...env },
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

// 起動する harness は PATH 上の偽 tmux で代用する（実在する実行ファイルなら何でもよい）
const open = (dir: string, timeout: number, env?: Record<string, string>) =>
  runScript(dir, ["open", "s", dir, "--timeout", String(timeout), "--", "tmux"], env);

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const TRUST_SCREEN = `Do you trust the files in this folder?

~/workspace

❯ 1. Yes, I trust this folder
  2. No, exit

`;

test.each(["ready-claude", "ready-codex", "ready-cursor", "startup-cursor"] as const)(
  "open: %s の実画面は exit 0 で session を残す",
  async (name) => {
    const dir = await setup(await readFile(join(FIXTURE, name), "utf8"));
    try {
      expect(await open(dir, 2)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      expect(await exists(join(dir, "killed"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test.each(["working-claude", "working-codex", "working-cursor"] as const)(
  "open: %s の実画面は ready にしない",
  async (name) => {
    const dir = await setup(await readFile(join(FIXTURE, name), "utf8"));
    try {
      expect(await open(dir, 1)).toEqual({
        stdout: "",
        stderr: "FATAL\t入力を受ける画面にならない（1 秒）: s\n",
        exitCode: 2,
      });
      expect(await exists(join(dir, "killed"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("open: trust 対話は Yes の番号と Enter だけを送る（Down を送らない）", async () => {
  const dir = await setup(TRUST_SCREEN, await readFile(join(FIXTURE, "ready-claude"), "utf8"));
  try {
    expect((await open(dir, 5)).exitCode).toBe(0);
    expect(await readFile(join(dir, "keys"), "utf8")).toBe("1\nC-m\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("open: trust 対話が消えなければ失敗（勝手に選び直さない）", async () => {
  const dir = await setup(TRUST_SCREEN);
  try {
    expect(await open(dir, 2)).toEqual({
      stdout: "",
      stderr: `FATAL\ttrust 対話を越えられない: ${dir}\n`,
      exitCode: 2,
    });
    expect(await readFile(join(dir, "keys"), "utf8")).toBe("1\nC-m\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ログイン待ち・消失・判定器の失敗は、timeout を待たずに理由を出して session を残さない。
// 消失した session の server は既に終わっているので止めに行かない
test.each([
  ["ログイン待ち", "login", "FATAL\tログインが要る: tmux\n", true],
  [
    "session の消失",
    "vanish",
    "FATAL\tsession が消えた（起動した harness が終了した）: s\n",
    false,
  ],
  ["画面判定の失敗", "judge", "FATAL\t画面を判定できない: s\n", true],
] as const)(
  "open: %s は timeout を待たず理由を出して exit 2",
  async (_label, kind, stderr, killed) => {
    const screen =
      kind === "login" ? await readFile(join(FIXTURE, "login-cursor"), "utf8") : "Loading\n";
    const dir = await setup(screen);
    try {
      if (kind === "vanish") await writeFile(join(dir, "vanish"), "");
      if (kind === "judge") {
        await writeFile(join(dir, "bun"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      }
      const started = Date.now();
      expect(await open(dir, 8)).toEqual({ stdout: "", stderr, exitCode: 2 });
      expect(Date.now() - started).toBeLessThan(6_000);
      expect(await exists(join(dir, "killed"))).toBe(killed);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);

// server が終わっても socket file は残る。session ごとの socket を使い捨てるので溜めない
const socketDir = (dir: string) => join(dir, `tmux-${process.getuid?.()}`);

const socketFile = async (dir: string) => {
  await mkdir(socketDir(dir), { recursive: true });
  const socket = join(socketDir(dir), "s");
  await writeFile(socket, "");
  return socket;
};

test("open の失敗は server を止めて socket file を消す", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "login-cursor"), "utf8"));
  try {
    const socket = await socketFile(dir);
    const argv = ["open", "s", dir, "--timeout", "2", "--", "tmux"];
    expect((await runScript(dir, argv, { TMUX_TMPDIR: dir })).exitCode).toBe(2);
    expect(await exists(join(dir, "killed"))).toBe(true);
    expect(await exists(socket)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test.each([
  ["生きている server", true],
  ["先に終わった server", false],
] as const)("kill: %s の socket file を消す", async (_label, alive) => {
  const dir = await setup("");
  try {
    const socket = await socketFile(dir);
    if (alive) await rm(join(dir, "absent"));
    expect((await runScript(dir, ["kill", "s"], { TMUX_TMPDIR: dir })).exitCode).toBe(0);
    expect(await exists(join(dir, "killed"))).toBe(alive);
    expect(await exists(socket)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("kill: kill-server の前に server が自分で終わっても socket file を消して成功する", async () => {
  const dir = await setup("");
  try {
    const socket = await socketFile(dir);
    await rm(join(dir, "absent"));
    await writeFile(join(dir, "racing"), "");
    expect(await runScript(dir, ["kill", "s"], { TMUX_TMPDIR: dir })).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await exists(socket)).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// socket file を消すとその server へ辿れなくなる
test("kill: server を止められなければ socket file を残して失敗する", async () => {
  const dir = await setup("");
  try {
    const socket = await socketFile(dir);
    await rm(join(dir, "absent"));
    await writeFile(join(dir, "unkillable"), "");
    expect(await runScript(dir, ["kill", "s"], { TMUX_TMPDIR: dir })).toEqual({
      stdout: "",
      stderr: "FATAL\tsession を殺せない: s\n",
      exitCode: 2,
    });
    expect(await exists(socket)).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// session 名は socket file のパスになる。境界の外のファイルに触れず、tmux も呼ばない
test.each(["../sentinel", "S", "-x", "a".repeat(49)])(
  "session 名 %p は tmux を呼ばずに落とす",
  async (name) => {
    const dir = await setup("");
    try {
      await mkdir(socketDir(dir), { recursive: true });
      await writeFile(join(dir, "sentinel"), "");
      expect(await runScript(dir, ["kill", name], { TMUX_TMPDIR: dir })).toEqual({
        stdout: "",
        stderr: `FATAL\tsession 名が不正: ${name}\n`,
        exitCode: 2,
      });
      expect(await exists(join(dir, "sentinel"))).toBe(true);
      expect(await exists(join(dir, "sockets"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("state: 表示中の画面の状態語を返す", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "working-codex"), "utf8"));
  try {
    await rm(join(dir, "absent"));
    expect(await runScript(dir, ["state", "s"])).toEqual({
      stdout: "working\n",
      stderr: "",
      exitCode: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// 共有 server は起こした呼び出し元の cwd・env・実行環境を後続の session へ漏らす
test("open: tmux の呼び出しはすべて session 名の socket へ向ける", async () => {
  const dir = await setup(TRUST_SCREEN, await readFile(join(FIXTURE, "ready-claude"), "utf8"));
  try {
    expect((await open(dir, 5)).exitCode).toBe(0);
    const sockets = (await readFile(join(dir, "sockets"), "utf8")).trim().split("\n");
    expect(sockets.length).toBeGreaterThan(3);
    expect(new Set(sockets)).toEqual(new Set(["s"]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("open: cwd は -c で渡し、起動 argv を直接 exec する", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "ready-codex"), "utf8"));
  try {
    expect((await open(dir, 2)).exitCode).toBe(0);
    const args = await readFile(join(dir, "new-session"), "utf8");
    expect(args).toContain(`\n-c\n${dir}\n`);
    expect(args).toEndWith(`\n--\n${dir}/tmux\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("open: 呼び出し元の印を空にして渡す", async () => {
  const dir = await setup(await readFile(join(FIXTURE, "ready-codex"), "utf8"));
  try {
    expect((await open(dir, 2, { CLAUDECODE: "1" })).exitCode).toBe(0);
    expect(await readFile(join(dir, "new-session"), "utf8")).toContain("-e\nCLAUDECODE=\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
