// pr/scripts/sync-and-push.test.sh を bun test から回す。
// 置いてあるだけの shell 検査は commit gate に載らない。

import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "../agents/skills/pr/scripts");

test("sync-and-push は origin の同名へ送りきる", async () => {
  // **GIT_* の剥がしは呼び先が持つ**（sync-and-push.test.sh の冒頭）。ここで先回りすると
  // 同じ規則が 2 つになり、呼び先だけを直したときに片方が古いまま残る。
  const p = Bun.spawn(["sh", "sync-and-push.test.sh"], {
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
