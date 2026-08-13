// `references/scenarios.md` の観測 → 選ぶ action を固定する。
//
// **characterization test**（`normalize.test.ts` の冒頭と同じ理由）。
// **テスト名は行 ID**。`何も選ばない` は選択結果の null 値なので `idle` で受ける。

import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, buildGroups, decide } from "../src/decide.ts";
import type { TickInput } from "../src/decide.ts";
import type { IssueObservation } from "../src/observation.ts";
import type { ActionName, ConflictReason, LeaseKind, RevertTarget } from "../src/types.ts";
import { present } from "../src/types.ts";
import { intent, observation, session, surface, wait } from "./fixtures.ts";

const tick = (observations: readonly IssueObservation[], over: Partial<TickInput> = {}) =>
  decide({ observations, config: DEFAULT_CONFIG, ...over });

const expectAction = (observations: readonly IssueObservation[], action: ActionName) => {
  const o = tick(observations).outcome;
  expect(o.kind === "action" ? o.params.action : o.kind).toBe(action);
};

const expectRevert = (observations: readonly IssueObservation[], to: RevertTarget) => {
  const o = tick(observations).outcome;
  expect(o.kind === "action" ? o.params : o.kind).toMatchObject({ action: "差し戻す", to });
};

const expectLease = (observations: readonly IssueObservation[], lease: LeaseKind) => {
  const o = tick(observations).outcome;
  expect(o.kind === "action" ? o.params : o.kind).toMatchObject({ action: "枠を渡す", lease });
};

const expectIdle = (observations: readonly IssueObservation[]) => {
  const o = tick(observations).outcome;
  expect(o.kind === "action" ? o.params.action : o.kind).toBe("idle");
};

/** **Conflict は action の選択と直交する。**出ていることだけを見る。 */
const expectConflict = (observations: readonly IssueObservation[], reason: ConflictReason) => {
  expect(tick(observations).conflicts.map((c) => c.reason)).toContain(reason);
};

