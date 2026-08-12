// `normalize` / `decide` が読む観測の型。**ここが decode 境界の出口**で、
// `watch.sh --snapshot` の生テキストと固定 marker の本文は `decode.ts` がここへ写す。

import type { Ledger, Observed } from "./types.ts";

/**
 * セッションの生の状態。**`分類不能` を `稼働中` にも `待機` にも丸めない**
 * （丸めると、人が入力を書いている最中の pane を閉じる action が `done` と区別できない）。
 */
export type SessionObservation =
  | { readonly kind: "running" }
  | { readonly kind: "idle" }
  | { readonly kind: "none" }
  | { readonly kind: "unclassifiable"; readonly raw: string };

/**
 * 人待ちの記録が有効かどうか。**判定は質問の本文の有無と、実行資源待ちの証跡の有無だけ**
 * （中身は解釈しない）。判定できないものは `Conflict`。
 */
export type WaitValidity =
  | { readonly kind: "valid" }
  /** 本文が無く、同じ対象に休止の記録がある。実行資源待ちを人待ちとして書いた記録 */
  | { readonly kind: "resource-wait-mislabeled" }
  /** 本文が無く、実行資源待ちの証跡も無い。**本文の欠落だけで解除しない** */
  | { readonly kind: "undecidable" };

export type WaitRecord =
  | { readonly kind: "absent" }
  | { readonly kind: "waiting"; readonly validity: WaitValidity }
  | { readonly kind: "cleared" }
  | { readonly kind: "broken"; readonly reason: string };

/** 意図の確認。**`not-required` と推測しない**（記録が無い / 壊れているは fail-closed）。 */
export type IntentRecord =
  | { readonly kind: "absent" }
  | { readonly kind: "pending" }
  | { readonly kind: "confirmed" }
  | { readonly kind: "not-required" }
  | { readonly kind: "broken"; readonly reason: string };

/**
 * 着地面 1 面の観測。**面ごとの失敗はその面を `unobservable` にするだけで、ラウンドは捨てない**
 * （制御面だけは正規化そのものが成り立たないので、ラウンドを無効にする）。
 */
export type SurfaceObservation = {
  readonly name: string;
  /** その面が PR で着地するか。`着地待ち` は面が 1 つも該当しない側の条件を真として扱う */
  readonly usesPr: boolean;
  /** `統合先..branch` が非空か。**branch 上の commit の存在で読まない** */
  readonly aheadOfIntegration: Observed<boolean>;
  /** worktree の dirty。**読めなかった `-` を clean へ畳まない** */
  readonly dirty: Observed<boolean>;
  /** worktree の checkout があるか（`capacity` の `あり` を決める） */
  readonly hasCheckout: Observed<boolean>;
  /** 面ごとの終端（`landing-surface.md` が SSOT） */
  readonly terminal: Observed<boolean>;
  /** 着地してよい（同上） */
  readonly landable: Observed<boolean>;
  /** live checkout の姿勢。**観測できないことを「異常なし」と読まない** */
  readonly liveCheckoutHealthy: Observed<boolean>;
};

