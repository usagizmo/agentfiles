// 打ち切られた board / REST 一覧を全件として受理しない。
//
// **`--paginate` の exit 0 は全件の証拠にしない。**最終ページの hasNextPage が真なら
// ラウンド失敗。REST は件数照合に落ちたらラウンド失敗。

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WATCH_SHELL } from "../agents/skills/conductor/src/port.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const WATCH = `${ROOT}agents/skills/conductor/scripts/watch.sh`;
const PARTIAL = `${ROOT}test/fixtures/watch-partial-fetch/bin`;
/** git はここだけにある。PATH は partial の gh を先に置き、baseline の git を後段で読む。 */
const BASELINE = `${ROOT}test/fixtures/watch-baseline/bin`;

async function snapshot(env: Record<string, string | undefined> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "watch-partial-"));
  const snapshotPath = join(dir, "snapshot");
  writeFileSync(join(dir, "state"), "resolve-1 working\n");
  const p = Bun.spawn(
    [
      WATCH_SHELL,
      WATCH,
      "--snapshot",
      snapshotPath,
      "--repo",
      "/fake/repo",
      "--gh-repo",
      "o/r",
      "--project-org",
      "o",
      "--project-number",
      "7",
      "--status-field",
      "Status",
      "--sessions-cmd",
      `cat ${join(dir, "state")}`,
      "--workspaces-cmd",
      "echo ws-1 /fake/wt",
      "--deadline",
      "20",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        PATH: `${PARTIAL}:${BASELINE}:${process.env["PATH"]}`,
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("board GraphQL の最終ページ hasNextPage が真ならラウンドは失敗する", async () => {
  const run = await snapshot({ GH_PARTIAL: "board" });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("hasNextPage");
});

test("REST の件数照合に落ちた一覧はラウンドを失敗にする", async () => {
  const run = await snapshot({ GH_PARTIAL: "rest" });
  expect(run.exitCode).toBe(1);
  expect(run.stderr).toContain("REST 一覧が短い");
});
