// 観測を組み立てる層。**`watch.sh` を再実装しない** —— あちらが観測の SSOT で、
// 「tick が読んだ観測をそのまま baseline に渡す」という不変条件を持っている。
// ここがやるのは、snapshot の decode と、snapshot に無い材料の補完と、`IssueObservation` の構成だけ。
//
// **外部呼び出しは port として受け取る。**production / test の差は型で表し、env で分岐しない。

import {
  issues as decodeIssues,
  parseSnapshot,
  projectStatus,
  pullRequests,
  liveCheckouts,
  sessions as decodeSessions,
  workspaces,
  worktrees as decodeWorktrees,
} from "./decode.ts";
import type { Tri } from "./decode.ts";
import type { IssueObservation, SessionObservation, SurfaceObservation } from "./observation.ts";
import {
  claimRecord,
  cycleRecord,
  extractMarker,
  intentRecord,
  integrationRecord,
  readyRecord,
  reportRecord,
  retryRecord,
  waitRecord,
} from "./records.ts";
import { deriveSurface } from "./surfaces.ts";
import type { SurfaceFacts } from "./surfaces.ts";
import type { Ledger, Observed } from "./types.ts";
import { absent, invalid, present, unobservable } from "./types.ts";

/** snapshot に無い材料を取る口。**実装は 1 つで、テストは fake を渡す。** */
export type ObservePort = {
  /** `watch.sh --snapshot` の出力 */
  readonly snapshot: () => Promise<string>;
  /** Issue 本文（番号 → 本文） */
  readonly issueBodies: (issues: readonly number[]) => Promise<ReadonlyMap<number, string>>;
  /** 固定 marker のコメント本文（番号 → 本文の配列） */
  readonly issueComments: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, readonly string[]>>;
  /**
   * 面ごとの git。`統合先..branch` が非空かと、その面の branch head。
   * **`統合先..branch` で測る** —— branch 上の commit の存在で読むと、追随しただけの空 branch が
   * `実装中` に化ける。
   */
  readonly surfaceGit: (
    issue: number,
    surface: string,
  ) => Promise<{ readonly ahead: Observed<boolean>; readonly head: Observed<string> }>;
  /** 成果の指紋（`scripts/cycle-mark.py`） */
  readonly cycleMark: (issue: number) => Promise<Observed<string>>;
  /** 本文が計画の記録と一致しているか・計画が失効したか・資源キー（計画コメントの中身） */
  readonly planFacts: (issue: number) => Promise<{
    readonly bodyMatchesPlan: Observed<boolean>;
    readonly planInvalidated: Observed<boolean>;
    readonly resourceKeys: Observed<readonly string[]>;
  }>;
  /**
   * snapshot からは導けないもの。**既定値へ倒さない** —— どれも `present(false)` にすると
   * 片付け・終端・入場を止める宣言・merge の枠の順序が、観測していない値で決まる。
   */
  readonly issueFacts: (issue: number) => Promise<{
    /** Issue 契約が揃っているか（項目の SSOT は `refine` の Issue 契約） */
    readonly issueContractComplete: Observed<boolean>;
    /** merged な PR があるか。snapshot は open PR しか持たない */
    readonly prMerged: Observed<boolean>;
    /** open PR が無く、head に紐づく最新 PR が unmerged で closed */
    readonly latestPrClosedUnmerged: Observed<boolean>;
    /** 入場を止める宣言。**置き場は project 差分が定める** */
    readonly blocksEntry: boolean;
    /** claim の記録が書かれた時刻。**merge の枠の順序キー**（PR 作成の早さでは選ばない） */
    readonly claimedAt: Observed<number>;
  }>;
};

/** project の Status 名 → `ledger`。**対応表は project 必須**（無ければ fail-closed）。 */
export type StatusMap = ReadonlyMap<string, Ledger>;

/** **`-` を `0` へ畳まない。**読めなかったことは値の 1 つ。 */
const fromTri = (t: Tri | undefined): Observed<boolean> => {
  if (t === undefined) return absent();
  if (t === "unreadable") return unobservable("snapshot が `-` を返した");
  return present(t);
};

/** 宣言行を本文の先頭区画・行頭からだけ読む（本文全体の文字列一致では辿らない）。 */
const declarations = (body: string, keyword: "Depends on" | "Same branch as"): number[] => {
  const head = body.split(/\n\s*\n/)[0] ?? "";
  const found: number[] = [];
  for (const line of head.split("\n")) {
    const match = new RegExp(`^${keyword}\\s+#(\\d+)`).exec(line.trim());
    const captured = match?.[1];
    if (captured !== undefined) found.push(Number(captured));
  }
  return found;
};

