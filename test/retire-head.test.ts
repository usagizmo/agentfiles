// ship/scripts/retire-head.test.sh を bun test から回す。
// 置いてあるだけの shell 検査は commit gate に載らない。

import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "../agents/skills/ship/scripts");

test("retire-head は merged な head だけを消す", async () => {
  // GIT_* の剥がしと gh の stub は呼び先が持つ（retire-head.test.sh の冒頭）。
  const p = Bun.spawn(["sh", "retire-head.test.sh"], {
    cwd: SCRIPTS,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const output = `${out}${err}`;
  expect(output).toContain("0 fail");
  expect(code).toBe(0);
}, 60_000);
