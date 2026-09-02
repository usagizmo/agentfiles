// `scripts/pr-list.jq` の抽出。欠落値を除外して次候補へ。読めない status は UNREADABLE。

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { classifyChecks } from "../src/checks.ts";
import { SNAPSHOT_SCHEMA, parseSnapshot, pullRequests } from "../src/decode.ts";

const JQ = join(import.meta.dir, "../scripts/pr-list.jq");

const SNAP = `--- schema ---
${SNAPSHOT_SCHEMA}
--- default ---
abc
--- landing tips ---
control origin/main def
--- landing local branches ---
control feat/1-x abc
--- live checkout (面 branch dirty(0/1/-) ahead behind) ---
control main 0 0 0
--- remote branches ---
origin/main
--- worktrees (面 dirty(0/1/-) head path) ---
control 0 abc /tmp/wt
--- sessions ---
x working
--- workspaces ---
ws-1 1 1 /tmp/wt
--- project status (board order) ---
1 1 進行中
--- issues ---
1 open abc alice
--- recent issue comments ---
1 2026-08-12T00:00:00Z plan
--- PRs ---
`;

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

  test("gh 形の実行中 CheckRun（空文字 conclusion + ゼロ時刻）は IN_PROGRESS として残る", async () => {
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
            conclusion: "",
            startedAt: "2026-08-13T22:00:00Z",
            completedAt: "0001-01-01T00:00:00Z",
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

  test("gh 形の実行中は decode → classifyChecks で running === 1", async () => {
    const line = await fold([
      {
        number: 951,
        headRefName: "chore/941-x",
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [
          {
            name: "Root gate (drift)",
            status: "IN_PROGRESS",
            conclusion: "",
            startedAt: "2026-08-13T22:00:00Z",
            completedAt: "0001-01-01T00:00:00.000000000Z",
          },
        ],
      },
    ]);
    const row = pullRequests(parseSnapshot(`${SNAP}${line}\n`))[0];
    if (row === undefined || row.checks === "untracked") throw new Error(line);
    expect(classifyChecks(row.checks)).toEqual({ running: 1, green: false });
  });

  test("欄が読めない check が混ざっても残った緑だけで green にならない", async () => {
    const line = await fold([
      {
        number: 3,
        headRefName: "fix/3-x",
        state: "OPEN",
        isDraft: false,
        statusCheckRollup: [
          { name: "lint", conclusion: "", status: "", state: "" },
          {
            name: "test",
            conclusion: "SUCCESS",
            status: "COMPLETED",
            completedAt: "2026-08-13T21:00:00Z",
          },
        ],
      },
    ]);
    expect(line).toBe(
      "3 fix/3-x OPEN draft=false checks=UNREADABLE@@lint|SUCCESS@2026-08-13T21:00:00Z@test",
    );
    const row = pullRequests(parseSnapshot(`${SNAP}${line}\n`))[0];
    if (row === undefined || row.checks === "untracked") throw new Error(line);
    expect(classifyChecks(row.checks)).toEqual({ running: 0, green: false });
  });
});
