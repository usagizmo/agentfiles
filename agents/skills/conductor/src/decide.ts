// tick が 1 周で出す結論を、観測から一意に決める純関数。
//
// **`select` だけを切り出さない。**記録の精算は action の選択より前に走り、書いたら
// 観測からやり直す順序制約を持つ。そこを外に置くと、順序が prose に残る。
//
// **1 tick 1 action。**上から最初に当たった rung を 1 つだけ返す。

import type { IssueObservation } from "./observation.ts";
import { sessionActive } from "./observation.ts";
import {
  blocks,
  checkoutCount,
  holdsIntegration,
  holdsWrite,
  integrationLandingBroken,
  integrationLandingValid,
  integrationOccupied,
  intersect,
  planSlotUsage,
  surfaceCountsTowardCapacity,
} from "./resources.ts";
import {
  allSurfacesClean,
  hasWorkInProgress,
  ledgerAhead,
  ledgerBehind,
  normalize,
} from "./normalize.ts";
import type {
  ActionName,
  ActionParams,
  Conflict,
  Decision,
  LeaseKind,
  Ledger,
  MarkMatch,
  NormalizedIssue,
  Observed,
  Outcome,
  Progress,
  Runtime,
  Target,
  TargetRecords,
  Usage,
} from "./types.ts";

const value = <T>(o: Observed<T>): T | undefined => (o.kind === "present" ? o.value : undefined);

/** 硬い上限。**暴走は「賢さ」で防がない。外部の数値で止める。** */
export type TickConfig = {
  readonly maxActionsPerTick: number;
  readonly retryBudget: number;
  readonly emptyCycleBudget: number;
  /** 容量は**目安**であって停止条件ではない（超えても既存の課題は進める） */
  readonly capacityTarget: number;
  readonly planSlots: number;
};

export const DEFAULT_CONFIG: TickConfig = {
  maxActionsPerTick: 5,
  retryBudget: 3,
  emptyCycleBudget: 3,
  capacityTarget: 6,
  planSlots: 3,
};

export type TickInput = {
  readonly observations: readonly IssueObservation[];
  readonly config: TickConfig;
  /**
   * この tick で規約の穴に気づいたか。**検知そのものはメタ判断**なので純関数では出せない ——
   * skill 側（LLM）が渡す。同じ事実の open Issue が無いことも呼ぶ側が確かめる。
   */
  readonly specGap?: { readonly issue: number; readonly fact: string } | undefined;
  /** 座標表の面名 */
  readonly surfaceNames: readonly string[];
};

// ---------------------------------------------------------------------------
// group
// ---------------------------------------------------------------------------

/** **適用の単位は group**（正規化は Issue 単位、実体を触る action は代表の番号で 1 回）。 */
export type Group = {
  readonly representative: number;
  readonly members: readonly number[];
  readonly observations: readonly IssueObservation[];
  readonly records: readonly NormalizedIssue[];
  /** 代表の正規化レコード。ラダーの述語はここを読む */
  readonly lead: NormalizedIssue;
  readonly leadObservation: IssueObservation;
};

/**
 * その課題が同じ 1 本で直すと宣言している相手。
 *
 * **claim 済みなら記録の `members`、未 claim なら本文の宣言**（`same-branch.md`
 * 「どちらの集合を見るか」）。記録は代表にしか無いので、成員の側は本文から辿る。
 * **本文にだけ足された番号は claim 済みの対象集合に入らない**（次の着地まで別扱い）。
 */
const links = (o: IssueObservation): readonly number[] =>
  o.claimRecord.kind === "present" ? o.claimRecord.value.members : o.sameBranchAs;

/**
 * 共有する実体の観測を、対象集合の全員へ揃える（`same-branch.md`「共有するもの」）。
 *
 * **branch も worktree もセッションも記録も、代表の番号で 1 セットしか無い。**成員ごとに
 * 自分の番号で引くと、それらが 1 つも見えず全員が `未着手` に落ちる —— claim するたびに
 * 代表以外が `ledger が期待より先` になり、着地すれば終端の混在になる。
 *
 * **Issue 単位のまま残すもの**: 台帳・open / closed・Issue 契約・本文から引くもの・
 * 在庫の鮮度・`refine` のセッション（どれも成員ごとに別々に在る）。
 *
 * **claim 前には当てない。**代表がまだ決まっておらず、人待ちは渡された Issue に書かれる。
 */
const shareEvidence = (member: IssueObservation, lead: IssueObservation): IssueObservation =>
  member.issue === lead.issue
    ? member
    : {
        ...member,
        claimBranchExists: lead.claimBranchExists,
        planCommentExists: lead.planCommentExists,
        claimRecord: lead.claimRecord,
        surfaces: lead.surfaces,
        openPr: lead.openPr,
        checks: lead.checks,
        latestPrClosedUnmerged: lead.latestPrClosedUnmerged,
        prMerged: lead.prMerged,
        submissionEvidence: lead.submissionEvidence,
        session: lead.session,
        worktreeBusy: lead.worktreeBusy,
        worktreeOccupied: lead.worktreeOccupied,
        waitRecord: lead.waitRecord,
        waitRecordCreatedAt: lead.waitRecordCreatedAt,
        pauseRecordExists: lead.pauseRecordExists,
        yieldRecord: lead.yieldRecord,
        intentRecord: lead.intentRecord,
        integrationRecordCount: lead.integrationRecordCount,
        integrationRecord: lead.integrationRecord,
        prunableWorkspace: lead.prunableWorkspace,
        failureRecord: lead.failureRecord,
        cycleRecord: lead.cycleRecord,
        currentMark: lead.currentMark,
        planInvalidated: lead.planInvalidated,
        resourceKeys: lead.resourceKeys,
        blocksEntry: lead.blocksEntry,
        claimedAt: lead.claimedAt,
      };

/**
 * 対象集合（claim 済み）または group（未 claim）の連結成分。
 * **代表は記録の `representative`、無ければ最小番号**（固定の規約は `same-branch.md`）。
 */
