// 観測を組み立てる層。**`watch.sh` を再実装しない** —— あちらが観測の SSOT で、
// 「tick が読んだ観測をそのまま baseline に渡す」という不変条件を持っている。
// ここがやるのは、snapshot の decode と、snapshot に無い材料の補完と、`IssueObservation` の構成だけ。
//
// **外部呼び出しは port として受け取る。**production / test の差は型で表し、env で分岐しない。

import {
  issues as decodeIssues,
  landingTips,
  liveCheckouts,
  localBranches,
  parseSnapshot,
  projectStatus,
  pullRequests,
  remoteBranches,
  sessions as decodeSessions,
  workspaceRows,
  worktrees as decodeWorktrees,
} from "./decode.ts";
import type { LocalBranchRow, Tri, WorkspaceRow } from "./decode.ts";
import type { IssueObservation, SessionObservation, SurfaceObservation } from "./observation.ts";
import {
  claimRecord,
  cycleRecord,
  extractMarker,
  intentRecord,
  integrationRecord,
  integrationRecordCount,
  reportFromSources,
  retryRecord,
  waitRecord,
  yieldRecord,
  type ReportRecord,
} from "./records.ts";
import { CONCURRENCY, mapLimit } from "./limit.ts";
import { normalizeProgress } from "./normalize.ts";
import { classifyChecks } from "./checks.ts";
import { deriveSurface } from "./surfaces.ts";
import type { SurfaceFacts } from "./surfaces.ts";
import { reportValid } from "./report.ts";
import type { Ledger, Observed, Progress } from "./types.ts";
import { absent, invalid, present, unobservable } from "./types.ts";

/**
 * 面ごとの git。
 * **`統合先..branch` で測る** —— branch 上の commit の存在で読むと、追随しただけの空 branch が
 * `実装中` に化ける。
 */
export type SurfaceGit = {
  readonly ahead: Observed<boolean>;
  readonly head: Observed<string>;
};

/** snapshot に無い材料を取る口。**実装は 1 つで、テストは fake を渡す。** */
export type ObservePort = {
  /** `watch.sh --snapshot` の出力 */
  readonly snapshot: () => Promise<string>;
  /** Issue 本文（番号 → 本文） */
  readonly issueBodies: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, Observed<string>>>;
  /** 固定 marker のコメント本文（番号 → 本文の配列） */
  readonly issueComments: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, Observed<readonly string[]>>>;
  /** 面ごとの git。`統合先..branch` が非空かと、その面の branch head。 */
  readonly surfaceGit: (issue: number, surface: string) => Promise<SurfaceGit>;
  /**
   * `git merge-base --is-ancestor`。解決できない SHA は `present(false)`。
   * git 自体が落ちたときだけ `unobservable`。
   */
  readonly isAncestor: (
    surface: string,
    ancestor: string,
    descendant: string,
  ) => Promise<Observed<boolean>>;
  /**
   * 成果の指紋（`scripts/cycle-mark.py`）。**渡すのは正規化済みの値だけ** ——
   * 成分の名前と符号化はスクリプトが専任する（引数表は `references/protocols.md`）。
   */
  readonly cycleMark: (input: CycleMarkInput) => Promise<Observed<string>>;
  /**
   * 本文が計画の記録と一致しているか・計画が失効したか・資源キー（計画コメントの中身）。
   * **`landing` はその課題の着地面**。座標表の全面を渡さない —— 制御面の base は他 repo に
   * 存在しないので、渡すと判定不能 = 交差扱いが全課題で立つ。
   */
  readonly planFacts: (
    issue: number,
    landing: readonly string[],
  ) => Promise<{
    readonly bodyMatchesPlan: Observed<boolean>;
    readonly planInvalidated: Observed<boolean>;
    readonly resourceKeys: Observed<readonly string[]>;
  }>;
  /**
   * 在庫の鮮度。**判定の 5 つは `ready-record.md`「読むときの判定」**が SSOT ——
   * 記録が読めるかどうかだけで決めると、統合先が進んでも本文が変わっても計画済みのまま claim される。
   */
  readonly readyFacts: (issue: number, landing: readonly string[]) => Promise<Observed<boolean>>;
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
    /** 入場を止める宣言。**運び方は `issue-contract.md`。いつ置くかは project の領分** */
    readonly blocksEntry: boolean;
    /** claim の記録が書かれた時刻。**merge の枠の順序キー**（PR 作成の早さでは選ばない） */
    readonly claimedAt: Observed<number>;
    /** 人待ちコメントの `createdAt`。**`updatedAt` で代用しない** */
    readonly waitRecordCreatedAt: Observed<number>;
    /**
     * 紐づく制御面 PR（open または merged）の `report` / `halt` コメント。
     * **PR 一覧が読めなければ unobservable** —— `present([])` に倒すと提出証跡が「無い」になる。
     */
    readonly linkedPrReportComments: Observed<readonly string[]>;
  }>;
};

