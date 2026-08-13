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
import type { LiveCheckoutRow, Tri } from "./decode.ts";
import type { IssueObservation, SessionObservation, SurfaceObservation } from "./observation.ts";
import {
  claimRecord,
  cycleRecord,
  extractMarker,
  intentRecord,
  integrationRecord,
  reportRecord,
  retryRecord,
  waitQuestionText,
  waitRecord,
  yieldRecord,
} from "./records.ts";
import { CONCURRENCY, mapLimit } from "./limit.ts";
import { normalizeProgress } from "./normalize.ts";
import { deriveSurface } from "./surfaces.ts";
import type { SurfaceFacts } from "./surfaces.ts";
import type { Ledger, Observed, Progress } from "./types.ts";
import { absent, invalid, present, unobservable } from "./types.ts";

/** 同じ観測プロセスが display 用に残した材料。**決定は読まない。** */
export type BoardView = {
  readonly titles: ReadonlyMap<number, string>;
  readonly wait: ReadonlyMap<number, { readonly question: string; readonly since: string }>;
  readonly prs: ReadonlyMap<number, number>;
  readonly branches: ReadonlyMap<number, string>;
  readonly counts: ReadonlyMap<
    string,
    { readonly dirty: number; readonly ahead: number; readonly behind: number }
  >;
  readonly live: readonly LiveCheckoutRow[];
  readonly worktreesBySurface: ReadonlyMap<string, number>;
};

export const countKey = (issue: number, surface: string): string => `${issue}\t${surface}`;

export const emptyView = (): BoardView => ({
  titles: new Map(),
  wait: new Map(),
  prs: new Map(),
  branches: new Map(),
  counts: new Map(),
  live: [],
  worktreesBySurface: new Map(),
});

/** 盤面の経過時刻用。**決定は `body` だけ読む。** */
export type IssueCommentView = {
  readonly body: string;
  readonly at: string;
};

/**
 * 面ごとの git。**数を一度取り、boolean はそこから導く。**
 * 数は盤面用。決定は `ahead` / `head` だけ読む。
 */
export type SurfaceGit = {
  readonly ahead: Observed<boolean>;
  readonly head: Observed<string>;
  readonly branch?: Observed<string>;
  readonly aheadCount?: Observed<number>;
  readonly behindCount?: Observed<number>;
  readonly dirtyCount?: Observed<number>;
};