export const buildGroups = (observations: readonly IssueObservation[]): Group[] => {
  const byIssue = new Map(observations.map((o) => [o.issue, o]));
  // **無向グラフにしてから辿る。**記録は代表にしか無く、本文の相互記載も漏れうるので、
  // 片側からしか張られていない辺が実在する。有向のまま辿ると、走査の順で group が割れる。
  const edges = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (a === b) return;
    (edges.get(a) ?? edges.set(a, new Set()).get(a))?.add(b);
    (edges.get(b) ?? edges.set(b, new Set()).get(b))?.add(a);
  };
  for (const o of observations) for (const n of links(o)) link(o.issue, n);

  const seen = new Set<number>();
  const groups: Group[] = [];

  for (const o of observations) {
    if (seen.has(o.issue)) continue;
    const members: number[] = [];
    const queue = [o.issue];
    while (queue.length > 0) {
      const current = queue.pop();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      members.push(current);
      for (const linked of edges.get(current) ?? []) if (!seen.has(linked)) queue.push(linked);
    }
    members.sort((a, b) => a - b);
    const raw = members.map((n) => byIssue.get(n)).filter((x) => x !== undefined);
    if (raw.length === 0) continue;

    const claim = raw.find((x) => x.claimRecord.kind === "present")?.claimRecord;
    const representative =
      claim?.kind === "present" ? claim.value.representative : (members[0] ?? o.issue);
    const leadIndex = Math.max(
      0,
      raw.findIndex((g) => g.issue === representative),
    );
    const leadObservation = raw[leadIndex];
    if (leadObservation === undefined) continue;
    // **共有の反映は claim 済みのときだけ**（claim 前は記録が成員ごとに別々に在る）。
    const groupObservations =
      claim?.kind === "present" ? raw.map((x) => shareEvidence(x, leadObservation)) : raw;
    const records = groupObservations.map(normalize);
    const lead = records[leadIndex];
    if (lead === undefined) continue;
    groups.push({
      representative,
      members,
      observations: groupObservations,
      records,
      lead,
      leadObservation,
    });
  }
  return groups;
};

const target = (g: Group): Target => ({ representative: g.representative, members: g.members });

// ---------------------------------------------------------------------------
// 述語
// ---------------------------------------------------------------------------

const TERMINAL: readonly Progress[] = ["着地済み", "取り下げ"];
const WRITE_STAGES: readonly Progress[] = ["準備済み", "実装中", "提出中"];
/** write を渡す周。`準備中` は保持しないが周には入る（行 10q）。 */
const WRITE_PASS_STAGES: readonly Progress[] = ["準備中", "準備済み", "実装中", "提出中"];
const RESTART_ACTIONS: readonly ActionName[] = [
  "claim する",
  "解決を起こし直す",
  "計画を起こす",
  "計画を起こし直す",
];

export type EmptyCycleInput = {
  readonly action: ActionName;
  readonly lease?: LeaseKind;
  readonly progress: Progress;
  readonly checks: Observed<{ readonly running: number; readonly green: boolean }>;
};

const emptyCycleKind = (input: EmptyCycleInput): "write" | "restart" | undefined => {
  if (input.action === "枠を渡す" && input.lease !== "integration") return "write";
  if (RESTART_ACTIONS.includes(input.action)) return "restart";
  return undefined;
};

/**
 * `着地待ち` と、実行中の checks がある `提出中` を外す。
 * **`提出中` を無条件では外さない** —— checks が 0 件の `提出中` は待ちではなく詰まり。
 */
const excludedFromEmptyCycle = (input: EmptyCycleInput): boolean => {
  if (input.progress === "着地待ち") return true;
  if (input.progress === "提出中") {
    return input.checks.kind === "present" && input.checks.value.running > 0;
  }
  return false;
};

/**
 * 回すことに成功したあと、周回の記録の `count` を +1 するか。
 * 指紋の一致と成功は呼び出し側（`protocols.md` の更新順）が見る。
 *
 * 除外は write を渡す周と起こす周の**どちらにも**掛かる。write 側だけに縮めると
 * 行 10f6 / 10g2 が落ちる。
 */
export const countsEmptyCycle = (input: EmptyCycleInput): boolean => {
  const kind = emptyCycleKind(input);
  if (kind === undefined) return false;
  if (kind === "write" && !WRITE_PASS_STAGES.includes(input.progress)) return false;
  return !excludedFromEmptyCycle(input);
};

/** 伝える 2 つ。受け手が `稼働中` の周では失敗カウントも退避も掛けない。 */
const isTellTwo = (name: string | null): boolean =>
  name === "本文の変更を伝える" || name === "計画の失効を伝える";

/** 伝える 2 つの受け手がいま書いている。加算と退避の免除はこれを共有する。 */
const tellRecipientWorking = (name: string | null, runtime: Runtime): boolean =>
  isTellTwo(name) && runtime === "稼働中";

export type FailureCountInput = {
  readonly action: ActionName;
  readonly runtime: Runtime;
};

/**
 * この action が成功したあと、失敗の記録の `count` を +1 するか。
 * 実行側はこれを読む。`runtime` を引き直さない。
 *
 * 伝える 2 つは受け手が `稼働中` なら偽。`計画枠の逼迫を伝える` は常に真。
 */
export const countsFailure = (input: FailureCountInput): boolean => {
  if (isTellTwo(input.action)) return !tellRecipientWorking(input.action, input.runtime);
  return input.action === "計画枠の逼迫を伝える";
};

/** group 内で終端と非終端が混在しているか。共有実体をどちらに倒しても壊れる。 */
const terminalMixedInGroup = (g: Group): boolean => {
  const terminal = g.records.filter((r) => TERMINAL.includes(r.progress)).length;
  return terminal > 0 && terminal < g.records.length;
};

/** `ledger` が `退避先`。当てる rung はこれを見ていないものだけ。 */
const isShelved = (g: Group): boolean => g.lead.ledger === "退避先";

const validWaiting = (o: IssueObservation): boolean =>
  o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid";

const sessionAlive = (g: Group): boolean => g.leadObservation.session.kind !== "none";

const failure = (g: Group) =>
  value(g.leadObservation.failureRecord) ?? { count: 0, lastAction: null };
const cycle = (g: Group) => value(g.leadObservation.cycleRecord) ?? { count: 0, mark: null };

/** **照合は action を選ぶより前**。指紋を作れない周は照合を飛ばすだけで、選択は続ける。 */
const markUnchanged = (g: Group): boolean => {
  const current = value(g.leadObservation.currentMark);
  const recorded = cycle(g).mark;
  return current !== undefined && recorded !== null && current === recorded;
};

