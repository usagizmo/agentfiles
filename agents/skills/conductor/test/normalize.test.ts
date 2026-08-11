// `references/scenarios.md` の観測 → 4 フィールドを固定する。
//
// **これは characterization test であって回帰テストではない。**prose 実装を revert して
// 落ちることを実測できないので、いま守っているのは「表と実装が一致していること」だけ。
// 将来この実装を直すとき、修正前コードで落ちることを確かめた行だけが回帰テストになる。
//
// **テスト名は `scenarios.md` の行 ID**。表と 1:1 で引けることが、両者が同じものを
// 語っている唯一の担保になる。

import { describe, expect, test } from "bun:test";
import { normalize } from "../src/normalize.ts";
import type { IssueObservation } from "../src/observation.ts";
import type { Capacity, ConflictReason, Ledger, Progress, Runtime } from "../src/types.ts";
import { absent, present, unobservable } from "../src/types.ts";
import { intent, observation, session, surface, wait } from "./fixtures.ts";

type Fields = {
  readonly progress: Progress;
  readonly runtime: Runtime;
  readonly capacity: Capacity;
  readonly ledger: Ledger;
};

const expectFields = (o: IssueObservation, expected: Fields) => {
  const r = normalize(o);
  expect({
    progress: r.progress,
    runtime: r.runtime,
    capacity: r.capacity,
    ledger: r.ledger,
  }).toEqual(expected);
};

const expectConflict = (o: IssueObservation, reason: ConflictReason) => {
  expect(normalize(o).conflicts.map((c) => c.reason)).toContain(reason);
};

/** 実装が進んでいる面（commit があり checkout も在る）。 */
const workingSurface = (over: Partial<ReturnType<typeof surface>> = {}) =>
  surface({ aheadOfIntegration: present(true), hasCheckout: present(true), ...over });

describe("台帳と実体のずれ", () => {
  test("1: merge 済みだが remote branch が残り、worktree もある", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface({ terminal: present(true) })],
        submissionEvidence: present(true),
      }),
      { progress: "着地済み", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });

  test("2: claim が Status 更新だけ失敗した（branch はあるがセッションも worktree も無い）", () => {
    expectFields(observation({ ledger: present("計画済み"), claimBranchExists: present(true) }), {
      progress: "準備中",
      runtime: "無し",
      capacity: "無し",
      ledger: "計画済み",
    });
  });

  test("3: claim の記録はあるが branch も commit も無い", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimRecord: present({ members: [1], landing: ["control"] }),
      }),
      { progress: "未着手", runtime: "無し", capacity: "無し", ledger: "進行中" },
    );
  });

  test("3b: 行 3 と同じ形だが、台帳は 計画済み のまま", () => {
    expectFields(
      observation({
        ledger: present("計画済み"),
        claimRecord: present({ members: [1], landing: ["control"] }),
      }),
      { progress: "未着手", runtime: "無し", capacity: "無し", ledger: "計画済み" },
    );
  });

  test("4: Issue 契約が欠けているが commit がある", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        issueContractComplete: present(false),
        claimBranchExists: present(true),
        surfaces: [workingSurface()],
      }),
      "Issue 契約が欠けたまま成果物がある",
    );
  });

  test("4b: 未計画 のまま積まれた課題", () => {
    expectFields(observation({ ledger: present("未計画") }), {
      progress: "未着手",
      runtime: "無し",
      capacity: "無し",
      ledger: "未計画",
    });
  });

  test("4c: 計画済みの正常な在庫", () => {
    expectFields(observation({ ledger: present("計画済み") }), {
      progress: "未着手",
      runtime: "無し",
      capacity: "無し",
      ledger: "計画済み",
    });
  });
});

