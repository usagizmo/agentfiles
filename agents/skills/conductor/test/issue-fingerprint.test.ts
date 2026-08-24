// `scripts/issue-fingerprint.py` の抽出。`updated_at` を指紋に戻さない。

import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const PY = join(import.meta.dir, "../scripts/issue-fingerprint.py");

const sha = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");

const fingerprint = async (issues: unknown): Promise<string> => {
  const p = Bun.spawn(["python3", PY], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(JSON.stringify(issues));
  p.stdin.end();
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if (code !== 0) throw new Error(err || `python3 exited ${code}`);
  return out.replace(/\n$/, "");
};

describe("issue-fingerprint.py", () => {
  test("本文 digest を置き、空でも行は残す", async () => {
    const empty = sha("");
    const hello = sha("hello");
    const out = await fingerprint([
      {
        number: 12,
        state: "open",
        body: "hello",
        updated_at: "2026-08-12T00:00:00Z",
        assignees: [{ login: "alice" }],
      },
      { number: 34, state: "closed", body: null, assignees: [] },
    ]);
    expect(out).toBe(`12 open ${hello} alice\n34 closed ${empty} `);
  });

  test("PR を落とし、assignee は sort する", async () => {
    const d = sha("");
    const out = await fingerprint([
      {
        number: 1,
        state: "open",
        body: "",
        pull_request: { url: "https://api.github.com/repos/acme/x/pulls/1" },
        assignees: [],
      },
      {
        number: 2,
        state: "open",
        body: "",
        assignees: [{ login: "bob" }, { login: "alice" }],
      },
    ]);
    expect(out).toBe(`2 open ${d} alice,bob`);
  });
});
