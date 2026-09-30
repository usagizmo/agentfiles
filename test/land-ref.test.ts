// merge/scripts/land-ref.test.sh を bun test から回す。
// 置いてあるだけの shell 検査は commit gate に載らない。

import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "../agents/skills/merge/scripts");

test("land-ref は checkout の無い統合先へだけ ref で着地する", async () => {
  // GIT_* の剥がしは呼び先が持つ（land-ref.test.sh の冒頭）。
  const p = Bun.spawn(["sh", "land-ref.test.sh"], {
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
  expect(output).toContain(" 0 fail");
  expect(code).toBe(0);
}, 60_000);
