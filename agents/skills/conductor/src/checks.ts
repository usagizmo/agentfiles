// 緑は `classifyChecks` 一箇所。呼び出し側で別の緑を作らない。
//
// 抽出は `scripts/pr-list.jq`。ここは畳みと分類だけ。

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

/** 緑を阻まない完了。 */
const PASSING = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

const isRunning = (status: string): boolean => RUNNING.has(status);

/** `at` が欠ける比較は曖昧。動いている側へ倒す。 */
const isNewer = (candidate: Check, prev: Check): boolean => {
  if (candidate.at !== "" && prev.at !== "") return candidate.at >= prev.at;
  if (isRunning(candidate.status) !== isRunning(prev.status)) {
    return isRunning(candidate.status);
  }
  if (candidate.at !== prev.at) return candidate.at !== "";
  return true;
};

const latestByName = (checks: readonly Check[]): readonly Check[] => {
  const latest = new Map<string, Check>();
  for (const check of checks) {
    const prev = latest.get(check.name);
    if (prev === undefined || isNewer(check, prev)) latest.set(check.name, check);
  }
  return [...latest.values()];
};

/**
 * 同じ name は新しい `at` だけ残してから、実行中と緑を出す。
 * 緑 = 1 件以上あり、実行中が 0、阻む値が 0。
 */
export const classifyChecks = (checks: readonly Check[]): ChecksVerdict => {
  const latest = latestByName(checks);
  const running = latest.filter((c) => isRunning(c.status)).length;
  const blocked = latest.some((c) => !isRunning(c.status) && !PASSING.has(c.status));
  return {
    running,
    green: latest.length > 0 && running === 0 && !blocked,
  };
};
