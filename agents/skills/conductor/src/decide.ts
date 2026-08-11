// tick が 1 周で出す結論を、観測から一意に決める純関数。
//
// **`select` だけを切り出さない。**記録の精算は action の選択より前に走り、書いたら
// 観測からやり直す順序制約を持つ。そこを外に置くと、順序が prose に残る。
//
// **1 tick 1 action。**上から最初に当たった rung を 1 つだけ返す。

import type { IssueObservation } from "./observation.ts";
import {
  blocks,
  holdsIntegration,
  holdsWrite,
  intersect,
  planSlotUsage,
  worktreeCount,
} from "./resources.ts";
import { normalize } from "./normalize.ts";
import type {
  ActionParams,
  Conflict,
  Decision,
  Ledger,
  NormalizedIssue,
  Observed,
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

/** `Same branch as #N` の連結成分。**代表は最小番号**（固定の規約は `same-branch.md`）。 */
export const buildGroups = (observations: readonly IssueObservation[]): Group[] => {
  const byIssue = new Map(observations.map((o) => [o.issue, o]));
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
      const observation = byIssue.get(current);
      if (observation === undefined) continue;
      for (const linked of observation.sameBranchAs) if (!seen.has(linked)) queue.push(linked);
    }
    members.sort((a, b) => a - b);
    const groupObservations = members.map((n) => byIssue.get(n)).filter((x) => x !== undefined);
    if (groupObservations.length === 0) continue;
    const records = groupObservations.map(normalize);
    const representative = members[0] ?? o.issue;
    const leadIndex = Math.max(
      0,
      groupObservations.findIndex((g) => g.issue === representative),
    );
    const lead = records[leadIndex];
    const leadObservation = groupObservations[leadIndex];
    if (lead === undefined || leadObservation === undefined) continue;
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

/** `progress` から期待される `ledger`。`取り下げ` は触らない（人が置いた状態を尊重する）。 */
const expectedLedger = (p: Progress): readonly Ledger[] => {
  if (p === "未着手") return ["未計画", "計画済み"];
  if (p === "着地済み") return ["完了"];
  if (p === "取り下げ") return LEDGER_ANY;
  return ["進行中"];
};
const LEDGER_ANY: readonly Ledger[] = ["未計画", "計画済み", "進行中", "完了", "退避先"];

const LEDGER_ORDER: readonly Ledger[] = ["未計画", "計画済み", "進行中", "完了"];
const ledgerRank = (l: Ledger): number => LEDGER_ORDER.indexOf(l);

/** `ledger` が期待より手前か。**前進のみ**で、後退は「差し戻す」だけが行う。 */
const ledgerBehind = (r: NormalizedIssue): boolean => {
  const expected = expectedLedger(r.progress);
  if (expected === LEDGER_ANY || expected.includes(r.ledger)) return false;
  const current = ledgerRank(r.ledger);
  if (current < 0) return false; // `退避先` はこの軸に乗らない
  return expected.every((e) => current < ledgerRank(e));
};

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
    o.session.kind !== "running"
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

  // **claim が構造的に止まっているあいだは陳腐化を評価しない。**
  if (
    r.ledger === "計画済み" &&
    r.progress === "未着手" &&
    !claimStructurallyBlocked(g) &&
    value(o.readyRecordStale) === true
  ) {
    return "未計画";
  }
  return undefined;
};

const hasArtifacts = (g: Group): boolean =>
  g.observations.some((o) =>
    o.surfaces.some((s) => value(s.aheadOfIntegration) === true || value(s.dirty) !== false),
  );

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
      return byIssue.get(n)?.open === false && record.ledger === "完了";
    }),
  );

