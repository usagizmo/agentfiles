// 同時実行の上限つき map。
//
// **観測は件数ぶん並行に投げない。**board の item 数だけ `gh` を同時に起動すると、
// primary の枠が残っていても secondary rate limit（短時間の大量リクエスト）に当たり、
// 観測そのものが落ちる（実測で、289 件の board が 1 tick で到達した）。
//
// **件数を絞って速くしない。**落とした項目だけで進む遷移が永久に起きない。
// 絞るのは同時に走る本数だけで、取る対象は全件のまま。

/** 既定の同時実行数。**外から変えられるようにしない** —— 調整点を増やすと環境ごとに挙動が割れる。 */
export const CONCURRENCY = 8;

/**
 * `items` を順に処理し、同時に走るのは高々 `limit` 本。**入力の順序で結果を返す。**
 * `Promise.all` と違い、投げる時点を制御する（`Promise.all` は全部同時に始まる）。
 */
export const mapLimit = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const item = items[i];
      if (item === undefined) continue;
      out[i] = await fn(item, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};
