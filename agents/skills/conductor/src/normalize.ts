// 観測 1 件を 4 フィールドへ畳む純関数。**`progress` と `runtime` は排他ラダー**で、
// 上から読んで先に当たった行が勝つ。生の条件は重なってよい —— 重なりは順序が解決する。

import {
  sessionActive,
  type IssueObservation,
  type SessionObservation,
  type SurfaceObservation,
  type WaitRecord,
} from "./observation.ts";
import type {
  Capacity,
  Conflict,
  ConflictReason,
  Ledger,
  NormalizedIssue,
  Observed,
  Progress,
  Runtime,
} from "./types.ts";

/** `present` の値だけを取り出す。**既定値へ倒さない** —— 呼ぶ側が 3 値を明示的に扱う。 */
const value = <T>(o: Observed<T>): T | undefined => (o.kind === "present" ? o.value : undefined);

const isUnreadable = (o: Observed<unknown>): boolean =>
  o.kind === "unobservable" || o.kind === "invalid";

/** 読めなかった理由。読めているなら `undefined`。**判定と理由を 1 回で取る。** */
const reasonOf = (o: Observed<unknown>): string | undefined =>
  o.kind === "unobservable" || o.kind === "invalid" ? o.reason : undefined;

/**
 * **commit が 0 の面は透過する**。予定した面に結局書かなかったことは通常運用で、
 * 透過させないと成果物が別 repo にある課題が終端から締め出される。
 * **透過は commit 包含の判定にだけ効かせる**（dirty は下の `allSurfacesClean` が別に見る）。
 */
const isTransparent = (s: SurfaceObservation): boolean => value(s.aheadOfIntegration) === false;

/** **dirty は全面の共通前提**（`0` のみ。`1` も、読めなかった `-` も不可）。 */
export const allSurfacesClean = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every((s) => value(s.dirty) === false);

const allSurfacesTerminalOrTransparent = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every((s) => isTransparent(s) || value(s.terminal) === true);

/** `着地待ち` の面ごとの条件は「終端している、**または着地してよい**」。 */
const allSurfacesLandableOrTransparent = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every(
    (s) => isTransparent(s) || value(s.terminal) === true || value(s.landable) === true,
  );

/**
 * `取り下げ` の除外。着地した面があり、かつ書いたきり着地していない面が残っている。
 * 終端していない面のうち、ahead が false かつ dirty でない面はどちらにも数えない。
 * 読めなかった観測は未着地側。
 */
const terminalMixed = (surfaces: readonly SurfaceObservation[]): boolean => {
  const landed = (s: SurfaceObservation): boolean => value(s.terminal) === true;
  const idle = (s: SurfaceObservation): boolean =>
    value(s.aheadOfIntegration) === false && value(s.dirty) === false;
  const unfinished = (s: SurfaceObservation): boolean => !landed(s) && !idle(s);
  return surfaces.some(landed) && surfaces.some(unfinished);
};

/**
 * `実装中` — **`統合先..branch` が非空か、worktree が dirty**。
 *
 * **読めた証跡だけで決める。**読めない面から `実装中` を導くと、branch も worktree も
 * セッションも無い課題が write を握り、**幽霊の保持者として本物の実行器を止める**
 * （`交差を解消する` がそれに当たる）。読めない面には `着地面が解決できない` が別に立つ。
 *
 * **終端側の fail-closed はここではない。**「全着地面が dirty でない（`0` のみ。読めなかった
 * `-` は不可）」は `allSurfacesClean` が持つ（`landing-surface.md`「終端」）。
 *
 * **`decide` の「成果物がある」と同じ述語**。割れると、契約が欠けた計画済みが差し戻されずに
 * Conflict へ落ちる。**2 つ書かない。**
 */
export const hasWorkInProgress = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.some((s) => value(s.aheadOfIntegration) === true || value(s.dirty) === true);

/** `完了` かつ提出の証跡がある。成果物 Conflict の免除が読む。 */
const settledSubmitted = (o: IssueObservation): boolean =>
  value(o.ledger) === "完了" && value(o.submissionEvidence) === true;

