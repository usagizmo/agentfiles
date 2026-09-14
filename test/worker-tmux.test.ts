// worker-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / claude は偽物。偽 tmux は fake-tmux.ts。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { installFakeTmux } from "./fake-tmux.ts";

const SCRIPT = new URL("../agents/skills/dispatch/scripts/worker-tmux.sh", import.meta.url)
  .pathname;

const FIXTURE = new URL("fixtures/pane-state", import.meta.url).pathname;

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
  await installFakeTmux(dir);
  await Bun.write(join(dir, "claude"), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Implement the fix.\n");
  await Bun.write(join(dir, "reply"), "Continue with tests.\n");
  await chmod(join(dir, "claude"), 0o755);
  return dir;
};

test("dispatch tmux: 起こせなければ log 末尾を出す", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "die"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain(
      "(log の末尾)\nFATAL\tsession が消えた（起動した harness が終了した）: d-claude-",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: ログイン待ちなら理由を出して起動を止める", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "login"), Bun.file(`${FIXTURE}/login-cursor`));
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("FATAL\tログインが要る: claude\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