/** 指紋を作れない周と、記録が壊れている周を `changed` へ畳まない。 */
export const markMatchOf = (o: IssueObservation): MarkMatch => {
  if (o.currentMark.kind !== "present") return "unknown";
  if (o.cycleRecord.kind === "unobservable" || o.cycleRecord.kind === "invalid") return "unknown";
  const recorded = o.cycleRecord.kind === "present" ? o.cycleRecord.value.mark : null;
  if (recorded === null) return "changed";
  return o.currentMark.value === recorded ? "same" : "changed";
};

const recordsOf = (g: Group): TargetRecords => ({
  currentMark: g.leadObservation.currentMark,
  markMatch: markMatchOf(g.leadObservation),
  cycle: g.leadObservation.cycleRecord,
  failure: g.leadObservation.failureRecord,
});

// ---------------------------------------------------------------------------
// 差し戻し
// ---------------------------------------------------------------------------

const REVERTABLE: readonly Ledger[] = ["未計画", "計画済み", "進行中"];

/**
 * **排他ラダー**。上から読み、最初に当たった行が勝つ。**上限に達した行を上に置く。**
 * `ledger` の範囲は行ごとに持つ（全行共通の 1 文へ外出ししない）。
 */
const revertTarget = (
  g: Group,
  config: TickConfig,
): "未計画" | "計画済み" | "退避先" | undefined => {
  const r = g.lead;
  const o = g.leadObservation;

  if (
    REVERTABLE.includes(r.ledger) &&
    failure(g).count >= config.retryBudget &&
    failure(g).lastAction !== "計画枠の逼迫を伝える" &&
    !tellRecipientWorking(failure(g).lastAction, r.runtime)
  ) {
    return "退避先";
  }

  // **正規化後の `runtime` では引かない** —— 人待ちの記録があると生きたセッションでも
  // `人待ち` に写るので、起こした直後の実行器を結果が出る前に落とす。
  if (
    REVERTABLE.includes(r.ledger) &&
    cycle(g).count >= config.emptyCycleBudget &&
    markUnchanged(g) &&
    !validWaiting(o) &&
    !sessionActive(o.session)
  ) {
    return "退避先";
  }

  // **「claim の痕跡」は claim の記録で引く**（`未着手` なら claim branch は無い）。
  if (
    (r.ledger === "計画済み" || r.ledger === "進行中") &&
    r.progress === "未着手" &&
    o.claimRecord.kind === "present" &&
    value(o.issueContractComplete) === true
  ) {
    return "計画済み";
  }

  // **claim の記録の有無では絞らない** —— 計画工程が契約を埋め損ねた形が沈黙する。
  if (
    (r.ledger === "計画済み" || r.ledger === "進行中") &&
    value(o.issueContractComplete) === false &&
    !hasArtifacts(g)
  ) {
    return "未計画";
  }

  return undefined;
};

/**
 * 在庫の陳腐化。**この事象だけ戻す単位が Issue** —— 鮮度の記録は成員ごとに別々に書かれるので、
 * group へ畳むと古くなっていない成員まで一緒に戻る。ラダー上は `revertTarget` の直後に置く
 * （4 事象より下位という順序を保つ）。
 *
 * **claim が構造的に止まっているあいだは評価しない。**
 */
const stockStale = (g: Group, ctx: Context): boolean =>
  g.lead.ledger === "計画済み" &&
  g.lead.progress === "未着手" &&
  // **停止の判定は成員ではなく group で行う。**`unit: "issue"` は solo group を渡すので、
  // そのまま評価すると「group の一部だけが計画済み」という停止が消え、揃っていない
  // group の計画済み側が交差のたびに未計画へ戻される。
  !claimStructurallyBlocked(parentOf(g, ctx), ctx) &&
  value(g.leadObservation.readyRecordStale) === true;

/** solo group から元の group を引く。`unit: "issue"` の rung が group の述語を使うときだけ要る。 */
const parentOf = (g: Group, ctx: Context): Group =>
  ctx.groups.find((x) => x.members.includes(g.representative)) ?? g;

/** **述語は `normalize` の 1 つだけ**。ここで書き直すと `実装中` の判定と割れる。 */
const hasArtifacts = (g: Group): boolean =>
  g.observations.some((o) => hasWorkInProgress(o.surfaces));

// ---------------------------------------------------------------------------
// 選出
// ---------------------------------------------------------------------------

/**
 * claim 済みか。記録か remote branch のどれか 1 つ。
 * 成員と代表は `buildGroups` が同じ group に載せているので、ここで辿り直さない。
 */
const alreadyClaimed = (g: Group): boolean =>
  g.observations.some(
    (o) => o.claimRecord.kind === "present" || value(o.claimBranchExists) === true,
  );

/** 代表の、数える面の checkout 本数。成員では増やさない。 */
const countedCapacityOf = (g: Group): number =>
  g.leadObservation.surfaces.filter((s) => surfaceCountsTowardCapacity(g.lead, s)).length;

/** claim したときに増える数える本数。checkout の有無では引かない。 */
const capacityIncrement = (g: Group): number =>
  g.leadObservation.surfaces.filter((s) => s.countsCapacity).length;

/** 着地面が解決できる。読めた面だけを含める。 */
const landingResolved = (g: Group): boolean =>
  g.observations.every(
    (o) => o.surfaces.length > 0 && o.surfaces.every((s) => s.terminal.kind === "present"),
  );

/** claim の前提のうち、台帳と claim 痕跡以外。 */
const claimPreconditions = (
  g: Group,
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
  opts: { readonly contract: "all" | "planned" } = { contract: "all" },
): boolean => {
  if (!g.observations.every((o) => value(o.open) === true)) return false;
  if (!dependenciesResolved(g, all, byIssue)) return false;
  if (!landingResolved(g)) return false;
  return g.records.every((r, i) => {
    if (opts.contract === "planned" && r.ledger !== "計画済み") return true;
    const complete = g.observations[i]?.issueContractComplete;
    return complete !== undefined && value(complete) === true;
  });
};

const usageOf = (
  groups: readonly Group[],
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
  observations: readonly IssueObservation[],
  config: TickConfig,
  excluded: ReadonlySet<number>,
): Usage => {
  const counted = groups.reduce((total, g) => total + countedCapacityOf(g), 0);
  return {
    counted,
    checkouts: checkoutCount(observations),
    supply: groups.filter((g) => countsAsSupply(g, all, byIssue, excluded)).length,
    supplyTarget: Math.max(0, config.capacityTarget - counted) + config.planSlots,
  };
};

