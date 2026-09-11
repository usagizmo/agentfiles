// dispatch-backend.sh の明示セレクタ。未設定・未知は fatal。黙って倒さない。

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/dispatch/scripts/dispatch-backend.sh", import.meta.url)
  .pathname;

const run = async (dir: string, env: Record<string, string | undefined>, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: { ...process.env, ...env, PATH: `${dir}:${process.env["PATH"]}`, TMPDIR: dir },
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

test("DISPATCH_BACKEND 未設定は fatal（fallback しない）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-backend-"));
  try {
    const r = await run(dir, { DISPATCH_BACKEND: undefined }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("DISPATCH_BACKEND が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("未知の DISPATCH_BACKEND は fatal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-backend-"));
  try {
    const r = await run(dir, { DISPATCH_BACKEND: "print" }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("未知の DISPATCH_BACKEND: print");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DISPATCH_BACKEND=herdr は未配線を明示して止まる", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-backend-"));
  try {
    const r = await run(dir, { DISPATCH_BACKEND: "herdr" }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("未配線");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("DISPATCH_BACKEND=tmux は worker-tmux へ委譲する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dispatch-backend-"));
  try {
    const r = await run(dir, { DISPATCH_BACKEND: "tmux" }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toMatch(/prompt が空|不正/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
