// wait-ready は表示中の trust 対話を即 exit 3 にする（❯ 誤判定の回帰）。
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/shared/tmux-session.sh", import.meta.url).pathname;

const FAKE = `#!/usr/bin/env python3
import pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
if args[:1] == ["-L"]:
    args = args[2:]

def target_session(token: str) -> str:
    t = token[1:] if token.startswith("=") else token
    return t.split(":", 1)[0]

if args[0] == "has-session":
    raise SystemExit(0)
if args[0] == "capture-pane":
    # -p only (visible) vs -S - (history): どちらも同じ screen を返す
    screen = (root / "screen").read_text()
    sys.stdout.write(screen)
    raise SystemExit(0)
raise SystemExit("unexpected: " + repr(args))
`;

test("wait-ready: trust 対話中は exit 3（ready にしない）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-trust-"));
  try {
    await writeFile(join(dir, "tmux"), FAKE, { mode: 0o755 });
    await writeFile(join(dir, "screen"), "❯ 1. Yes, I trust this folder\n  2. No\n");
    const proc = Bun.spawn(["sh", SCRIPT, "wait-ready", "s", "2"], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("wait-ready: 通常の入力待ちは exit 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmux-ready-"));
  try {
    await writeFile(join(dir, "tmux"), FAKE, { mode: 0o755 });
    await writeFile(join(dir, "screen"), "ready\n❯ \n");
    const proc = Bun.spawn(["sh", SCRIPT, "wait-ready", "s", "2"], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}` },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