/**
 * 完了すれば claim できるようになる group か。
 * 自分側の欠けは落とす。入場停止・容量待ち・write 交差では落とさない。
 */
const countsAsSupply = (
  g: Group,
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
  excluded: ReadonlySet<number>,
): boolean => {
  if (g.members.some((n) => excluded.has(n))) return false;
  if (g.lead.ledger === "退避先") return false;
  if (g.observations.some((o) => o.retiredRefineExists)) return false;
  if (g.observations.some((o) => o.refineSession.kind !== "none" && validWaiting(o))) {
    return false;
  }
  if (alreadyClaimed(g)) return false;
  const remainingCovered = g.records.every((r, i) => {
    if (r.ledger === "計画済み") return true;
    return g.observations[i]?.refineSession.kind !== "none";
  });
  if (!remainingCovered) return false;
  return claimPreconditions(g, all, byIssue, { contract: "planned" });
};

const dependenciesResolved = (
  g: Group,
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
): boolean =>
  g.observations.every((o) =>
    o.dependsOn.every((n) => {
      const record = all.find((r) => r.issue === n);
      if (record === undefined) return false;
      // **解消 = `着地済み`、または closed かつ `完了`**（片付けが終端の証跡を消すため）。
      if (record.progress === "着地済み") return true;
      const dep = byIssue.get(n);
      return dep !== undefined && value(dep.open) === false && record.ledger === "完了";
    }),
  );

/** **「選出の条件」は `resolve` の候補 1 件について真偽を決めるものすべて。** */
const selectable = (
  g: Group,
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
): boolean => {
  if (!g.records.every((r) => r.ledger === "計画済み")) return false;
  if (alreadyClaimed(g)) return false;
  return claimPreconditions(g, all, byIssue);
};

/**
 * **「claim する」の条件のうち、容量以外のどれかが偽であること。**
 * **容量は含めない** —— 枠が無いだけの在庫は claim の前提が揃っていて、
 * そこは在庫の鮮度が守っている対象そのもの。
 */
const claimStructurallyBlocked = (g: Group, ctx: Context): boolean => {
  if (!selectable(g, ctx.all, ctx.byIssue)) return true;
  return claimCrossesWriteHolders(g, ctx);
};

// ---------------------------------------------------------------------------
// 順序
// ---------------------------------------------------------------------------

/**
 * **他をブロックしている数が多いものを先に取る**。同数ならボード上の並び順。
 * **数えるのは、解ければ実際に動き出すものだけ** —— `退避先` は人が動かすまで動かない。
 */
const blockingCount = (g: Group, groups: readonly Group[]): number =>
  groups.filter(
    (other) =>
      !isShelved(other) &&
      other.representative !== g.representative &&
      other.observations.some((o) => o.dependsOn.some((n) => g.members.includes(n))),
  ).length;

const byPriority = (groups: readonly Group[]) => (a: Group, b: Group) => {
  const diff = blockingCount(b, groups) - blockingCount(a, groups);
  if (diff !== 0) return diff;
  return a.leadObservation.boardOrder - b.leadObservation.boardOrder;
};

/**
 * 「計画を起こす」の match から計画枠の条件だけを外したもの。
 * 飽和の述語はこれを複製せず、この関数を共有する。
 */
const planStartable = (g: Group, ctx: Context): boolean => {
  if (isShelved(g)) return false;
  if (g.lead.ledger !== "未計画" || g.lead.progress !== "未着手") return false;
  if (g.leadObservation.refineSession.kind !== "none" || g.leadObservation.retiredRefineExists)
    return false;
  if (g.leadObservation.waitRecord.kind === "waiting") return false;
  return ctx.supply < ctx.supplyTarget;
};

/** 枠を占めている有効な人待ち refine。 */
const waitingOccupant = (g: Group): boolean =>
  g.leadObservation.refineSession.kind !== "none" && validWaiting(g.leadObservation);

/**
 * この経路で退避を始めたが三拍子が揃っていない。
 * 飽和が一時的に解けても、始めた対象は完成させる。
 */
const incompleteRetreat = (g: Group): boolean => {
  if (g.lead.ledger !== "退避先") return false;
  if (failure(g).lastAction !== "計画枠の逼迫を伝える") return false;
  return validWaiting(g.leadObservation) || g.leadObservation.refineSession.kind !== "none";
};

const retreatComplete = (g: Group): boolean =>
  g.lead.ledger === "退避先" &&
  !validWaiting(g.leadObservation) &&
  g.leadObservation.refineSession.kind === "none";

const asSolo = (g: Group): Group[] =>
  g.observations.flatMap((o, i) => {
    const record = g.records[i];
    return record === undefined
      ? []
      : [
          {
            representative: o.issue,
            members: [o.issue],
            observations: [o],
            records: [record],
            lead: record,
            leadObservation: o,
          } satisfies Group,
        ];
  });

const waitAge = (g: Group): number =>
  value(g.leadObservation.waitRecordCreatedAt) ?? Number.MAX_SAFE_INTEGER;

const olderWait = (a: Group, b: Group): number => {
  const left = waitAge(a);
  const right = waitAge(b);
  return left === right ? a.representative - b.representative : left - right;
};

const promptPlanSlotRetreat = (g: Group, ctx: Context): boolean => {
  const solos = ctx.groups.flatMap(asSolo);
  if (incompleteRetreat(g)) {
    const open = solos.filter(incompleteRetreat);
    return open.sort(olderWait)[0]?.representative === g.representative;
  }
  if (ctx.planSlotsUsed < ctx.config.planSlots) return false;
  if (!waitingOccupant(g)) return false;
  if (!solos.some((other) => planStartable(other, ctx))) return false;
  const occupants = solos.filter(waitingOccupant);
  return occupants.sort(olderWait)[0]?.representative === g.representative;
};

// ---------------------------------------------------------------------------
// ラダー
// ---------------------------------------------------------------------------