/** snapshot に無い材料を取る口。**実装は 1 つで、テストは fake を渡す。** */
export type ObservePort = {
  /** `watch.sh --snapshot` の出力 */
  readonly snapshot: () => Promise<string>;
  /** Issue 本文（番号 → 本文） */
  readonly issueBodies: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, Observed<string>>>;
  /**
   * Issue 題。**`issueBodies` と同じ一覧から取る。**本文の後に呼び、取り直さない。
   * 決定は読まない。
   */
  readonly issueTitles: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, Observed<string>>>;
  /** 固定 marker のコメント本文（番号 → 本文の配列） */
  readonly issueComments: (
    issues: readonly number[],
  ) => Promise<ReadonlyMap<number, Observed<readonly IssueCommentView[]>>>;
  /**
   * 面ごとの git。`統合先..branch` が非空かと、その面の branch head。
   * **`統合先..branch` で測る** —— branch 上の commit の存在で読むと、追随しただけの空 branch が
   * `実装中` に化ける。
   */
  readonly surfaceGit: (
    issue: number,
    surface: string,
    worktreePath?: string | null,
  ) => Promise<SurfaceGit>;
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
    /** 入場を止める宣言。**置き場は project 差分が定める** */
    readonly blocksEntry: boolean;
    /** claim の記録が書かれた時刻。**merge の枠の順序キー**（PR 作成の早さでは選ばない） */
    readonly claimedAt: Observed<number>;
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
  /** 計画コメントの本文。無ければ null */
  readonly planComment: string | null;
  /** 人待ちの記録の本文。**有効なときだけ渡す**（判定は呼び出し側） */
  readonly waitRecord: string | null;
  /** 計画の周のみ。対象集合の全件 */
  readonly issueBodies: readonly { readonly issue: number; readonly body: string }[];
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
 * `terminal` が `unobservable` である限り、着地の判定も live checkout の検査も先へ進まない。
 */
const unknownSurface = (name: string): SurfaceObservation => {
  // 面の名前は報告する側が添えるので、理由には入れない。
  const reason = "座標表に無い（面を表から外した後も、本文の宣言や claim の記録が指したまま）";
  return {
    name,
    usesPr: true,
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

/** `sessions` の行は `<名前> <状態>`。**分類できない値を丸めない。** */
const classifySession = (rows: readonly string[], name: string): SessionObservation => {
  const row = rows.find((r) => r.split(" ")[0] === name);
  if (row === undefined) return { kind: "none" };
  const raw = row.split(" ")[1] ?? "";
  if (raw === "working") return { kind: "running" };
  if (raw === "idle" || raw === "done") return { kind: "idle" };
  if (raw === "blocked") return { kind: "blocked" };
  return { kind: "unclassifiable", raw };
};

/** 全コメントを 1 本に連ねる。marker は本文をまたがないので、重複検知はそのまま効く。 */
const joinComments = (comments: readonly string[]): string => comments.join("\n\n");

export type ObserveResult = {
  readonly observations: readonly IssueObservation[];
  readonly view: BoardView;
};

/** 決定と盤面が同じ観測を共有する。**盤面だけ取り直さない。** */
export const observeTick = async (
  port: ObservePort,
  statusMap: StatusMap,
  /** 座標表。面の名前 → PR で着地するか */
  surfaceUsesPr: ReadonlyMap<string, boolean>,
): Promise<ObserveResult> => {
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
  // **本文と同じ一覧から取る。**並列にすると cache が空のまま 2 本目の API になる。
  const titles = await port.issueTitles(numbers);

  const branches = new Map<number, string>();
  const counts = new Map<string, { dirty: number; ahead: number; behind: number }>();

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
      commentsObserved.kind === "present"
        ? joinComments(commentsObserved.value.map((c) => c.body))
        : "";

    const parsedYield = yieldRecord(commentText);
    const pause = extractMarker(commentText, "yield").kind === "present";
    const claim = claimRecord(commentText);
    const report = reportRecord(commentText);

    // **claim 後は claim の記録の `landing` が着地面の SSOT。**
    // **claim 前は本文の `Lands in`**（宣言が無ければ制御面 1 面）。本文を見ずに既定へ倒すと、
    // 座標表に無い面を宣言した課題が claim でき、複数面を宣言した課題は二次面が落ちる。
    const declared = declarationLines(body, "Lands in");
    const surfaceNames =
      claim.kind === "present" && claim.value.landing.length > 0
        ? claim.value.landing
        : declared.length > 0
          ? declared
          : [...surfaceUsesPr.keys()].slice(0, 1);

    // **着地面を決めてから計画を照らす。**失効は面ごとの base から測るので、
    // その課題の着地面が決まっていないと問い合わせられない。
    const [plan, extra, stale] = await Promise.all([
      port.planFacts(issue, surfaceNames),
      port.issueFacts(issue),
      port.readyFacts(issue, surfaceNames),
    ]);

    const surfaces: SurfaceObservation[] = await Promise.all(
      surfaceNames.map(async (name) => {
        // **座標表に無い面を「PR で着地する面」へ倒さない。**倒すと、着地の条件も
        // live checkout の検査も観測していない面の型で決まり、座標表の欠けが
        // `着地面が解決できない` として出てこない。
        const usesPr = surfaceUsesPr.get(name);
        if (usesPr === undefined) return unknownSurface(name);

        // **帰属は面の名前だけでは引けない。**同じ面に複数の課題の worktree が並ぶので、
        // path に自分の claim branch（`{prefix}/{番号}-`）が入っているものだけを自分のものとする。
        // 面だけで引くと、隣の課題の worktree を自分の容量として数え、片付けの対象にもする。
        const worktree = worktreeRows.find(
          (w) => w.surface === name && ownsWorktreePath(w.path, issue),
        );
        const git = await port.surfaceGit(issue, name, worktree?.path ?? null);
        if (git.branch?.kind === "present") branches.set(issue, git.branch.value);
        const dirtyN =
          git.dirtyCount?.kind === "present"
            ? git.dirtyCount.value
            : worktree === undefined
              ? 0
              : worktree.dirty === true
                ? 1
                : worktree.dirty === false
                  ? 0
                  : undefined;
        const aheadN =
          git.aheadCount?.kind === "present"
            ? git.aheadCount.value
            : git.ahead.kind === "present"
              ? git.ahead.value
                ? 1
                : 0
              : undefined;
        const behindN = git.behindCount?.kind === "present" ? git.behindCount.value : undefined;
        if (dirtyN !== undefined || aheadN !== undefined || behindN !== undefined) {
          counts.set(countKey(issue, name), {
            dirty: dirtyN ?? 0,
            ahead: aheadN ?? 0,
            behind: behindN ?? 0,
          });
        }
        const blind = blindSurfaces.has(name);
        const pr = prRows.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
        const facts: SurfaceFacts = {
          name,
          usesPr,
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
              : present(rollupChecks(pr.checks).green),
        };
        return deriveSurface(facts, report);
      }),
    );

    const row = issueRows.get(issue);
    const ledger = statusMap.get(status.status);

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

      submissionEvidence: present(report.kind === "present"),

      session: classifySession(sessionRows, `resolve-${issue}`),
      retiredRefineExists: sessionRows.some((r) => r.startsWith(`retired-refine-${issue} `)),
      refineSession: classifySession(sessionRows, `refine-${issue}`),

      waitRecord: waitRecord(commentText, pause),
      pauseRecordExists: pause,
      yieldRecord: parsedYield,
      intentRecord: intentRecord(commentText),
      integrationRecordCount: present(integrationRecord(commentText).kind === "present" ? 1 : 0),

      // checkout は無いが、所有している workspace が残っている。**snapshot の 2 節の差**で引く。
      prunableWorkspace: present(
        [...prunableWorkspaces].some((path) => ownsWorktreePath(path, issue)),
      ),

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
    const text = raw?.kind === "present" ? joinComments(raw.value.map((c) => c.body)) : "";
    const plan = extractMarker(text, "plan");
    const waitBlock = extractMarker(text, "wait");
    // **有効な人待ちだけ渡す**（判定は呼び出し側、と引数表が定めている）。
    const validWait =
      o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid"
        ? waitBlock.kind === "present"
          ? waitBlock.value
          : null
        : null;
    const bodyOf = (n: number): string => {
      const b = bodies.get(n);
      return b?.kind === "present" ? b.value : "";
    };
    marks.set(
      o.issue,
      await port.cycleMark({
        issue: o.issue,
        ledger: o.ledger.value,
        progress: normalizeProgress(o),
        surfaces: o.surfaces.map((s) => ({
          name: s.name,
          worktree:
            worktreeRows.find((w) => w.surface === s.name && ownsWorktreePath(w.path, o.issue))
              ?.path ?? null,
        })),
        planComment: plan.kind === "present" ? plan.value : null,
        waitRecord: validWait,
        // **計画の周は対象集合の全件**。claim 前なので group は本文の宣言から引く。
        issueBodies:
          o.ledger.value === "未計画"
            ? [o.issue, ...o.sameBranchAs].map((n) => ({ issue: n, body: bodyOf(n) }))
            : [],
      }),
    );
  });

  const observations = base.map((o) => ({ ...o, currentMark: marks.get(o.issue) ?? absent() }));

  const titleMap = new Map<number, string>();
  for (const [n, t] of titles) {
    if (t.kind === "present" && t.value !== "") titleMap.set(n, t.value);
  }

  const wait = new Map<number, { question: string; since: string }>();
  for (const n of numbers) {
    const cs = comments.get(n);
    if (cs === undefined || cs.kind !== "present") continue;
    const text = joinComments(cs.value.map((c) => c.body));
    const question = waitQuestionText(text);
    if (question === undefined) continue;
    const hit = cs.value.find((c) => extractMarker(c.body, "wait").kind === "present");
    wait.set(n, { question, since: hit?.at ?? "" });
  }

  const prs = new Map<number, number>();
  for (const o of observations) {
    const owned = prRows.filter((p) => new RegExp(`^[^/]+/${o.issue}-`).test(p.headRef));
    const branch = branches.get(o.issue);
    const exact = branch === undefined ? undefined : owned.find((p) => p.headRef === branch);
    const picked = exact ?? [...owned].sort((a, b) => a.number - b.number)[0];
    if (picked !== undefined) prs.set(o.issue, picked.number);
  }

  const worktreesBySurface = new Map<string, number>();
  for (const w of worktreeRows) {
    if (w.dirty === "unreadable") continue;
    worktreesBySurface.set(w.surface, (worktreesBySurface.get(w.surface) ?? 0) + 1);
  }

  const live: readonly LiveCheckoutRow[] = liveCheckouts(snapshot);

  return {
    observations,
    view: {
      titles: titleMap,
      wait,
      prs,
      branches,
      counts,
      live,
      worktreesBySurface,
    },
  };
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

const CHECK_RUNNING = new Set(["PENDING", "IN_PROGRESS", "QUEUED"]);
/** cancel は入れない。全部 cancel を待ちと読むと引き直しが消える。 */
const CHECK_GREEN = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);

export const rollupChecks = (
  checks: readonly string[],
): { readonly running: number; readonly green: boolean } => ({
  running: checks.filter((c) => CHECK_RUNNING.has(c)).length,
  green: checks.length > 0 && checks.every((c) => CHECK_GREEN.has(c)),
});

const checksOf = (
  prs: ReturnType<typeof pullRequests>,
  issue: number,
): Observed<{ readonly running: number; readonly green: boolean }> => {
  const pr = prs.find((p) => new RegExp(`^[^/]+/${issue}-`).test(p.headRef));
  if (pr === undefined) return absent();
  // **追跡していない PR の checks を「無し」と読まない。**
  if (pr.checks === "untracked") return unobservable("追跡していない PR");
  return present(rollupChecks(pr.checks));
};