export const normalizeProgress = (o: IssueObservation): Progress => {
  const clean = allSurfacesClean(o.surfaces);
  const submitted = value(o.submissionEvidence) === true;

  if (allSurfacesTerminalOrTransparent(o.surfaces) && clean && submitted) return "着地済み";

  // **読めなかった `open` を closed 側へ倒さない**（同じ観測が `観測できない` を立てる）。
  const withdrawn = value(o.open) === false || value(o.latestPrClosedUnmerged) === true;
  if (withdrawn && !terminalMixed(o.surfaces)) return "取り下げ";

  if (allSurfacesLandableOrTransparent(o.surfaces) && clean && submitted) return "着地待ち";
  if (value(o.openPr) === true) return "提出中";
  if (hasWorkInProgress(o.surfaces)) return "実装中";

  const claimed = value(o.claimBranchExists) === true;
  if (claimed && value(o.planCommentExists) === true) return "準備済み";
  if (claimed) return "準備中";
  return "未着手";
};

export const normalizeRuntime = (o: IssueObservation): Runtime => {
  // **`人待ち` を最上段に置き、セッションの有無を条件に入れない。**
  if (o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "valid") return "人待ち";
  if (o.session.kind === "running") return "稼働中";
  // **`休止` は「記録あり」だけでは成立しない**（記録を書いた直後はまだ書き続けている）。
  // 「動いていない」は 1 つ上の行が既に落としているので、ここで再掲しない —— 再掲すると
  // 型の上で常に真になり、ラダーの前提が条件式へ二重化する。
  if (o.pauseRecordExists) return "休止";
  if (o.session.kind === "idle") return "待機";
  return "無し";
};

export const normalizeCapacity = (o: IssueObservation): Capacity => {
  if (o.surfaces.some((s) => value(s.hasCheckout) === true)) return "あり";
  if (value(o.prunableWorkspace) === true) return "prunable";
  return "無し";
};

const conflict = (reason: ConflictReason, issue: number, ...evidence: string[]): Conflict => ({
  reason,
  evidence,
  issues: [issue],
});

/** 印はあるが記録が `absent` / `cleared`。`waiting` の無効は別行。 */
const markWithoutWait = (s: SessionObservation, wait: WaitRecord): boolean =>
  s.kind === "blocked" && (wait.kind === "absent" || wait.kind === "cleared");

/**
 * ラダーで解決できないものだけを集める。**「2 つの行に当たった」は含まない。**
 * `ledger` と期待値のずれは、5 事象の入力が要るので `decide` が見る。
 */