/** `sessions` の行は `<名前> <状態>`。**分類できない値を丸めない。** */
const classifySession = (rows: readonly string[], name: string): SessionObservation => {
  const row = rows.find((r) => r.split(" ")[0] === name);
  if (row === undefined) return { kind: "none" };
  const raw = row.split(" ")[1] ?? "";
  if (raw === "working") return { kind: "running" };
  if (raw === "idle" || raw === "done") return { kind: "idle" };
  return { kind: "unclassifiable", raw };
};

/** 全コメントを 1 本に連ねる。marker は本文をまたがないので、重複検知はそのまま効く。 */
const joinComments = (comments: readonly string[]): string => comments.join("\n\n");

export const observe = async (
  port: ObservePort,
  statusMap: StatusMap,
  /** 座標表。面の名前 → PR で着地するか */
  surfaceUsesPr: ReadonlyMap<string, boolean>,
): Promise<readonly IssueObservation[]> => {
  const snapshot = parseSnapshot(await port.snapshot());
  const statuses = projectStatus(snapshot);
  const issueRows = new Map(decodeIssues(snapshot).map((r) => [r.issue, r]));
  const sessionRows = decodeSessions(snapshot);
  const worktreeRows = decodeWorktrees(snapshot);
  const prRows = pullRequests(snapshot);

  // **dirty か、HEAD が統合先の branch でない状態は異常**。upstream より先行しているのは
  // 異常ではない（push が人の領分の面では常態）。**読めなかったものを clean 側へ倒さない。**
  const liveHealth = new Map<string, Observed<boolean>>(
    liveCheckouts(snapshot).map((row) => [
      row.surface,
      row.dirty === "unreadable"
        ? unobservable("live checkout の dirty を読めない")
        : present(row.dirty === false && row.behind === 0),
    ]),
  );

  // `--- workspaces ---` に在るが worktree の path が無いものが `prunable`。
  const worktreePaths = new Set(worktreeRows.map((w) => w.path));
  const prunableWorkspaces = new Set(
    workspaces(snapshot)
      .map((row) => row.split(" "))
      .filter((parts) => {
        const path = parts.slice(1).join(" ");
        return path !== "" && !worktreePaths.has(path);
      })
      .map((parts) => parts.slice(1).join(" ")),
  );

  const numbers = statuses.map((s) => s.issue);
  const [bodies, comments] = await Promise.all([
    port.issueBodies(numbers),
    port.issueComments(numbers),
  ]);

  return Promise.all(
    statuses.map(async (status): Promise<IssueObservation> => {
      const issue = status.issue;
      const body = bodies.get(issue) ?? "";
      const commentText = joinComments(comments.get(issue) ?? []);

      const [plan, extra] = await Promise.all([port.planFacts(issue), port.issueFacts(issue)]);
      const pause = extractMarker(commentText, "yield").kind === "present";
      const claim = claimRecord(commentText);
      const report = reportRecord(commentText);

      // **claim 後は claim の記録の `landing` が着地面の SSOT。**claim 前は座標表の既定 1 面。
      const surfaceNames =
        claim.kind === "present" && claim.value.landing.length > 0
          ? claim.value.landing
          : [...surfaceUsesPr.keys()].slice(0, 1);

      const surfaces: SurfaceObservation[] = await Promise.all(
        surfaceNames.map(async (name) => {
          const git = await port.surfaceGit(issue, name);
          // **帰属は面の名前だけでは引けない。**同じ面に複数の課題の worktree が並ぶので、
          // path に自分の claim branch（`{prefix}/{番号}-`）が入っているものだけを自分のものとする。
          // 面だけで引くと、隣の課題の worktree を自分の容量として数え、片付けの対象にもする。
          const worktree = worktreeRows.find(
            (w) => w.surface === name && ownsWorktreePath(w.path, issue),
          );
          const pr = prRows.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
          const facts: SurfaceFacts = {
            name,
            usesPr: surfaceUsesPr.get(name) ?? true,
            aheadOfIntegration: git.ahead,
            head: git.head,
            dirty: fromTri(worktree?.dirty),
            hasCheckout: present(worktree !== undefined),
            liveCheckoutHealthy:
              liveHealth.get(name) ?? unobservable("live checkout を観測していない"),
            prMerged: extra.prMerged,
            openPr: present(pr !== undefined),
            checksGreen:
              pr === undefined || pr.checks === "untracked"
                ? absent()
                : present(pr.checks.length > 0 && pr.checks.every((c) => c === "SUCCESS")),
          };
          return deriveSurface(facts, report);
        }),
      );

      const row = issueRows.get(issue);
      const ledger = statusMap.get(status.status);

      return {
        issue,
        open: row?.open ?? false,
        // **対応表に無い Status を既定へ倒さない**（`invalid` が `Conflict` を立てる）。
        ledger:
          ledger === undefined ? invalid(status.status, "Status の対応が無い") : present(ledger),

        claimBranchExists: present(snapshotHasClaimBranch(snapshot, issue)),
        planCommentExists: present(extractMarker(commentText, "plan").kind === "present"),
        issueContractComplete: extra.issueContractComplete,
        claimRecord: claim,

        surfaces,

        openPr: present(
          surfaces.some((s) => s.usesPr) &&
            prRows.some((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef)),
        ),
        checks: checksOf(prRows, issue),
        latestPrClosedUnmerged: extra.latestPrClosedUnmerged,
        prMerged: extra.prMerged,

        submissionEvidence: present(report.kind === "present"),

        session: classifySession(sessionRows, `resolve-${issue}`),
        retiredRefineExists: sessionRows.some((r) => r.startsWith(`retired-refine-${issue} `)),
        refineSessionExists: sessionRows.some((r) => r.split(" ")[0] === `refine-${issue}`),

        waitRecord: waitRecord(commentText, pause),
        pauseRecordExists: pause,
        intentRecord: intentRecord(commentText),
        integrationRecordCount: present(integrationRecord(commentText).kind === "present" ? 1 : 0),

        // checkout は無いが、所有している workspace が残っている。**snapshot の 2 節の差**で引く。
        prunableWorkspace: present(
          [...prunableWorkspaces].some((path) => ownsWorktreePath(path, issue)),
        ),

        failureRecord: retryRecord(commentText),
        cycleRecord: cycleRecord(commentText),
        currentMark: await port.cycleMark(issue),
        readyRecordStale: stalenessOf(readyRecord(commentText)),

        bodyMatchesPlan: plan.bodyMatchesPlan,
        planInvalidated: plan.planInvalidated,
        resourceKeys: plan.resourceKeys,
        blocksEntry: extra.blocksEntry,

        dependsOn: declarations(body, "Depends on"),
        sameBranchAs: declarations(body, "Same branch as"),

        boardOrder: status.boardOrder,
        claimedAt: extra.claimedAt,
      };
    }),
  );
};

