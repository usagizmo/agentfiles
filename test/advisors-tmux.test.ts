// advisors-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / claude / codex は偽物。paste で marker を画面へ積む。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/consult/scripts/advisors-tmux.sh", import.meta.url)
  .pathname;

const FAKE_TMUX = `#!/usr/bin/env python3
import pathlib, re, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]

def session_dir(name: str) -> pathlib.Path:
    d = root / ("sess-" + name)
    d.mkdir(exist_ok=True)
    return d

def target_session(token: str) -> str:
    # -t =name or -t name:0.0
    t = token[1:] if token.startswith("=") else token
    return t.split(":", 1)[0]

if not args:
    raise SystemExit("tmux: no args")

if args[0] == "has-session":
    name = target_session(args[args.index("-t") + 1])
    raise SystemExit(0 if (root / ("sess-" + name)).exists() else 1)

if args[0] == "new-session":
    # ... -s NAME -c DIR ...
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
    b = args[args.index("-b") + 1]
    name = target_session(args[args.index("-t") + 1])
    d = session_dir(name)
    prompt_path = (root / ("buf-" + b)).read_text()
    # load-buffer は file 内容を入れた。advisors-tmux は file パスではなく内容を load する
    text = prompt_path
    marker_m = re.search(r"(ADVISOR-DONE-[a-z0-9]+-\\d+)", text)
    marker = marker_m.group(1) if marker_m else "NO-MARKER"
    n = int((d / "prompts").read_text()) + 1 if (d / "prompts").exists() else 1
    (d / "prompts").write_text(str(n))
    prev = (d / "screen").read_text() if (d / "screen").exists() else ""
    line = "answer %d\\n%s\\n❯ \\n" % (n, marker)
    (d / "screen").write_text(prev + line)
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

const FAKE_BIN = `#!/bin/sh
# PATH 上の偽 claude / 偽 codex。実体は不要（tmux create が send-keys するだけ）
exit 0
`;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
      CONSULT_SELF_KIND: "cursor",
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
  const dir = await mkdtemp(join(tmpdir(), "advisors-tmux-"));
  await Bun.write(join(dir, "tmux"), FAKE_TMUX);
  await Bun.write(join(dir, "claude"), FAKE_BIN);
  await Bun.write(join(dir, "codex"), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Review the diff.\n");
  await Bun.write(join(dir, "reply"), "Applied 1. Re-review.\n");
  await chmod(join(dir, "tmux"), 0o755);
  await chmod(join(dir, "claude"), 0o755);
  await chmod(join(dir, "codex"), 0o755);
  return dir;
};

test("tmux backend: 巡をまたいで送り、close で session を破棄する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect({ exitCode: started.exitCode, stderr: started.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "backend"), "utf8")).toBe("tmux\n");
    expect(await readFile(join(runDir, "round"), "utf8")).toBe("1\n");

    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("=== claude 巡 1 (rc=0) ===");
    expect(first.stdout).toContain("answer 1");

    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect({ exitCode: asked.exitCode, stdout: asked.stdout }).toEqual({
      exitCode: 0,
      stdout: "2\n",
    });

    const second = await run(dir, ["collect", runDir, "5"]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("answer 2");

    const closed = await run(dir, ["close", runDir]);
    expect(closed.exitCode).toBe(0);
    expect(await readFile(join(dir, "kills"), "utf8")).toMatch(/^[1-9]/);
    const after = await run(dir, ["collect", runDir, "5"]);
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toContain("close 済み");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: CONSULT_SELF_KIND 無しは start できない", async () => {
  const dir = await setup();
  try {
    const proc = Bun.spawn(["sh", SCRIPT, "start", join(dir, "prompt")], {
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"]}`, TMPDIR: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(2);
    expect(stderr).toContain("CONSULT_SELF_KIND が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
