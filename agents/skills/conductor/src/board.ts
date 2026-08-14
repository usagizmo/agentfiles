// 状況ボード JSON の投影。**決定層の型に display を混ぜない。**
//
// 観測と Decision から毎 tick フル生成する。前の盤面は読まない。

import type { ProjectConfig } from "./config.ts";
import type { LiveCheckoutRow } from "./decode.ts";
import { buildGroups, usageOf } from "./decide.ts";
import { normalize } from "./normalize.ts";
import type { IssueObservation } from "./observation.ts";
import type { BoardView } from "./observe.ts";
import { countKey } from "./observe.ts";
import { holdsIntegration, holdsWrite } from "./resources.ts";
import type { RecentTick } from "./journal.ts";
import type { Capacity, Conflict, ConflictReason, Decision, Outcome } from "./types.ts";
import { LEDGER_VALUES, PROGRESS_LADDER, RUNTIME_LADDER } from "./types.ts";

const CAPACITY_VALUES = ["無し", "あり", "prunable"] as const satisfies readonly Capacity[];

const value = <T>(o: { readonly kind: string; readonly value?: T }): T | undefined =>
  o.kind === "present" ? o.value : undefined;

export type HumanTodo = {
  readonly title: string;
  readonly detail: string;
  readonly unblocks: string;
  readonly issues: readonly number[];
  readonly kind: string;
  readonly since?: string;
  readonly id?: string;
};

export type BoardOverlay = {
  readonly humanTodo?: readonly HumanTodo[];
  readonly notes?: Readonly<Record<string, string>>;
};

export type BoardInput = {
  readonly observations: readonly IssueObservation[];
  readonly decision: Decision;
  readonly config: ProjectConfig;
  readonly view: BoardView;
  readonly overlay?: BoardOverlay;
  readonly recent?: readonly RecentTick[];
  readonly observedAt: string;
  readonly tick?: number;
  readonly actionsUsed?: number;
};

type Tone =
  | "idle"
  | "prep"
  | "active"
  | "review"
  | "human"
  | "hold"
  | "done"
  | "dropped"
  | "parked";

const VOCAB = {
  progress: [
    { key: "未着手", tone: "idle" },
    { key: "準備中", tone: "prep" },
    { key: "準備済み", tone: "prep" },
    { key: "実装中", tone: "active" },
    { key: "提出中", tone: "review" },
    { key: "着地待ち", tone: "review" },
    { key: "着地済み", tone: "done" },
    { key: "取り下げ", tone: "dropped" },
  ],
  runtime: [
    { key: "無し", tone: "idle" },
    { key: "稼働中", tone: "active" },
    { key: "待機", tone: "hold" },
    { key: "人待ち", tone: "human" },
    { key: "休止", tone: "hold" },
  ],
  ledger: [
    { key: "未計画", tone: "idle" },
    { key: "計画済み", tone: "prep" },
    { key: "進行中", tone: "active" },
    { key: "完了", tone: "done" },
    { key: "退避先", tone: "parked" },
  ],
  capacity: [
    { key: "無し", tone: "idle" },
    { key: "あり", tone: "active" },
    { key: "prunable", tone: "hold" },
  ],
} as const satisfies {
  readonly progress: readonly { key: (typeof PROGRESS_LADDER)[number]; tone: Tone }[];
  readonly runtime: readonly { key: (typeof RUNTIME_LADDER)[number]; tone: Tone }[];
  readonly ledger: readonly { key: (typeof LEDGER_VALUES)[number]; tone: Tone }[];
  readonly capacity: readonly { key: (typeof CAPACITY_VALUES)[number]; tone: Tone }[];
};

const UNBLOCKS: Record<ConflictReason, string> = {
  観測できない: "観測できる状態に戻す",
  証跡が矛盾している: "証跡の食い違いを人が見る",
  "ledger が解釈不能": "Status を対応表の 5 値へ直す",
  "ledger が期待より先": "台帳と成果物のずれを人が見る",
  "group の終端が混在": "group の扱いを人が決める",
  着地面が解決できない: "座標表と着地面の宣言を揃える",
  着地済みだが提出の証跡が無い: "提出のまとめを書くか、証跡の欠けを人が見る",
  "live checkout が異常": "live checkout を人が直す",
  "Issue 契約が欠けたまま成果物がある": "契約を埋めるか、成果物を人が片付ける",
  計画コメントが無いまま実装の証跡がある: "計画を書くか、成果物を人が片付ける",
  "意図の確認が pending なのに人待ちが無い": "意図の確認を進めるか、人待ちの記録を書く",
  渡しの記録が複数: "渡しの記録を 1 件に人が揃える",
  退避先だがセッションが止まらない: "セッションを止めてから退避する",
};

export const tickWhy = (outcome: Outcome): string => {
  switch (outcome.kind) {
    case "action":
      return outcome.evidence.why;
    case "settle-record":
      return outcome.settlement.detail;
    case "constraint":
    case "non-action":
      return outcome.detail;
    case "idle":
      return "次の観測まで待つ";
  }
};

const ids = (issues: readonly number[]): string => issues.map((n) => `#${n}`).join(" / ");

