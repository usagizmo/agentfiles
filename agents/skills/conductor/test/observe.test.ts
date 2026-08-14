// 観測の組み立て。**port は fake を渡す**（production / test の差は型で表し、env で分岐しない）。
//
// ここで押さえるのは配線 ——「snapshot から導けるもの」と「port から来るもの」が
// 混ざらず、どちらも既定値へ倒れないこと。

import { describe, expect, test } from "bun:test";
import type { IssueObservation } from "../src/observation.ts";
import type { ObservePort, StatusMap } from "../src/observe.ts";
import { observeTick, worktreeBusy } from "../src/observe.ts";
import { normalizeProgress } from "../src/normalize.ts";
import { SNAPSHOT_SCHEMA } from "../src/decode.ts";
import type { Ledger, Observed } from "../src/types.ts";
import { unobservable } from "../src/types.ts";
import { absent, present } from "../src/types.ts";

const SNAP = `--- schema ---
${SNAPSHOT_SCHEMA}
--- default ---
abc123
--- landing tips ---
o/control origin/main def456
o/other refs/heads/main 111222
--- landing local branches ---
o/control feat/12-x aaa
o/other feat/12-x bbb
--- live checkout (面 branch dirty(0/1/-) ahead behind) ---
o/control main 0 0 0
o/other main 0 0 0
--- remote branches ---
origin/main
origin/feat/12-x
--- worktrees (面 dirty(0/1/-) head path) ---
o/control 0 aaa /tmp/wt/feat-12-x
o/other 0 bbb /tmp/wt2/feat-12-x
--- sessions ---
resolve-12 working
--- workspaces ---
ws-12 /tmp/wt/feat-12-x
ws-old /tmp/wt/feat-34-y
--- project status (board order) ---
1 12 進行中
2 34 計画済み
--- issues ---
12 open 2026-08-12T00:00:00Z alice
34 open 2026-08-12T00:00:00Z
--- recent issue comments ---
900 2026-08-12T00:00:00Z claim
--- PRs ---
7 feat/12-x OPEN draft=false checks=SUCCESS@2026-08-12T00:00:00Z@lint
`;

const STATUS: StatusMap = new Map<string, Ledger>([
  ["進行中", "進行中"],
  ["計画済み", "計画済み"],
  ["未計画", "未計画"],
]);

// **2 面にしておく。**1 面だと「その課題の着地面だけを渡す」が「全面を渡す」と区別できない。
const SURFACES = new Map([
  ["o/control", true],
  ["o/other", false],
]);

const claimComment = `<!-- claim -->

\`\`\`yaml
representative: 12
members: [12]
landing: [o/control]
\`\`\`

<!-- /claim -->`;

const comment = (body: string, at = "2026-08-12T00:00:00Z") => present([{ body, at }]);

const observe = async (
  ...args: Parameters<typeof observeTick>
): Promise<readonly IssueObservation[]> => (await observeTick(...args)).observations;

const port = (over: Partial<ObservePort> = {}): ObservePort => ({
  snapshot: async () => SNAP,
  issueBodies: async () =>
    new Map([
      [12, present("Depends on #34\nSame branch as #99\n\n本文")],
      [34, present("本文")],
    ]),
  issueTitles: async () => new Map(),
  issueComments: async () =>
    new Map([
      [12, comment(claimComment)],
      [34, present([])],
    ]),
  surfaceGit: async () => ({ ahead: present(true), head: present("aaa") }),
  readyFacts: async () => present(false),
  cycleMark: async () => present("mark-1"),
  // 実引数の組み立ては port の責務。ここは「何を渡すか」だけを見る。
  planFacts: async () => ({
    bodyMatchesPlan: present(true),
    planInvalidated: present(false),
    resourceKeys: present([]),
  }),
  issueFacts: async () => ({
    issueContractComplete: present(true),
    prMerged: present(false),
    latestPrClosedUnmerged: present(false),
    blocksEntry: false,
    claimedAt: present(100),
  }),
  ...over,
});

const find = (rows: readonly IssueObservation[], n: number): IssueObservation => {
  const row = rows.find((r) => r.issue === n);
  if (row === undefined) throw new Error(`issue ${n} が観測に無い`);
  return row;
};