type Rung = {
  /** **`ctx.config` で組み立てる。**`DEFAULT_CONFIG` を直接読むと `match` と判定がずれる。 */
  readonly params: (g: Group, ctx: Context) => ActionParams;
  readonly why: string;
  readonly match: (g: Group, ctx: Context) => boolean;
  /**
   * 適用の単位。既定は group（**実体を触る action は代表の番号で 1 回**）。
   * **`refine` を起こす / 片付ける / 計画枠の逼迫を伝えるだけが Issue 単位** ——
   * `refine-<番号>` は Issue ごとで worktree を持たないので、group へ畳むと
   * **揃っていない group の未計画側が永久に計画されない**。
   */
  readonly unit?: "issue";
};

type Context = {
  readonly groups: readonly Group[];
  readonly all: readonly NormalizedIssue[];
  readonly byIssue: Map<number, IssueObservation>;
  readonly config: TickConfig;
  readonly counted: number;
  readonly planSlotsUsed: number;
  readonly supply: number;
  readonly supplyTarget: number;
  readonly entryBlocked: boolean;
  readonly input: TickInput;
  readonly excluded: ReadonlySet<number>;
  readonly surfaceNames: readonly string[];
};

/** 交差する write 保持者。**対象集合自身は除く**（保持者への渡し直しがあるため）。 */
const crossingWriteHolders = (g: Group, ctx: Context): Group[] =>
  ctx.groups.filter(
    (other) =>
      other.representative !== g.representative &&
      holdsWrite(other.lead) &&
      blocks(intersect(g.leadObservation.resourceKeys, other.leadObservation.resourceKeys)),
  );

/**
 * 候補のキーが読めて、いまの write 保持者と交わる。
 * **読めなければ止めない** —— 倒すと計画コメントの無い在庫が全部止まる。
 */
const claimCrossesWriteHolders = (g: Group, ctx: Context): boolean => {
  if (g.leadObservation.resourceKeys.kind !== "present") return false;
  return crossingWriteHolders(g, ctx).length > 0;
};

/** 「claim する」の match と同一。譲位の判定が別実装になると、譲った先が空になる。 */
const canClaim = (g: Group, ctx: Context): boolean => {
  if (isShelved(g)) return false;
  if (!selectable(g, ctx.all, ctx.byIssue)) return false;
  if (ctx.counted >= ctx.config.capacityTarget && capacityIncrement(g) > 0) return false;
  if (claimCrossesWriteHolders(g, ctx)) return false;
  return !ctx.entryBlocked;
};

/**
 * `提出中` × checks 緑 × 全面 clean × 有効な `report` が無い。
 * **`runtime` は見ない** —— 渡す本文の欠けは成果物側の事実。
 */
const needsSubmissionReport = (g: Group): boolean => {
  if (g.lead.progress !== "提出中") return false;
  const checks = value(g.leadObservation.checks);
  if (checks === undefined || checks.running !== 0 || !checks.green) return false;
  if (!allSurfacesClean(g.leadObservation.surfaces)) return false;
  return value(g.leadObservation.submissionEvidence) !== true;
};

const sharedKeys = (
  a: Observed<readonly string[]>,
  b: Observed<readonly string[]>,
): readonly string[] | undefined => {
  const left = value(a);
  const right = value(b);
  if (left === undefined || right === undefined) return undefined;
  return left.filter((key) => right.includes(key));
};

const sameKeySet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return false;
  for (const key of left) if (!right.has(key)) return false;
  return true;
};

/** 記録の `to` / `keys` が、この 2 者のいまの交差を記述しているか。 */
const yieldDescribesPair = (holder: Group, partner: Group): boolean => {
  const rec = holder.leadObservation.yieldRecord;
  if (rec.kind !== "present") return false;
  if (rec.value.to !== partner.representative && !partner.members.includes(rec.value.to)) {
    return false;
  }
  const shared = sharedKeys(
    holder.leadObservation.resourceKeys,
    partner.leadObservation.resourceKeys,
  );
  if (shared === undefined) return false;
  return sameKeySet(rec.value.keys, shared);
};

/** 交差相手のすべてについて、どちらかの yield が現況を記述しているか。 */
const crossingDescribed = (g: Group, crossing: readonly Group[]): boolean =>
  crossing.every((partner) => yieldDescribesPair(g, partner) || yieldDescribesPair(partner, g));

/**
 * 位置に依らない Conflict。**ラダーへ乗せない** —— どの rung より先に、その group を
 * 選出対象外にする。`ledger が期待より先` だけは差し戻しの後でなければ判定できないので
 * ラダー上に残る（そちらも当たった group を選出対象外にする）。
 */
const standingConflicts = (g: Group): Conflict[] => {
  const found: Conflict[] = g.records.flatMap((r) => [...r.conflicts]);
  if (terminalMixedInGroup(g)) {
    found.push({
      reason: "group の終端が混在",
      evidence: ["group 内で終端と非終端が混在している"],
      issues: g.members,
    });
  }
  return found;
};

const sameEvidence = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((s, i) => s === b[i]);

/** reason + evidence が同じものを 1 件にし、`issues` に番号を集める。選出対象外は畳まない。 */
const foldConflicts = (xs: readonly Conflict[]): Conflict[] => {
  const out: { reason: Conflict["reason"]; evidence: readonly string[]; issues: number[] }[] = [];
  for (const c of xs) {
    const hit = out.find((x) => x.reason === c.reason && sameEvidence(x.evidence, c.evidence));
    if (hit === undefined) {
      out.push({ reason: c.reason, evidence: c.evidence, issues: [...c.issues] });
      continue;
    }
    for (const n of c.issues) {
      if (!hit.issues.includes(n)) hit.issues.push(n);
    }
  }
  return out.map((c) => ({
    reason: c.reason,
    evidence: c.evidence,
    issues: [...c.issues].sort((a, b) => a - b),
  }));
};

