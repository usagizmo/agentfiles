// 同時実行の上限。**「速い」ではなく「同時に何本立つか」を固定する。**
//
// 上限が効いていないことは結果からは見えない（全部同じ値が返る）ので、
// 走っている本数の最大値を数える。実測で 289 件の board が secondary rate limit に達した。

import { describe, expect, test } from "bun:test";
import { CONCURRENCY, mapLimit } from "../src/limit.ts";

/** 同時に走った本数の最大値を数えながら map する。 */
const withPeak = async (count: number, limit: number) => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit(
    Array.from({ length: count }, (_, i) => i),
    limit,
    async (n) => {
      running++;
      peak = Math.max(peak, running);
      await Promise.resolve();
      await Promise.resolve();
      running--;
      return n * 2;
    },
  );
  return { out, peak };
};

describe("mapLimit", () => {
  test("同時に走るのは上限まで", async () => {
    const { peak } = await withPeak(50, 4);
    expect(peak).toBeLessThanOrEqual(4);
  });

  test("上限まではちゃんと使う（1 本ずつに落とさない）", async () => {
    const { peak } = await withPeak(50, 4);
    expect(peak).toBe(4);
  });

  test("入力の順序で返す", async () => {
    const { out } = await withPeak(10, 3);
    expect(out).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  test("件数が上限より少なくても走る", async () => {
    const { out, peak } = await withPeak(2, 8);
    expect(out).toEqual([0, 2]);
    expect(peak).toBe(2);
  });

  test("空でも落ちない", async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  test("既定の同時実行数は 1 より大きく、board の件数に依らない定数", () => {
    expect(CONCURRENCY).toBeGreaterThan(1);
  });
});
