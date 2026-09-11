// consult-backend.sh の明示セレクタ。未設定・未知は fatal。黙って倒さない。

import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/consult/scripts/consult-backend.sh", import.meta.url)
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

test("CONSULT_BACKEND 未設定は fatal（fallback しない）", async () => {
  const dir = await mkdtemp(join(tmpdir(), "consult-backend-"));
  try {
    const r = await run(dir, { CONSULT_BACKEND: undefined }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("CONSULT_BACKEND が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("未知の CONSULT_BACKEND は fatal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "consult-backend-"));
  try {
    const r = await run(dir, { CONSULT_BACKEND: "print" }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("未知の CONSULT_BACKEND: print");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CONSULT_BACKEND=tmux は advisors-tmux へ委譲する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "consult-backend-"));
  try {
    // advisors-tmux は CONSULT_SELF_KIND 無しで fatal するはず（委譲の証拠）
    const r = await run(dir, { CONSULT_BACKEND: "tmux" }, ["start", "/dev/null"]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("CONSULT_SELF_KIND が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CONSULT_BACKEND=herdr は advisors.sh へ委譲する", async () => {
  const dir = await mkdtemp(join(tmpdir(), "consult-backend-"));
  try {
    await Bun.write(join(dir, "herdr"), "#!/bin/sh\necho unexpected >&2\nexit 1\n");
    await chmod(join(dir, "herdr"), 0o755);
    const r = await run(dir, { CONSULT_BACKEND: "herdr", HERDR_ENV: undefined }, [
      "start",
      "/dev/null",
    ]);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("Herdr の外ではアドバイザーを立てない");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
