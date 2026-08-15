// 緑と実行中の分類。`PASSING` と実行中の集合、同じ name の新しい `at` だけが残ることを固定する。

import { describe, expect, test } from "bun:test";
import { classifyChecks, type Check } from "../src/checks.ts";

const check = (over: Partial<Check> & Pick<Check, "status">): Check => ({
  name: over.name ?? "lint",
  at: over.at ?? "2026-08-13T00:00:00Z",
  status: over.status,
});

describe("classifyChecks", () => {
  test("SUCCESS と SKIPPED と NEUTRAL だけなら緑", () => {
    expect(
      classifyChecks([
        check({ name: "a", status: "SUCCESS" }),
        check({ name: "b", status: "SKIPPED" }),
        check({ name: "c", status: "NEUTRAL" }),
      ]),
    ).toEqual({ running: 0, green: true });
  });

  test("全部 SKIPPED でも緑", () => {
    expect(classifyChecks([check({ status: "SKIPPED" })])).toEqual({ running: 0, green: true });
  });

  test("IN_PROGRESS は実行中で、緑ではない", () => {
    expect(classifyChecks([check({ status: "IN_PROGRESS" })])).toEqual({
      running: 1,
      green: false,
    });
  });

  test("PENDING / QUEUED / REQUESTED も実行中", () => {
    expect(
      classifyChecks([
        check({ name: "a", status: "PENDING" }),
        check({ name: "b", status: "QUEUED" }),
        check({ name: "c", status: "REQUESTED" }),
      ]),
    ).toEqual({ running: 3, green: false });
  });

  test("全部 CANCELLED は緑ではない（行 9f）", () => {
    expect(
      classifyChecks([
        check({ name: "a", status: "CANCELLED" }),
        check({ name: "b", status: "CANCELLED" }),
      ]),
    ).toEqual({ running: 0, green: false });
  });

  test("WAITING / EXPECTED / STALE は実行中ではなく、緑でもない", () => {
    expect(classifyChecks([check({ status: "WAITING" })])).toEqual({ running: 0, green: false });
    expect(classifyChecks([check({ status: "EXPECTED" })])).toEqual({ running: 0, green: false });
    expect(classifyChecks([check({ status: "STALE" })])).toEqual({ running: 0, green: false });
  });

  test("FAILURE は緑を阻む", () => {
    expect(
      classifyChecks([
        check({ name: "a", status: "SUCCESS" }),
        check({ name: "b", status: "FAILURE" }),
      ]),
    ).toEqual({ running: 0, green: false });
  });

  test("checks が 0 件なら緑ではない", () => {
    expect(classifyChecks([])).toEqual({ running: 0, green: false });
  });

  test("同じ name の古い FAILURE は、新しい SUCCESS のあとに緑を阻まない", () => {
    expect(
      classifyChecks([
        check({ name: "lint", status: "FAILURE", at: "2026-08-13T00:00:00Z" }),
        check({ name: "lint", status: "SUCCESS", at: "2026-08-13T01:00:00Z" }),
      ]),
    ).toEqual({ running: 0, green: true });
  });

  test("同じ name の新しい IN_PROGRESS が、古い SUCCESS より勝つ", () => {
    expect(
      classifyChecks([
        check({ name: "lint", status: "SUCCESS", at: "2026-08-13T00:00:00Z" }),
        check({ name: "lint", status: "IN_PROGRESS", at: "2026-08-13T01:00:00Z" }),
      ]),
    ).toEqual({ running: 1, green: false });
  });
});