/** claim 済みで実装が進んでいる課題の骨格。各行はここから差分だけ書く。 */
const implementing = (over: Partial<IssueObservation> = {}): IssueObservation =>
  observation({
    ledger: present("進行中"),
    claimBranchExists: present(true),
    planCommentExists: present(true),
    claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
          claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
          claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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

  test("3d: Conflict のある課題は選出対象外になるだけで、他の課題は回る", () => {
    // **1 件を止めるのは差し戻し、全体を止めるのは conductor セッション自体の停止**
    // （SKILL.md「硬い上限」）。1 件で全体が凍ると、健全な課題まで人が触るまで動かない
    // （実測で 289 件中 287 件が健全でも 1 手も出なかった）。
    const broken = observation({
      issue: 1,
      ledger: present("進行中"),
      session: session.unclassifiable("weird"),
    });
    const healthy = observation({ issue: 2, ledger: present("未計画") });
    const d = tick([broken, healthy]);
    expect(d.conflicts.map((c) => c.reason)).toContain("観測できない");
    expect(d.outcome.kind === "action" ? d.outcome.params.action : d.outcome.kind).toBe(
      "計画を起こす",
    );
    expect(d.outcome.kind === "action" ? d.outcome.target.representative : null).toBe(2);
  });

  test("3e: Conflict のある課題自身には action を出さない", () => {
    const broken = observation({
      issue: 1,
      ledger: present("未計画"),
      session: session.unclassifiable("weird"),
    });
    const d = tick([broken]);
    expect(d.conflicts.length).toBeGreaterThan(0);
    expect(d.outcome.kind).toBe("idle");
  });

  test("3f: ledger が期待より先の課題が居ても、他の課題は回る", () => {
    // この Conflict だけはラダー上で決まる（差し戻しのどれにも当たらないことが条件）。
    // **当たった課題を選出対象外にするだけ**で、そこで tick を終え**ない**。
    const ahead = observation({ issue: 1, ledger: present("進行中") });
    const healthy = observation({ issue: 2, ledger: present("未計画") });
    const d = tick([ahead, healthy]);
    expect(d.conflicts.map((c) => c.reason)).toContain("ledger が期待より先");
    expect(d.outcome.kind === "action" ? d.outcome.target.representative : null).toBe(2);
  });

  test("3g: reason と evidence が同じ Conflict は 1 件に畳み、issues に番号を集める", () => {
    const liveBroken = (n: number): IssueObservation =>
      implementing({
        issue: n,
        claimRecord: present({ representative: n, members: [n], landing: ["control"] }),
        surfaces: [
          surface({
            name: "skills",
            usesPr: false,
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            liveCheckoutHealthy: present(false),
          }),
        ],
      });
    const otherBroken = implementing({
      issue: 4,
      claimRecord: present({ representative: 4, members: [4], landing: ["control"] }),
      surfaces: [
        surface({
          name: "other",
          usesPr: false,
          aheadOfIntegration: present(true),
          hasCheckout: present(true),
          liveCheckoutHealthy: present(false),
        }),
      ],
    });
    const healthy = observation({ issue: 3, ledger: present("未計画") });
    const d = tick([liveBroken(1), liveBroken(2), otherBroken, healthy]);
    const live = d.conflicts.filter((c) => c.reason === "live checkout が異常");
    expect(live).toHaveLength(2);
    expect(live.find((c) => c.evidence[0]?.includes("skills"))?.issues).toEqual([1, 2]);
    expect(live.find((c) => c.evidence[0]?.includes("other"))?.issues).toEqual([4]);
    expect(d.outcome.kind === "action" ? d.outcome.target.representative : null).toBe(3);
  });

  test("4c: 計画済みの正常な在庫", () => {
    expectAction([observation({ ledger: present("計画済み") })], "claim する");
  });

  test("4d: claim の残骸があり、同時に retry budget も上限に達している", () => {
    expectRevert(
      [
        observation({
          ledger: present("進行中"),
          claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
          refineSession: session.idle,
        }),
      ],
      "計画セッションを片付ける",
    );
  });

  test("7f2: セッションが blocked。人待ちの記録は waiting かつ有効", () => {
    expectIdle([
      implementing({
        waitRecord: wait.waiting,
        session: session.blocked,
      }),
    ]);
  });

  test("7f3: セッションが blocked。人待ちの記録が無い", () => {
    expectConflict([implementing({ session: session.blocked })], "証跡が矛盾している");
    expectIdle([implementing({ session: session.blocked })]);
  });

  test("7f4: 計画セッションが blocked。人待ちの記録が無い", () => {
    const rows = [
      observation({
        ledger: present("未計画"),
        refineSession: session.blocked,
      }),
    ];
    expectConflict(rows, "証跡が矛盾している");
    const o = tick(rows).outcome;
    expect(o.kind === "action" ? o.params.action : o.kind).not.toBe("計画セッションを片付ける");
  });

  test("7f5: 終端に達し、セッションが blocked。人待ちの記録が無い", () => {
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
          session: session.blocked,
          ledger: present("完了"),
        }),
      ],
      "片付ける",
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
          refineSession: session.idle,
        }),
      ],
      "計画セッションを片付ける",
    );
  });

  test("7d2: 起こした直後で、計画セッションが動いている", () => {
    // **走っているセッションを片付ける action に当てない。**`o.session` は `resolve-<番号>` を
    // 見るので計画中は常に `none` になり、`refine` の稼働で引かないと保護が一度も効かない ——
    // 起こす → 次の tick で畳む → また起こす、の往復から出られなくなる（実物で踏んだ）。
    expectIdle([observation({ ledger: present("未計画"), refineSession: session.running })]);
  });

  test("7d3: 台帳が進んだ後でも、計画セッションが動いているうちは畳まない", () => {
    // `refine` は Status を進めてから終わるので、**この窓を毎回通る**。
    expectAction(
      [observation({ ledger: present("計画済み"), refineSession: session.running })],
      "claim する",
    );
  });

  test("7d4: retired-refine は片付けの対象ではなく、計画を塞ぐ印として残る", () => {
    // rename 済みなので「計画セッションを片付ける」は当たらない（対象は `refine-<番号>` の完全一致）。
    // **塞ぎは残る** —— 当てて消すと、次の tick で二重計画になる。
    expectIdle([observation({ ledger: present("未計画"), retiredRefineExists: true })]);
  });

  test("7e: 計画セッションが idle", () => {
    expectAction(
      [
        observation({
          ledger: present("計画済み"),
          refineSession: session.idle,
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
        claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
          claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
        claimRecord: present({ representative: 10, members: [10 + i], landing: ["control"] }),
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    expectAction([a, b], "交差を解消する");
  });

  test("9d: 休止の記録の to / keys が現在の交差と一致し、セッションは動き続けている", () => {
    const a = implementing({
      issue: 1,
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    const b = implementing({
      issue: 2,
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      resourceKeys: present(["skills"]),
      pauseRecordExists: true,
      yieldRecord: present({ issues: [2], to: 1, keys: ["skills"] }),
      session: session.running,
    });
    expectIdle([a, b]);
  });

  test("9k: 休止の記録はあるが、to か keys が現在の交差と一致しない", () => {
    const a = implementing({
      issue: 1,
      resourceKeys: present(["skills"]),
      session: session.running,
    });
    const b = implementing({
      issue: 2,
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      resourceKeys: present(["skills"]),
      pauseRecordExists: true,
      yieldRecord: present({ issues: [2], to: 1, keys: ["old"] }),
      session: session.running,
    });
    expectAction([a, b], "交差を解消する");
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      resourceKeys: present(["api"]),
      pauseRecordExists: true,
      session: session.idle,
    });
    const d = tick([lead, follower]).outcome;
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
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
    ]).outcome;
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
    ]).outcome;
    expect(d.kind === "action" ? d.params.action : d.kind).not.toBe("差し戻す");
  });

  test("10q: 準備中 のまま枠を渡すが成功し続け、計画コメントも commit も出ない", () => {
    expectLease(
      [
        observation({
          ledger: present("進行中"),
          claimBranchExists: present(true),
          claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
    const d = tick([
      awaitingLanding({ intentRecord: intent.pending, waitRecord: wait.waiting }),
    ]).outcome;
    // merge の枠の受け手にしない。
    expect(d.kind === "action" && d.params.action === "枠を渡す" ? d.params.lease : null).not.toBe(
      "integration",
    );
  });

  test("15c: 一部の項目だけ明示承認され、残りは無反応", () => {
    const d = tick([
      awaitingLanding({ intentRecord: intent.pending, waitRecord: wait.waiting }),
    ]).outcome;
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      claimedAt: present(200),
      session: session.idle,
    });
    const d = tick([blocked, other]).outcome;
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      claimedAt: present(50),
      session: session.idle,
    });
    const d = tick([holder, other]).outcome;
    // 記録を持つ側が保持者。**`着地待ち` に居ることは保持の条件ではない。**
    expect(d.kind === "action" ? d.params.action : d.kind).not.toBe("枠を渡す");
  });

  test("13g: 渡しの記録が 2 件ある", () => {
    expectConflict([implementing({ integrationRecordCount: present(2) })], "渡しの記録が複数");
  });
});

