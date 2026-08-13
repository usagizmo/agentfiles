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
  holdsIntegration,
  holdsWrite,
  intersect,
  planSlotUsage,
  worktreeCount,
} from "./resources.ts";
import { hasWorkInProgress, ledgerAhead, ledgerBehind, normalize } from "./normalize.ts";
import type {
  ActionParams,
  Conflict,
  Decision,
  Ledger,
  NormalizedIssue,
  Observed,
  Outcome,
  Progress,
  Target,
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
  /** 計画済みの在庫の上限。既定は容量の目安 + 先読み 1 */
  readonly readyStockLimit: number;
};

export const DEFAULT_CONFIG: TickConfig = {
  maxActionsPerTick: 5,
  retryBudget: 3,
  emptyCycleBudget: 3,
  capacityTarget: 4,
  planSlots: 3,
  readyStockLimit: 5,
};

export type TickInput = {
  readonly observations: readonly IssueObservation[];
  readonly config: TickConfig;
  /**
   * この tick で規約の穴に気づいたか。**検知そのものはメタ判断**なので純関数では出せない ——
   * skill 側（LLM）が渡す。同じ事実の open Issue が無いことも呼ぶ側が確かめる。
   */
  readonly specGap?: { readonly issue: number; readonly fact: string } | undefined;
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
        waitRecord: lead.waitRecord,
        pauseRecordExists: lead.pauseRecordExists,
        yieldRecord: lead.yieldRecord,
        intentRecord: lead.intentRecord,
        integrationRecordCount: lead.integrationRecordCount,
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

/** group 内で終端と非終端が混在しているか。共有実体をどちらに倒しても壊れる。 */
const terminalMixedInGroup = (g: Group): boolean => {
  const terminal = g.records.filter((r) => TERMINAL.includes(r.progress)).length;
  return terminal > 0 && terminal < g.records.length;
};

/** **`退避先` に当てるのは上 3 つと、merge の枠の回収だけ。** */
const isShelved = (g: Group): boolean => g.lead.ledger === "退避先";

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

  if (REVERTABLE.includes(r.ledger) && failure(g).count >= config.retryBudget) return "退避先";

  // **正規化後の `runtime` では引かない** —— 人待ちの記録があると生きたセッションでも
  // `人待ち` に写るので、起こした直後の実行器を結果が出る前に落とす。
  if (
    REVERTABLE.includes(r.ledger) &&
    cycle(g).count >= config.emptyCycleBudget &&
    markUnchanged(g) &&
    !(o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid") &&
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
  !claimStructurallyBlocked(parentOf(g, ctx)) &&
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

/** **claim 済みの判定は 4 通り**。branch 名には番号が 1 つしか入らないので 1 つでは漏れる。 */
const alreadyClaimed = (g: Group): boolean =>
  g.observations.some(
    (o) => o.claimRecord.kind === "present" || value(o.claimBranchExists) === true,
  );

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
  // **読めなかった `open` を選出の側へ倒さない**（claim は worktree を作る不可逆操作）。
  if (!g.observations.every((o) => value(o.open) === true)) return false;
  if (!g.records.every((r) => r.ledger === "計画済み")) return false;
  if (alreadyClaimed(g)) return false;
  if (!g.observations.every((o) => value(o.issueContractComplete) === true)) return false;
  if (!dependenciesResolved(g, all, byIssue)) return false;
  // **着地面が解決できる**。読めない面があれば正規化が `Conflict` を立てている。
  if (g.observations.some((o) => o.surfaces.length === 0)) return false;
  return true;
};

/**
 * **「claim する」の条件のうち、容量以外のどれかが偽であること。**
 * **容量は含めない** —— 枠が無いだけの在庫は claim の前提が揃っていて、
 * そこは在庫の鮮度が守っている対象そのもの。
 */
const claimStructurallyBlocked = (g: Group): boolean => {
  if (!g.observations.every((o) => value(o.open) === true)) return true;
  if (!g.records.every((r) => r.ledger === "計画済み")) return true;
  if (alreadyClaimed(g)) return true;
  if (!g.observations.every((o) => value(o.issueContractComplete) === true)) return true;
  return false;
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
   * **`refine` を起こす / 片付ける 3 つだけが Issue 単位** —— `refine-<番号>` は Issue ごとで
   * worktree を持たないので、group へ畳むと**揃っていない group の未計画側が永久に計画されない**。
   */
  readonly unit?: "issue";
};

type Context = {
  readonly groups: readonly Group[];
  readonly all: readonly NormalizedIssue[];
  readonly byIssue: Map<number, IssueObservation>;
  readonly config: TickConfig;
  readonly worktrees: number;
  readonly planSlotsUsed: number;
  readonly readyStock: number;
  readonly entryBlocked: boolean;
  readonly input: TickInput;
};

/** 交差する write 保持者。**対象集合自身は除く**（保持者への渡し直しがあるため）。 */
const crossingWriteHolders = (g: Group, ctx: Context): Group[] =>
  ctx.groups.filter(
    (other) =>
      other.representative !== g.representative &&
      holdsWrite(other.lead) &&
      blocks(intersect(g.leadObservation.resourceKeys, other.leadObservation.resourceKeys)),
  );

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

const LADDER: readonly Rung[] = [
  {
    params: () => ({ action: "規約の穴を起票する" }),
    why: "この tick で規約の穴に当たった",
    match: (g, ctx) => ctx.input.specGap?.issue === g.representative,
  },
  {
    params: () => ({ action: "片付ける" }),
    why: "終端に達したものの実体と記録が残っている",
    match: (g) => {
      const r = g.lead;
      const o = g.leadObservation;
      const done = TERMINAL.includes(r.progress) || r.ledger === "完了";
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
      // **checkout が無く、作ると容量が目安を超えるなら選ばない** ——
      // ただし論理 lease を保持しているなら、目安を超えても起こす（回収なので）。
      if (r.capacity === "あり") return true;
      if (holdsWrite(r) || holdsIntegration(g.leadObservation)) return true;
      return ctx.worktrees < ctx.config.capacityTarget;
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
      if (g.lead.progress !== "提出中" && g.lead.progress !== "着地待ち") return false;
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
    }),
    why: "止まっている実行器に資源を渡せる",
    match: (g, ctx) => {
      if (isShelved(g)) return false;
      if (g.lead.runtime !== "待機" && g.lead.runtime !== "休止") return false;
      if (g.lead.progress === "着地待ち") {
        if (holdsIntegration(g.leadObservation)) return true;
        return nextIntegrationReceiver(ctx)?.representative === g.representative;
      }
      if (crossingWriteHolders(g, ctx).length > 0) return false;
      // **入場を止める宣言**は、まだ write を保持していない課題への貸し出しだけを止める。
      if (ctx.entryBlocked && !holdsWrite(g.lead) && !g.leadObservation.blocksEntry) return false;
      return true;
    },
  },
  {
    params: () => ({ action: "計画を起こす" }),
    unit: "issue",
    why: "未計画の課題に計画枠と在庫の空きがある",
    match: (g, ctx) => {
      if (isShelved(g)) return false;
      if (g.lead.ledger !== "未計画" || g.lead.progress !== "未着手") return false;
      // `retired-refine-<番号>` も「有る」に数える。
      if (g.leadObservation.refineSession.kind !== "none" || g.leadObservation.retiredRefineExists)
        return false;
      if (g.leadObservation.waitRecord.kind === "waiting") return false;
      if (ctx.planSlotsUsed >= ctx.config.planSlots) return false;
      return ctx.readyStock < ctx.config.readyStockLimit;
    },
  },
  {
    params: () => ({ action: "claim する" }),
    why: "選出の条件が揃い、容量にも空きがある",
    match: (g, ctx) => {
      if (isShelved(g)) return false;
      if (!selectable(g, ctx.all, ctx.byIssue)) return false;
      // **作っても容量が目安を超えない**（作ると超えるなら選ばない）。
      if (ctx.worktrees + g.leadObservation.surfaces.length > ctx.config.capacityTarget)
        return false;
      return !ctx.entryBlocked;
    },
  },
];

/**
 * **次の受け手は、記録がどこにも無いときだけ評価する。**
 * **PR 作成の早さで選ばない** —— PR を持たない課題が順序キー未定義で選外へ落ちる。
 */
const nextIntegrationReceiver = (ctx: Context): Group | undefined => {
  if (ctx.groups.some((g) => holdsIntegration(g.leadObservation))) return undefined;
  const candidates = ctx.groups.filter((g) => {
    if (g.lead.progress !== "着地待ち") return false;
    if (!alreadyClaimed(g)) return false;
    if (!g.observations.some((o) => o.surfaces.some((s) => s.usesPr))) return false;
    if (g.lead.runtime === "人待ち" || g.lead.ledger === "退避先") return false;
    if (g.observations.some((o) => value(o.bodyMatchesPlan) === false)) return false;
    const intent = g.leadObservation.intentRecord;
    return intent.kind === "confirmed" || intent.kind === "not-required";
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
    (g) => isShelved(g) && (failure(g).count !== 0 || cycle(g).count !== 0),
  );
  // **Conflict は 1 手の選択と直交する。**当たった課題を選出対象外にするだけで、他は回す。
  const conflicts: Conflict[] = [];
  const excluded = new Set<number>();
  for (const g of groups) {
    const found = standingConflicts(g);
    if (found.length === 0) continue;
    conflicts.push(...found);
    for (const n of g.members) excluded.add(n);
  }
  const decision = (outcome: Outcome): Decision => ({ conflicts, outcome });

  if (shelved !== undefined) {
    return decision({
      kind: "settle-record",
      settlement: {
        target: target(shelved),
        kind: "退避先の count を 0 に揃える",
        detail: `失敗 ${failure(shelved).count} / 周回 ${cycle(shelved).count} を 0 へ`,
      },
    });
  }

  const ctx: Context = {
    groups,
    all,
    byIssue,
    config: input.config,
    worktrees: worktreeCount(input.observations),
    planSlotsUsed: planSlotUsage(input.observations),
    // **在庫 = 計画済みの group 数 + 生存している `refine` セッション数。**
    readyStock:
      groups.filter((g) => g.records.every((r) => r.ledger === "計画済み") && !alreadyClaimed(g))
        .length + planSlotUsage(input.observations),
    // **効くのは終端に達するまで。**外すのは `人待ち` と、止まったことを確かめた `退避先` だけ。
    entryBlocked: groups.some(
      (g) =>
        g.leadObservation.blocksEntry &&
        !TERMINAL.includes(g.lead.progress) &&
        g.lead.runtime !== "人待ち" &&
        !(g.lead.ledger === "退避先" && !sessionActive(g.leadObservation.session)),
    ),
    input,
  };

  const ordered = [...groups].sort(byPriority(groups));
  // Issue 単位の rung 用に、成員 1 件ずつを単独の group として並べ直す。
  const solo = ordered.flatMap((g) =>
    g.observations
      .map((o, i) => {
        const record = g.records[i];
        return record === undefined
          ? undefined
          : ({
              representative: o.issue,
              members: [o.issue],
              observations: [o],
              records: [record],
              lead: record,
              leadObservation: o,
            } satisfies Group);
      })
      .filter((x) => x !== undefined),
  );

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
      return decision({
        kind: "action",
        params: rung.params(g, ctx),
        target: target(g),
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
