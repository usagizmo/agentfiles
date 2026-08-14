// `references/scenarios.md` の観測 → 4 フィールドを固定する。
//
// **これは characterization test であって回帰テストではない。**prose 実装を revert して
// 落ちることを実測できないので、いま守っているのは「表と実装が一致していること」だけ。
// 将来この実装を直すとき、修正前コードで落ちることを確かめた行だけが回帰テストになる。
//
// **テスト名は `scenarios.md` の行 ID**。表と 1:1 で引けることが、両者が同じものを
// 語っている唯一の担保になる。

import { describe, expect, test } from "bun:test";
import { normalize, normalizeProgress } from "../src/normalize.ts";
import { holdsIntegration, holdsWrite } from "../src/resources.ts";
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
        claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
      }),
      { progress: "未着手", runtime: "無し", capacity: "無し", ledger: "進行中" },
    );
  });

  test("3b: 行 3 と同じ形だが、台帳は 計画済み のまま", () => {
    expectFields(
      observation({
        ledger: present("計画済み"),
        claimRecord: present({ representative: 1, members: [1], landing: ["control"] }),
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
      observation({ ledger: present("未計画"), refineSession: session.idle }),
      // **`runtime` は `resolve-<番号>` から導く。**計画中は `無し`（`refine` の稼働を写さない）。
      { progress: "未着手", runtime: "無し", capacity: "無し", ledger: "未計画" },
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
        refineSession: session.idle,
      }),
      { progress: "未着手", runtime: "無し", capacity: "無し", ledger: "計画済み" },
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

  test("7f2: セッションが blocked。人待ちの記録は waiting かつ有効", () => {
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [workingSurface()],
      waitRecord: wait.waiting,
      session: session.blocked,
    });
    expectFields(o, { progress: "実装中", runtime: "人待ち", capacity: "あり", ledger: "進行中" });
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain("観測できない");
  });

  test("7f3: セッションが blocked。人待ちの記録が無い", () => {
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [workingSurface()],
      session: session.blocked,
    });
    expectConflict(o, "証跡が矛盾している");
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain("観測できない");
    expect(normalize(o).runtime).not.toBe("待機");
  });

  test("7f4: 計画セッションが blocked。人待ちの記録が無い", () => {
    const o = observation({
      ledger: present("未計画"),
      refineSession: session.blocked,
    });
    expectConflict(o, "証跡が矛盾している");
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain("観測できない");
  });

  test("7f5: 終端に達し、セッションが blocked。人待ちの記録が無い", () => {
    const o = observation({
      ledger: present("完了"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [workingSurface({ terminal: present(true) })],
      submissionEvidence: present(true),
      session: session.blocked,
    });
    expectFields(o, { progress: "着地済み", runtime: "無し", capacity: "あり", ledger: "完了" });
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain("証跡が矛盾している");
  });

  test("7n: board に居るのに issues 節に無く、open / closed を読めない", () => {
    const o = observation({ ledger: present("進行中"), open: unobservable("issues 節に無い") });
    expectConflict(o, "観測できない");
    // **closed へ倒さない** —— 倒すと `取り下げ` に化け、生きている課題が片付けの対象になる。
    expect(normalizeProgress(o)).not.toBe("取り下げ");
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

  // characterization: `着地待ち` から `submitted` を外すと `着地待ち` になり落ちる。
  test("17c3: 全着地面が透過で、提出の証跡が無く、open PR がある", () => {
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [control(), secondary({ hasCheckout: present(true) })],
        openPr: present(true),
      }),
      { progress: "提出中", runtime: "無し", capacity: "あり", ledger: "進行中" },
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

  test("17h3: 面が読めない課題に、成果物の Conflict を重ねない", () => {
    // 面を読めないなら **その面の dirty も commit も読めない**。fail-closed で「成果物あり」
    // 側へ倒れるが、そこから「計画コメントが無いのに実装の証跡がある」を出すと、
    // 実際には無い成果物を人へ報告することになる。根の Conflict は同じ観測が立てている。
    const o = observation({
      ledger: present("未計画"),
      issueContractComplete: present(false),
      // `observe` の `unknownSurface` と同じ形（面ごと観測できない）。
      surfaces: [
        control({
          aheadOfIntegration: unobservable("座標表に無い"),
          dirty: unobservable("座標表に無い"),
          hasCheckout: unobservable("座標表に無い"),
          terminal: unobservable("座標表に無い"),
          landable: unobservable("座標表に無い"),
        }),
      ],
    });
    const reasons = normalize(o).conflicts.map((c) => c.reason);
    expect(reasons).toContain("着地面が解決できない");
    expect(reasons).not.toContain("計画コメントが無いまま実装の証跡がある");
    expect(reasons).not.toContain("Issue 契約が欠けたまま成果物がある");
  });

  test("17h4: 面が読めない未 claim の課題は、write を保持しない", () => {
    // **`実装中` は読めた証跡だけで決める。**読めない面から `実装中` を導くと、branch も
    // worktree もセッションも無い課題が write を握り、**幽霊の保持者として本物の実行器を
    // 止める**（`交差を解消する` が当たる）。終端側の fail-closed は `allSurfacesClean` が
    // 別に守っているので、ここで倒す必要は無い。
    const o = observation({
      ledger: present("未計画"),
      surfaces: [
        control({
          aheadOfIntegration: unobservable("座標表に無い"),
          dirty: unobservable("座標表に無い"),
          hasCheckout: unobservable("座標表に無い"),
          terminal: unobservable("座標表に無い"),
          landable: unobservable("座標表に無い"),
        }),
      ],
    });
    expect(normalizeProgress(o)).toBe("未着手");
    expect(holdsWrite(normalize(o))).toBe(false);
  });

  test("17h5: 面を読めなくても、claim 済みなら write を保持し続ける", () => {
    // 実体（branch）があることは読めているので、そちらは手放さない。
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [
        control({
          aheadOfIntegration: unobservable("面の git を読めない"),
          dirty: unobservable("面の git を読めない"),
          terminal: unobservable("面の git を読めない"),
          landable: unobservable("面の git を読めない"),
        }),
      ],
    });
    expect(holdsWrite(normalize(o))).toBe(true);
  });

  test("17h6: 終端の判定では、読めない dirty を clean へ倒さない", () => {
    // `landing-surface.md`「全着地面が dirty でない（`0` のみ。読めなかった `-` は不可）」。
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      submissionEvidence: present(true),
      surfaces: [
        control({
          aheadOfIntegration: present(true),
          hasCheckout: present(true),
          terminal: present(true),
          dirty: unobservable("worktree 一覧を読めない"),
        }),
      ],
    });
    expect(normalizeProgress(o)).not.toBe("着地済み");
  });

  test("17h7: 面が読めない課題が、終端に達して実体も残っていない", () => {
    // **報告しても人が動かす先が無い。**`片付ける` が触る実体（容量・セッション・claim branch）が
    // 1 つも残っていないので、面を解決する必要そのものが無い。当てると毎 tick 報告し続ける。
    const settled: Partial<IssueObservation> = {
      open: present(false),
      ledger: present("完了"),
      surfaces: [
        control({
          aheadOfIntegration: unobservable("座標表に無い"),
          dirty: unobservable("座標表に無い"),
          hasCheckout: unobservable("座標表に無い"),
          terminal: unobservable("座標表に無い"),
          landable: unobservable("座標表に無い"),
        }),
      ],
    };
    expect(normalize(observation(settled)).conflicts).toEqual([]);
    // **実体が残っているなら出す** —— 面を解決できないまま片付けにいかせない。
    const left = normalize(observation({ ...settled, claimBranchExists: present(true) }));
    expect(left.conflicts.map((c) => c.reason)).toContain("着地面が解決できない");
  });

  test("17h2: 面が読めない理由を、そのまま人へ渡す", () => {
    // **「読めない」だけでは人が動けない。**座標表から外れたのか、checkout が無いのか、
    // git が落ちたのかで、次にやることが違う。観測が持っている理由を握り潰さない。
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(true),
      surfaces: [control({ terminal: unobservable("座標表に無い") })],
    });
    const evidence = normalize(o)
      .conflicts.filter((c) => c.reason === "着地面が解決できない")
      .flatMap((c) => c.evidence)
      .join(" ");
    expect(evidence).toContain("座標表に無い");
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

  test("17d2: 提出の証跡がある 完了 の残骸。非 PR 面は終端でなく、live / 計画 / 契約が欠ける", () => {
    const base = {
      ledger: present("完了" as const),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      issueContractComplete: present(true),
      submissionEvidence: present(true),
    };
    const remnants = (over: Partial<ReturnType<typeof secondary>> = {}) =>
      secondary({
        aheadOfIntegration: present(true),
        hasCheckout: present(true),
        ...over,
      });
    const cases: Partial<IssueObservation>[] = [
      { ...base, surfaces: [remnants({ liveCheckoutHealthy: present(false) })] },
      { ...base, planCommentExists: present(false), surfaces: [remnants()] },
      { ...base, issueContractComplete: present(false), surfaces: [remnants()] },
    ];
    const blocked: readonly ConflictReason[] = [
      "live checkout が異常",
      "計画コメントが無いまま実装の証跡がある",
      "Issue 契約が欠けたまま成果物がある",
    ];
    for (const over of cases) {
      const o = observation(over);
      expectFields(o, { progress: "実装中", runtime: "無し", capacity: "あり", ledger: "完了" });
      const reasons = normalize(o).conflicts.map((c) => c.reason);
      for (const reason of blocked) expect(reasons).not.toContain(reason);
    }
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

  test("17m3: 記録の整合が壊れているが、台帳は既に 完了", () => {
    // キュー以前に着地した課題。当てると**歴史側が全部ここへ落ち**、ラダー最上段なので
    // `片付ける` にも永久に届かない。
    const settled: Partial<IssueObservation> = {
      open: present(false),
      ledger: present("完了"),
      surfaces: [control({ terminal: present(true) })],
    };
    const cases: Partial<IssueObservation>[] = [
      { ...settled, prMerged: present(true) },
      { ...settled, waitRecord: wait.broken("marker を読めない") },
      { ...settled, waitRecord: wait.undecidable },
      { ...settled, intentRecord: intent.pending },
      { ...settled, integrationRecordCount: present(2) },
      { ...settled, integrationRecordCount: unobservable("読めない") },
    ];
    for (const over of cases) expect(normalize(observation(over)).conflicts).toEqual([]);
  });

  test("17m4: 完了 だが提出の証跡が無く、残骸がある", () => {
    expectConflict(
      observation({
        ledger: present("完了"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
      }),
      "着地済みだが提出の証跡が無い",
    );
  });

  test("17m5: 行 17m と同じく証跡が無いが、claim の remote branch が無い", () => {
    const o = observation({
      ledger: present("進行中"),
      claimBranchExists: present(false),
      planCommentExists: present(true),
      prMerged: present(true),
      surfaces: [workingSurface({ terminal: present(true) })],
    });
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain(
      "着地済みだが提出の証跡が無い",
    );
  });

  test("17m6: 行 17m4 と同じく完了 × 残骸だが、claim の remote branch が無い", () => {
    const o = observation({
      ledger: present("完了"),
      claimBranchExists: present(false),
      planCommentExists: present(true),
      prMerged: present(true),
      surfaces: [secondary({ aheadOfIntegration: present(true), hasCheckout: present(true) })],
    });
    expect(normalize(o).conflicts.map((c) => c.reason)).not.toContain(
      "着地済みだが提出の証跡が無い",
    );
  });

  test("17k: 片付けが終わり、Issue は closed・worktree も無い", () => {
    expectFields(
      observation({
        open: present(false),
        ledger: present("完了"),
        claimBranchExists: present(true),
      }),
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

  test("渡しの記録が読めなければ保持している側へ倒す", () => {
    expect(
      holdsIntegration(observation({ integrationRecordCount: unobservable("読めない") })),
    ).toBe(true);
    expect(holdsIntegration(observation({ integrationRecordCount: present(0) }))).toBe(false);
    expect(holdsIntegration(observation({ integrationRecordCount: present(1) }))).toBe(true);
  });
});

describe("capacity", () => {
  test("checkout は無いが、所有している workspace が残っている", () => {
    expectFields(
      observation({
        ledger: present("完了"),
        prunableWorkspace: present(true),
        open: present(false),
      }),
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
  test("dirty が `-` の面は、終端へ上がらない", () => {
    // **守るのは終端側**（`allSurfacesClean` が `0` のみを通す）。`実装中` を名乗らせる必要は
    // 無い —— 読めない dirty から `実装中` を導くと、実体を持たない課題まで write を握る。
    expectFields(
      observation({
        ledger: present("進行中"),
        claimBranchExists: present(true),
        planCommentExists: present(true),
        surfaces: [
          surface({
            dirty: unobservable("worktree を読めない"),
            hasCheckout: present(true),
            terminal: present(true),
          }),
        ],
        submissionEvidence: present(true),
      }),
      { progress: "準備済み", runtime: "無し", capacity: "あり", ledger: "進行中" },
    );
  });

  test("ledger を読めなければ Conflict", () => {
    expectConflict(observation({ ledger: absent() }), "ledger が解釈不能");
  });
});
