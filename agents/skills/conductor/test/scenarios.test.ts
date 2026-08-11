// `references/scenarios.md` の行とテストの対応をラチェットにする。
//
// SKILL.md は「期待の SSOT は `test/decide.test.ts` と `test/normalize.test.ts` で、
// `references/scenarios.md` は同じ行 ID の解説」と宣言している。**その対応を誰も検査していなかった。**
// 宣言だけあって検査が無いと、表が SSOT を名乗ったまま実装と黙って割れる。
//
// **UNPORTED は正確に一致させる**（部分集合では通さない）。緩めると、移していない行が
// 増えても緑のままになり、ラチェットが逆回りする。

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const HERE = import.meta.dir;

/** 表の行 ID。行頭が `| <数字>` の行だけを見る（節見出しと説明行を拾わない）。 */
const rowIds = (): Set<string> => {
  const md = readFileSync(join(HERE, "../references/scenarios.md"), "utf8");
  const ids = new Set<string>();
  for (const line of md.split("\n")) {
    const m = /^\|\s*([0-9]+[a-z]?[0-9]?)\s*\|/.exec(line);
    if (m?.[1] !== undefined) ids.add(m[1]);
  }
  return ids;
};

/** テスト名の先頭に置いた行 ID。`test("8d: ...")` の形だけを拾う。 */
const testedIds = (): Set<string> => {
  const ids = new Set<string>();
  for (const file of readdirSync(HERE)) {
    if (!file.endsWith(".test.ts")) continue;
    const src = readFileSync(join(HERE, file), "utf8");
    for (const m of src.matchAll(/\btest\(\s*"([0-9]+[a-z]?[0-9]?):/g)) {
      if (m[1] !== undefined) ids.add(m[1]);
    }
  }
  return ids;
};

/**
 * まだテストへ移していない行。**減らす方向にしか動かさない。**
 * 移したらここから消す。ここに足すのは、表へ行を増やしてテストを書かなかったときだけで、
 * それは「表が SSOT を名乗ったまま実装と割れる」ことそのものなので、原則やらない。
 */
const UNPORTED: readonly string[] = [
  "3c",
  "8",
  "8b",
  "8b2",
  "8b3",
  "8c",
  "9b",
  "9h",
  "9i",
  "9j",
  "10",
  "10b",
  "10c",
  "10d",
  "10f2",
  "10i",
  "10j",
  "10m",
  "10n",
  "10o",
  "10p",
  "10q",
  "10s",
  "10t",
  "10x",
  "12b",
  "12c",
  "12d",
  "12e",
  "13c",
  "13d",
  "13e",
  "13f",
  "13h",
  "13i",
  "14b",
  "14d",
  "14e",
  "14f",
  "14h",
  "15",
  "15c",
  "15f",
  "16",
  "16b",
  "16c",
  "16d",
  "16e",
  "16f",
  "16g",
  "17a",
  "17d",
  "17e",
  "17f",
  "17g",
  "17g3",
  "17j",
  "17l",
  "17m2",
];

const sorted = (s: Iterable<string>) => [...s].sort();

describe("代表シナリオとテストの対応", () => {
  test("テストの無い行は UNPORTED と正確に一致する", () => {
    const rows = rowIds();
    const tested = testedIds();
    const missing = sorted([...rows].filter((id) => !tested.has(id)));
    expect(missing).toEqual(sorted(UNPORTED));
  });

  test("表に無い行 ID を名乗るテストは無い", () => {
    const rows = rowIds();
    expect(sorted([...testedIds()].filter((id) => !rows.has(id)))).toEqual([]);
  });

  test("表の行を 1 件も読めていない状態を成功にしない", () => {
    expect(rowIds().size).toBeGreaterThan(100);
  });
});