/**
 * その worktree path がこの課題のものか。branch 名は `{prefix}/{Issue 番号}-{slug}` に固定
 * されていて、path の末尾要素がそれを写した形になる。**prefix の集合は project が変えてよい**
 * ので、`feat|fix|chore` のような allowlist を焼き込まない。
 */
const ownsWorktreePath = (path: string, issue: number): boolean => {
  const leaf = path.split("/").pop() ?? "";
  return new RegExp(`(^|[^0-9])${issue}-`).test(leaf);
};

/** `--- remote branches ---` に `{prefix}/{番号}-` の branch が在るか。 */
const snapshotHasClaimBranch = (
  snapshot: ReturnType<typeof parseSnapshot>,
  issue: number,
): boolean =>
  (snapshot.sections.get("remote branches") ?? []).some((b) =>
    new RegExp(`^origin/[^/]+/${issue}-`).test(b),
  );

const checksOf = (
  prs: ReturnType<typeof pullRequests>,
  issue: number,
): Observed<{ readonly running: number; readonly green: boolean }> => {
  const pr = prs.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
  if (pr === undefined) return absent();
  // **追跡していない PR の checks を「無し」と読まない。**
  if (pr.checks === "untracked") return unobservable("追跡していない PR");
  const running = pr.checks.filter(
    (c) => c === "PENDING" || c === "IN_PROGRESS" || c === "QUEUED",
  ).length;
  return present({
    running,
    green: pr.checks.length > 0 && pr.checks.every((c) => c === "SUCCESS"),
  });
};

/** 在庫の鮮度。**判定できないものは陳腐化に倒す**（`ready-record.md`）。 */
const stalenessOf = (record: ReturnType<typeof readyRecord>): Observed<boolean> =>
  record.kind === "present" ? present(false) : present(true);