describe("実行器が消える / 止まる", () => {
  test("5: 人待ちの記録が waiting のままセッションが消えた（実装途中）", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        waitRecord: wait.waiting,
        session: session.none,
      }),
      { progress: "実装中", runtime: "人待ち", capacity: "あり", ledger: "進行中" },
    );
  });

  test("6: 行 5 と同じく waiting だが、計画段階でセッションが消えた", () => {
    expectFields(observation({ ledger: present("未計画"), waitRecord: wait.waiting }), {
      progress: "未着手",
      runtime: "人待ち",
      capacity: "無し",
      ledger: "未計画",
    });
  });

  test("6b: refine が Status も人待ちの記録も残さずに終わった（セッションは done）", () => {
    expectFields(
      observation({ ledger: present("未計画"), session: session.idle, refineSessionExists: true }),
      { progress: "未着手", runtime: "待機", capacity: "無し", ledger: "未計画" },
    );
  });

  test("7a: dirty worktree のまま人待ちへ入り、セッションは生きている", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface({ dirty: present(true) })],
        waitRecord: wait.waiting,
        session: session.running,
      }),
      { progress: "実装中", runtime: "人待ち", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7c: 人が答え、記録が cleared になった", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        waitRecord: wait.cleared,
        session: session.idle,
      }),
      { progress: "実装中", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7e: 計画セッションが idle（人が入力を書いている最中かもしれない）", () => {
    expectFields(
      observation({
        ledger: present("計画済み"),
        session: session.idle,
        refineSessionExists: true,
      }),
      { progress: "未着手", runtime: "待機", capacity: "無し", ledger: "計画済み" },
    );
  });

  test("7k: claim 済み・branch は clean・計画コメント無し。prepare の途中", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        surfaces: [surface({ hasCheckout: present(true) })],
        session: session.running,
      }),
      { progress: "準備中", runtime: "稼働中", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7l: 計画コメントが無いのに dirty か commit がある", () => {
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      surfaces: [workingSurface()],
      session: session.running,
    });
    expectFields(o, { progress: "実装中", runtime: "稼働中", capacity: "あり", ledger: "進行中" });
    expectConflict(o, "計画コメントが無いまま実装の証跡がある");
  });

  test("7f: セッションの生の状態が「分類できない」を返した", () => {
    expectConflict(
      observation({ ledger: present("進行中"), session: session.unclassifiable("weird") }),
      "観測できない",
    );
  });

  test("7g: write を渡された直後にターンが終わった（1 行も書いていない）", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [surface({ hasCheckout: present(true) })],
        session: session.idle,
      }),
      { progress: "準備済み", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7h: 人待ちの記録が waiting だが本文が無く、同じ対象に休止の記録がある", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        waitRecord: wait.mislabeled,
        pauseRecordExists: true,
        session: session.running,
      }),
      { progress: "実装中", runtime: "稼働中", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7i: 行 7h と同じく本文が無いが、実行資源待ちの証跡も無い", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        waitRecord: wait.undecidable,
        session: session.running,
      }),
      "証跡が矛盾している",
    );
  });

  test("7j: 一度 cleared にした後に聞き直し、記録を waiting へ戻した", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        openPr: present(true),
        waitRecord: wait.waiting,
        session: session.running,
      }),
      { progress: "提出中", runtime: "人待ち", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7m: write を保持したままターンが終わった（人待ちの記録は無い）", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        session: session.idle,
      }),
      { progress: "実装中", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });

  test("7r: 起こし直しのあと、記録は cleared でセッションは 稼働中", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [workingSurface()],
        waitRecord: wait.cleared,
        session: session.running,
      }),
      { progress: "実装中", runtime: "稼働中", capacity: "あり", ledger: "進行中" },
    );
  });
});