/**
 * 指紋の材料。**`ledger` が式を決める**（`未計画` なら計画の周、それ以外は解決の周）。
 * checkout path と host は port が持つので入れない。branch も port が git から引く。
 */
export type CycleMarkInput = {
  readonly issue: number;
  readonly ledger: Ledger;
  readonly progress: Progress;
  /** 着地面ごとの worktree。**無いことも明示して渡す**（省略は usage error） */
  readonly surfaces: readonly { readonly name: string; readonly worktree: string | null }[];
  /** 計画コメント。bytes は `protocols.md` の「file の bytes」。無ければ null */
  readonly planComment: string | null;
  /** 人待ちの記録。bytes は `protocols.md` の「file の bytes」 */
  readonly waitRecord: string | null;
  /** 計画の周のみ。その課題自身 1 件。bytes は `protocols.md` の「file の bytes」 */
  readonly issueBodies: readonly { readonly issue: number; readonly body: string }[];
  /**
   * 同じ worktree に居る所有外セッション。**name + cwd だけ。状態は入れない。**
   * 空は `--no-occupied`。
   */
  readonly occupied: readonly { readonly name: string; readonly cwd: string }[];
};

/** project の Status 名 → `ledger`。**対応表は project 必須**（無ければ fail-closed）。 */
export type StatusMap = ReadonlyMap<string, Ledger>;

/** **`-` を `0` へ畳まない。**読めなかったことは値の 1 つ。 */
const fromTri = (t: Tri | undefined): Observed<boolean> => {
  if (t === undefined) return absent();
  if (t === "unreadable") return unobservable("snapshot が `-` を返した");
  return present(t);
};

/**
 * 座標表に無い面。**面ごと観測できないものとして残す** —— 正規化が
 * `着地面が解決できない` を立てるので、座標表の欠けがそのまま人へ出る。
 *
 * `usesPr` だけは真偽で持つ型なので `true` を置く。**この値では何も決まらない** ——
 * `terminal` が `unobservable` である限り、着地の判定は先へ進まない。live の検査は `merge` skill。
 */
const unknownSurface = (name: string): SurfaceObservation => {
  // 面の名前は報告する側が添えるので、理由には入れない。
  const reason = "座標表に無い（面を表から外した後も、本文の宣言や claim の記録が指したまま）";
  return {
    name,
    usesPr: true,
    countsCapacity: true,
    aheadOfIntegration: unobservable(reason),
    dirty: unobservable(reason),
    hasCheckout: unobservable(reason),
    terminal: unobservable(reason),
    landable: unobservable(reason),
    liveCheckoutHealthy: unobservable(reason),
  };
};

/**
 * 本文の先頭区画。**最初の見出しより前**（`same-branch.md`「宣言の形と置き場所」）。
 *
 * **空行までにしない。**先頭区画は宣言専用ではなく、保留バナー・注記・URL・要約が同居する ——
 * 空行で切ると、それらの後ろに書かれた宣言が読まれない。
 */
