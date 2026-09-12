// worker-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / claude は偽物。paste で WORKER-DONE marker を画面へ積む。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/dispatch/scripts/worker-tmux.sh", import.meta.url)
  .pathname;

const FAKE_TMUX = `#!/usr/bin/env python3
import pathlib, re, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
if args[:1] == ["-L"]:
    args = args[2:]

def session_dir(name: str) -> pathlib.Path:
    d = root / ("sess-" + name)
    d.mkdir(exist_ok=True)
    return d

def target_session(token: str) -> str:
    # -t =name / -t %pane-id
    t = token[1:] if token[:1] in ("=", "%") else token
    return t.split(":", 1)[0]

if not args:
    raise SystemExit("tmux: no args")

if args[0] == "list-panes":
    # 本物は pane id を返す。固定 target へ戻す回帰を落とす
    sys.stdout.write("%" + target_session(args[args.index("-t") + 1]) + "\\n")
    raise SystemExit(0)

if args[0] == "has-session":
    name = target_session(args[args.index("-t") + 1])
    raise SystemExit(0 if (root / ("sess-" + name)).exists() else 1)

if args[0] == "new-session":
    name = args[args.index("-s") + 1]
    d = session_dir(name)
    (d / "screen").write_text("❯ \\n")
    raise SystemExit(0)

if args[0] == "send-keys":
    raise SystemExit(0)

if args[0] == "load-buffer":
    b = args[args.index("-b") + 1]
    path = args[-1]
    (root / ("buf-" + b)).write_text(pathlib.Path(path).read_text())
    raise SystemExit(0)

if args[0] == "paste-buffer":
    # -p / -d は本番と同じく受け取る（無視）
    b = args[args.index("-b") + 1]
    name = target_session(args[args.index("-t") + 1])
    d = session_dir(name)
    text = (root / ("buf-" + b)).read_text()
    marker_m = re.search(r"(WORKER-DONE-[a-z0-9]+-\\d+)", text)
    marker = marker_m.group(1) if marker_m else "NO-MARKER"
    n = int((d / "prompts").read_text()) + 1 if (d / "prompts").exists() else 1
    (d / "prompts").write_text(str(n))
    prev = (d / "screen").read_text() if (d / "screen").exists() else ""
    (d / "screen").write_text(prev + ("done %d\\n%s\\n❯ \\n" % (n, marker)))
    raise SystemExit(0)

if args[0] == "delete-buffer":
    raise SystemExit(0)

if args[0] == "capture-pane":
    name = target_session(args[args.index("-t") + 1])
    d = session_dir(name)
    sys.stdout.write((d / "screen").read_text() if (d / "screen").exists() else "")
    raise SystemExit(0)

if args[0] == "kill-session":
    name = target_session(args[args.index("-t") + 1])
    d = root / ("sess-" + name)
    if d.exists():
        for p in d.iterdir():
            p.unlink()
        d.rmdir()
        bump = root / "kills"
        bump.write_text(str(int(bump.read_text()) + 1 if bump.exists() else 1))
    raise SystemExit(0)

raise SystemExit("Unexpected tmux: " + repr(args))
`;

const FAKE_BIN = `#!/bin/sh\nexit 0\n`;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
      DISPATCH_KIND: "claude",
    },
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

const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-tmux-"));
  await Bun.write(join(dir, "tmux"), FAKE_TMUX);
  await Bun.write(join(dir, "claude"), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Implement the fix.\n");
  await Bun.write(join(dir, "reply"), "Continue with tests.\n");
  await chmod(join(dir, "tmux"), 0o755);
  await chmod(join(dir, "claude"), 0o755);
  return dir;
};

test("dispatch tmux: 巡をまたいで送り、close で session を破棄する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect({ exitCode: started.exitCode, stderr: started.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "backend"), "utf8")).toBe("tmux\n");
    expect(await readFile(join(runDir, "layer"), "utf8")).toBe("dispatch\n");
    expect(await readFile(join(runDir, "worker"), "utf8")).toBe("claude\n");

    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("claude");
    expect(first.stdout).toContain("done 1");

    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect({ exitCode: asked.exitCode, stdout: asked.stdout }).toEqual({
      exitCode: 0,
      stdout: "2\n",
    });

    const second = await run(dir, ["collect", runDir, "5"]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("done 2");

    const closed = await run(dir, ["close", runDir]);
    expect(closed.exitCode).toBe(0);
    expect(await readFile(join(dir, "kills"), "utf8")).toMatch(/^[1-9]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