/** 1 課題ぶんの観測。**group へ畳む前**の、Issue 単位の材料。 */
export type IssueObservation = {
  readonly issue: number;
  /** Issue が open か。**board に居るのに `issues` 節に無いことを closed へ畳まない** */
  readonly open: Observed<boolean>;
  readonly ledger: Observed<Ledger>;

  /**
   * 本文とコメントを読めたか。**読めなかったことを「無い」に畳まない** ——
   * 畳むと Issue 契約が「欠けている」に、記録が全部「無い」に読まれる。
   * 偽なら `観測できない` の `Conflict` が最上段で当たり、他の値は誰も読まない。
   */
  readonly sourceReadable: Observed<boolean>;

  /** 制御面の claim branch。**成果物の段とは混ぜない**（`準備中` / `準備済み` はここから引く） */
  readonly claimBranchExists: Observed<boolean>;
  /** 固定 marker の計画コメント */
  readonly planCommentExists: Observed<boolean>;
  /** Issue 契約が揃っているか（項目の SSOT は `refine` の Issue 契約） */
  readonly issueContractComplete: Observed<boolean>;
  /** claim の記録。`landing` の欠落は `Conflict`。**対象集合と代表を定めるのはこれ** */
  readonly claimRecord: Observed<{
    readonly representative: number;
    readonly members: readonly number[];
    readonly landing: readonly string[];
  }>;

  readonly surfaces: readonly SurfaceObservation[];

  /** open PR があるか */
  readonly openPr: Observed<boolean>;
  /** `gh pr checks` の判定。**`mergeStateStatus` で代用しない** */
  readonly checks: Observed<{ readonly running: number; readonly green: boolean }>;
  /** open PR が無く、head に紐づく最新 PR が unmerged で closed */
  readonly latestPrClosedUnmerged: Observed<boolean>;
  /** merged な PR があるか（提出の証跡が無いときの `Conflict` に効く） */
  readonly prMerged: Observed<boolean>;

  /** 提出の証跡（有効なまとめの記録。有効の判定は `session-report.md` が SSOT） */
  readonly submissionEvidence: Observed<boolean>;

  readonly session: SessionObservation;
  /** `retired-refine-<番号>` が残っているか。**`runtime` には写さない**（`無し` として扱う） */
  readonly retiredRefineExists: boolean;
  /**
   * `refine-<番号>` のセッション（完全一致）。**存在の有無ではなく状態で持つ** ——
   * `session` は `resolve-<番号>` を見るので計画中は常に `none` になり、
   * 有無だけでは「走っているものを畳まない」を書けない。
   */
  readonly refineSession: SessionObservation;

  readonly waitRecord: WaitRecord;
  /** 休止の記録。**「記録あり」だけでは `休止` にならない**（非稼働も要る） */
  readonly pauseRecordExists: boolean;
  readonly intentRecord: IntentRecord;
  /** merge の枠の渡しの記録。2 件以上は `Conflict` */
  readonly integrationRecordCount: Observed<number>;

  /** checkout は無いが所有している workspace が残っている */
  readonly prunableWorkspace: Observed<boolean>;

  // -------------------------------------------------------------------------
  // 記録。**どれも指紋に入る**ので、書いたら観測からやり直す。
  // -------------------------------------------------------------------------

  /** 失敗の記録。数える失敗と数えない失敗の区別は `decide` の外（実行側）が持つ */
  readonly failureRecord: Observed<{ readonly count: number; readonly lastAction: string | null }>;
  /** 周回の記録。`mark` と現在の指紋が一致したまま上限に達したら `退避先` へ落ちる */
  readonly cycleRecord: Observed<{ readonly count: number; readonly mark: string | null }>;
  /** いまの成果の指紋。**作れない周でも action の選択は続ける**（照合を飛ばすだけ） */
  readonly currentMark: Observed<string>;
  /** 在庫の記録が陳腐化しているか（判定は `ready-record.md`） */
  readonly readyRecordStale: Observed<boolean>;

  /** 本文が計画の記録と一致しているか */
  readonly bodyMatchesPlan: Observed<boolean>;
  /** 計画が失効したか（統合先の変更が `invalidationScope` / `resourceKeys` に交差） */
  readonly planInvalidated: Observed<boolean>;
  /**
   * 資源キー。**path ではなく「同時に触ると壊れるもの」の名前**。
   * 読めなければ `unknown` = 全交差（`incompatible` として扱う）。
   */
  readonly resourceKeys: Observed<readonly string[]>;
  /** 入場を止める宣言を持っているか（宣言の形は project の領分） */
  readonly blocksEntry: boolean;

  /** `Depends on #N` */
  readonly dependsOn: readonly number[];
  /** `Same branch as #N`。**group は 1 単位で claim する** */
  readonly sameBranchAs: readonly number[];

  /** ボード上の並び順。**人が並べた順**なので、同数のときの tie-break に使う */
  readonly boardOrder: number;
  /** claim の順序キー。**PR 作成の早さで選ばない**（PR を持たない課題が選外へ落ちる） */
  readonly claimedAt: Observed<number>;
};
