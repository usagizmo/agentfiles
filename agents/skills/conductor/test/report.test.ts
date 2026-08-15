// `report` の妥当性。YAML の存在は提出ではない。

import { describe, expect, test } from "bun:test";
import { reportValid } from "../src/report.ts";
import type { ReportRecord } from "../src/records.ts";
import { present, unobservable } from "../src/types.ts";

const rec = (over: Partial<ReportRecord> = {}): ReportRecord => ({
  heads: { "o/r": "aaa" },
  bases: { "o/r": "bbb" },
  written: {},
  ...over,
});

const yes = () => present(true);
const no = () => present(false);

describe("reportValid", () => {
  test("bases..heads が非空で祖先なら妥当（written 無し）", async () => {
    expect(await reportValid(rec(), ["o/r"], new Map([["o/r", "tip"]]), yes)).toEqual(
      present(true),
    );
  });

  test("heads = bases で written が無ければ妥当でない", async () => {
    expect(
      await reportValid(
        rec({ heads: { "o/r": "aaa" }, bases: { "o/r": "aaa" } }),
        ["o/r"],
        new Map(),
        yes,
      ),
    ).toEqual(present(false));
  });

  test("heads = bases で written がいまの tip の祖先なら妥当", async () => {
    const r = rec({
      heads: { "o/r": "aaa" },
      bases: { "o/r": "aaa" },
      written: { "o/r": ["old"] },
    });
    const tips = new Map([["o/r", "tip"]]);
    expect(
      await reportValid(r, ["o/r"], tips, (_s, a, d) => present(a === "old" && d === "tip")),
    ).toEqual(present(true));
  });

  test("heads = bases で written が tip の祖先でなければ妥当でない", async () => {
    const r = rec({
      heads: { "o/r": "aaa" },
      bases: { "o/r": "aaa" },
      written: { "o/r": ["old"] },
    });
    expect(await reportValid(r, ["o/r"], new Map([["o/r", "tip"]]), no)).toEqual(present(false));
  });

  test("written があるのに tip が読めなければ unobservable", async () => {
    const r = rec({
      heads: { "o/r": "aaa" },
      bases: { "o/r": "aaa" },
      written: { "o/r": ["old"] },
    });
    expect((await reportValid(r, ["o/r"], new Map(), yes)).kind).toBe("unobservable");
  });

  test("written の SHA が tip と同一なら祖先判定せず妥当", async () => {
    const r = rec({
      heads: { "o/r": "aaa" },
      bases: { "o/r": "aaa" },
      written: { "o/r": ["tip"] },
    });
    expect(await reportValid(r, ["o/r"], new Map([["o/r", "tip"]]), no)).toEqual(present(true));
  });

  test("キーが着地面と一致しなければ妥当でない", async () => {
    expect(await reportValid(rec(), ["o/other"], new Map(), yes)).toEqual(present(false));
  });

  test("逆向きの祖先は妥当でない", async () => {
    expect(await reportValid(rec(), ["o/r"], new Map(), no)).toEqual(present(false));
  });

  test("祖先判定が読めなければ unobservable", async () => {
    const got = await reportValid(rec(), ["o/r"], new Map(), () => unobservable("git が落ちた"));
    expect(got.kind).toBe("unobservable");
  });
});
