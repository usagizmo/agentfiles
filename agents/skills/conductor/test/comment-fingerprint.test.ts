// `scripts/comment-fingerprint.jq` の抽出。散文の字面は拾わない。

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { standaloneOpenMarkerNames } from "../src/standalone-line.ts";

const JQ = join(import.meta.dir, "../scripts/comment-fingerprint.jq");

const comment = (input: {
  readonly id: number;
  readonly issue: number;
  readonly updatedAt: string;
  readonly body: string;
}) => ({
  id: input.id,
  updated_at: input.updatedAt,
  issue_url: `https://api.github.com/repos/acme/x/issues/${String(input.issue)}`,
  body: input.body,
});

const fingerprint = async (board: string, comments: unknown): Promise<string> => {
  const p = Bun.spawn(["jq", "-r", "-f", JQ, "--arg", "board", board], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  p.stdin.write(JSON.stringify(comments));
  p.stdin.end();
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if (code !== 0) throw new Error(err || `jq exited ${code}`);
  return out.replace(/\n$/, "");
};

const wrap = (name: string) =>
  `前文\n<!-- ${name} -->\n\`\`\`yaml\nx: 1\n\`\`\`\n<!-- /${name} -->\n`;

describe("comment-fingerprint.jq", () => {
  test("散文の引用は marker 名に出ない", async () => {
    const out = await fingerprint("12", [
      comment({
        id: 1,
        issue: 12,
        updatedAt: "2026-08-12T00:00:00Z",
        body: "差し戻し。`<!-- wait -->` は `cleared`。\n| `<!-- claim -->` | 無し |",
      }),
    ]);
    expect(out).toBe("1 2026-08-12T00:00:00Z ");
  });

  test("単独行だけを拾い、行末の空白でも欠落しない", async () => {
    const out = await fingerprint("12", [
      comment({
        id: 2,
        issue: 12,
        updatedAt: "2026-08-12T00:00:00Z",
        body: "<!-- plan -->  \r\n中身",
      }),
    ]);
    expect(out).toBe("2 2026-08-12T00:00:00Z plan");
  });

  test("board 外のコメントを落とす", async () => {
    const out = await fingerprint("12", [
      comment({ id: 3, issue: 12, updatedAt: "2026-08-12T00:00:00Z", body: "<!-- plan -->" }),
      comment({ id: 4, issue: 99, updatedAt: "2026-08-12T00:00:00Z", body: "<!-- plan -->" }),
    ]);
    expect(out).toBe("3 2026-08-12T00:00:00Z plan");
  });

  test("専有記録だけの時刻を owned へ畳む", async () => {
    const owned = ["cycle", "retry", "yield", "integration"] as const;
    for (const name of owned) {
      const out = await fingerprint("12", [
        comment({ id: 10, issue: 12, updatedAt: "2026-08-12T00:00:00Z", body: wrap(name) }),
      ]);
      expect(out).toBe(`10 owned ${name}`);
    }
  });

  test("畳んではいけない marker の時刻は畳まない", async () => {
    const keep = [
      "claim",
      "wait",
      "plan",
      "ready",
      "intent",
      "report",
      "halt",
      "entry-block",
      "written",
      "unknown-marker",
    ] as const;
    for (const name of keep) {
      const out = await fingerprint("12", [
        comment({ id: 11, issue: 12, updatedAt: "2026-08-12T00:00:00Z", body: wrap(name) }),
      ]);
      expect(out).toBe(`11 2026-08-12T00:00:00Z ${name}`);
    }
  });

  test("専有記録と他工程の単独行が混在したら畳まない", async () => {
    const out = await fingerprint("12", [
      comment({
        id: 12,
        issue: 12,
        updatedAt: "2026-08-12T00:00:00Z",
        body: `${wrap("cycle")}\n${wrap("wait")}`,
      }),
    ]);
    expect(out).toBe("12 2026-08-12T00:00:00Z cycle,wait");
  });

  test("専有 marker の引用だけでは畳まない", async () => {
    const out = await fingerprint("12", [
      comment({
        id: 13,
        issue: 12,
        updatedAt: "2026-08-12T00:00:00Z",
        body: "まとめは `<!-- cycle -->` を付ける",
      }),
    ]);
    expect(out).toBe("13 2026-08-12T00:00:00Z ");
  });

  test("TypeScript と同じ入力で同じ marker 名になる", async () => {
    const bodies = [
      wrap("claim"),
      "差し戻し。`<!-- wait -->` は `cleared`。",
      "<!-- plan -->  \r\n中身",
      " <!-- wait -->\nインデント",
      `${wrap("cycle")}\n表の \`<!-- yield -->\``,
    ];
    for (const body of bodies) {
      const out = await fingerprint("12", [comment({ id: 20, issue: 12, updatedAt: "t", body })]);
      const jqNames = out.split(" ").slice(2).join(" ");
      expect(jqNames).toBe(standaloneOpenMarkerNames(body).join(","));
    }
  });
});
