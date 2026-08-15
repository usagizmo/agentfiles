// 面ごとの終端判定。**倒す向きは「完了と判定しない」側**であることを固定する。

import { describe, expect, test } from "bun:test";
import type { SurfaceFacts } from "../src/surfaces.ts";
import { deriveSurface, surfaceReported } from "../src/surfaces.ts";
import type { ReportRecord } from "../src/records.ts";
import type { Observed } from "../src/types.ts";
import { absent, present, unobservable } from "../src/types.ts";

const facts = (over: Partial<SurfaceFacts> = {}): SurfaceFacts => ({
  name: "o/r",
  usesPr: true,
  countsCapacity: true,
  aheadOfIntegration: present(true),
  head: present("aaa"),
  dirty: present(false),
  hasCheckout: present(true),
  liveCheckoutHealthy: present(true),
  prMerged: present(false),
  openPr: present(false),
  checksGreen: present(false),
  ...over,
});

const report = (
  heads: Record<string, string>,
  bases: Record<string, string> = {},
): Observed<ReportRecord> => present({ heads, bases, written: {} });

describe("PR を使う面", () => {
  test("17n: PR がまだ無い面は、着地してよくないことが確定している", () => {
    // `checksGreen` は PR が無いと `absent`。**それを「読めない」に畳まない** ——
    // 畳むと claim 済みで PR 前の課題（準備中・実装中の全部）が Conflict になり、
    // キューがそこで止まる。
    const s = deriveSurface(facts({ openPr: present(false), checksGreen: absent() }), absent());
    expect(s.landable).toEqual(present(false));
  });

  test("open PR はあるが checks を読めないなら、着地してよいかは判定できない", () => {
    const s = deriveSurface(facts({ openPr: present(true), checksGreen: absent() }), absent());
    expect(s.landable.kind).toBe("unobservable");
  });

  test("merged なら終端", () => {
    const s = deriveSurface(facts({ prMerged: present(true) }), absent());
    expect(s.terminal).toEqual(present(true));
  });

  test("open PR + 緑なら着地してよい（まだ終端ではない）", () => {
    const s = deriveSurface(facts({ openPr: present(true), checksGreen: present(true) }), absent());
    expect(s.landable).toEqual(present(true));
    expect(s.terminal).toEqual(present(false));
  });

  test("checks が赤なら着地してよいに達しない", () => {
    const s = deriveSurface(
      facts({ openPr: present(true), checksGreen: present(false) }),
      absent(),
    );
    expect(s.landable).toEqual(present(false));
  });

  test("PR を読めなければ終端にしない（観測できない側へ倒す）", () => {
    const s = deriveSurface(facts({ prMerged: unobservable("API が落ちた") }), absent());
    expect(s.terminal.kind).toBe("unobservable");
  });
});

describe("PR を使わない面", () => {
  const noPr = (over: Partial<SurfaceFacts> = {}) => facts({ usesPr: false, ...over });

  test("提出済みで未統合なら着地してよい。終端ではない", () => {
    const s = deriveSurface(
      noPr({ aheadOfIntegration: present(true), head: present("aaa") }),
      report({ "o/r": "aaa" }, { "o/r": "bbb" }),
    );
    expect(s.landable).toEqual(present(true));
    expect(s.terminal).toEqual(present(false));
  });

  test("提出済みの成果が統合先に入ったら終端", () => {
    const s = deriveSurface(
      noPr({ aheadOfIntegration: present(false), head: present("aaa") }),
      report({ "o/r": "aaa" }, { "o/r": "bbb" }),
    );
    expect(s.terminal).toEqual(present(true));
    expect(s.landable).toEqual(present(true));
  });

  test("透過は終端でも着地してよくもない", () => {
    const s = deriveSurface(
      noPr({ aheadOfIntegration: present(false), head: present("aaa") }),
      report({ "o/r": "aaa" }, { "o/r": "aaa" }),
    );
    expect(s.terminal).toEqual(present(false));
    expect(s.landable).toEqual(present(false));
  });

  test("commit があっても提出の証跡が無ければ終端にしない", () => {
    const s = deriveSurface(noPr(), absent());
    expect(s.terminal).toEqual(present(false));
  });

  test("提出のあとに書き足したら（head がずれたら）終端から落ちる", () => {
    const s = deriveSurface(noPr({ head: present("bbb") }), report({ "o/r": "aaa" }));
    expect(s.terminal).toEqual(present(false));
    expect(s.landable).toEqual(present(false));
  });

  test("branch が無くても heads ≠ bases だけでは終端にしない", () => {
    const s = deriveSurface(
      noPr({ aheadOfIntegration: present(false), head: absent() }),
      report({ "o/r": "aaa" }, { "o/r": "bbb" }),
    );
    expect(s.terminal).toEqual(present(false));
    expect(s.landable).toEqual(present(false));
  });

  test("まとめがあっても heads = bases なら終端にしない", () => {
    const s = deriveSurface(
      noPr({ aheadOfIntegration: present(false) }),
      report({ "o/r": "aaa" }, { "o/r": "aaa" }),
    );
    expect(s.terminal).toEqual(present(false));
  });

  test("まとめを読めなければ終端にしない", () => {
    const s = deriveSurface(noPr(), unobservable("コメントを読めない"));
    expect(s.terminal.kind).toBe("unobservable");
  });
});

describe("提出の証跡", () => {
  test("まとめが別の面しか持たなければ、その面は提出済みでない", () => {
    expect(surfaceReported("o/r", present("aaa"), report({ "o/other": "aaa" }))).toEqual(
      present(false),
    );
  });

  test("head を読めなければ判定しない", () => {
    expect(
      surfaceReported("o/r", unobservable("branch が無い"), report({ "o/r": "aaa" })).kind,
    ).toBe("unobservable");
  });

  test("head が無い（branch 削除）なら、記録にあれば提出済み", () => {
    expect(surfaceReported("o/r", absent(), report({ "o/r": "aaa" }))).toEqual(present(true));
  });
});