const LADDER: readonly Rung[] = [
  {
    params: () => ({ action: "規約の穴を起票する" }),
    why: "この tick で規約の穴に当たった",
    match: (g, ctx) => ctx.input.specGap?.issue === g.representative,
  },
  {
    params: () => ({ action: "片付ける" }),
    why: "片付ける対象が残っている",
    match: (g) => {
      const r = g.lead;
      const o = g.leadObservation;
      const done = TERMINAL.includes(r.progress);
      if (!done) return false;
      // **片付ける対象が全部消えるまで当たり続ける述語にする**（branch も入れる）。
      return (
        r.capacity !== "無し" ||
        sessionAlive(g) ||
        value(o.claimBranchExists) === true ||
        o.waitRecord.kind === "waiting" ||
        holdsIntegration(o) ||
        cycle(g).count > 0 ||
        cycle(g).mark !== null
      );
    },
  },
  {
    params: () => ({ action: "計画セッションを片付ける" }),
    unit: "issue",
    why: "計画セッションが残って計画枠を焼いている",
    match: (g, ctx) => {
      const o = g.leadObservation;
      if (o.refineSession.kind === "none") return false;
      if (g.lead.runtime === "人待ち") return false;
      // **走っている計画セッションには当てない。`ledger` で絞らない。**
      // `runtime` は `resolve-<番号>` から導くので計画中は必ず `無し` になり、そちらでは
      // 一度も止められない。`refine` は Status を進めてから終わるので `計画済み` の窓も通る ——
      // 絞ると、起こす → 次の tick で畳む → また起こす、の往復から出られない。
      if (sessionActive(o.refineSession)) return false;
      // **`count` 条件は `ledger` が `未計画` のときだけ掛かる。**
      if (g.lead.ledger === "未計画" && failure(g).count >= ctx.config.retryBudget) return false;
      return true;
    },
  },
  {
    params: (g, ctx) => ({ action: "差し戻す", to: revertTarget(g, ctx.config) ?? "未計画" }),
    why: "差し戻しの 4 事象のどれかに当たった",
    match: (g, ctx) => !isShelved(g) && revertTarget(g, ctx.config) !== undefined,
  },
  {
    params: () => ({ action: "差し戻す", to: "未計画" }),
    unit: "issue",
    why: "計画済みの在庫が陳腐化した",
    match: (g, ctx) => !isShelved(g) && stockStale(g, ctx),
  },
  {
    params: () => ({ action: "報告して止める" }),
    why: "ledger が期待より先で、差し戻しのどの事象にも当たらない",
    match: (g) => !isShelved(g) && g.records.some(ledgerAhead),
  },
  {
    params: () => ({ action: "本文の変更を伝える" }),
    why: "本文が計画の記録と食い違っている",
    match: (g) =>
      !isShelved(g) &&
      g.observations.some((o) => value(o.bodyMatchesPlan) === false) &&
      sessionAlive(g) &&
      g.lead.runtime !== "人待ち" &&
      g.lead.runtime !== "休止",
  },
  {
    params: () => ({ action: "計画の失効を伝える" }),
    why: "統合先の変更が計画の資源キーに交差した",
    match: (g) =>
      !isShelved(g) &&
      value(g.leadObservation.planInvalidated) === true &&
      sessionAlive(g) &&
      g.lead.runtime !== "人待ち" &&
      g.lead.runtime !== "休止",
  },
  {
    params: () => ({ action: "台帳を進める" }),
    why: "台帳が期待より手前にある",
    match: (g) => !isShelved(g) && g.records.some(ledgerBehind),
  },
  {
    params: () => ({ action: "計画を起こし直す" }),
    unit: "issue",
    why: "計画の人待ちが落ちてセッションが消えた",
    match: (g, ctx) =>
      !isShelved(g) &&
      g.lead.ledger === "未計画" &&
      g.lead.runtime === "人待ち" &&
      g.leadObservation.refineSession.kind === "none" &&
      ctx.planSlotsUsed < ctx.config.planSlots,
  },
  {
    params: () => ({ action: "解決を起こし直す" }),
    why: "実行器が消えたまま成果物が途中で止まっている",
    match: (g, ctx) => {
      if (isShelved(g)) return false;
      const r = g.lead;
      const inFlight: readonly Progress[] = ["準備中", "準備済み", "実装中", "提出中", "着地待ち"];
      if (!inFlight.includes(r.progress)) return false;
      if (sessionAlive(g)) return false;
      if (r.runtime !== "無し" && r.runtime !== "人待ち" && r.runtime !== "休止") return false;
      if (g.records.some(ledgerBehind)) return false;
      // **checkout が無く、作ると数える本数が目安以上になるなら選ばない** ——
      // ただし論理 lease を保持しているなら、目安を超えても起こす（回収なので）。
      if (r.capacity === "あり") return true;
      if (holdsWrite(r) || holdsIntegration(g.leadObservation)) return true;
      if (capacityIncrement(g) === 0) return true;
      return ctx.counted < ctx.config.capacityTarget;
    },
  },
  {
    params: () => ({ action: "失効した記録を片付ける" }),
    why: "記録が指しているものが既に無い",
    match: (g) => {
      const o = g.leadObservation;
      // ① 休止の記録があるのに、成果物の側の条件で write を保持していない
      if (o.pauseRecordExists && !WRITE_STAGES.includes(g.lead.progress)) return true;
      // ② 人待ちの記録が `waiting` なのに人待ちを表していない
      if (
        o.waitRecord.kind === "waiting" &&
        o.waitRecord.validity.kind === "resource-wait-mislabeled"
      )
        return true;
      // ③ 渡しの記録があり、回収の表の行に当たる
      if (holdsIntegration(o)) {
        if (g.lead.runtime === "人待ち") return true;
        if (g.lead.ledger === "退避先" && !sessionActive(o.session)) return true;
      }
      // **解除の述語に「交差する保持者が居ない」を足さない。**`休止` は write の保持者から
      // 外れるので、足すと消した瞬間に保持者へ戻り、休止と解除を往復する。
      // 交差が解けた課題は下の「枠を渡す」が拾い、記録はその実行が先に消す。
      return false;
    },
  },
  {
    params: () => ({ action: "交差を解消する" }),
    why: "資源キーが交差する write 保持者が並び、休止の記録が現在の交差を記述していない",
    match: (g, ctx) => {
      if (isShelved(g) || !holdsWrite(g.lead)) return false;
      const crossing = crossingWriteHolders(g, ctx);
      if (crossing.length === 0) return false;
      // **キーが present でない相手へは休止を送らない。**記述不能な記録は解除条件に届かない。
      // 直列化（`intersect` の `unknown`）は残す。
      if (g.leadObservation.resourceKeys.kind !== "present") return false;
      if (crossing.some((p) => p.leadObservation.resourceKeys.kind !== "present")) return false;
      // **記録の有無だけでは見ない。**`to` / `keys` が現況と一致しているあいだは送らない。
      return !crossingDescribed(g, crossing);
    },
  },
  {
    params: () => ({ action: "checks を引き直させる" }),
    why: "実行中の checks が 1 つも無く、緑でもない",
    match: (g) => {
      if (isShelved(g)) return false;
      if (g.lead.progress !== "提出中" || g.lead.runtime !== "待機") return false;
      const checks = value(g.leadObservation.checks);
      // **「緑でもない」を落とすと、混在する課題でキューが止まる。**
      return checks !== undefined && checks.running === 0 && !checks.green;
    },
  },
  {
    params: () => ({ action: "意図の確認を促す" }),
    why: "意図の確認の記録が観測できない",
    match: (g) => {
      if (isShelved(g) || !alreadyClaimed(g)) return false;
      if (g.lead.progress !== "着地待ち") return false;
      if (g.lead.runtime !== "待機") return false;
      const record = g.leadObservation.intentRecord;
      // **`pending` には当たらない** —— そちらは確認が始まっている。
      return record.kind === "absent" || record.kind === "broken";
    },
  },
  {
    params: (g) => ({
      action: "枠を渡す",
      lease: g.lead.progress === "着地待ち" ? "integration" : "write",
      ...(needsSubmissionReport(g) ? { missing: "report" as const } : {}),
    }),
    why: "止まっている実行器に資源を渡せる",
    match: (g, ctx) => {
      if (isShelved(g)) return false;
      if (g.lead.runtime !== "待機" && g.lead.runtime !== "休止") return false;
      // **consult の子が同じ worktree で working なら write を渡さない。**integration は別資源。
      if (g.lead.progress !== "着地待ち" && g.leadObservation.worktreeBusy) return false;
      if (g.lead.progress === "着地待ち") {
        if (holdsIntegration(g.leadObservation)) return true;
        return nextIntegrationReceiver(ctx)?.representative === g.representative;
      }
      if (crossingWriteHolders(g, ctx).length > 0) return false;
      // **入場を止める宣言**は、まだ write を保持していない課題への貸し出しだけを止める。
      if (ctx.entryBlocked && !holdsWrite(g.lead) && !g.leadObservation.blocksEntry) return false;
      // **`待機` に限る。**`休止` は交差の再開で、claim へ譲ると再開が後回しになる。
      if (
        g.lead.runtime === "待機" &&
        needsSubmissionReport(g) &&
        ctx.groups.some(
          (other) => other.representative !== g.representative && canClaim(other, ctx),
        )
      ) {
        return false;
      }
      return true;
    },
  },
  {
    params: () => ({ action: "計画枠の逼迫を伝える" }),
    unit: "issue",
    why: "計画枠が人待ちの計画で飽和し、起こせる候補が待たされている",
    match: (g, ctx) => promptPlanSlotRetreat(g, ctx),
  },
  {
    params: () => ({ action: "計画を起こす" }),
    unit: "issue",
    why: "未計画の課題に計画枠と在庫の空きがある",
    match: (g, ctx) => planStartable(g, ctx) && ctx.planSlotsUsed < ctx.config.planSlots,
  },
  {
    params: () => ({ action: "claim する" }),
    why: "選出の条件が揃い、容量に空きがあり、いまの write 保持者と交わらない",
    match: canClaim,
  },
];

