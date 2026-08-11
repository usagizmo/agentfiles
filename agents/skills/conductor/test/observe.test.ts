// 観測の組み立て。**port は fake を渡す**（production / test の差は型で表し、env で分岐しない）。
//
// ここで押さえるのは配線 ——「snapshot から導けるもの」と「port から来るもの」が
// 混ざらず、どちらも既定値へ倒れないこと。

import { describe, expect, test } from "bun:test";
import type { IssueObservation } from "../src/observation.ts";
import type { ObservePort, StatusMap } from "../src/observe.ts";
import { observe } from "../src/observe.ts";
import { SNAPSHOT_SCHEMA } from "../src/decode.ts";
import type { Ledger, Observed } from "../src/types.ts";
import { absent, present } from "../src/types.ts";

const SNAP = `--- schema ---
${SNAPSHOT_SCHEMA}
--- default ---
abc123
--- landing tips ---
o/control def456
--- landing local branches ---
o/control feat/12-x aaa
--- live checkout (面 branch dirty(0/1/-) ahead behind) ---
o/control main 0 0 0
--- remote branches ---
origin/main
origin/feat/12-x
--- worktrees (面 dirty(0/1/-) head path) ---
o/control 0 aaa /tmp/wt/feat-12-x
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
7 feat/12-x OPEN draft=false checks=SUCCESS
`;

const STATUS: StatusMap = new Map<string, Ledger>([
  ["進行中", "進行中"],
  ["計画済み", "計画済み"],
  ["未計画", "未計画"],
]);

const SURFACES = new Map([["o/control", true]]);

const claimComment = `<!-- claim -->

\`\`\`yaml
representative: 12
members: [12]
landing: [o/control]
\`\`\`

<!-- /claim -->`;

const port = (over: Partial<ObservePort> = {}): ObservePort => ({
  snapshot: async () => SNAP,
  issueBodies: async () =>
    new Map([
      [12, "Depends on #34\nSame branch as #99\n\n本文"],
      [34, "本文"],
    ]),
  issueComments: async () =>
    new Map([
      [12, [claimComment]],
      [34, []],
    ]),
  surfaceGit: async () => ({ ahead: present(true), head: present("aaa") }),
  cycleMark: async () => present("mark-1"),
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
  test("ボード順・open / closed・セッション・claim branch を引く", async () => {
    const rows = await observe(port(), STATUS, SURFACES);
    const twelve = find(rows, 12);
    expect(twelve.boardOrder).toBe(1);
    expect(twelve.open).toBe(true);
    expect(twelve.session).toEqual({ kind: "running" });
    expect(twelve.claimBranchExists).toEqual(present(true));
    expect(find(rows, 34).claimBranchExists).toEqual(present(false));
  });

  test("対応表に無い Status を既定へ倒さない", async () => {
    const rows = await observe(port(), new Map<string, Ledger>([["進行中", "進行中"]]), SURFACES);
    expect(find(rows, 34).ledger.kind).toBe("invalid");
  });

  test("宣言は本文の先頭区画・行頭からだけ読む", async () => {
    const rows = await observe(
      port({
        issueBodies: async () =>
          new Map([
            [12, "Depends on #34\n\n本文の後ろに Depends on #77 と書いても読まない"],
            [34, ""],
          ]),
      }),
      STATUS,
      SURFACES,
    );
    expect(find(rows, 12).dependsOn).toEqual([34]);
  });

  test("checkout が無く workspace だけ残っているものを prunable にする", async () => {
    const rows = await observe(port(), STATUS, SURFACES);
    expect(find(rows, 34).prunableWorkspace).toEqual(present(true));
    expect(find(rows, 12).prunableWorkspace).toEqual(present(false));
  });

  test("live checkout が dirty なら異常として残す", async () => {
    const dirty = SNAP.replace("o/control main 0 0 0", "o/control main 1 0 0");
    const rows = await observe(port({ snapshot: async () => dirty }), STATUS, SURFACES);
    expect(find(rows, 12).surfaces[0]?.liveCheckoutHealthy).toEqual(present(false));
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
});