describe("着地面が制御面と違う", () => {
  const control = (over: Partial<ReturnType<typeof surface>> = {}) =>
    surface({ name: "control", ...over });
  const secondary = (over: Partial<ReturnType<typeof surface>> = {}) =>
    surface({ name: "skills", usesPr: false, ...over });

  test("17b: 着地面にだけ commit があり、制御面の branch は 0 commit", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          control(),
          secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) }),
        ],
        session: session.running,
      }),
      { progress: "実装中", runtime: "稼働中", capacity: "あり", ledger: "進行中" },
    );
  });

  test("17c: 着地面に commit と有効な report があり、制御面は 0 commit のまま", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          control(),
          secondary({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            terminal: present(true),
          }),
        ],
        submissionEvidence: present(true),
      }),
      { progress: "着地済み", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });

  test("17c2: 行 17c と同じ状況だが、提出の証跡が無い", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          control(),
          secondary({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            terminal: present(true),
          }),
        ],
      }),
      { progress: "実装中", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });

  test("17g2: 書いた面は clean で report もあるが、書かなかった面が dirty", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          control({ dirty: present(true), hasCheckout: present(true) }),
          secondary({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            landable: present(true),
          }),
        ],
        submissionEvidence: present(true),
        session: session.idle,
      }),
      { progress: "実装中", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });

  test("17h: 宣言された着地面が座標表に無い（面の観測が読めない）", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        surfaces: [control({ terminal: unobservable("座標表に無い") })],
      }),
      "着地面が解決できない",
    );
  });

  test("17i: live checkout が dirty で、その面はまだ着地していない", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          secondary({ aheadOfIntegration: present(true), liveCheckoutHealthy: present(false) }),
        ],
      }),
      "live checkout が異常",
    );
  });

  test("17i2: 行 17i と同じ live の dirty だが、その課題は既に 着地済み", () => {
    const o = observation({
      ledger: present("完了"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [
        secondary({
          aheadOfIntegration: present(true),
          hasCheckout: present(true),
          terminal: present(true),
          liveCheckoutHealthy: present(false),
        }),
      ],
      submissionEvidence: present(true),
    });
    expectFields(o, { progress: "着地済み", runtime: "無し", capacity: "あり", ledger: "完了" });
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain("live checkout が異常");
  });

  test("17m: PR が merged なのに提出の証跡が無い", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [control({ aheadOfIntegration: present(true), terminal: present(true) })],
        prMerged: present(true),
      }),
      "着地済みだが提出の証跡が無い",
    );
  });

  test("17k: 片付けが終わり、Issue は closed・worktree も無い", () => {
    expectFields(
      observation({ open: false, ledger: present("完了"), claimBranchExists: present(true) }),
      { progress: "取り下げ", runtime: "無し", capacity: "無し", ledger: "完了" },
    );
  });
});

describe("外から状態が動く", () => {
  test("9f: 提出中 のまま CI が全部 cancel され、実行中の checks が 0 件になった", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [surface({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
        openPr: present(true),
        checks: present({ running: 0, green: false }),
        session: session.idle,
      }),
      { progress: "提出中", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });

  test("9e: 先発が着地し、休止していた後発と交差する保持者が居なくなった", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [surface({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
        pauseRecordExists: true,
        session: session.none,
      }),
      { progress: "実装中", runtime: "休止", capacity: "あり", ledger: "進行中" },
    );
  });

  test("9d: 休止の記録があるのに、そのセッションが動き続けている", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [surface({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
        pauseRecordExists: true,
        session: session.running,
      }),
      { progress: "実装中", runtime: "稼働中", capacity: "あり", ledger: "進行中" },
    );
  });

  test("10g: 着地待ち で渡しの記録を持ったまま 待機", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          surface({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            landable: present(true),
          }),
        ],
        submissionEvidence: present(true),
        integrationRecordCount: present(1),
        session: session.idle,
      }),
      { progress: "着地待ち", runtime: "待機", capacity: "あり", ledger: "進行中" },
    );
  });
});

describe("意図の確認", () => {
  test("15b: 意図の確認が pending なのに、人待ちが cleared か無い", () => {
    expectConflict(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          surface({
            aheadOfIntegration: present(true),
            hasCheckout: present(true),
            landable: present(true),
          }),
        ],
        submissionEvidence: present(true),
        intentRecord: intent.pending,
        waitRecord: wait.cleared,
      }),
      "意図の確認が pending なのに人待ちが無い",
    );
  });
});

describe("merge の直列化（integration）", () => {
  test("13g: 渡しの記録が 2 件ある", () => {
    expectConflict(
      observation({ ledger: present("進行中"), integrationRecordCount: present(2) }),
      "渡しの記録が複数",
    );
  });
});

describe("capacity", () => {
  test("checkout は無いが、所有している workspace が残っている", () => {
    expectFields(
      observation({ ledger: present("完了"), prunableWorkspace: present(true), open: false }),
      { progress: "取り下げ", runtime: "無し", capacity: "prunable", ledger: "完了" },
    );
  });

  test("面が 2 つあり、片方にだけ checkout がある", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        surfaces: [surface({ name: "a" }), surface({ name: "b", hasCheckout: present(true) })],
      }),
      { progress: "準備中", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });
});

describe("読めなかった観測を clean へ畳まない", () => {
  test("dirty が `-` の面は `実装中` 側へ落ちる", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          surface({ dirty: unobservable("worktree を読めない"), hasCheckout: present(true) }),
        ],
        submissionEvidence: present(true),
      }),
      { progress: "実装中", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });

  test("ledger を読めなければ Conflict", () => {
    expectConflict(observation({ ledger: absent() }), "ledger が解釈不能");
  });
});
