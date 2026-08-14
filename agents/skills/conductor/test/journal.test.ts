// 履歴の畳み。壊れた行は落とす。idle は追記しない。判断には使わない。

import { describe, expect, test } from "bun:test";
import {
  decisionEvent,
  openNotes,
  parseEvent,
  readJournal,
  recentOf,
  type JournalEvent,
} from "../src/journal.ts";
import type { Decision } from "../src/types.ts";

const decision = (
  over: Partial<Extract<JournalEvent, { kind: "decision" }>> = {},
): JournalEvent => ({
  kind: "decision",
  at: "2026-08-14T00:00:00Z",
  outcome: "action",
  why: "claim できる",
  action: "claim する",
  target: 1,
  members: [1],
  ...over,
});

const result = (status: "ok" | "env" | "gap", at = "2026-08-14T00:01:00Z"): JournalEvent => ({
  kind: "result",
  at,
  status,
});

describe("parseEvent", () => {
  test("壊れた行と空行は落とす", () => {
    expect(parseEvent("")).toBeUndefined();
    expect(parseEvent("{")).toBeUndefined();
    expect(parseEvent('{"kind":"note"}')).toBeUndefined();
  });

  test("decision と result を読む", () => {
    expect(parseEvent(JSON.stringify(decision()))).toEqual(decision());
    expect(parseEvent(JSON.stringify(result("ok")))).toEqual(result("ok"));
  });
});

describe("readJournal", () => {
  test("壊れた行を挟んでも残りを読む", () => {
    const text = `${JSON.stringify(decision())}\nnot-json\n${JSON.stringify(result("env"))}\n`;
    expect(readJournal(text)).toEqual([decision(), result("env")]);
  });
});

describe("recentOf", () => {
  test("後ろから N 件。直後の result を付ける", () => {
    const events = [
      decision({ at: "t1", target: 1, why: "one" }),
      result("ok", "t1r"),
      decision({ at: "t2", target: 2, why: "two" }),
      decision({ at: "t3", target: 3, why: "three" }),
      result("env", "t3r"),
    ];
    expect(recentOf(events, 2)).toEqual([
      { at: "t2", outcome: "action", why: "two", action: "claim する", target: 2 },
      {
        at: "t3",
        outcome: "action",
        why: "three",
        action: "claim する",
        target: 3,
        result: "env",
      },
    ]);
  });

  test("result だけの行は捨てる", () => {
    expect(recentOf([result("ok")])).toEqual([]);
  });

  test("note と clear は recent に入れない", () => {
    expect(
      recentOf([
        {
          kind: "note",
          at: "t",
          id: "a",
          title: "one",
          detail: "d",
          unblocks: "u",
          issues: [],
          noteKind: "env",
        },
        decision({ at: "t2" }),
        { kind: "clear", at: "t3", id: "a" },
      ]),
    ).toEqual([
      { at: "t2", outcome: "action", why: "claim できる", action: "claim する", target: 1 },
    ]);
  });
});

describe("openNotes", () => {
  test("clear の後は残らない。note 以外は無視する", () => {
    expect(
      openNotes([
        decision(),
        {
          kind: "note",
          at: "t",
          id: "a",
          title: "one",
          detail: "d",
          unblocks: "u",
          issues: [],
          noteKind: "env",
        },
        result("ok"),
        { kind: "clear", at: "t2", id: "a" },
      ]),
    ).toEqual([]);
  });
});

describe("decisionEvent", () => {
  test("idle は追記しない", () => {
    const idle: Decision = { conflicts: [], outcome: { kind: "idle" } };
    expect(decisionEvent(idle, "t")).toBeUndefined();
  });

  test("action の why と対象を残す", () => {
    const d: Decision = {
      conflicts: [],
      outcome: {
        kind: "action",
        params: { action: "claim する" },
        target: { representative: 4, members: [4, 5] },
        evidence: {
          progress: "未着手",
          runtime: "無し",
          capacity: "無し",
          ledger: "計画済み",
          why: "選出の条件が揃った",
        },
      },
    };
    expect(decisionEvent(d, "t")).toEqual({
      kind: "decision",
      at: "t",
      outcome: "action",
      why: "選出の条件が揃った",
      action: "claim する",
      target: 4,
      members: [4, 5],
    });
  });
});