const conflictTodo = (c: Conflict): HumanTodo => ({
  title:
    c.issues.length === 1 ? `${ids(c.issues)} は ${c.reason}` : `${ids(c.issues)} の ${c.reason}`,
  detail: c.evidence.join(" / "),
  unblocks: UNBLOCKS[c.reason],
  issues: c.issues,
  kind: "conflict",
});

const humanTodos = (
  observations: readonly IssueObservation[],
  decision: Decision,
  view: BoardView,
  overlay: BoardOverlay | undefined,
): HumanTodo[] => {
  const groups = buildGroups(observations);
  const todos: HumanTodo[] = decision.conflicts.map(conflictTodo);

  for (const o of observations) {
    const wait = view.wait.get(o.issue);
    if (wait === undefined) continue;
    if (!(o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid")) continue;
    todos.push({
      title: `#${o.issue} は人待ち`,
      detail: wait.question,
      unblocks: wait.question,
      issues: [o.issue],
      kind: "waiting",
      ...(wait.since !== "" ? { since: wait.since } : {}),
    });
  }

  for (const o of observations) {
    if (!o.retiredRefineExists) continue;
    todos.push({
      title: `#${o.issue} の計画セッションが retired のまま`,
      detail: "人が pane を閉じるまで計画が起きない。",
      unblocks: "retired-refine の pane を閉じる",
      issues: [o.issue],
      kind: "retired",
    });
  }

  for (const g of groups) {
    if (!g.leadObservation.blocksEntry) continue;
    const progress = g.lead.progress;
    if (progress === "着地済み" || progress === "取り下げ") continue;
    todos.push({
      title: `#${g.representative} が入場を止めている`,
      detail: "宣言があるあいだ claim しない。",
      unblocks: "入場を止める宣言を外す",
      issues: g.members,
      kind: "entry-block",
    });
  }

  const parked = observations.filter((o) => {
    const rec = normalize(o);
    return rec.ledger === "退避先";
  });
  if (parked.length > 0) {
    todos.push({
      title: `退避先 ${parked.length} 件`,
      detail: "人が未計画へ移すまで、どの工程も起きない。",
      unblocks: "Status を未計画へ移す",
      issues: parked.map((o) => o.issue),
      kind: "parked",
    });
  }

  return [...todos, ...(overlay?.humanTodo ?? [])];
};

const sessionName = (o: IssueObservation): string | undefined => {
  if (o.session.kind !== "none") return `resolve-${o.issue}`;
  if (o.refineSession.kind !== "none") return `refine-${o.issue}`;
  if (o.retiredRefineExists) return `retired-refine-${o.issue}`;
  return undefined;
};

const surfaceRows = (o: IssueObservation, view: BoardView) =>
  o.surfaces.map((s) => {
    const counted = view.counts.get(countKey(o.issue, s.name));
    if (counted !== undefined) return { name: s.name, ...counted };
    const dirty = value(s.dirty);
    const ahead = value(s.aheadOfIntegration);
    return {
      name: s.name,
      ...(dirty !== undefined ? { dirty: dirty ? 1 : 0 } : {}),
      ...(ahead !== undefined ? { ahead: ahead ? 1 : 0 } : {}),
    };
  });

const issueRow = (
  o: IssueObservation,
  input: BoardInput,
  group: { readonly representative: number; readonly members: readonly number[] },
  conflicted: ReadonlySet<number>,
) => {
  const rec = normalize(o);
  const pr = input.view.prs.get(o.issue);
  const branch = input.view.branches.get(o.issue);
  const session = sessionName(o);
  const wait = input.view.wait.get(o.issue);
  const keys = value(o.resourceKeys);
  const yieldTo = o.yieldRecord.kind === "present" ? o.yieldRecord.value.to : undefined;
  const claimedAt =
    o.claimedAt.kind === "present" ? new Date(o.claimedAt.value).toISOString() : undefined;
  const note = input.overlay?.notes?.[String(o.issue)];
  const leases: string[] = [];
  if (holdsWrite(rec)) leases.push("write");
  if (holdsIntegration(o)) leases.push("integration");
  const landsIn =
    o.claimRecord.kind === "present" && o.claimRecord.value.landing.length > 0
      ? o.claimRecord.value.landing
      : o.surfaces.map((s) => s.name);

  return {
    n: o.issue,
    title: input.view.titles.get(o.issue) ?? `#${o.issue}`,
    repo: input.config.ghRepo,
    ...(o.open.kind === "present" ? { open: o.open.value } : {}),
    group: group.members,
    rep: group.representative,
    ledger: rec.ledger,
    progress: rec.progress,
    runtime: rec.runtime,
    capacity: rec.capacity,
    ...(branch !== undefined ? { branch } : {}),
    ...(session !== undefined ? { session } : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(claimedAt !== undefined ? { claimedAt } : {}),
    surfaces: surfaceRows(o, input.view),
    landsIn,
    ...(leases.length > 0 ? { leases } : {}),
    ...(keys !== undefined && keys.length > 0 ? { keys } : {}),
    ...(yieldTo !== undefined ? { yieldTo } : {}),
    ...(o.dependsOn.length > 0 ? { dependsOn: o.dependsOn } : {}),
    ...(wait !== undefined
      ? {
          waiting: { question: wait.question, ...(wait.since !== "" ? { since: wait.since } : {}) },
        }
      : {}),
    ...(conflicted.has(o.issue) ? { conflict: true } : {}),
    ...(note !== undefined ? { note } : {}),
  };
};

const tickOf = (decision: Decision) => {
  const { outcome } = decision;
  const base = { outcome: outcome.kind, why: tickWhy(outcome) };
  if (outcome.kind !== "action") return base;
  return {
    ...base,
    action: {
      name: outcome.params.action,
      target: outcome.target.representative,
      members: [...outcome.target.members],
    },
  };
};

const liveHealth = (row: LiveCheckoutRow): "ok" | "dirty" | "unknown" => {
  if (row.dirty === "unreadable") return "unknown";
  return row.dirty === true ? "dirty" : "ok";
};

export const toBoard = (input: BoardInput): Record<string, unknown> => {
  const groups = buildGroups(input.observations);
  const byIssue = new Map(
    groups.flatMap((g) =>
      g.members.map((n) => [n, { representative: g.representative, members: g.members }]),
    ),
  );
  const conflicted = new Set(input.decision.conflicts.flatMap((c) => c.issues));
  const usage = usageOf(input.observations);
  const actionsUsed = input.actionsUsed ?? 0;
  const liveByName = new Map(input.view.live.map((row) => [row.surface, row]));

  const limits = [
    {
      key: "actions",
      used: actionsUsed,
      limit: input.config.tick.maxActionsPerTick,
      unit: "手",
      ...(actionsUsed >= input.config.tick.maxActionsPerTick
        ? { note: "上限に達したので watcher を張って終わる" }
        : {}),
    },
    {
      key: "capacity",
      used: usage.worktrees,
      limit: input.config.tick.capacityTarget,
      soft: true,
      unit: "worktree",
    },
    {
      key: "readyStock",
      used: usage.readyStock,
      limit: input.config.tick.readyStockLimit,
      unit: "group",
    },
    {
      key: "planSlots",
      used: usage.planSlotsUsed,
      limit: input.config.tick.planSlots,
      unit: "refine",
    },
  ];

  const write: { holder: number; keys: readonly string[]; since: string | null }[] = [];
  const integration: { holder: number; keys: readonly string[]; since: string | null }[] = [];
  for (const g of groups) {
    const rec = g.lead;
    const keys = value(g.leadObservation.resourceKeys) ?? [];
    const since =
      g.leadObservation.claimedAt.kind === "present"
        ? new Date(g.leadObservation.claimedAt.value).toISOString()
        : null;
    if (holdsWrite(rec)) write.push({ holder: g.representative, keys, since });
    if (holdsIntegration(g.leadObservation))
      integration.push({ holder: g.representative, keys, since });
  }

  return {
    meta: {
      board: "conductor",
      source: input.config.ghRepo,
      observedAt: input.observedAt,
      ...(input.tick !== undefined ? { tick: input.tick } : {}),
    },
    vocab: VOCAB,
    limits,
    tick: tickOf(input.decision),
    humanTodo: humanTodos(input.observations, input.decision, input.view, input.overlay),
    surfaces: input.config.surfaces.map((s) => {
      const live = liveByName.get(s.name);
      return {
        name: s.name,
        repo: s.name,
        live: {
          branch: live?.branch ?? "",
          dirty: live === undefined ? 0 : live.dirty === true ? 1 : 0,
          ahead: live?.ahead ?? 0,
          behind: live?.behind ?? 0,
        },
        health: live === undefined ? "unknown" : liveHealth(live),
        usesPR: s.usesPr,
        worktrees: input.view.worktreesBySurface.get(s.name) ?? 0,
      };
    }),
    leases: { write, integration },
    issues: input.observations.map((o) =>
      issueRow(
        o,
        input,
        byIssue.get(o.issue) ?? { representative: o.issue, members: [o.issue] },
        conflicted,
      ),
    ),
    conflicts: input.decision.conflicts,
    ...(input.recent !== undefined && input.recent.length > 0 ? { recent: input.recent } : {}),
  };
};

export const parseOverlay = (raw: unknown): BoardOverlay => {
  if (typeof raw !== "object" || raw === null) throw new Error("overlay が object ではない");
  const o = raw as Record<string, unknown>;
  const humanTodo = o["humanTodo"];
  const notes = o["notes"];
  if (humanTodo !== undefined && !Array.isArray(humanTodo)) {
    throw new Error("overlay.humanTodo が配列ではない");
  }
  if (
    notes !== undefined &&
    (typeof notes !== "object" || notes === null || Array.isArray(notes))
  ) {
    throw new Error("overlay.notes が map ではない");
  }
  return {
    ...(humanTodo !== undefined ? { humanTodo: humanTodo as HumanTodo[] } : {}),
    ...(notes !== undefined ? { notes: notes as Record<string, string> } : {}),
  };
};
