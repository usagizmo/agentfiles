// ship/scripts/wait-merge.test.sh を bun test から回す。
// 置いてあるだけの shell 検査は commit gate に載らない。

import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "../agents/skills/ship/scripts");

test("wait-merge は merge 待ちの終端を理由 1 語で返す", async () => {
  // GIT_* の剥がしと gh / date / sleep の stub は呼び先が持つ（wait-merge.test.sh の冒頭）。
  const p = Bun.spawn(["sh", "wait-merge.test.sh"], {
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
}, 120_000);