const preamble = (body: string): string => {
  const lines = body.split("\n");
  const heading = lines.findIndex((line) => /^#{1,6}\s/.test(line));
  return (heading < 0 ? lines : lines.slice(0, heading)).join("\n");
};

/**
 * 宣言行を先頭区画・**行頭**からだけ読む（本文全体の文字列一致では辿らない）。
 * **3 つとも同じ規則に相乗りする**（置き場所の規則を宣言ごとに分けない）。
 * **行頭の `**` 装飾は許容する**（`**Depends on #N**`）。
 */
const declarationLines = (body: string, keyword: string): string[] => {
  const found: string[] = [];
  for (const line of preamble(body).split("\n")) {
    const match = new RegExp(`^(?:\\*\\*)?${keyword}\\s+(\\S+?)\\*{0,2}\\s*$`).exec(line);
    const captured = match?.[1];
    if (captured !== undefined) found.push(captured);
  }
  return found;
};

const declarations = (body: string, keyword: "Depends on" | "Same branch as"): number[] => {
  const found: number[] = [];
  for (const raw of declarationLines(body, keyword)) {
    const match = /^#(\d+)$/.exec(raw);
    const captured = match?.[1];
    if (captured !== undefined) found.push(Number(captured));
  }
  return found;
};

/** `sessions` の行は `<名前> <状態>`。任意で後ろに cwd。**分類できない値を丸めない。** */
const classifySession = (rows: readonly string[], name: string): SessionObservation => {
  const row = rows.find((r) => r.split(" ")[0] === name);
  if (row === undefined) return { kind: "none" };
  const raw = row.split(" ")[1] ?? "";
  if (raw === "working") return { kind: "running" };
  if (raw === "idle" || raw === "done") return { kind: "idle" };
  if (raw === "blocked") return { kind: "blocked" };
  return { kind: "unclassifiable", raw };
};

const OWNED_SESSION = /^(retired-)?(refine|resolve)-\d+$/;

const cwdOnOwned = (cwd: string, ownedPaths: readonly string[]): boolean =>
  ownedPaths.some(
    (path) => cwd === path || cwd.startsWith(`${path}/`) || path.startsWith(`${cwd}/`),
  );

type ForeignRow = { readonly name: string; readonly status: string; readonly cwd: string };

/** 所有外で、課題の worktree に cwd が載っている行。**cwd が無い行は入れない。** */
const foreignOnOwned = (rows: readonly string[], ownedPaths: readonly string[]): ForeignRow[] => {
  const out: ForeignRow[] = [];
  for (const row of rows) {
    const [name, status, ...cwdParts] = row.split(" ");
    if (name === undefined || name === "conductor" || OWNED_SESSION.test(name)) continue;
    if (status === undefined) continue;
    const cwd = cwdParts.join(" ");
    // **cwd が無い行は同じ worktree と判定しない。**無いことを全所有へ倒すと、
    // 帰属できない 1 本が全課題の write を止める。
    if (cwd === "") continue;
    if (!cwdOnOwned(cwd, ownedPaths)) continue;
    out.push({ name, status, cwd });
  }
  return out;
};

/** 同じ worktree で `refine` / `resolve` / `conductor` 以外が working か。 */
export const worktreeBusy = (rows: readonly string[], ownedPaths: readonly string[]): boolean =>
  foreignOnOwned(rows, ownedPaths).some((row) => row.status === "working");

/** 同じ worktree で `refine` / `resolve` / `conductor` 以外が居るか。**状態は問わない。** */
export const worktreeOccupied = (rows: readonly string[], ownedPaths: readonly string[]): boolean =>
  foreignOnOwned(rows, ownedPaths).length > 0;

/** 指紋用。**状態は落とす。**出現・消滅・cwd だけが動く。 */
export const occupiedSessions = (
  rows: readonly string[],
  ownedPaths: readonly string[],
): readonly { readonly name: string; readonly cwd: string }[] =>
  foreignOnOwned(rows, ownedPaths)
    .map(({ name, cwd }) => ({ name, cwd }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.cwd.localeCompare(b.cwd));

/** 全コメントを 1 本に連ねる。marker は本文をまたがないので、重複検知はそのまま効く。 */
const joinComments = (comments: readonly string[]): string => comments.join("\n\n");

/** 座標表から観測へ写す面の属性。**欠けたらその面は座標表に無い。** */
export type SurfaceAttrs = {
  readonly usesPr: boolean;
  readonly countsCapacity: boolean;
};

export const observeTick = async (
  port: ObservePort,
  statusMap: StatusMap,
  /** 座標表。面の名前 → 属性 */
  surfaceAttrs: ReadonlyMap<string, SurfaceAttrs>,
): Promise<readonly IssueObservation[]> => {
  const snapshot = parseSnapshot(await port.snapshot());
  const statuses = projectStatus(snapshot);
  const issueRows = new Map(decodeIssues(snapshot).map((r) => [r.issue, r]));
  const sessionRows = decodeSessions(snapshot);
  const worktreeRows = decodeWorktrees(snapshot);
  const prRows = pullRequests(snapshot);
  const tips = landingTips(snapshot);
  const locals = localBranches(snapshot);

  // **dirty か、統合先より behind なら異常**。upstream より先行しているのは異常ではない
  // （push が人の領分の面では常態）。**読めなかったものを clean 側へ倒さない。**
  const liveHealth = new Map<string, Observed<boolean>>(
    liveCheckouts(snapshot).map((row) => [
      row.surface,
      row.dirty === "unreadable"
        ? unobservable("live checkout の dirty を読めない")
        : present(row.dirty === false && row.behind === 0),
    ]),
  );

  const workspaceList = workspaceRows(snapshot);

  // **面ごとの worktree 一覧を読めたか。**`watch.sh` の `plane_unknown` は面ごと `-` で潰すので、
  // 実体が 0 件なのか読めなかったのかを行の有無では区別できない。**dirty を読めない行が
  // 1 本でもあれば、その面の一覧そのものを観測できていない**として扱う。
  const blindSurfaces = new Set(
    worktreeRows.filter((w) => w.dirty === "unreadable").map((w) => w.surface),
  );

  const numbers = statuses.map((s) => s.issue);
  const [bodies, comments] = await Promise.all([
    port.issueBodies(numbers),
    port.issueComments(numbers),
  ]);

  // **件数ぶん並行に投げない**（`limit.ts`）。1 件につき計画と PR の 2 経路が走るので、
  // ここを開けると board の件数の 2 倍が同時に立つ。
  const base = await mapLimit(statuses, CONCURRENCY, async (status): Promise<IssueObservation> => {
    const issue = status.issue;
    // **読めなかったものを空へ畳まない。**畳むと Issue 契約が「欠けている」に、
    // 記録が全部「無い」に読まれ、差し戻しと片付けが誤った観測で走る。
    // 値そのものは `観測できない` の Conflict が最上段で当たるので誰も読まない。
    const bodyObserved = bodies.get(issue) ?? absent();
    const commentsObserved = comments.get(issue) ?? absent();
    const body = bodyObserved.kind === "present" ? bodyObserved.value : "";
    const commentText =
      commentsObserved.kind === "present" ? joinComments(commentsObserved.value) : "";

    const parsedYield = yieldRecord(commentText);
    const pause = extractMarker(commentText, "yield").kind === "present";
    const claim = claimRecord(commentText);

    // **claim 後は claim の記録の `landing` が着地面の SSOT。**
    // **claim 前は本文の `Lands in`**（宣言が無ければ制御面 1 面）。本文を見ずに既定へ倒すと、
    // 座標表に無い面を宣言した課題が claim でき、複数面を宣言した課題は二次面が落ちる。
    const declared = declarationLines(body, "Lands in");
    const surfaceNames =
      claim.kind === "present" && claim.value.landing.length > 0
        ? claim.value.landing
        : declared.length > 0
          ? declared
          : [...surfaceAttrs.keys()].slice(0, 1);

    const ledger = statusMap.get(status.status);

    // **着地面を決めてから計画を照らす。**失効は面ごとの base から測るので、
    // その課題の着地面が決まっていないと問い合わせられない。
    // **完了 は計画の照合も在庫の鮮度も読まない rung しか当たらない。**
    // 飛ばした値は unobservable のまま残す（`present(false)` にも `absent` にも倒さない）。
    const skipPlanReady = ledger === "完了";
    const [plan, extra, stale] = await Promise.all([
      skipPlanReady
        ? Promise.resolve({
            bodyMatchesPlan: unobservable<boolean>("完了の課題は計画の照合をしない"),
            planInvalidated: unobservable<boolean>("完了の課題は計画の照合をしない"),
            resourceKeys: absent<readonly string[]>(),
          })
        : port.planFacts(issue, surfaceNames),
      port.issueFacts(issue),
      skipPlanReady
        ? Promise.resolve(unobservable<boolean>("完了の課題は在庫の鮮度を見ない"))
        : port.readyFacts(issue, surfaceNames),
    ]);
    const report = reportFromSources(commentText, extra.linkedPrReportComments);

    const surfaces: SurfaceObservation[] = await Promise.all(
      surfaceNames.map(async (name) => {
        // **座標表に無い面を「PR で着地する面」へ倒さない。**倒すと、着地の条件も
        // live checkout の検査も観測していない面の型で決まり、座標表の欠けが
        // `着地面が解決できない` として出てこない。
        const attrs = surfaceAttrs.get(name);
        if (attrs === undefined) return unknownSurface(name);
        const { usesPr, countsCapacity } = attrs;

        // **帰属は面の名前だけでは引けない。**同じ面に複数の課題の worktree が並ぶので、
        // path に自分の claim branch（`{prefix}/{番号}-`）が入っているものだけを自分のものとする。
        // 面だけで引くと、隣の課題の worktree を自分の容量として数え、片付けの対象にもする。
        const worktree = worktreeRows.find(
          (w) => w.surface === name && ownsWorktreePath(w.path, issue),
        );
        const git = await surfaceGitOf(port, issue, name, locals, tips);
        const blind = blindSurfaces.has(name);
        const pr = prRows.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
        const facts: SurfaceFacts = {
          name,
          usesPr,
          countsCapacity,
          aheadOfIntegration: git.ahead,
          head: git.head,
          // **worktree が無いことは「読めなかった」ではない。**checkout が無い面には
          // 未コミットの変更が存在しえないので `false` で確定する —— `absent` にすると
          // 「dirty でないとは言えない」に読まれ、**claim もされていない課題が全部
          // 「成果物あり」になる**。読めなかったのは一覧ごと潰れている場合だけ。
          dirty: blind
            ? unobservable("面の worktree 一覧を読めない")
            : worktree === undefined
              ? present(false)
              : fromTri(worktree.dirty),
          hasCheckout: blind
            ? unobservable("面の worktree 一覧を読めない")
            : present(worktree !== undefined),
          liveCheckoutHealthy:
            liveHealth.get(name) ?? unobservable("live checkout を観測していない"),
          prMerged: extra.prMerged,
          openPr: present(pr !== undefined),
          checksGreen:
            pr === undefined || pr.checks === "untracked"
              ? absent()
              : present(classifyChecks(pr.checks).green),
        };
        return deriveSurface(facts, report);
      }),
    );

    const row = issueRows.get(issue);

    return {
      issue,
      // **board に居るのに `issues` 節に無い課題を closed へ倒さない。**倒すと `取り下げ` に
      // 化け、まだ生きている課題が終端として片付けの対象になる。
      open: row === undefined ? unobservable("board に居るが issues 節に無い") : present(row.open),
      sourceReadable:
        bodyObserved.kind === "present" && commentsObserved.kind === "present"
          ? present(true)
          : unobservable("Issue の本文かコメントを読めない"),
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

      submissionEvidence: await submissionEvidenceOf(report, surfaceNames, tips, port),

      session: classifySession(sessionRows, `resolve-${issue}`),
      retiredRefineExists: sessionRows.some((r) => r.startsWith(`retired-refine-${issue} `)),
      refineSession: classifySession(sessionRows, `refine-${issue}`),
      worktreeBusy: worktreeBusy(
        sessionRows,
        worktreeRows.filter((w) => ownsWorktreePath(w.path, issue)).map((w) => w.path),
      ),
      worktreeOccupied: worktreeOccupied(
        sessionRows,
        worktreeRows.filter((w) => ownsWorktreePath(w.path, issue)).map((w) => w.path),
      ),

      waitRecord: waitRecord(commentText, pause),
      waitRecordCreatedAt: extra.waitRecordCreatedAt,
      pauseRecordExists: pause,
      yieldRecord: parsedYield,
      intentRecord: intentRecord(commentText),
      integrationRecordCount: integrationRecordCount(commentText),
      integrationRecord: integrationRecord(commentText),

      prunableWorkspace: present(isPrunableWorkspace(workspaceList, issue)),

      failureRecord: retryRecord(commentText),
      cycleRecord: cycleRecord(commentText),
      currentMark: absent(),
      readyRecordStale: stale,

      bodyMatchesPlan: plan.bodyMatchesPlan,
      planInvalidated: plan.planInvalidated,
      resourceKeys: plan.resourceKeys,
      blocksEntry: extra.blocksEntry,

      dependsOn: declarations(body, "Depends on"),
      sameBranchAs: declarations(body, "Same branch as"),

      boardOrder: status.boardOrder,
      claimedAt: extra.claimedAt,
    };
  });

  // **指紋は要る課題にだけ作る。**`decide` が読むのは周回の記録が `mark` を持つときだけで、
  // 書く側（回す action）は終端に達した課題では走らない。全件に走らせると board の件数ぶん
  // python を起こす。**落としているのは対象であって観測項目ではない。**
  const marks = new Map<number, Observed<string>>();
  const needsMark = base.filter((o) => {
    const cycle = o.cycleRecord.kind === "present" ? o.cycleRecord.value : undefined;
    if (cycle?.mark != null) return true;
    return !(o.ledger.kind === "present" && o.ledger.value === "完了");
  });
  await mapLimit(needsMark, CONCURRENCY, async (o) => {
    if (o.ledger.kind !== "present") return;
    const raw = comments.get(o.issue);
    const text = raw?.kind === "present" ? joinComments(raw.value) : "";
    const plan = extractMarker(text, "plan");
    const waitBlock = extractMarker(text, "wait");
    // **有効な人待ちだけ渡す**（判定は呼び出し側、と引数表が定めている）。
    const validWait =
      o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid"
        ? waitBlock.kind === "present"
          ? waitBlock.value
          : null
        : null;
    const ledger = o.ledger.value;
    const issueBodies: { issue: number; body: string }[] = [];
    if (ledger === "未計画") {
      // **計画の周は、その課題自身の本文 1 件。**
      // **読めない本文を空へ畳まない。**
      const b = bodies.get(o.issue);
      if (b?.kind !== "present") {
        marks.set(o.issue, unobservable(`Issue ${String(o.issue)} の本文を読めない`));
        return;
      }
      issueBodies.push({ issue: o.issue, body: b.value });
    }
    marks.set(
      o.issue,
      await port.cycleMark({
        issue: o.issue,
        ledger,
        progress: normalizeProgress(o),
        surfaces: o.surfaces.map((s) => ({
          name: s.name,
          worktree:
            worktreeRows.find((w) => w.surface === s.name && ownsWorktreePath(w.path, o.issue))
              ?.path ?? null,
        })),
        planComment: plan.kind === "present" ? plan.value : null,
        waitRecord: validWait,
        issueBodies,
        occupied: occupiedSessions(
          sessionRows,
          worktreeRows.filter((w) => ownsWorktreePath(w.path, o.issue)).map((w) => w.path),
        ),
      }),
    );
  });

  return base.map((o) => ({ ...o, currentMark: marks.get(o.issue) ?? absent() }));
};

/**
 * YAML の存在は提出ではない。妥当なら `present(true)`、YAML があるが妥当でないなら
 * `present(false)`。PR 一覧が読めないときだけ `unobservable`。
 */
const submissionEvidenceOf = async (
  report: Observed<ReportRecord>,
  landing: readonly string[],
  tips: ReadonlyMap<string, string>,
  port: ObservePort,
): Promise<Observed<boolean>> => {
  if (report.kind === "unobservable") return unobservable(report.reason);
  if (report.kind !== "present") return present(false);
  return reportValid(report.value, landing, tips, port.isAncestor);
};

/**
 * branch の有無と head は snapshot に在る。**無い / tip と同じなら git を引き直さない。**
 * SHA が tip と違うときだけ `統合先..branch` を測る（behind だけの非空はここでは分からない）。
 *
 * **tip が `-` なら ahead を false へ畳まない。**畳むと読めない面が透過し、終端へ上がる。
 */
const surfaceGitOf = async (
  port: ObservePort,
  issue: number,
  surface: string,
  locals: readonly LocalBranchRow[],
  tips: ReadonlyMap<string, string>,
): Promise<SurfaceGit> => {
  const tip = tips.get(surface);
  if (tip === undefined || tip === "-") {
    return {
      ahead: unobservable("統合先の tip を読めない"),
      head: unobservable("統合先の tip を読めない"),
    };
  }
  const branch = locals.find(
    (b) => b.surface === surface && new RegExp(`^[^/]+/${issue}-`).test(b.branch),
  );
  if (branch === undefined) return { ahead: present(false), head: absent() };
  if (branch.sha === tip) return { ahead: present(false), head: present(branch.sha) };
  return port.surfaceGit(issue, surface);
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

/**
 * 孤児 workspace の帰属。候補が 0 または 2 以上、あるいは linked でないなら触らない。
 * 述語は `is_linked_worktree` が真かつ checkout_path が実在しないこと。
 */
const isPrunableWorkspace = (rows: readonly WorkspaceRow[], issue: number): boolean => {
  const candidates = rows.filter(
    (row) => row.path !== "" && row.path !== "-" && ownsWorktreePath(row.path, issue),
  );
  if (candidates.length !== 1) return false;
  const row = candidates[0];
  return row !== undefined && row.linked === true && row.exists === false;
};

/** `--- remote branches ---` に `{prefix}/{番号}-` の branch が在るか。 */
const snapshotHasClaimBranch = (
  snapshot: ReturnType<typeof parseSnapshot>,
  issue: number,
): boolean => remoteBranches(snapshot).some((b) => new RegExp(`^origin/[^/]+/${issue}-`).test(b));

const checksOf = (
  prs: ReturnType<typeof pullRequests>,
  issue: number,
): Observed<{ readonly running: number; readonly green: boolean }> => {
  const pr = prs.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
  if (pr === undefined) return absent();
  // **追跡していない PR の checks を「無し」と読まない。**
  if (pr.checks === "untracked") return unobservable("追跡していない PR");
  return present(classifyChecks(pr.checks));
};
