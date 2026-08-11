// 計画との突き合わせ。**倒す向き**（不一致側・交差側）だけを固定する。

import { describe, expect, test } from "bun:test";
import { bodyMatchesPlan, planInvalidated } from "../src/plan.ts";
import { planRecord } from "../src/records.ts";
import type { Observed } from "../src/types.ts";
import { absent, present, unobservable } from "../src/types.ts";

const plan = (yaml: string) =>
  planRecord(`<!-- plan -->\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n<!-- /plan -->`);

const BASE = `baseSha: aaa
issueDigests:
  "12": d12
  "13": d13
invalidationScope:
  - agents/skills/conductor
resourceKeys:
  - conductor-tick
alsoResolves: [13]`;

describe("本文と計画の突き合わせ", () => {
  test("全員の digest が一致すれば一致", () => {
    const digests = new Map<number, Observed<string>>([
      [12, present("d12")],
      [13, present("d13")],
    ]);
    expect(bodyMatchesPlan(plan(BASE), digests)).toEqual(present(true));
  });

  test("キーが無い成員は不一致として扱う（fail-closed）", () => {
    const digests = new Map<number, Observed<string>>([[14, present("d14")]]);
    expect(bodyMatchesPlan(plan(BASE), digests)).toEqual(present(false));
  });

  test("本文を読めなければ判定しない", () => {
    const digests = new Map<number, Observed<string>>([[12, unobservable("API が落ちた")]]);
    expect(bodyMatchesPlan(plan(BASE), digests).kind).toBe("unobservable");
  });

  test("計画がまだ無い段では突き合わせない", () => {
    expect(bodyMatchesPlan(absent(), new Map())).toEqual(present(true));
  });

  test("計画コメントが壊れていれば判定しない", () => {
    expect(bodyMatchesPlan(plan("baseSha: aaa"), new Map()).kind).toBe("unobservable");
  });
});

describe("計画の失効", () => {
  test("invalidationScope の下の変更は交差する（前方一致）", () => {
    const changed = present(["agents/skills/conductor/SKILL.md"]);
    expect(planInvalidated(plan(BASE), changed)).toEqual(present(true));
  });

  test("範囲外の変更は交差しない", () => {
    expect(planInvalidated(plan(BASE), present(["harnesses/claude/settings.json"]))).toEqual(
      present(false),
    );
  });

  test("resourceKeys の名前に当たる path も交差する", () => {
    expect(planInvalidated(plan(BASE), present(["conductor-tick/x.ts"]))).toEqual(present(true));
  });

  test("変更を読めなければ交差扱いにする（判定不能を「交差していない」へ倒さない）", () => {
    expect(planInvalidated(plan(BASE), unobservable("面の統合先を読めない"))).toEqual(
      present(true),
    );
  });

  test("接頭辞が途中で切れている path は当たらない", () => {
    expect(planInvalidated(plan(BASE), present(["agents/skills/conductor-other/x"]))).toEqual(
      present(false),
    );
  });
});
