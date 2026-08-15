// checks の緑と実行中。**面の着地してよいと「checks を引き直させる」が同じ値を読む。**
//
// 抽出（`conclusion // status // state`）は `scripts/pr-list.jq`。ここは畳みと分類だけ。

export type Check = {
  readonly name: string;
  readonly status: string;
  readonly at: string;
};

export type ChecksVerdict = {
  readonly running: number;
  readonly green: boolean;
};

/** 機械が動いている状態。`WAITING` / `EXPECTED` / `STALE` は入れない。 */
const RUNNING = new Set(["QUEUED", "IN_PROGRESS", "PENDING", "REQUESTED"]);

/** 緑を阻まない完了。`gh pr checks` の pass / skipping。 */
const PASSING = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

const latestByName = (checks: readonly Check[]): readonly Check[] => {
  const latest = new Map<string, Check>();
  for (const check of checks) {
    const prev = latest.get(check.name);
    if (prev === undefined || check.at >= prev.at) latest.set(check.name, check);
  }
  return [...latest.values()];
};

/**
 * 同じ name は新しい `at` だけ残してから、実行中と緑を出す。
 * 緑 = 1 件以上あり、実行中が 0、阻む値が 0。
 */
export const classifyChecks = (checks: readonly Check[]): ChecksVerdict => {
  const latest = latestByName(checks);
  const running = latest.filter((c) => RUNNING.has(c.status)).length;
  const blocked = latest.some((c) => !RUNNING.has(c.status) && !PASSING.has(c.status));
  return {
    running,
    green: latest.length > 0 && running === 0 && !blocked,
  };
};