const collectConflicts = (o: IssueObservation): Conflict[] => {
  const found: Conflict[] = [];
  const n = o.issue;
  // **記録の整合の Conflict は、その記録がこれから読まれる課題にだけ当てる。**
  // 台帳が `完了` に達した課題の記録は二度と分岐に使われないので、当てても人が動かす先が
  // 無く、ラダー最上段なので `片付ける` にも届かない。
  //
  // **実体を守る Conflict には掛けない** —— 着地面は `片付ける` が消しにいく対象そのものを見ている。
  // 成果物を伴う 2 つは、`完了` かつ提出の証跡があるときにだけ立てない。
  const settled = value(o.ledger) === "完了";
  const submitted = settledSubmitted(o);

  // **本文とコメントを読めていないなら、他の値は詰め物。**先に報告して止める。
  if (o.sourceReadable.kind !== "present" || o.sourceReadable.value === false) {
    found.push(conflict("観測できない", n, "Issue の本文かコメントを読めない"));
  }

  if (o.open.kind !== "present") {
    found.push(conflict("観測できない", n, "board に居るが Issue の open / closed を読めない"));
  }

  if (o.session.kind === "unclassifiable") {
    found.push(conflict("観測できない", n, `セッションの生の状態が分類できない: ${o.session.raw}`));
  }
  // **`absent` もここに含める。**対応表に無い Status の Issue は `decode` が
  // キューから外すので、ここまで来た `absent` は「キューに居るのに Status が無い」——
  // 既定へ倒すと、台帳の無い課題が `未計画` として計画を起こされる。
  if (o.ledger.kind !== "present") {
    found.push(conflict("ledger が解釈不能", n, "Project Status を読めない"));
  }

  // **`退避先` は論理 lease を返す**ので、そこでセッションが動いているのは
  // 「lease を持たないまま書いている」状態。人が Status だけ動かすと起きる。
  // 出さないと、入場を止める宣言も merge の枠も外れないまま誰にも見えない。
  if (value(o.ledger) === "退避先" && sessionActive(o.session)) {
    found.push(
      conflict(
        "退避先だがセッションが止まらない",
        n,
        "退避先へ移ったのにセッションが止まっていない",
      ),
    );
  }

  // **印だけ。**`blocked` は人待ちの印。記録が無い／`cleared` なら書き手が残す前に落ちた。
  // **`waiting` の無効・壊れは下の既存行が扱う**（7h の自己修復を Conflict で潰さない）。
  // **終端には当てない** —— 当てると `片付ける` が選出対象外になり、pane が残る。
  if (
    !settled &&
    (markWithoutWait(o.session, o.waitRecord) || markWithoutWait(o.refineSession, o.waitRecord))
  ) {
    found.push(
      conflict("証跡が矛盾している", n, "実行器が承認か質問で止まっているが、人待ちの記録が無い"),
    );
  }

  // **本文の欠落だけで解除しない** —— 本物の質問を選択 UI にだけ出して書き損ねた経路がある。
  if (!settled && o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "undecidable") {
    found.push(
      conflict("証跡が矛盾している", n, "人待ちの記録に質問の本文が無く、実行資源待ちの証跡も無い"),
    );
  }
  if (!settled && o.waitRecord.kind === "broken") {
    found.push(
      conflict("証跡が矛盾している", n, `人待ちの記録が壊れている: ${o.waitRecord.reason}`),
    );
  }

  // **面を読めないなら、その面の成果物も読めない。**fail-closed で「成果物あり」側へ倒れるが、
  // そこから成果物の Conflict を出すと、実際には無い実装を人へ報告することになる ——
  // 根の `着地面が解決できない` は同じ観測が立てているので、そちらだけを出す。
  const artifacts =
    o.surfaces.every((s) => !isUnreadable(s.terminal) && !isUnreadable(s.landable)) &&
    hasWorkInProgress(o.surfaces);

  // **保守的に全交差のまま保持し続ける**（非保持へ倒すと、投稿に失敗した課題が無防備に書く）。
  // **`完了` かつ提出の証跡がある残骸には当てない** —— 当てると standing が片付けの入口を塞ぐ。
  if (!submitted && value(o.planCommentExists) === false && artifacts) {
    found.push(
      conflict(
        "計画コメントが無いまま実装の証跡がある",
        n,
        "計画コメントが無いのに dirty か commit がある",
      ),
    );
  }

  if (!submitted && value(o.issueContractComplete) === false && artifacts) {
    found.push(
      conflict(
        "Issue 契約が欠けたまま成果物がある",
        n,
        "差し戻すと実装が消え、放置すると着手できない",
      ),
    );
  }

  // **`取り下げ` に落とさない** —— 実体は着地しているのに `完了` が付かず、依存が永久に解けない。
  // **PR を使わない面には当てない**（あちらは提出の証跡そのものが終端の条件）。
  // 守っているのは台帳が進んでいないことだけなので、`完了` には当てない
  // （`完了` なら依存は `closed かつ 完了` の経路で解ける）。
  // **claim の remote branch が無い着地済みには当てない**（ship の既定が branch を消す）。
  const landedWithoutClaimBranch = value(o.claimBranchExists) === false;
  if (
    !settled &&
    value(o.prMerged) === true &&
    value(o.submissionEvidence) !== true &&
    !landedWithoutClaimBranch
  ) {
    found.push(
      conflict("着地済みだが提出の証跡が無い", n, "merged な PR があるのに提出のまとめが無い"),
    );
  }

  // **終端に達して、片付けが触る実体が 1 つも残っていない課題には当てない。**面を解決する
  // 必要そのものが無いので、報告しても人が動かす先が無く、毎 tick 出続けるだけになる。
  // **実体が残っているなら出す** —— 面を解決できないまま片付けにいかせない。
  const nothingLeft =
    settled &&
    normalizeCapacity(o) === "無し" &&
    o.session.kind === "none" &&
    value(o.claimBranchExists) !== true;

  // **提出の証跡が無い `完了` の残骸は片付けに入らず、人が見る。**残骸が無い形（17m3）には立てない。
  // **claim の remote branch が無い着地済みには当てない**（行 17m6）。
  if (
    settled &&
    value(o.submissionEvidence) !== true &&
    !nothingLeft &&
    !landedWithoutClaimBranch
  ) {
    found.push(conflict("着地済みだが提出の証跡が無い", n, "台帳は完了なのに提出のまとめが無い"));
  }

  const claim = value(o.claimRecord);
  if (
    o.claimBranchExists.kind === "present" &&
    o.claimBranchExists.value &&
    claim !== undefined &&
    claim.landing.length === 0
  ) {
    found.push(conflict("着地面が解決できない", n, "claim の記録の landing が空"));
  }
  if (isUnreadable(o.claimRecord) && value(o.claimBranchExists) === true) {
    found.push(conflict("着地面が解決できない", n, "claim の記録を読めない"));
  }
  // **理由を握り潰さない。**座標表から外れたのか・checkout が無いのか・git が落ちたのかで
  // 人が次にやることが違う。`unobservable` と `invalid` はどちらも理由を持っている。
  for (const s of o.surfaces) {
    const why = nothingLeft ? undefined : (reasonOf(s.terminal) ?? reasonOf(s.landable));
    if (why !== undefined) {
      found.push(conflict("着地面が解決できない", n, `面 ${s.name} の観測が読めない: ${why}`));
    }
  }

  // **待つのをやめたのに要求が残っている形。**放置すると実物を見せないまま着地する。
  if (!settled && o.intentRecord.kind === "pending" && o.waitRecord.kind !== "waiting") {
    found.push(
      conflict("意図の確認が pending なのに人待ちが無い", n, "人待ちの記録が cleared か無い"),
    );
  }

  // `完了` の課題に残った渡しの記録は、報告ではなく `片付ける` が消す。
  const integrationRecords = value(o.integrationRecordCount);
  if (!settled && integrationRecords !== undefined && integrationRecords >= 2) {
    found.push(conflict("渡しの記録が複数", n, `渡しの記録が ${integrationRecords} 件ある`));
  }
  if (!settled && isUnreadable(o.integrationRecordCount)) {
    found.push(conflict("渡しの記録が複数", n, "渡しの記録を読めない"));
  }

  return found;
};

