// 計画との突き合わせ。**倒す向き**（不一致側・交差側）だけを固定する。

import { describe, expect, test } from "bun:test";
import {
  bodyMatchesPlan,
  planBases,
  planInvalidated,
  readyBases,
  readyStale,
} from "../src/plan.ts";
import { planRecord, readyRecord } from "../src/records.ts";
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

const CONTROL = "acme/control";
const at = (surface: string, ...paths: string[]) =>
  present(paths.map((path) => ({ surface, path })));

describe("計画の失効", () => {
  test("invalidationScope の下の変更は交差する（前方一致）", () => {
    const changed = at("acme/control", "agents/skills/conductor/SKILL.md");
    expect(planInvalidated(plan(BASE), changed, CONTROL)).toEqual(present(true));
  });

  test("範囲外の変更は交差しない", () => {
    expect(
      planInvalidated(plan(BASE), at("acme/control", "harnesses/claude/settings.json"), CONTROL),
    ).toEqual(present(false));
  });

  test("resourceKeys の名前に当たる path も交差する", () => {
    expect(planInvalidated(plan(BASE), at("acme/control", "conductor-tick/x.ts"), CONTROL)).toEqual(
      present(true),
    );
  });

  test("変更を読めなければ交差扱いにする（判定不能を「交差していない」へ倒さない）", () => {
    expect(planInvalidated(plan(BASE), unobservable("面の統合先を読めない"), CONTROL)).toEqual(
      present(true),
    );
  });

  test("他の面を指した項目は、この面の変更に当てない", () => {
    // `landing-surface.md`「面をまたぐ path の突き合わせ」の 3 行目。
    // 当てると、別 repo の同名 path が動くたびに計画が失効する。
    const scoped = plan(BASE.replace("- agents/skills/conductor", '- "acme/skills: agents"'));
    expect(planInvalidated(scoped, at("acme/control", "agents/x"), CONTROL)).toEqual(
      present(false),
    );
    expect(planInvalidated(scoped, at("acme/skills", "agents/x"), CONTROL)).toEqual(present(true));
  });

  test("接頭辞の無い項目は制御面の変更にだけ当たる", () => {
    expect(
      planInvalidated(plan(BASE), at("acme/skills", "agents/skills/conductor/x"), CONTROL),
    ).toEqual(present(false));
  });

  test("接頭辞が途中で切れている path は当たらない", () => {
    expect(
      planInvalidated(plan(BASE), at("acme/control", "agents/skills/conductor-other/x"), CONTROL),
    ).toEqual(present(false));
  });
});

describe("面ごとの base", () => {
  const record = (yaml: string) => {
    const r = plan(yaml);
    if (r.kind !== "present") throw new Error("計画を読めない");
    return r.value;
  };

  test("回すのはその課題の着地面だけ（座標表の全面ではない）", () => {
    // 全面を回すと、**制御面の SHA を持たない repo で必ず落ちて**判定不能になり、
    // 着地面が 2 面以上ある座標表では計画を持つ全課題が常に失効扱いになる。
    expect(planBases(record(BASE), ["acme/control"], CONTROL)).toEqual([
      { surface: "acme/control", base: "aaa" },
    ]);
  });

  test("制御面は baseSha、それ以外は landingBaseShas", () => {
    const two = record(`${BASE}\nlandingBaseShas:\n  acme/skills: bbb`);
    expect(planBases(two, ["acme/control", "acme/skills"], CONTROL)).toEqual([
      { surface: "acme/control", base: "aaa" },
      { surface: "acme/skills", base: "bbb" },
    ]);
  });

  test("landingBaseShas にキーが無い面は判定不能（交差扱いへ倒す材料）", () => {
    // **制御面は着地面に含まれなくても必ず見る**（`landing-surface.md`）。
    expect(planBases(record(BASE), ["acme/skills"], CONTROL)).toEqual([
      { surface: "acme/control", base: "aaa" },
      { surface: "acme/skills", base: undefined },
    ]);
  });
});

describe("在庫の鮮度", () => {
  // 判定の 5 つは `ready-record.md`「読むときの判定」。**記録が読めるかどうかだけで決めない** ——
  // 決めると、統合先が進んでも本文が変わっても計画済みのまま claim される。
  const ready = (yaml: string) =>
    readyRecord(`<!-- ready -->\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n<!-- /ready -->`);
  const R = `readySha: aaa
issueDigest: d1
invalidationScope:
  - agents/skills/conductor`;

  test("記録が無ければ陳腐化", () => {
    expect(readyStale(absent(), present([]), present("d1"), CONTROL)).toEqual(present(true));
  });

  test("記録を読めなければ陳腐化（fail-closed）", () => {
    expect(readyStale(ready("readySha: aaa"), present([]), present("d1"), CONTROL)).toEqual(
      present(true),
    );
  });

  test("交差も不一致も無ければ鮮度は保たれる", () => {
    expect(readyStale(ready(R), at("acme/control", "other/x"), present("d1"), CONTROL)).toEqual(
      present(false),
    );
  });

  test("readySha..default の変更が invalidationScope に交差すれば陳腐化", () => {
    expect(
      readyStale(
        ready(R),
        at("acme/control", "agents/skills/conductor/SKILL.md"),
        present("d1"),
        CONTROL,
      ),
    ).toEqual(present(true));
  });

  test("issueDigest が現在の本文と一致しなければ陳腐化", () => {
    expect(readyStale(ready(R), present([]), present("d2"), CONTROL)).toEqual(present(true));
  });

  test("本文を読めなければ陳腐化", () => {
    expect(readyStale(ready(R), present([]), unobservable("読めない"), CONTROL)).toEqual(
      present(true),
    );
  });

  test("面ごとの変更を読めなければ陳腐化", () => {
    expect(
      readyStale(ready(R), unobservable("面の統合先を読めない"), present("d1"), CONTROL),
    ).toEqual(present(true));
  });

  test("着地面のキーが landingReadyShas に無ければ判定不能（base が undefined）", () => {
    const r = ready(R);
    if (r.kind !== "present") throw new Error("記録を読めない");
    expect(readyBases(r.value, ["acme/skills"], CONTROL)).toEqual([
      { surface: "acme/control", base: "aaa" },
      { surface: "acme/skills", base: undefined },
    ]);
  });

  test("制御面は着地面に含まれなくても必ず見る", () => {
    const r = ready(`${R}\nlandingReadyShas:\n  acme/skills: bbb`);
    if (r.kind !== "present") throw new Error("記録を読めない");
    expect(readyBases(r.value, ["acme/skills"], CONTROL)).toEqual([
      { surface: "acme/control", base: "aaa" },
      { surface: "acme/skills", base: "bbb" },
    ]);
  });
});