describe("group", () => {
  test("11: 対象集合の 1 人だけが closed になり、終端が混在した", () => {
    // 実体は 1 セットなので、**どちらに倒しても壊れる** —— 片付ければ走っている実装が消え、
    // 放置すれば closed の課題が終端に達しないまま資源を握り続ける。
    const lead = implementing({
      issue: 1,
      claimRecord: present({ representative: 1, members: [1, 2], landing: ["control"] }),
    });
    const closed = observation({ issue: 2, ledger: present("進行中"), open: present(false) });
    expectConflict([lead, closed], "group の終端が混在");
  });

  test("12g: claim 済み group の非代表成員を正規化する", () => {
    // **共有する実体は代表の番号で 1 セット**（`same-branch.md`「共有するもの」）。
    // 成員ごとに自分の番号で引くと branch も worktree もセッションも見えず、
    // **claim するたびに代表以外の全員が `ledger が期待より先` になる**。
    const lead = implementing({
      issue: 1,
      claimRecord: present({ representative: 1, members: [1, 2], landing: ["control"] }),
    });
    const member = observation({ issue: 2, ledger: present("進行中"), sameBranchAs: [1] });
    expect(tick([lead, member]).conflicts).toEqual([]);
  });

  test("12h: 行 12g の group が着地した", () => {
    const landed = implementing({
      issue: 1,
      claimRecord: present({ representative: 1, members: [1, 2], landing: ["control"] }),
      surfaces: [
        surface({
          aheadOfIntegration: present(true),
          hasCheckout: present(true),
          terminal: present(true),
        }),
      ],
      submissionEvidence: present(true),
    });
    const member = observation({ issue: 2, ledger: present("進行中"), sameBranchAs: [1] });
    const records = buildGroups([landed, member]).flatMap((g) => g.records);
    expect(records.find((r) => r.issue === 2)?.progress).toBe("着地済み");
    expect(tick([landed, member]).conflicts).toEqual([]);
  });

  test("12i: claim の記録の members にだけ居る番号", () => {
    // 加入は記録への追記が実体。**本文の宣言を待たない。**
    const lead = implementing({
      issue: 1,
      claimRecord: present({ representative: 1, members: [1, 2], landing: ["control"] }),
    });
    const joined = observation({ issue: 2, ledger: present("進行中") });
    const d = tick([lead, joined]);
    expect(d.conflicts).toEqual([]);
    expect(d.outcome.kind === "action" ? d.outcome.target.members : null).toEqual([1, 2]);
  });

  test("12k: 片方向の宣言で、書いていない側が先に観測される", () => {
    // **宣言は片方向でも group が成立する**（`same-branch.md`「譲っても機能は失われない」）。
    // 有向辺のまま辿ると、辺を持たない側を先に訪問した時点でそこが確定し、
    // **board の並び順で連結成分が割れる** —— 1 本で直すための宣言が 2 本の branch を生む。
    const silent = observation({ issue: 1, ledger: present("計画済み") });
    const declaring = observation({ issue: 2, ledger: present("計画済み"), sameBranchAs: [1] });
    // 宣言していない側が先（board の並び順がそうなりうる）。
    const groups = buildGroups([silent, declaring]);
    expect(groups.length).toBe(1);
    expect(groups[0]?.members).toEqual([1, 2]);
    expect(groups[0]?.representative).toBe(1);
    // 並びを逆にしても同じ（順序に依存しない）。
    expect(buildGroups([declaring, silent])[0]?.members).toEqual([1, 2]);
  });

  test("12j: claim 前の group で、成員の側にだけ人待ちの記録がある", () => {
    // claim 前の人待ちは渡された Issue に書かれる（代表がまだ決まっていない）。
    const a = observation({ issue: 1, ledger: present("未計画"), sameBranchAs: [2] });
    const b = observation({
      issue: 2,
      ledger: present("未計画"),
      sameBranchAs: [1],
      waitRecord: wait.waiting,
    });
    const records = buildGroups([a, b]).flatMap((g) => g.records);
    expect(records.find((r) => r.issue === 2)?.runtime).toBe("人待ち");
  });

  test("12l: claim 済み。wait は成員にだけあり、代表のセッションは blocked", () => {
    // claim 後の wait は代表のコメントだけを読む。成員の記録は runtime に写さない。
    const lead = implementing({
      issue: 1,
      claimRecord: present({ representative: 1, members: [1, 2], landing: ["control"] }),
      session: session.blocked,
    });
    const member = observation({
      issue: 2,
      ledger: present("進行中"),
      sameBranchAs: [1],
      waitRecord: wait.waiting,
    });
    const records = buildGroups([lead, member]).flatMap((g) => g.records);
    expect(records.find((r) => r.issue === 1)?.runtime).not.toBe("人待ち");
    expect(records.find((r) => r.issue === 2)?.runtime).not.toBe("人待ち");
    expectConflict([lead, member], "証跡が矛盾している");
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
      refineSession: session.running,
      sameBranchAs: [2],
    });
    const b = observation({
      issue: 2,
      ledger: present("未計画"),
      refineSession: session.running,
      sameBranchAs: [1],
    });
    expectIdle([a, b]);
  });

  test("12d: conductor がこの tick で規約の穴を見つけた", () => {
    const d = tick([observation({ issue: 1, ledger: present("計画済み") })], {
      specGap: { issue: 1, fact: "片付けの述語が 2 箇所に在る" },
    }).outcome;
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
    const d = tick([fresh, stale]).outcome;
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      surfaces: [surface({ hasCheckout: present(true) })],
      // 計画コメントがまだ無い = `準備中` なので、この課題は write を保持していない。
      session: session.idle,
    });
    const d = tick([blocker, waiting]).outcome;
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
    const shelved = (s: IssueObservation["session"]) =>
      implementing({
        issue: 1,
        blocksEntry: true,
        ledger: present("退避先"),
        session: s,
      });
    expectConflict([shelved(session.running)], "退避先だがセッションが止まらない");
    expectConflict([shelved(session.blocked)], "退避先だがセッションが止まらない");
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
      claimRecord: present({ representative: 2, members: [2], landing: ["control"] }),
      claimedAt: present(1),
      session: session.idle,
    });
    const d = tick([holder, reentered]).outcome;
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
    const d = tick([blocker, board, waiter]).outcome;
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
    const d = tick([first, shelved, board]).outcome;
    expect(d.kind === "action" ? d.target.representative : d.kind).toBe(2);
  });
});

