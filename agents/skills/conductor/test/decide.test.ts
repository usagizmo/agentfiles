// `references/scenarios.md` の観測 → 選ぶ action を固定する。
//
// **characterization test**（`normalize.test.ts` の冒頭と同じ理由）。
// **テスト名は行 ID**。`何も選ばない` は選択結果の null 値なので `idle` で受ける。

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, decide } from "../src/decide.ts";
import type { TickInput } from "../src/decide.ts";
import type { IssueObservation } from "../src/observation.ts";
import type { ActionName, ConflictReason, LeaseKind, RevertTarget } from "../src/types.ts";
import { present } from "../src/types.ts";
import { intent, observation, session, surface, wait } from "./fixtures.ts";

const tick = (observations: readonly IssueObservation[], over: Partial<TickInput> = {}) =>
  decide({ observations, config: DEFAULT_CONFIG, ...over });

const expectAction = (observations: readonly IssueObservation[], action: ActionName) => {
  const d = tick(observations);
  expect(d.kind === "action" ? d.params.action : d.kind).toBe(action);
};

const expectRevert = (observations: readonly IssueObservation[], to: RevertTarget) => {
  const d = tick(observations);
  expect(d.kind === "action" ? d.params : d.kind).toMatchObject({ action: "差し戻す", to });
};

const expectLease = (observations: readonly IssueObservation[], lease: LeaseKind) => {
  const d = tick(observations);
  expect(d.kind === "action" ? d.params : d.kind).toMatchObject({ action: "枠を渡す", lease });
};

const expectIdle = (observations: readonly IssueObservation[]) => {
  const d = tick(observations);
  expect(d.kind === "action" ? d.params.action : d.kind).toBe("idle");
};

const expectConflict = (observations: readonly IssueObservation[], reason: ConflictReason) => {
  const d = tick(observations);
  expect(d.kind === "conflict" ? d.conflicts.map((c) => c.reason) : d.kind).toContain(reason);
};

