// 観測 1 件を 4 フィールドへ畳む純関数。**`progress` と `runtime` は排他ラダー**で、
// 上から読んで先に当たった行が勝つ。生の条件は重なってよい —— 重なりは順序が解決する。

import type { IssueObservation, SurfaceObservation } from "./observation.ts";
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

/**
 * **commit が 0 の面は透過する**。予定した面に結局書かなかったことは通常運用で、
 * 透過させないと成果物が別 repo にある課題が終端から締め出される。
 * **透過は commit 包含の判定にだけ効かせる**（dirty は下の `allSurfacesClean` が別に見る）。
 */
const isTransparent = (s: SurfaceObservation): boolean => value(s.aheadOfIntegration) === false;

/** **dirty は全面の共通前提**（`0` のみ。`1` も、読めなかった `-` も不可）。 */
const allSurfacesClean = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every((s) => value(s.dirty) === false);

const allSurfacesTerminalOrTransparent = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every((s) => isTransparent(s) || value(s.terminal) === true);

/** `着地待ち` の面ごとの条件は「終端している、**または着地してよい**」。 */
const allSurfacesLandableOrTransparent = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.every(
    (s) => isTransparent(s) || value(s.terminal) === true || value(s.landable) === true,
  );

/** 終端した面と終端していない面が混在しているか（`取り下げ` の除外条件）。 */
const terminalMixed = (surfaces: readonly SurfaceObservation[]): boolean => {
  const terminal = surfaces.filter((s) => value(s.terminal) === true).length;
  return terminal > 0 && terminal < surfaces.length;
};

/** `実装中` — **`統合先..branch` が非空か、worktree が dirty**（`-` も dirty 側）。 */
const hasWorkInProgress = (surfaces: readonly SurfaceObservation[]): boolean =>
  surfaces.some((s) => value(s.aheadOfIntegration) === true || value(s.dirty) !== false);

export const normalizeProgress = (o: IssueObservation): Progress => {
  const clean = allSurfacesClean(o.surfaces);
  const submitted = value(o.submissionEvidence) === true;

  if (allSurfacesTerminalOrTransparent(o.surfaces) && clean && submitted) return "着地済み";

  const withdrawn = o.open === false || value(o.latestPrClosedUnmerged) === true;
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

/**
 * ラダーで解決できないものだけを集める。**「2 つの行に当たった」は含まない。**
 * `ledger` と期待値のずれは、5 事象の入力が要るので `decide` が見る。
 */
const collectConflicts = (o: IssueObservation, progress: Progress): Conflict[] => {
  const found: Conflict[] = [];
  const n = o.issue;

  if (o.session.kind === "unclassifiable") {
    found.push(conflict("観測できない", n, `セッションの生の状態が分類できない: ${o.session.raw}`));
  }
  // **`absent` もここに含める。**対応表に無い Status の Issue は `decode` が
  // キューから外すので、ここまで来た `absent` は「キューに居るのに Status が無い」——
  // 既定へ倒すと、台帳の無い課題が `未計画` として計画を起こされる。
  if (o.ledger.kind !== "present") {
    found.push(conflict("ledger が解釈不能", n, "Project Status を読めない"));
  }

  // **本文の欠落だけで解除しない** —— 本物の質問を選択 UI にだけ出して書き損ねた経路がある。
  if (o.waitRecord.kind === "waiting" && o.waitRecord.validity.kind === "undecidable") {
    found.push(
      conflict("証跡が矛盾している", n, "人待ちの記録に質問の本文が無く、実行資源待ちの証跡も無い"),
    );
  }
  if (o.waitRecord.kind === "broken") {
    found.push(
      conflict("証跡が矛盾している", n, `人待ちの記録が壊れている: ${o.waitRecord.reason}`),
    );
  }

  // **保守的に全交差のまま保持し続ける**（非保持へ倒すと、投稿に失敗した課題が無防備に書く）。
  if (value(o.planCommentExists) === false && hasWorkInProgress(o.surfaces)) {
    found.push(
      conflict(
        "計画コメントが無いまま実装の証跡がある",
        n,
        "計画コメントが無いのに dirty か commit がある",
      ),
    );
  }

  if (value(o.issueContractComplete) === false && hasWorkInProgress(o.surfaces)) {
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
  if (value(o.prMerged) === true && value(o.submissionEvidence) !== true) {
    found.push(
      conflict("着地済みだが提出の証跡が無い", n, "merged な PR があるのに提出のまとめが無い"),
    );
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
  for (const s of o.surfaces) {
    if (isUnreadable(s.terminal) || isUnreadable(s.landable)) {
      found.push(conflict("着地面が解決できない", n, `面 ${s.name} の観測が読めない`));
    }
  }

  // **当てるのは、その面を着地面に持ち、かつその面がまだ終端していない課題だけ。**
  // **PR で着地する面は対象外** —— そちらは live へ merge しない。
  for (const s of o.surfaces) {
    if (s.usesPr || value(s.terminal) === true) continue;
    if (value(s.liveCheckoutHealthy) !== true) {
      found.push(
        conflict(
          "live checkout が異常",
          n,
          `面 ${s.name} の live checkout が dirty / 分岐 / 観測不能`,
        ),
      );
    }
  }

  // **待つのをやめたのに要求が残っている形。**放置すると実物を見せないまま着地する。
  if (o.intentRecord.kind === "pending" && o.waitRecord.kind !== "waiting") {
    found.push(
      conflict("意図の確認が pending なのに人待ちが無い", n, "人待ちの記録が cleared か無い"),
    );
  }

  const integrationRecords = value(o.integrationRecordCount);
  if (integrationRecords !== undefined && integrationRecords >= 2) {
    found.push(conflict("渡しの記録が複数", n, `渡しの記録が ${integrationRecords} 件ある`));
  }
  if (isUnreadable(o.integrationRecordCount)) {
    found.push(conflict("渡しの記録が複数", n, "渡しの記録を読めない"));
  }

  // `取り下げ` は人が置いた状態を尊重するので、終端の混在だけは別に見る。
  if (progress !== "取り下げ" && terminalMixed(o.surfaces) && progress === "着地済み") {
    found.push(conflict("group の終端が混在", n, "終端した面と終端していない面が混在している"));
  }

  return found;
};

/** **正規化は Issue 単位で行う**。group を 1 レコードに畳まない。 */
export const normalize = (o: IssueObservation): NormalizedIssue => {
  const progress = normalizeProgress(o);
  // 読めなかったときの `未計画` は**この値を誰も読まないことが前提**の詰め物。
  // 同じ観測が `ledger が解釈不能` を立て、`報告して止める` がラダー最上段で当たるので、
  // 4 フィールドの側は分岐に使われない。**既定値として意味を持たせない。**
  const ledger: Ledger = value(o.ledger) ?? "未計画";
  return {
    issue: o.issue,
    progress,
    runtime: normalizeRuntime(o),
    capacity: normalizeCapacity(o),
    ledger,
    conflicts: collectConflicts(o, progress),
  };
};
