// pr/scripts/sync-and-push.test.sh を bun test から回す。
// 置いてあるだけの shell 検査は commit gate に載らない。

import { expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPTS = join(import.meta.dir, "../agents/skills/pr/scripts");

test("sync-and-push は origin の同名へ送りきる", async () => {
  const env = { ...process.env };
  delete env["GIT_DIR"];
  delete env["GIT_WORK_TREE"];
  delete env["GIT_INDEX_FILE"];
  delete env["GIT_OBJECT_DIRECTORY"];
  delete env["GIT_PREFIX"];
  delete env["GIT_COMMON_DIR"];
  const p = Bun.spawn(["sh", "sync-and-push.test.sh"], {
    cwd: SCRIPTS,
    env,
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
