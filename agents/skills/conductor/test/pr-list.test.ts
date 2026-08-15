// `scripts/pr-list.jq` の抽出。CheckRun の実行中は `status` を読み、空の status は出さない。

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const JQ = join(import.meta.dir, "../scripts/pr-list.jq");

const fold = async (prs: unknown): Promise<string> => {
  const p = Bun.spawn(["jq", "-r", "-f", JQ], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  p.stdin.write(JSON.stringify(prs));
  p.stdin.end();
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if (code !== 0) throw new Error(err || `jq exited ${code}`);
  return out.trimEnd();
};

describe("pr-list.jq", () => {
  test("CheckRun の実行中は IN_PROGRESS として残り、空にならない", async () => {
    const out = await fold([
      {
        number: 951,
        headRefName: "chore/941-x",
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [
          {
            name: "Root gate (drift)",
            status: "IN_PROGRESS",
            conclusion: null,
            startedAt: "2026-08-13T22:00:00Z",
            completedAt: null,
          },
          {
            name: "Preview DB",
            conclusion: "SKIPPED",
            status: "COMPLETED",
            completedAt: "2026-08-13T21:00:00Z",
          },
        ],
      },
    ]);
    expect(out).toBe(
      "951 chore/941-x OPEN draft=false checks=IN_PROGRESS@2026-08-13T22:00:00Z@Root gate (drift)|SKIPPED@2026-08-13T21:00:00Z@Preview DB",
    );
  });

  test("StatusContext は state を読む", async () => {
    const out = await fold([
      {
        number: 1,
        headRefName: "fix/1-x",
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [
          { context: "deploy", state: "SUCCESS", createdAt: "2026-08-13T00:00:00Z" },
        ],
      },
    ]);
    expect(out).toBe("1 fix/1-x OPEN draft=false checks=SUCCESS@2026-08-13T00:00:00Z@deploy");
  });

  test("番号の無い PR は untracked", async () => {
    const out = await fold([
      {
        number: 8,
        headRefName: "scratch",
        state: "OPEN",
        isDraft: true,
        statusCheckRollup: [{ name: "lint", conclusion: "SUCCESS" }],
      },
    ]);
    expect(out).toBe("8 scratch OPEN draft=true checks=untracked");
  });

  test("rollup が空なら none（untracked と混ぜない）", async () => {
    const out = await fold([
      { number: 2, headRefName: "fix/2-x", state: "OPEN", isDraft: false, statusCheckRollup: [] },
    ]);
    expect(out).toBe("2 fix/2-x OPEN draft=false checks=none");
  });
});