const occupiedSurfaces = (ctx: Context): ReadonlySet<string> => {
  const occupied = new Set<string>();
  for (const g of ctx.groups) {
    for (const name of integrationOccupied(g.leadObservation, ctx.surfaceNames)) {
      occupied.add(name);
    }
  }
  return occupied;
};

const validIntegrationLanding = (
  g: Group,
  surfaceNames: readonly string[],
): readonly string[] | undefined => {
  const rec = value(g.leadObservation.integrationRecord);
  const claim = value(g.leadObservation.claimRecord);
  if (rec === undefined || claim === undefined) return undefined;
  if (!integrationLandingValid(rec.landing, claim.landing, surfaceNames)) return undefined;
  return rec.landing;
};

/** 有効な記録どうしの `landing` が交わる。 */
const intersectingIntegrationConflicts = (
  groups: readonly Group[],
  surfaceNames: readonly string[],
): Conflict[] => {
  const found: Conflict[] = [];
  const valids = groups.flatMap((g) => {
    if (TERMINAL.includes(g.lead.progress) || g.lead.ledger === "完了") return [];
    const landing = validIntegrationLanding(g, surfaceNames);
    return landing === undefined ? [] : [{ g, landing }];
  });
  for (let i = 0; i < valids.length; i++) {
    const left = valids[i];
    if (left === undefined) continue;
    for (let j = i + 1; j < valids.length; j++) {
      const right = valids[j];
      if (right === undefined) continue;
      if (!left.landing.some((name) => right.landing.includes(name))) continue;
      found.push({
        reason: "証跡が矛盾している",
        evidence: ["有効な渡しの記録の landing が交わっている"],
        issues: [...left.g.members, ...right.g.members],
      });
    }
  }
  return found;
};

/**
 * **次の受け手は、面が空いていていま渡せる候補のうち、claim が最も古い 1 件。**
 * 保持者への再送は選定の外。**PR 作成の早さで選ばない。**
 * rung の拒否条件（shelved / 渡せない runtime）を候補からも外す。外すと最古が枠を止める。
 */
const nextIntegrationReceiver = (ctx: Context): Group | undefined => {
  const occupied = occupiedSurfaces(ctx);
  const candidates = ctx.groups.filter((g) => {
    if (isShelved(g)) return false;
    if (g.members.some((n) => ctx.excluded.has(n))) return false;
    if (g.lead.progress !== "着地待ち") return false;
    if (!alreadyClaimed(g)) return false;
    if (g.lead.runtime !== "待機" && g.lead.runtime !== "休止") return false;
    if (holdsIntegration(g.leadObservation)) return false;
    if (g.observations.some((o) => value(o.bodyMatchesPlan) === false)) return false;
    const intent = g.leadObservation.intentRecord;
    if (intent.kind !== "confirmed" && intent.kind !== "not-required") return false;
    const landing = value(g.leadObservation.claimRecord)?.landing;
    if (landing === undefined || landing.length === 0) return false;
    if (new Set(landing).size !== landing.length) return false;
    if (landing.some((name) => !ctx.surfaceNames.includes(name))) return false;
    return !landing.some((name) => occupied.has(name));
  });
  // **claim が最も古い 1 件**（同値なら代表の番号が小さい方）。
  return [...candidates].sort((a, b) => {
    const left = value(a.leadObservation.claimedAt) ?? Number.MAX_SAFE_INTEGER;
    const right = value(b.leadObservation.claimedAt) ?? Number.MAX_SAFE_INTEGER;
    return left === right ? a.representative - b.representative : left - right;
  })[0];
};