describe("snapshot から導くもの", () => {
  test("SUCCESS と NEUTRAL だけの checks は緑", async () => {
    const snap = SNAP.replace(
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint",
      "checks=NEUTRAL@2026-08-12T00:00:00Z@audit|SUCCESS@2026-08-12T00:00:00Z@lint",
    );
    const rows = await observe(port({ snapshot: async () => snap }), STATUS, SURFACES);
    expect(find(rows, 12).checks).toEqual(present({ running: 0, green: true }));
  });

  test("CANCELLED を含む checks は緑にしない", async () => {
    const snap = SNAP.replace(
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint",
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint|CANCELLED@2026-08-12T00:00:00Z@Preview DB",
    );
    const rows = await observe(port({ snapshot: async () => snap }), STATUS, SURFACES);
    expect(find(rows, 12).checks).toEqual(present({ running: 0, green: false }));
    const prSurface = find(rows, 12).surfaces.find((s) => s.usesPr);
    expect(prSurface?.landable).toEqual(present(false));
  });

  test("ボード順・open / closed・セッション・claim branch を引く", async () => {
    const rows = await observe(port(), STATUS, SURFACES);
    const twelve = find(rows, 12);
    expect(twelve.boardOrder).toBe(1);
    expect(twelve.open).toEqual(present(true));
    expect(twelve.session).toEqual({ kind: "running" });
    expect(twelve.claimBranchExists).toEqual(present(true));
    expect(find(rows, 34).claimBranchExists).toEqual(present(false));
  });

  test("渡しの記録が 2 つあるコメントを 0 件に畳まない", async () => {
    const one = `<!-- integration -->

\`\`\`yaml
issues: [12]
\`\`\`

<!-- /integration -->`;
    const rows = await observe(
      port({ issueComments: async () => new Map([[12, comment(one + "\n" + one)]]) }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 12).integrationRecordCount).toEqual(present(2));
  });

  test("休止の記録の to / keys を本体として残す", async () => {
    const yieldComment = `<!-- yield -->

\`\`\`yaml
issues: [12]
to: 34
keys: [skills]
\`\`\`

<!-- /yield -->`;
    const rows = await observe(
      port({ issueComments: async () => new Map([[12, comment(yieldComment)]]) }),
      STATUS,
      SURFACES,
    );
    const twelve = find(rows, 12);
    expect(twelve.pauseRecordExists).toBe(true);
    expect(twelve.yieldRecord).toEqual(present({ issues: [12], to: 34, keys: ["skills"] }));
  });

  test("blocked は分類する（unclassifiable にしない）", async () => {
    const blocked = SNAP.replace("resolve-12 working", "resolve-12 blocked");
    const rows = await observe(port({ snapshot: async () => blocked }), STATUS, SURFACES);
    expect(find(rows, 12).session).toEqual({ kind: "blocked" });
  });

  test("unknown は分類できないまま残す", async () => {
    const unknown = SNAP.replace("resolve-12 working", "resolve-12 unknown");
    const rows = await observe(port({ snapshot: async () => unknown }), STATUS, SURFACES);
    expect(find(rows, 12).session).toEqual({ kind: "unclassifiable", raw: "unknown" });
  });

  test("同じ worktree の consult 子が working なら worktreeBusy", async () => {
    const snap = SNAP.replace(
      "resolve-12 working",
      "resolve-12 done\na-grok-1 working /tmp/wt/feat-12-x",
    );
    const rows = await observe(port({ snapshot: async () => snap }), STATUS, SURFACES);
    expect(find(rows, 12).worktreeBusy).toBe(true);
    expect(find(rows, 34).worktreeBusy).toBe(false);
  });

  test("worktreeBusy: 同じ path かその配下だけを同じ worktree と読む", () => {
    const owned = ["/tmp/wt/feat-12-x"];
    expect(worktreeBusy(["a-grok-1 working /tmp/wt/feat-12-x"], owned)).toBe(true);
    expect(worktreeBusy(["a-grok-1 working /tmp/wt/feat-12-x/src"], owned)).toBe(true);
    expect(worktreeBusy(["a-grok-1 working /tmp/other"], owned)).toBe(false);
    expect(worktreeBusy(["a-grok-1 working"], owned)).toBe(false);
    expect(worktreeBusy(["resolve-12 working /tmp/wt/feat-12-x"], owned)).toBe(false);
    expect(worktreeBusy(["conductor working /tmp/wt/feat-12-x"], owned)).toBe(false);
  });

  test("計画セッションは refine-<番号> から引く（resolve の名前で代用しない）", async () => {
    // **代用すると計画中は必ず `none` になり**、走っているものを畳まない保護が一度も効かない。
    const planning = SNAP.replace("resolve-12 working", "refine-12 working");
    const rows = await observe(port({ snapshot: async () => planning }), STATUS, SURFACES);
    expect(find(rows, 12).refineSession).toEqual({ kind: "running" });
    expect(find(rows, 12).session).toEqual({ kind: "none" });
  });

  test("対応表に無い Status を既定へ倒さない", async () => {
    const rows = await observe(port(), new Map<string, Ledger>([["進行中", "進行中"]]), SURFACES);
    expect(find(rows, 34).ledger.kind).toBe("invalid");
  });

  test("指紋には ledger と progress と面ごとの worktree を渡す", async () => {
    const seen: unknown[] = [];
    await observe(
      port({
        cycleMark: async (input) => {
          seen.push(input);
          return present("mark-1");
        },
      }),
      STATUS,
      SURFACES,
    );
    // **`--ledger` が式を決める**ので、渡さないとスクリプトは usage error になる。
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatchObject({ ledger: expect.any(String), progress: expect.any(String) });
    expect((seen[0] as { surfaces: unknown[] }).surfaces.length).toBeGreaterThan(0);
  });

  test("完了 で周回の記録も無い課題には指紋を作らない", async () => {
    const seen: number[] = [];
    await observe(
      port({
        cycleMark: async (input) => {
          seen.push(input.issue);
          return present("mark-1");
        },
      }),
      // 12 を `完了` に写す。34 は `計画済み` のまま残す。
      new Map<string, Ledger>([
        ["進行中", "完了"],
        ["計画済み", "計画済み"],
      ]) as StatusMap,
      SURFACES,
    );
    // board の件数ぶん python を起こさない。**落としているのは対象であって観測項目ではない。**
    expect(seen).toEqual([34]);
  });

  test("本文を読めなかった課題は、空本文へ畳まず観測できないとして扱う", async () => {
    const rows = await observe(
      port({ issueBodies: async () => new Map([[12, unobservable("読めない")]]) }),
      STATUS,
      SURFACES,
    );
    expect(rows.find((r) => r.issue === 12)?.sourceReadable.kind).toBe("unobservable");
  });

  test("コメントを読めなかった課題も同じ", async () => {
    const rows = await observe(
      port({ issueComments: async () => new Map([[12, unobservable("読めない")]]) }),
      STATUS,
      SURFACES,
    );
    expect(rows.find((r) => r.issue === 12)?.sourceReadable.kind).toBe("unobservable");
  });

  test("宣言は本文の先頭区画・行頭からだけ読む", async () => {
    const rows = await observe(
      port({
        issueBodies: async () =>
          new Map([
            [12, present("Depends on #34\n\n本文の後ろに Depends on #77 と書いても読まない")],
            [34, present("")],
          ]),
      }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 12).dependsOn).toEqual([34]);
  });

  test("claim 前の着地面は本文の Lands in から引く", async () => {
    // **claim 前の枝が本文を見ずに座標表の先頭 1 面へ倒すと、宣言が黙って落ちる。**
    // 座標表に無い面を宣言した課題が claim できてしまい、複数面を宣言した課題は
    // 二次面の worktree が作られないまま「成果ゼロの周」として数えられる。
    const rows = await observe(
      port({
        issueComments: async () => new Map([[34, present([])]]),
        issueBodies: async () =>
          new Map([
            [12, present("本文")],
            [34, present("Lands in o/control\nLands in o/other\n\n本文")],
          ]),
      }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 34).surfaces.map((s) => s.name)).toEqual(["o/control", "o/other"]);
  });

  test("Lands in が座標表に無ければ、その面を観測できないものとして残す", async () => {
    // これが立って初めて、選出の条件「着地面が解決できる」が claim 前に効く。
    const rows = await observe(
      port({
        issueComments: async () => new Map([[34, present([])]]),
        issueBodies: async () =>
          new Map([
            [12, present("本文")],
            [34, present("Lands in o/elsewhere\n\n本文")],
          ]),
      }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 34).surfaces.map((s) => s.name)).toEqual(["o/elsewhere"]);
    expect(find(rows, 34).surfaces[0]?.terminal.kind).toBe("unobservable");
  });

  test("宣言は先頭区画（最初の見出しより前）から読む。行頭の ** 装飾も許す", async () => {
    // **空行までにしない** —— 先頭区画は宣言専用ではなく、保留バナーや要約が同居する。
    const body = [
      "保留中: 仕様の確認待ち",
      "",
      "**Depends on #34**",
      "Lands in o/other",
      "",
      "## 目的と期待する結果",
      "",
      "Depends on #99",
    ].join("\n");
    const rows = await observe(
      port({
        issueComments: async () => new Map([[12, present([])]]),
        issueBodies: async () =>
          new Map([
            [12, present(body)],
            [34, present("本文")],
          ]),
      }),
      STATUS,
      SURFACES,
    );
    // 見出しより後ろの宣言は読まない。
    expect(find(rows, 12).dependsOn).toEqual([34]);
    expect(find(rows, 12).surfaces.map((s) => s.name)).toEqual(["o/other"]);
  });

  test("checkout が無く workspace だけ残っているものを prunable にする", async () => {
    const rows = await observe(port(), STATUS, SURFACES);
    expect(find(rows, 34).prunableWorkspace).toEqual(present(true));
    expect(find(rows, 12).prunableWorkspace).toEqual(present(false));
  });

  test("worktree を持たない課題の面は dirty を false で確定する", async () => {
    // **checkout が無い面には未コミットの変更が存在しえない**ので、`present(false)`。
    // `absent` にすると `value(dirty) !== false` が真になり、**claim もされていない課題が
    // 全部「成果物あり」に読まれる**（実測で 289 件中 117 件が `実装中`、172 件が `取り下げ`）。
    const rows = await observe(port(), STATUS, SURFACES);
    expect(find(rows, 34).surfaces[0]?.dirty).toEqual(present(false));
    expect(find(rows, 34).surfaces[0]?.hasCheckout).toEqual(present(false));
  });

  test("worktree が無いことを「成果物あり」と読まない", async () => {
    // commit も無い（`統合先..branch` が空）ので、残る材料は dirty だけ。
    const rows = await observe(
      port({ surfaceGit: async () => ({ ahead: present(false), head: absent() }) }),
      STATUS,
      SURFACES,
    );
    expect(normalizeProgress(find(rows, 34))).toBe("未着手");
  });

  test("面の worktree 一覧そのものを読めないときは dirty を false へ倒さない", async () => {
    // `watch.sh` の `plane_unknown` は面ごと `-` で潰す。**その面の worktree が 0 件なのか
    // 読めなかったのかは区別できない**ので、実体を消す側へ倒さない。
    const blind = SNAP.replace("o/control 0 aaa /tmp/wt/feat-12-x", "o/control - - -");
    const rows = await observe(port({ snapshot: async () => blind }), STATUS, SURFACES);
    expect(find(rows, 34).surfaces[0]?.dirty.kind).toBe("unobservable");
    expect(find(rows, 34).surfaces[0]?.hasCheckout.kind).toBe("unobservable");
  });

  test("board に居るのに issues 節に無い課題を closed へ倒さない", async () => {
    // 倒すと `取り下げ` に化け、**まだ生きている課題が終端として片付けの対象になる**。
    const missing = SNAP.replace("34 open 2026-08-12T00:00:00Z\n", "");
    const rows = await observe(port({ snapshot: async () => missing }), STATUS, SURFACES);
    expect(find(rows, 34).open.kind).toBe("unobservable");
  });

  test("live checkout が dirty なら異常として残す", async () => {
    const dirty = SNAP.replace("o/control main 0 0 0", "o/control main 1 0 0");
    const rows = await observe(port({ snapshot: async () => dirty }), STATUS, SURFACES);
    expect(find(rows, 12).surfaces[0]?.liveCheckoutHealthy).toEqual(present(false));
  });

  test("SKIPPED を含む checks は緑で、面の着地してよいと同じ値を読む", async () => {
    const mixed = SNAP.replace(
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint",
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint|SKIPPED@2026-08-12T00:00:00Z@Preview DB",
    );
    const rows = await observe(port({ snapshot: async () => mixed }), STATUS, SURFACES);
    const twelve = find(rows, 12);
    expect(twelve.checks).toEqual(present({ running: 0, green: true }));
    const control = twelve.surfaces.find((s) => s.name === "o/control");
    expect(control?.landable).toEqual(present(true));
  });

  test("IN_PROGRESS だけでも実行中として残る", async () => {
    const pending = SNAP.replace(
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint",
      "checks=IN_PROGRESS@2026-08-12T01:00:00Z@Root gate (drift)",
    );
    const rows = await observe(port({ snapshot: async () => pending }), STATUS, SURFACES);
    expect(find(rows, 12).checks).toEqual(present({ running: 1, green: false }));
  });
});