describe("硬い上限", () => {
  test("10: 人が直接 resolve を走らせ、worktree が目安を超えた", () => {
    const busy = Array.from({ length: 4 }, (_, i) =>
      implementing({
        issue: 10 + i,
        claimRecord: present({ representative: 10, members: [10 + i], landing: ["control"] }),
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
        refineSession: session.running,
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
    }).outcome;
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
    ]).outcome;
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

describe("着地面が制御面と違う（action）", () => {
  const control = (over: Partial<ReturnType<typeof surface>> = {}) =>
    surface({ name: "control", ...over });
  const secondary = (over: Partial<ReturnType<typeof surface>> = {}) =>
    surface({ name: "skills", usesPr: false, ...over });

  /** claim 済みで、制御面の branch と着地面の worktree を持つ骨格。 */
  const landed = (over: Partial<IssueObservation> = {}): IssueObservation =>
    observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      claimRecord: present({ representative: 1, members: [1], landing: ["control", "skills"] }),
      surfaces: [control(), secondary({ hasCheckout: present(true) })],
      ...over,
    });

  test("17a: claim 済みだが、着地面の worktree をまだ作っていない", () => {
    expectAction(
      [
        observation({
          ledger: present("進行中"),
          claimBranchExists: present(true),
          claimRecord: present({ representative: 1, members: [1], landing: ["control", "skills"] }),
          surfaces: [control(), secondary()],
        }),
      ],
      "解決を起こし直す",
    );
  });

  test("17d: 着地面の worktree は片付けたが、もう 1 面が残っている", () => {
    expectAction(
      [
        landed({
          ledger: present("完了"),
          claimBranchExists: present(false),
          surfaces: [
            control({ terminal: present(true) }),
            secondary({ terminal: present(true), hasCheckout: present(true) }),
          ],
          submissionEvidence: present(true),
        }),
      ],
      "片付ける",
    );
  });

  test("17e: 着地面は clean で commit あり、セッションまとめの記録が無い", () => {
    expectLease(
      [
        landed({
          surfaces: [
            control(),
            secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) }),
          ],
          session: session.idle,
        }),
      ],
      "write",
    );
  });

  test("17f: 行 17e と同じ状況でまとめの記録が出た", () => {
    expectAction(
      [
        landed({
          surfaces: [
            control(),
            secondary({
              aheadOfIntegration: present(true),
              hasCheckout: present(true),
              landable: present(true),
            }),
          ],
          submissionEvidence: present(true),
          session: session.idle,
        }),
      ],
      "意図の確認を促す",
    );
  });

  test("17g: まとめの記録はあるが、着地の直前に書き直して dirty になった", () => {
    expectIdle([
      landed({
        surfaces: [
          control(),
          secondary({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            landable: present(true),
            dirty: present(true),
          }),
        ],
        submissionEvidence: present(true),
        session: session.running,
      }),
    ]);
  });

  test("17g3: 提出のあとで、書かないつもりだった面へ commit した", () => {
    expectLease(
      [
        landed({
          surfaces: [
            control({ aheadOfIntegration: present(true), hasCheckout: present(true) }),
            secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) }),
          ],
          // まとめは無効になっているので `着地待ち` から落ちる（透過にも `heads = T` を課す）。
          submissionEvidence: present(false),
          session: session.idle,
        }),
      ],
      "write",
    );
  });

  test("17j: 同じ面へ別の課題が着地し、統合先が動いた", () => {
    expectAction(
      [
        landed({
          surfaces: [
            control(),
            secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) }),
          ],
          planInvalidated: present(true),
          session: session.running,
        }),
      ],
      "計画の失効を伝える",
    );
  });

  test("17l: 依存先が closed かつ 完了 なら、依存は解けている", () => {
    const dependency = observation({
      issue: 1,
      open: present(false),
      ledger: present("完了"),
      surfaces: [control(), secondary()],
    });
    const child = observation({ issue: 2, ledger: present("計画済み"), dependsOn: [1] });
    expectAction([dependency, child], "claim する");
  });

  test("17m2: PR を使わない面だけの課題で、commit はあるが提出の証跡が無い", () => {
    expectAction(
      [
        landed({
          surfaces: [secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
          claimRecord: present({ representative: 1, members: [1], landing: ["skills"] }),
          submissionEvidence: present(false),
          session: session.none,
        }),
      ],
      "解決を起こし直す",
    );
  });
});
