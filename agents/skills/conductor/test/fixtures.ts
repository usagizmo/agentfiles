// `scenarios` の観測欄を型付きの入力にするための builder。
//
// **既定は「何も無い課題」**。各行は「その行が語っている観測」だけを上書きする ——
// 既定に意味を持たせると、行が黙って別の前提を掴む。

import type {
  IntentRecord,
  IssueObservation,
  SessionObservation,
  SurfaceObservation,
  WaitRecord,
} from "../src/observation.ts";
import { absent, present } from "../src/types.ts";

/**
 * 面 1 つぶんの既定。**worktree が無い面の `dirty` は `present(false)`**
 * —— 未コミットが「無い」ことは観測できている（読めなかった `-` とは別）。
 */
export const surface = (over: Partial<SurfaceObservation> = {}): SurfaceObservation => ({
  name: "control",
  usesPr: true,
  countsCapacity: true,
  aheadOfIntegration: present(false),
  dirty: present(false),
  hasCheckout: present(false),
  terminal: present(false),
  landable: present(false),
  liveCheckoutHealthy: present(true),
  ...over,
});

export const session = {
  running: { kind: "running" } as const satisfies SessionObservation,
  idle: { kind: "idle" } as const satisfies SessionObservation,
  blocked: { kind: "blocked" } as const satisfies SessionObservation,
  none: { kind: "none" } as const satisfies SessionObservation,
  unclassifiable: (raw: string): SessionObservation => ({ kind: "unclassifiable", raw }),
};

export const wait = {
  absent: { kind: "absent" } as const satisfies WaitRecord,
  cleared: { kind: "cleared" } as const satisfies WaitRecord,
  waiting: { kind: "waiting", validity: { kind: "valid" } } as const satisfies WaitRecord,
  /** 本文が無く、同じ対象に休止の記録がある（実行資源待ちを人待ちとして書いた） */
  mislabeled: {
    kind: "waiting",
    validity: { kind: "resource-wait-mislabeled" },
  } as const satisfies WaitRecord,
  /** 本文が無く、実行資源待ちの証跡も無い */
  undecidable: {
    kind: "waiting",
    validity: { kind: "undecidable" },
  } as const satisfies WaitRecord,
  broken: (reason: string): WaitRecord => ({ kind: "broken", reason }),
};

export const intent = {
  absent: { kind: "absent" } as const satisfies IntentRecord,
  pending: { kind: "pending" } as const satisfies IntentRecord,
  confirmed: { kind: "confirmed" } as const satisfies IntentRecord,
  notRequired: { kind: "not-required" } as const satisfies IntentRecord,
  broken: (reason: string): IntentRecord => ({ kind: "broken", reason }),
};

export const observation = (over: Partial<IssueObservation> = {}): IssueObservation => ({
  issue: 1,
  open: present(true),
  ledger: present("未計画"),
  sourceReadable: present(true),

  claimBranchExists: present(false),
  planCommentExists: present(false),
  issueContractComplete: present(true),
  claimRecord: absent(),

  surfaces: [surface()],

  openPr: present(false),
  checks: absent(),
  latestPrClosedUnmerged: present(false),
  prMerged: present(false),

  submissionEvidence: present(false),

  session: session.none,
  leftover: false,
  activity: "判定不能",
  retiredRefineExists: false,
  refineSession: { kind: "none" },
  refineLeftover: false,
  refineActivity: "判定不能",

  waitRecord: wait.absent,
  waitRecordCreatedAt: absent(),
  pauseRecordExists: false,
  yieldRecord: absent(),
  intentRecord: intent.absent,
  integrationRecordCount: present(0),
  integrationRecord: absent(),

  prunableWorkspace: present(false),

  failureRecord: present({ count: 0, lastAction: null }),
  cycleRecord: present({ count: 0, mark: null }),
  currentMark: present("mark-0"),
  readyRecordStale: present(false),

  bodyMatchesPlan: present(true),
  planInvalidated: present(false),
  // **既定は「キーの一覧を持たない project」ではなく「交差しない」**。
  // 既定を `absent` にすると全行が `unknown` = 全直列になり、交差を語らない行まで
  // 資源で説明が付いてしまう（行が語っていない前提を掴む）。
  resourceKeys: present([]),
  blocksEntry: false,

  dependsOn: [],
  sameBranchAs: [],

  boardOrder: 0,
  claimedAt: absent(),
  worktreeBusy: false,
  worktreeOccupied: false,
  ...over,
});