describe("port から来るもの", () => {
  test("Issue 契約・merged・claim 時刻・入場を止める宣言をそのまま持つ", async () => {
    const rows = await observe(
      port({
        issueFacts: async () => ({
          issueContractComplete: present(false),
          prMerged: present(true),
          latestPrClosedUnmerged: present(false),
          blocksEntry: true,
          claimedAt: absent(),
        }),
      }),
      STATUS,
      SURFACES,
    );
    const twelve = find(rows, 12);
    expect(twelve.issueContractComplete).toEqual(present(false));
    expect(twelve.prMerged).toEqual(present(true));
    expect(twelve.blocksEntry).toBe(true);
    expect(twelve.claimedAt.kind).toBe("absent");
  });

  test("面ごとの commit は 統合先..branch で測った値を使う", async () => {
    const empty: Observed<boolean> = present(false);
    const rows = await observe(
      port({ surfaceGit: async () => ({ ahead: empty, head: present("aaa") }) }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 12).surfaces[0]?.aheadOfIntegration).toEqual(present(false));
  });
});

describe("記録の読み取りを繋ぐ", () => {
  test("claim の記録から着地面を引く", async () => {
    const rows = await observe(port(), STATUS, SURFACES);
    expect(find(rows, 12).surfaces.map((s) => s.name)).toEqual(["o/control"]);
    expect(find(rows, 12).claimRecord.kind).toBe("present");
  });

  test("計画の照合には、その課題の着地面だけを渡す", async () => {
    // 座標表の全面を渡すと、**制御面の base を持たない repo で `git diff` が必ず落ちて**
    // 判定不能 = 交差扱いになり、計画を持つ全課題が常に失効扱いになる。
    const seen: (readonly string[])[] = [];
    await observe(
      port({
        planFacts: async (_issue, landing) => {
          seen.push(landing);
          return {
            bodyMatchesPlan: present(true),
            planInvalidated: present(false),
            resourceKeys: present([]),
          };
        },
      }),
      STATUS,
      SURFACES,
    );
    expect(seen).not.toHaveLength(0);
    for (const landing of seen) expect(landing).toEqual(["o/control"]);
  });

  test("landing が座標表に無い面なら、その面を観測できないものとして残す", async () => {
    // **「PR で着地する面」を既定にしない** —— 倒すと、着地の条件も live checkout の検査も
    // 観測していない面の型で決まり、座標表の欠けが `着地面が解決できない` として出てこない。
    const unknown = claimComment.replace("landing: [o/control]", "landing: [o/elsewhere]");
    const rows = await observe(
      port({ issueComments: async () => new Map([[12, comment(unknown)]]) }),
      STATUS,
      SURFACES,
    );
    const surface = find(rows, 12).surfaces[0];
    expect(surface?.name).toBe("o/elsewhere");
    expect(surface?.terminal.kind).toBe("unobservable");
    expect(surface?.landable.kind).toBe("unobservable");
  });
});