/** claim 済みで実装が進んでいる課題の骨格。各行はここから差分だけ書く。 */
const implementing = (over: Partial<IssueObservation> = {}): IssueObservation =>
  observation({
    ledger: present("進行中"),
    claimBranchExists: present(true),
    planCommentExists: present(true),
    claimRecord: present({ members: [1], landing: ["control"] }),
    surfaces: [surface({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
    ...over,
  });

/** 提出まで進み、着地待ちに居る課題の骨格。 */
const awaitingLanding = (over: Partial<IssueObservation> = {}): IssueObservation =>
  implementing({
    surfaces: [
      surface({
        aheadOfIntegration: present(true),
        hasCheckout: present(true),
        landable: present(true),
      }),
    ],
    submissionEvidence: present(true),
    intentRecord: intent.confirmed,
    claimedAt: present(100),
    ...over,
  });

describe("台帳と実体のずれ", () => {
  test("1: merge 済みだが remote branch が残り、worktree もある", () => {
    expectAction(
      [
        implementing({
          surfaces: [
            surface({
              aheadOfIntegration: present(true),
              hasCheckout: present(true),
              terminal: present(true),
            }),
          ],
          submissionEvidence: present(true),
        }),
      ],
      "片付ける",
    );
  });

  test("2: claim が Status 更新だけ失敗した", () => {
    expectAction(
      [observation({ ledger: present("計画済み"), claimBranchExists: present(true) })],
      "台帳を進める",
    );
  });

  test("3: claim の記録はあるが branch も commit も無い", () => {
    expectRevert(
      [
        observation({
          ledger: present("進行中"),
          claimRecord: present({ members: [1], landing: ["control"] }),
        }),
      ],
      "計画済み",
    );
  });

  test("3b: 行 3 と同じ形だが、台帳は 計画済み のまま", () => {
    expectRevert(
      [
        observation({
          ledger: present("計画済み"),
          claimRecord: present({ members: [1], landing: ["control"] }),
        }),
      ],
      "計画済み",
    );
  });

  test("3c: 行 3 と同じ 進行中 × 未着手 だが、claim の記録が無い", () => {
    expectConflict([observation({ ledger: present("進行中") })], "ledger が期待より先");
  });

  test("4: Issue 契約が欠けているが commit がある", () => {
    expectConflict(
      [implementing({ issueContractComplete: present(false) })],
      "Issue 契約が欠けたまま成果物がある",
    );
  });

  test("4b: 未計画 のまま積まれた課題", () => {
    expectAction([observation({ ledger: present("未計画") })], "計画を起こす");
  });

  test("4c: 計画済みの正常な在庫", () => {
    expectAction([observation({ ledger: present("計画済み") })], "claim する");
  });

  test("4d: claim の残骸があり、同時に retry budget も上限に達している", () => {
    expectRevert(
      [
        observation({
          ledger: present("進行中"),
          claimRecord: present({ members: [1], landing: ["control"] }),
          failureRecord: present({ count: 3, lastAction: "解決を起こし直す" }),
        }),
      ],
      "退避先",
    );
  });
});

describe("実行器が消える / 止まる", () => {
  test("5: 人待ちの記録が waiting のままセッションが消えた（実装途中）", () => {
    expectAction(
      [implementing({ waitRecord: wait.waiting, session: session.none })],
      "解決を起こし直す",
    );
  });

  test("6: 計画段階でセッションが消えた", () => {
    expectAction(
      [observation({ ledger: present("未計画"), waitRecord: wait.waiting })],
      "計画を起こし直す",
    );
  });

  test("6b: refine が Status も人待ちの記録も残さずに終わった", () => {
    expectAction(
      [
        observation({
          ledger: present("未計画"),
          session: session.idle,
          refineSessionExists: true,
        }),
      ],
      "計画セッションを片付ける",
    );
  });

  test("7a: dirty worktree のまま人待ちへ入り、セッションは生きている", () => {
    expectIdle([
      implementing({
        surfaces: [
          surface({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            dirty: present(true),
          }),
        ],
        waitRecord: wait.waiting,
        session: session.running,
      }),
    ]);
  });

  test("7b: 行 7a と同じ状況でセッションが消えた", () => {
    expectAction(
      [
        implementing({
          surfaces: [
            surface({
              aheadOfIntegration: present(true),
              hasCheckout: present(true),
              dirty: present(true),
            }),
          ],
          waitRecord: wait.waiting,
          session: session.none,
        }),
      ],
      "解決を起こし直す",
    );
  });

  test("7c: 人が答え、記録が cleared になった", () => {
    expectLease([implementing({ waitRecord: wait.cleared, session: session.idle })], "write");
  });

  test("7d: 計画工程が自分で 退避先 へ移して終えた（pane は残っている）", () => {
    expectAction(
      [
        observation({
          ledger: present("退避先"),
          session: session.idle,
          refineSessionExists: true,
        }),
      ],
      "計画セッションを片付ける",
    );
  });

  test("7e: 計画セッションが idle", () => {
    expectAction(
      [
        observation({
          ledger: present("計画済み"),
          session: session.idle,
          refineSessionExists: true,
        }),
      ],
      "計画セッションを片付ける",
    );
  });

  test("7k: claim 済み・branch は clean・計画コメント無し。prepare の途中", () => {
    expectIdle([
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        claimRecord: present({ members: [1], landing: ["control"] }),
        surfaces: [surface({ hasCheckout: present(true) })],
        session: session.running,
      }),
    ]);
  });

  test("7l: 計画コメントが無いのに dirty か commit がある", () => {
    expectConflict(
      [
        observation({
          ledger: present("進行中"),
          claimBranchExists: present(true),
          claimRecord: present({ members: [1], landing: ["control"] }),
          surfaces: [surface({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
          session: session.running,
        }),
      ],
      "計画コメントが無いまま実装の証跡がある",
    );
  });

  test("7g: write を渡された直後にターンが終わった", () => {
    expectLease(
      [
        implementing({
          surfaces: [surface({ hasCheckout: present(true) })],
          session: session.idle,
        }),
      ],
      "write",
    );
  });

  test("7h: 人待ちの記録が waiting だが本文が無く、同じ対象に休止の記録がある", () => {
    expectAction(
      [
        implementing({
          waitRecord: wait.mislabeled,
          pauseRecordExists: true,
          session: session.running,
        }),
      ],
      "失効した記録を片付ける",
    );
  });

  test("7j: 聞き直して waiting へ戻した。セッションは生きている", () => {
    expectIdle([
      implementing({ openPr: present(true), waitRecord: wait.waiting, session: session.running }),
    ]);
  });

  test("7m: write を保持したままターンが終わった", () => {
    expectLease([implementing({ session: session.idle })], "write");
  });

  test("7r: 起こし直しのあと、記録は cleared でセッションは 稼働中", () => {
    expectIdle([implementing({ waitRecord: wait.cleared, session: session.running })]);
  });
});

describe("外から状態が動く", () => {
  test("9: 実装中に Issue 本文が変わった", () => {
    expectAction(
      [implementing({ bodyMatchesPlan: present(false), session: session.running })],
      "本文の変更を伝える",
    );
  });

  test("8: PR は緑だが、その後 default が進んで計画の資源キーに交差した", () => {
    expectAction(
      [awaitingLanding({ planInvalidated: present(true), session: session.running })],
      "計画の失効を伝える",
    );
  });

  test("8b: 在庫のまま default が進み、ready の invalidationScope に交差した", () => {
    expectRevert(
      [observation({ ledger: present("計画済み"), readyRecordStale: present(true) })],
      "未計画",
    );
  });

  test("8b2: 揃っていない group の成員が在庫のまま交差した", () => {
    const stale = observation({
      issue: 1,
      ledger: present("計画済み"),
      readyRecordStale: present(true),
      sameBranchAs: [2],
    });
    const unplanned = observation({ issue: 2, ledger: present("未計画"), sameBranchAs: [1] });
    // claim が構造的に止まっているので陳腐化を評価せず、未計画側の成員に「計画を起こす」が当たる。
    expectAction([stale, unplanned], "計画を起こす");
  });

  test("8b3: 容量が目安を超えているだけの在庫が交差した", () => {
    const busy = Array.from({ length: 4 }, (_, i) =>
      implementing({
        issue: 10 + i,
        claimRecord: present({ members: [10 + i], landing: ["control"] }),
        session: session.running,
      }),
    );
    expectRevert(
      [
        ...busy,
        observation({ issue: 1, ledger: present("計画済み"), readyRecordStale: present(true) }),
      ],
      "未計画",
    );
  });

  test("9b: 行 9 を伝えたが、受け手が計画の記録を更新しないまま tick が進む", () => {
    // 再送は冪等。同じ観測が続くあいだ同じ action を返す（失敗として数えるのは実行側）。
    expectAction(
      [implementing({ bodyMatchesPlan: present(false), session: session.running })],
      "本文の変更を伝える",
    );
  });

  test("9c: 資源キーが交差する write 保持者が 2 つ。どちらにも休止の記録が無い", () => {
    const a = implementing({
      issue: 1,
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    const b = implementing({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    expectAction([a, b], "交差を解消する");
  });

  test("9d: 休止の記録があるのに、そのセッションが動き続けている", () => {
    const a = implementing({
      issue: 1,
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    const b = implementing({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      resourceKeys: present(["skills"]),
      pauseRecordExists: true,
      session: session.running,
    });
    expectAction([a, b], "休止を促し直す");
  });

  test("9e: 先発が着地し、休止していた後発と交差する保持者が居なくなった", () => {
    // **記録は「枠を渡す」の実行が先に消す。**解除を独立した action にすると、
    // `休止` が write の保持者から外れるぶん、休止と解除を往復する。
    expectLease([implementing({ pauseRecordExists: true, session: session.idle })], "write");
  });

  test("9g: 後発が自力で前へ進んで交差が解けた。休止の記録だけが残っている", () => {
    expectAction(
      [awaitingLanding({ pauseRecordExists: true, session: session.running })],
      "失効した記録を片付ける",
    );
  });

  test("9i: 先発が提出前に宣言を実体へ狭めた結果、後発との交差が消えた", () => {
    const lead = implementing({
      issue: 1,
      resourceKeys: present(["ui"]),
      submissionEvidence: present(true),
      openPr: present(true),
      checks: present({ running: 1, green: false }),
      // 行の観測は先発も `待機` だが、そこは先発自身も枠の候補になる。この行が固定するのは
      // **後発へ渡ること**なので、先発が競らない `稼働中` で置く。
      session: session.running,
    });
    const follower = implementing({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      resourceKeys: present(["api"]),
      pauseRecordExists: true,
      session: session.idle,
    });
    const d = tick([lead, follower]);
    expect(d.kind === "action" ? d.params : d.kind).toMatchObject({
      action: "枠を渡す",
      lease: "write",
    });
    expect(d.kind === "action" ? d.target.representative : d.kind).toBe(2);
  });

  test("9j: 行 9i のあと先発が宣言を広げ直し、交差が戻った", () => {
    const lead = implementing({
      issue: 1,
      resourceKeys: present(["ui", "api"]),
      submissionEvidence: present(true),
      openPr: present(true),
      checks: present({ running: 1, green: false }),
      session: session.running,
    });
    const follower = implementing({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      resourceKeys: present(["api"]),
      session: session.running,
    });
    expectAction([lead, follower], "交差を解消する");
  });

  test("9h: 先発が push して 着地待ち から 提出中 へ戻り、write を取り直した", () => {
    const lead = implementing({
      issue: 1,
      resourceKeys: present(["api"]),
      submissionEvidence: present(true),
      openPr: present(true),
      checks: present({ running: 1, green: false }),
      session: session.running,
    });
    const follower = implementing({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      resourceKeys: present(["api"]),
      session: session.running,
    });
    expectAction([lead, follower], "交差を解消する");
  });

  test("9f: 提出中 のまま CI が全部 cancel され、実行中の checks が 0 件になった", () => {
    expectAction(
      [
        implementing({
          openPr: present(true),
          checks: present({ running: 0, green: false }),
          intentRecord: intent.confirmed,
          session: session.idle,
        }),
      ],
      "checks を引き直させる",
    );
  });

  test("10f: 提出中 × 待機 で checks が実行中", () => {
    expectLease(
      [
        implementing({
          openPr: present(true),
          checks: present({ running: 2, green: false }),
          intentRecord: intent.confirmed,
          session: session.idle,
        }),
      ],
      "write",
    );
  });

  test("10g: 着地待ち で渡しの記録を持ったまま 待機", () => {
    expectLease(
      [awaitingLanding({ integrationRecordCount: present(1), session: session.idle })],
      "integration",
    );
  });

  test("10h: セッションが死んでは起こし直されるのを繰り返している", () => {
    expectAction(
      [implementing({ session: session.none, cycleRecord: present({ count: 1, mark: "mark-0" }) })],
      "解決を起こし直す",
    );
  });

  test("10k: 周回の count が上限に達したが、セッションはまだ 稼働中", () => {
    expectIdle([
      implementing({
        session: session.running,
        cycleRecord: present({ count: 3, mark: "mark-0" }),
      }),
    ]);
  });

  test("10l: count が上限に達したが、runtime が 休止", () => {
    expectRevert(
      [
        implementing({
          session: session.none,
          pauseRecordExists: true,
          cycleRecord: present({ count: 3, mark: "mark-0" }),
        }),
      ],
      "退避先",
    );
  });

  test("10w: count が上限に達し、セッションは有効な問いを残して止まっている", () => {
    const d = tick([
      implementing({
        session: session.none,
        waitRecord: wait.waiting,
        cycleRecord: present({ count: 3, mark: "mark-0" }),
      }),
    ]);
    expect(d.kind === "action" ? d.params.action : d.kind).not.toBe("差し戻す");
  });

  test("10b: 実行環境が DELETE を拒否し、枠を渡すが休止の記録を消せない", () => {
    // 消せないこと自体は decide の外。選び続けることだけを固定する。
    expectLease([implementing({ pauseRecordExists: true, session: session.idle })], "write");
  });

  test("10c: 枠を渡すで 1 周回り、commit が 1 本積まれてまた 待機 になった", () => {
    expectLease([implementing({ session: session.idle })], "write");
  });

  test("10d: 行 10c と同じ形だが、指紋が前の周と同じ", () => {
    expectLease(
      [
        implementing({
          session: session.idle,
          cycleRecord: present({ count: 1, mark: "mark-0" }),
        }),
      ],
      "write",
    );
  });

  test("10f2: PR は緑・使わない面のまとめが出ない。意図の確認は confirmed", () => {
    expectLease(
      [
        implementing({
          session: session.idle,
          submissionEvidence: present(true),
          openPr: present(true),
          checks: present({ running: 0, green: true }),
          intentRecord: intent.confirmed,
        }),
      ],
      "write",
    );
  });

  test("10i: refine が閉じられては起こし直されるが、本文も ledger も動いていない", () => {
    expectAction(
      [
        observation({
          ledger: present("未計画"),
          cycleRecord: present({ count: 1, mark: "mark-0" }),
        }),
      ],
      "計画を起こす",
    );
  });

  test("10m: 人待ちのまま起こし直しを繰り返し、成果が何も出ていない", () => {
    expectAction(
      [implementing({ waitRecord: wait.waiting, session: session.none })],
      "解決を起こし直す",
    );
  });

  test("10n: 上限に達したまま人待ちへ入り、人が答えて 待機 に落ちた", () => {
    expectLease(
      [
        implementing({
          waitRecord: wait.cleared,
          session: session.idle,
          // 人待ちの記録が指紋に入っているので、聞いた時点と答えた時点で mark が動いている。
          cycleRecord: present({ count: 3, mark: "mark-prev" }),
        }),
      ],
      "write",
    );
  });

  test("10o: セッションが無い状態から起こして成功した。指紋は不変", () => {
    expectAction([implementing({ session: session.none })], "解決を起こし直す");
  });

  test("10p: count が上限に達した後、新規 commit 無しに 提出中 へ進んだ", () => {
    const d = tick([
      implementing({
        session: session.idle,
        submissionEvidence: present(true),
        openPr: present(true),
        checks: present({ running: 1, green: false }),
        // `progress` が指紋に入っているので、提出中 へ進んだ時点で mark が動いている。
        cycleRecord: present({ count: 3, mark: "mark-prev" }),
      }),
    ]);
    expect(d.kind === "action" ? d.params.action : d.kind).not.toBe("差し戻す");
  });

  test("10q: 準備中 のまま枠を渡すが成功し続け、計画コメントも commit も出ない", () => {
    expectLease(
      [
        observation({
          ledger: present("進行中"),
          claimBranchExists: present(true),
          claimRecord: present({ members: [1], landing: ["control"] }),
          surfaces: [surface({ hasCheckout: present(true) })],
          planCommentExists: present(true),
          session: session.idle,
        }),
      ],
      "write",
    );
  });

  test("10s: 未着手 から claim する。branch も worktree もまだ無い", () => {
    expectAction([observation({ ledger: present("計画済み") })], "claim する");
  });

  test("10t: 問いの空な waiting を書いては止まる往復", () => {
    expectLease(
      [
        implementing({
          // 無効な `waiting` は指紋の人待ち成分から外れるので、自動で `cleared` にした周も
          // 成果ゼロとして数え続ける（`mark` が動かない）。
          waitRecord: wait.cleared,
          session: session.idle,
          cycleRecord: present({ count: 1, mark: "mark-0" }),
        }),
      ],
      "write",
    );
  });

  test("10x: 終端に達し、周回の記録だけが残っている", () => {
    expectAction(
      [
        implementing({
          surfaces: [surface({ terminal: present(true) })],
          submissionEvidence: present(true),
          claimBranchExists: present(false),
          claimRecord: { kind: "absent" },
          ledger: present("完了"),
          cycleRecord: present({ count: 2, mark: "mark-0" }),
        }),
      ],
      "片付ける",
    );
  });
});

describe("意図の確認", () => {
  test("15: 意図の確認が pending で、人待ちも waiting", () => {
    const d = tick([awaitingLanding({ intentRecord: intent.pending, waitRecord: wait.waiting })]);
    // merge の枠の受け手にしない。
    expect(d.kind === "action" && d.params.action === "枠を渡す" ? d.params.lease : null).not.toBe(
      "integration",
    );
  });

  test("15c: 一部の項目だけ明示承認され、残りは無反応", () => {
    const d = tick([awaitingLanding({ intentRecord: intent.pending, waitRecord: wait.waiting })]);
    // 沈黙は承認ではないので `pending` のまま。受け手にしない。
    expect(d.kind === "action" && d.params.action === "枠を渡す" ? d.params.lease : null).not.toBe(
      "integration",
    );
  });

  test("15g: 記録が無い課題が 着地待ち × 待機 のまま緑で止まっている", () => {
    expectAction(
      [awaitingLanding({ intentRecord: intent.absent, session: session.idle })],
      "意図の確認を促す",
    );
  });

  test("15d: 意図の確認が confirmed で PR は緑。merge の枠の受け手になれる", () => {
    expectLease([awaitingLanding({ session: session.idle })], "integration");
  });

  test("15e: 記録が壊れている課題は受け手にしない", () => {
    // claim は古いが記録が壊れている 1 は受け手にならず、枠は 2 へ回る。
    // 1 側で「意図の確認を促す」が先に当たらないよう、そちらは `稼働中` にしてある。
    const blocked = awaitingLanding({
      issue: 1,
      intentRecord: intent.broken("parse 失敗"),
      claimedAt: present(10),
      session: session.running,
    });
    const other = awaitingLanding({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      claimedAt: present(200),
      session: session.idle,
    });
    const d = tick([blocked, other]);
    expect(d.kind === "action" ? d.target.representative : d.kind).toBe(2);
  });
});

describe("merge の直列化（integration）", () => {
  test("13: 渡しの記録がどこにも無く、着地待ち の候補が 1 件で 待機", () => {
    expectLease([awaitingLanding({ session: session.idle })], "integration");
  });

  test("13b: 渡した相手が追随して 提出中 へ落ちた。別の課題が 着地待ち に居る", () => {
    const holder = awaitingLanding({
      issue: 1,
      openPr: present(true),
      submissionEvidence: present(false),
      integrationRecordCount: present(1),
      session: session.running,
    });
    const other = awaitingLanding({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      claimedAt: present(50),
      session: session.idle,
    });
    const d = tick([holder, other]);
    // 記録を持つ側が保持者。**`着地待ち` に居ることは保持の条件ではない。**
    expect(d.kind === "action" ? d.params.action : d.kind).not.toBe("枠を渡す");
  });

  test("13g: 渡しの記録が 2 件ある", () => {
    expectConflict([implementing({ integrationRecordCount: present(2) })], "渡しの記録が複数");
  });
});

describe("group", () => {
  test("11: group 内で 着地済み と 実装中 が混在している", () => {
    const landed = implementing({
      issue: 1,
      sameBranchAs: [2],
      surfaces: [
        surface({
          aheadOfIntegration: present(true),
          hasCheckout: present(true),
          terminal: present(true),
        }),
      ],
      submissionEvidence: present(true),
    });
    const working = implementing({
      issue: 2,
      sameBranchAs: [1],
      claimRecord: present({ members: [2], landing: ["control"] }),
    });
    expectConflict([landed, working], "group の終端が混在");
  });

  test("12: group の一部だけ計画済み。group は claim の候補にしない", () => {
    const planned = observation({ issue: 1, ledger: present("計画済み"), sameBranchAs: [2] });
    const unplanned = observation({ issue: 2, ledger: present("未計画"), sameBranchAs: [1] });
    expectAction([planned, unplanned], "計画を起こす");
  });

  test("12b: 相互記載で本文が動いたが、書き換えた側が相手の ready も upsert 済み", () => {
    const a = observation({ issue: 1, ledger: present("計画済み"), sameBranchAs: [2] });
    const b = observation({ issue: 2, ledger: present("未計画"), sameBranchAs: [1] });
    // digest は合っているので陳腐化は拾わない。未計画側に「計画を起こす」が当たる。
    expectAction([a, b], "計画を起こす");
  });

  test("12c: 別々の計画セッションが走っている 2 件が、同じ group に属すると判明した", () => {
    const a = observation({
      issue: 1,
      ledger: present("未計画"),
      refineSessionExists: true,
      session: session.running,
      sameBranchAs: [2],
    });
    const b = observation({
      issue: 2,
      ledger: present("未計画"),
      refineSessionExists: true,
      session: session.running,
      sameBranchAs: [1],
    });
    expectIdle([a, b]);
  });

  test("12d: conductor がこの tick で規約の穴を見つけた", () => {
    const d = tick([observation({ issue: 1, ledger: present("計画済み") })], {
      specGap: { issue: 1, fact: "片付けの述語が 2 箇所に在る" },
    });
    expect(d.kind === "action" ? d.params.action : d.kind).toBe("規約の穴を起票する");
  });

  test("12f: 在庫の陳腐化は、古くなった成員だけを戻す", () => {
    const fresh = observation({
      issue: 1,
      ledger: present("計画済み"),
      sameBranchAs: [2],
      readyRecordStale: present(false),
    });
    const stale = observation({
      issue: 2,
      ledger: present("計画済み"),
      sameBranchAs: [1],
      readyRecordStale: present(true),
    });
    const d = tick([fresh, stale]);
    expect(d.kind === "action" ? d.params : d.kind).toMatchObject({
      action: "差し戻す",
      to: "未計画",
    });
    expect(d.kind === "action" ? d.target : d.kind).toMatchObject({
      representative: 2,
      members: [2],
    });
  });
});

describe("入場を止める宣言", () => {
  test("14: 宣言した課題が 実装中 で、容量に空きがある", () => {
    const blocker = implementing({ issue: 1, blocksEntry: true, session: session.running });
    const candidate = observation({ issue: 2, ledger: present("計画済み") });
    expectIdle([blocker, candidate]);
  });

  test("14c: 宣言した課題が先発を待って 休止 している", () => {
    const blocker = implementing({
      issue: 1,
      blocksEntry: true,
      pauseRecordExists: true,
      session: session.idle,
    });
    expectLease([blocker], "write");
  });

  test("14g: project がキーの一覧を持たず、全部が unknown に倒れている", () => {
    // **判定できないことは宣言ではない** —— 当てると 1 件も claim できない。
    expectAction(
      [observation({ ledger: present("計画済み"), resourceKeys: { kind: "absent" } })],
      "claim する",
    );
  });
});

describe("入場を止める宣言（続き）", () => {
  test("14b: 宣言した課題が 着地待ち で、write を持たない別の課題が枠を待っている", () => {
    const blocker = awaitingLanding({ issue: 1, blocksEntry: true, session: session.running });
    const waiting = observation({
      issue: 2,
      ledger: present("進行中"),
      claimBranchExists: present(true),
      claimRecord: present({ members: [2], landing: ["control"] }),
      surfaces: [surface({ hasCheckout: present(true) })],
      // 計画コメントがまだ無い = `準備中` なので、この課題は write を保持していない。
      session: session.idle,
    });
    const d = tick([blocker, waiting]);
    expect(d.kind === "action" && d.params.action === "枠を渡す" ? d.params.lease : null).not.toBe(
      "write",
    );
  });

  test("14d: 宣言した課題が 人待ち に入った", () => {
    const blocker = implementing({
      issue: 1,
      blocksEntry: true,
      waitRecord: wait.waiting,
      session: session.running,
    });
    const candidate = observation({ issue: 2, ledger: present("計画済み") });
    expectAction([blocker, candidate], "claim する");
  });

  test("14e: 宣言した課題が 退避先 へ移り、セッションも止まっている", () => {
    const blocker = implementing({
      issue: 1,
      blocksEntry: true,
      ledger: present("退避先"),
      session: session.none,
    });
    const candidate = observation({ issue: 2, ledger: present("計画済み") });
    expectAction([blocker, candidate], "claim する");
  });

  test("14f: 行 14e と同じく 退避先 だが、セッションはまだ動いている", () => {
    expectConflict(
      [
        implementing({
          issue: 1,
          blocksEntry: true,
          ledger: present("退避先"),
          session: session.running,
        }),
      ],
      "退避先だがセッションが止まらない",
    );
  });
});

describe("merge の直列化（続き）", () => {
  test("13c: 渡した後で、PR 作成のより早い課題が緑に戻って 着地待ち へ再入した", () => {
    const holder = awaitingLanding({
      issue: 1,
      integrationRecordCount: present(1),
      session: session.running,
    });
    const reentered = awaitingLanding({
      issue: 2,
      claimRecord: present({ members: [2], landing: ["control"] }),
      claimedAt: present(1),
      session: session.idle,
    });
    const d = tick([holder, reentered]);
    expect(d.kind === "action" ? d.target.representative : null).not.toBe(2);
  });

  test("13d: 保持者の本文が計画の記録と食い違った", () => {
    expectAction(
      [
        awaitingLanding({
          integrationRecordCount: present(1),
          bodyMatchesPlan: present(false),
          session: session.running,
        }),
      ],
      "本文の変更を伝える",
    );
  });

  test("13e: 保持者が 人待ち に入った", () => {
    expectAction(
      [
        awaitingLanding({
          integrationRecordCount: present(1),
          waitRecord: wait.waiting,
          session: session.running,
        }),
      ],
      "失効した記録を片付ける",
    );
  });

  test("13i: 保持者が終端に達したが、実体もセッションも既に無い", () => {
    expectAction(
      [
        implementing({
          surfaces: [surface({ terminal: present(true) })],
          submissionEvidence: present(true),
          claimBranchExists: present(false),
          claimRecord: { kind: "absent" },
          ledger: present("完了"),
          integrationRecordCount: present(1),
        }),
      ],
      "片付ける",
    );
  });
});

describe("順序", () => {
  test("他をブロックしている数が多いものを先に取る", () => {
    // **順序が効くのは同じ rung の候補どうし。**ラダーの段が違えば段が勝つ。
    const blocker = observation({ issue: 1, ledger: present("計画済み"), boardOrder: 50 });
    const board = observation({ issue: 2, ledger: present("計画済み"), boardOrder: 1 });
    const waiter = observation({
      issue: 3,
      ledger: present("計画済み"),
      dependsOn: [1],
      boardOrder: 90,
    });
    const d = tick([blocker, board, waiter]);
    expect(d.kind === "action" ? d.target.representative : d.kind).toBe(1);
  });

  test("退避先 をブロックしているだけの課題は詰まりに数えない", () => {
    const first = observation({ issue: 1, ledger: present("計画済み"), boardOrder: 50 });
    const shelved = observation({
      issue: 3,
      ledger: present("退避先"),
      dependsOn: [1],
      boardOrder: 90,
    });
    const board = observation({ issue: 2, ledger: present("計画済み"), boardOrder: 1 });
    const d = tick([first, shelved, board]);
    expect(d.kind === "action" ? d.target.representative : d.kind).toBe(2);
  });
});

describe("硬い上限", () => {
  test("10: 人が直接 resolve を走らせ、worktree が目安を超えた", () => {
    const busy = Array.from({ length: 4 }, (_, i) =>
      implementing({
        issue: 10 + i,
        claimRecord: present({ members: [10 + i], landing: ["control"] }),
        session: session.running,
      }),
    );
    const candidate = observation({ issue: 1, ledger: present("計画済み") });
    expectIdle([...busy, candidate]);
  });

  test("計画枠が埋まっていたら計画を起こさない", () => {
    const planning = Array.from({ length: 3 }, (_, i) =>
      observation({
        issue: 10 + i,
        ledger: present("未計画"),
        refineSessionExists: true,
        session: session.running,
      }),
    );
    const candidate = observation({ issue: 1, ledger: present("未計画") });
    expectIdle([...planning, candidate]);
  });

  test("8n: retry budget の戻し先は TickConfig の値で決まる", () => {
    const d = decide({
      observations: [
        implementing({
          session: session.none,
          failureRecord: present({ count: 2, lastAction: null }),
        }),
      ],
      config: { ...DEFAULT_CONFIG, retryBudget: 2 },
    });
    expect(d.kind === "action" ? d.params : d.kind).toMatchObject({
      action: "差し戻す",
      to: "退避先",
    });
  });
});

describe("action の選択と独立な精算", () => {
  test("退避先 を観測したら count を 0 に揃える（action にも上限にも数えない）", () => {
    const d = tick([
      observation({
        ledger: present("退避先"),
        failureRecord: present({ count: 3, lastAction: "解決を起こし直す" }),
      }),
    ]);
    expect(d.kind).toBe("settle-record");
  });

  test("8d: 人が未計画へ戻した課題は、差し戻しへ直帰しない", () => {
    // `退避先` に居るあいだに不変条件で 0 に揃っているので、新しい失敗なしには戻らない。
    expectAction(
      [
        observation({
          ledger: present("未計画"),
          failureRecord: present({ count: 0, lastAction: "解決を起こし直す" }),
        }),
      ],
      "計画を起こす",
    );
  });
});
