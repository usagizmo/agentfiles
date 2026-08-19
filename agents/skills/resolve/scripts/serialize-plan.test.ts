import { describe, expect, test } from "bun:test";
import { checkPlan, emitAndCheck, wrapPlan } from "./serialize-plan.ts";

const fields = {
  baseSha: "aaa",
  issueDigests: { "12": "d12" },
  size: "中規模",
  expectedWrites: ["agents/skills/conductor/src/decide.ts"],
  invalidationScope: ["agents/skills/conductor/src/decide.ts"],
  resourceKeys: [] as string[],
};

describe("serialize-plan", () => {
  test("生の pathname は投稿できる", () => {
    const r = emitAndCheck({
      ...fields,
      invalidationScope: ["docs/coding/シェルとトークン設計.md"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(checkPlan(r.body).ok).toBe(true);
  });

  test("git の quoted path は投稿前に止まる", () => {
    const quoted = "docs/coding/\\343\\202\\267\\343\\202\\247.md";
    const r = emitAndCheck({
      ...fields,
      invalidationScope: [quoted],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("quoted path");
  });

  test("行末の空白がある plan marker でも読める", () => {
    const body = "<!-- plan -->  \n```yaml\nbaseSha: aaa\n```\n<!-- /plan -->\n";
    expect(checkPlan(body).ok).toBe(true);
  });

  test("git octal を二重引用符の scalar に入れた本文は check が落とす", () => {
    const body = wrapPlan(
      [
        "baseSha: aaa",
        'issueDigests:\n  "12": d12',
        'invalidationScope:\n  - "docs/coding/\\343\\202\\267.md"',
        "resourceKeys: []",
      ].join("\n"),
    );
    const r = checkPlan(body);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toContain("yaml として読めない");
  });
});