/** **正規化は Issue 単位で行う**。group を 1 レコードに畳まない。 */
/**
 * `progress` から期待される `ledger`。`取り下げ` は触らない（人が置いた状態を尊重する）。
 * **軸をここに置くのは、期待より手前（前進）と期待より先（Conflict）が同じ表を読むため。**
 */
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
export const ledgerBehind = (r: NormalizedIssue): boolean => {
  const expected = expectedLedger(r.progress);
  if (expected === LEDGER_ANY || expected.includes(r.ledger)) return false;
  const current = ledgerRank(r.ledger);
  if (current < 0) return false; // `退避先` はこの軸に乗らない
  return expected.every((e) => current < ledgerRank(e));
};

/**
 * `ledger` が期待より先か。**ラダーの 5 段目**。前進で直せないので Conflict へ倒す ——
 * 落とすと、どの action にも当たらない課題が `idle` として静かに滞留する。
 *
 * **ここで Conflict を立てない。**ラダーは差し戻し（2 段目）を先に評価するので、
 * 正規化の時点で立てると `進行中` × `未着手` の差し戻しが全部 Conflict に食われる。
 * 判定は `decide` のラダーが、差し戻しの rung より後で行う。
 */
export const ledgerAhead = (r: NormalizedIssue): boolean => {
  const ledger = r.ledger;
  const progress = r.progress;
  const expected = expectedLedger(progress);
  if (expected === LEDGER_ANY || expected.includes(ledger)) return false;
  const current = ledgerRank(ledger);
  if (current < 0) return false; // `退避先` はこの軸に乗らない
  return expected.every((e) => current > ledgerRank(e));
};

export const normalize = (o: IssueObservation): NormalizedIssue => {
  const progress = normalizeProgress(o);
  // 読めなかったときの `未計画` は**この値を誰も読まないことが前提**の詰め物。
  // 同じ観測が `ledger が解釈不能` を立て、standing が選出対象外にするので、
  // 4 フィールドの側は分岐に使われない。**既定値として意味を持たせない。**
  const ledger: Ledger = value(o.ledger) ?? "未計画";
  return {
    issue: o.issue,
    progress,
    runtime: normalizeRuntime(o),
    capacity: normalizeCapacity(o),
    ledger,
    conflicts: collectConflicts(o),
  };
};