/** **1 tick 1 action。**上から最初に当たった rung を 1 つだけ返す。 */
export const decide = (input: TickInput): Decision => {
  const groups = buildGroups(input.observations);
  const all = groups.flatMap((g) => g.records);
  const byIssue = new Map(input.observations.map((o) => [o.issue, o]));

  // **精算は action の選択より前。**`退避先` にはどの action も当たらないことがあるので、
  // action の側に置くと一度も揃わず、人が救出した瞬間に差し戻しの述語が真のまま当たって直帰する。
  const shelved = groups.find(
    (g) =>
      isShelved(g) &&
      (failure(g).count !== 0 || cycle(g).count !== 0) &&
      (failure(g).lastAction !== "計画枠の逼迫を伝える" || retreatComplete(g)),
  );
  // **Conflict は 1 手の選択と直交する。**当たった課題を選出対象外にするだけで、他は回す。
  const surfaceNames = input.surfaceNames;
  const conflicts: Conflict[] = [];
  const excluded = new Set<number>();
  for (const g of groups) {
    const found = standingConflicts(g);
    if (found.length === 0) continue;
    conflicts.push(...found);
    for (const n of g.members) excluded.add(n);
  }
  for (const g of groups) {
    if (TERMINAL.includes(g.lead.progress) || g.lead.ledger === "完了") continue;
    if (!integrationLandingBroken(g.leadObservation, surfaceNames)) continue;
    conflicts.push({
      reason: "渡しの記録が壊れている",
      evidence: ["渡しの記録の landing が壊れている"],
      issues: g.members,
    });
    for (const n of g.members) excluded.add(n);
  }
  for (const found of intersectingIntegrationConflicts(groups, surfaceNames)) {
    conflicts.push(found);
    for (const n of found.issues) excluded.add(n);
  }
  const usage = usageOf(groups, all, byIssue, input.observations, input.config, excluded);
  const decision = (outcome: Outcome): Decision => ({
    conflicts: foldConflicts(conflicts),
    outcome,
    usage,
  });

  // **計画 block の invalid は 1 件ずつの扱いに落とさない。**精算より前にセッションを止める。
  // `absent` / `unobservable` は倒さない（コメント取得の一時失敗を全体停止にしない）。
  const schemaUnknown = groups.flatMap((g) =>
    g.observations.flatMap((o) =>
      o.resourceKeys.kind === "invalid"
        ? [
            {
              issue: o.issue,
              evidence: `Issue ${o.issue} の marker plan が読めない: ${o.resourceKeys.reason}`,
            },
          ]
        : [],
    ),
  );
  if (schemaUnknown.length > 0) {
    return decision({
      kind: "halt",
      reason: "計画 schema 不明",
      evidence: schemaUnknown.map((x) => x.evidence),
      issues: schemaUnknown.map((x) => x.issue).sort((a, b) => a - b),
    });
  }

  if (shelved !== undefined) {
    return decision({
      kind: "settle-record",
      settlement: {
        target: target(shelved),
        kind: "退避先の count を 0 に揃える",
        detail: `失敗 ${failure(shelved).count} / 周回 ${cycle(shelved).count} を 0 へ`,
      },
      records: recordsOf(shelved),
    });
  }

  const ctx: Context = {
    groups,
    all,
    byIssue,
    config: input.config,
    counted: usage.counted,
    planSlotsUsed: planSlotUsage(input.observations),
    supply: usage.supply,
    supplyTarget: usage.supplyTarget,
    // **効くのは終端に達するまで。**外すのは `人待ち` と、止まったことを確かめた `退避先` だけ。
    entryBlocked: groups.some(
      (g) =>
        g.leadObservation.blocksEntry &&
        !TERMINAL.includes(g.lead.progress) &&
        g.lead.runtime !== "人待ち" &&
        !(g.lead.ledger === "退避先" && !sessionActive(g.leadObservation.session)),
    ),
    input,
    excluded,
    surfaceNames,
  };

  const ordered = [...groups].sort(byPriority(groups));
  const solo = ordered.flatMap(asSolo);

  const inPlay = (g: Group): boolean => !g.members.some((n) => excluded.has(n));

  // **候補を 1 度だけ舐める。**`ledger が期待より先` は当たった課題を選出対象外にするだけ
  // なので、その rung の次の候補へ進む。**同じ rung を当て直す形にしない** ——
  // 終了が「外したものが次から外れる」という述語の一致に依存し、食い違うと tick が返らなくなる
  // （返らないのは、誤った action より重い）。
  for (const rung of LADDER) {
    for (const g of rung.unit === "issue" ? solo : ordered) {
      if (!inPlay(g) || !rung.match(g, ctx)) continue;
      if (rung.params(g, ctx).action === "報告して止める") {
        for (const r of g.records) {
          if (!ledgerAhead(r)) continue;
          conflicts.push({
            reason: "ledger が期待より先",
            evidence: [`progress が ${r.progress} なのに ledger が ${r.ledger}`],
            issues: [r.issue],
          });
        }
        for (const n of g.members) excluded.add(n);
        continue;
      }
      const params = rung.params(g, ctx);
      return decision({
        kind: "action",
        params,
        target: target(g),
        countsEmptyCycle: countsEmptyCycle({
          action: params.action,
          ...(params.action === "枠を渡す" ? { lease: params.lease } : {}),
          progress: g.lead.progress,
          checks: g.leadObservation.checks,
        }),
        countsFailure: countsFailure({
          action: params.action,
          runtime: g.lead.runtime,
        }),
        records: recordsOf(g),
        evidence: {
          progress: g.lead.progress,
          runtime: g.lead.runtime,
          capacity: g.lead.capacity,
          ledger: g.lead.ledger,
          why: rung.why,
        },
      });
    }
  }

  // **空キューは終了条件ではなく idle。**次の観測まで待つ。
  return decision({ kind: "idle" });
};