/** **「選出の条件」は `resolve` の候補 1 件について真偽を決めるものすべて。** */
const selectable = (
  g: Group,
  all: readonly NormalizedIssue[],
  byIssue: Map<number, IssueObservation>,
): boolean => {
  if (!g.observations.every((o) => o.open)) return false;
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
  if (!g.observations.every((o) => o.open)) return true;
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
  readonly params: (g: Group) => ActionParams;
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

const LADDER: readonly Rung[] = [
  {
    params: () => ({ action: "報告して止める" }),
    why: "ラダーで解決できない証跡がある",
    match: (g) => g.records.some((r) => r.conflicts.length > 0) || terminalMixedInGroup(g),
  },
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
      if (!o.refineSessionExists) return false;
      if (g.lead.runtime === "人待ち") return false;
      if (g.lead.ledger === "未計画" && o.session.kind === "running") return false;
      // **`count` 条件は `ledger` が `未計画` のときだけ掛かる。**
      if (g.lead.ledger === "未計画" && failure(g).count >= ctx.config.retryBudget) return false;
      return true;
    },
  },
  {
    params: (g) => ({ action: "差し戻す", to: revertTarget(g, DEFAULT_CONFIG) ?? "未計画" }),
    why: "差し戻しの 5 事象のどれかに当たった",
    match: (g, ctx) => !isShelved(g) && revertTarget(g, ctx.config) !== undefined,
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
      !g.leadObservation.refineSessionExists &&
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
        if (g.lead.ledger === "退避先" && o.session.kind !== "running") return true;
      }
      // **解除の述語に「交差する保持者が居ない」を足さない。**`休止` は write の保持者から
      // 外れるので、足すと消した瞬間に保持者へ戻り、休止と解除を往復する。
      // 交差が解けた課題は下の「枠を渡す」が拾い、記録はその実行が先に消す。
      return false;
    },
  },
  {
    params: () => ({ action: "交差を解消する" }),
    why: "資源キーが交差する write 保持者が並んでいる",
    match: (g, ctx) => {
      if (isShelved(g) || !holdsWrite(g.lead)) return false;
      const crossing = crossingWriteHolders(g, ctx);
      if (crossing.length === 0) return false;
      // **そのうち休止の記録を持つものが 1 つも無い**ときだけ。
      return ![g, ...crossing].some((x) => x.leadObservation.pauseRecordExists);
    },
  },
  {
    params: () => ({ action: "休止を促し直す" }),
    why: "休止の記録があるのにセッションが動き続けている",
    match: (g) =>
      g.leadObservation.pauseRecordExists && g.leadObservation.session.kind === "running",
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
      if (g.leadObservation.refineSessionExists || g.leadObservation.retiredRefineExists)
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
  if (shelved !== undefined) {
    return {
      kind: "settle-record",
      settlement: {
        target: target(shelved),
        kind: "退避先の count を 0 に揃える",
        detail: `失敗 ${failure(shelved).count} / 周回 ${cycle(shelved).count} を 0 へ`,
      },
    };
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
        !(g.lead.ledger === "退避先" && g.leadObservation.session.kind !== "running"),
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

  for (const rung of LADDER) {
    const candidates = rung.unit === "issue" ? solo : ordered;
    const hit = candidates.find((g) => rung.match(g, ctx));
    if (hit === undefined) continue;
    if (rung.params(hit).action === "報告して止める") {
      const conflicts: Conflict[] = hit.records.flatMap((r) => [...r.conflicts]);
      if (terminalMixedInGroup(hit)) {
        conflicts.push({
          reason: "group の終端が混在",
          evidence: ["group 内で終端と非終端が混在している"],
          issues: hit.members,
        });
      }
      return { kind: "conflict", conflicts };
    }
    return {
      kind: "action",
      params: rung.params(hit),
      target: target(hit),
      evidence: {
        progress: hit.lead.progress,
        runtime: hit.lead.runtime,
        capacity: hit.lead.capacity,
        ledger: hit.lead.ledger,
        why: rung.why,
      },
    };
  }

  // **空キューは終了条件ではなく idle。**次の観測まで待つ。
  return { kind: "idle" };
};
