// 盤面 JSON の投影。**構造は観測と Decision から出す。**LLM 文は overlay だけ。

import { describe, expect, test } from "bun:test";
import { tickWhy, toBoard } from "../src/board.ts";
import type { BoardInput } from "../src/board.ts";
import { emptyView } from "../src/observe.ts";
import type { BoardView } from "../src/observe.ts";
import type { ProjectConfig } from "../src/config.ts";
import { DEFAULT_CONFIG } from "../src/decide.ts";
import type { Decision, Outcome } from "../src/types.ts";
import { present } from "../src/types.ts";
import { observation, session, wait } from "./fixtures.ts";

const CONFIG: ProjectConfig = {
  ghRepo: "acme/control",
  projectOrg: "acme",
  projectNumber: 1,
  statusField: "Status",
  statusMap: new Map([
    ["Backlog", "未計画"],
    ["Ready", "計画済み"],
    ["In progress", "進行中"],
    ["Done", "完了"],
    ["Shelved", "退避先"],
  ]),
  surfaces: [{ name: "acme/control", usesPr: true, integrationRef: "origin/main" }],
  sessionsCmd: "echo",
  workspacesCmd: "echo",
  executors: { refine: "claude", resolve: "claude" },
  tick: DEFAULT_CONFIG,
};

const idle: Decision = { conflicts: [], outcome: { kind: "idle" } };

const input = (over: Partial<BoardInput> = {}): BoardInput => ({
  observations: [observation()],
  decision: idle,
  config: CONFIG,
  view: emptyView(),
  observedAt: "2026-08-14T00:00:00+09:00",
  ...over,
});

describe("tick.why", () => {
  test("action は Evidence.why を使う", () => {
    const outcome: Outcome = {
      kind: "action",
      params: { action: "claim する" },
      target: { representative: 1, members: [1] },
      evidence: {
        progress: "未着手",
        runtime: "無し",
        capacity: "無し",
        ledger: "計画済み",
        why: "選出の条件が揃い、容量に空きがあり、いまの write 保持者と交わらない",
      },
    };
    expect(tickWhy(outcome)).toBe(outcome.evidence.why);
  });

  test("settle-record は settlement.detail を使う", () => {
    expect(
      tickWhy({
        kind: "settle-record",
        settlement: {
          target: { representative: 1, members: [1] },
          kind: "退避先の count を 0 に揃える",
          detail: "失敗 3 / 周回 0 を 0 へ",
        },
      }),
    ).toBe("失敗 3 / 周回 0 を 0 へ");
  });

  test("idle は固定文", () => {
    expect(tickWhy({ kind: "idle" })).toBe("次の観測まで待つ");
  });
});

describe("toBoard", () => {
  test("stdout 用の Decision を盤面へ写す", () => {
    const decision: Decision = {
      conflicts: [
        { reason: "group の終端が混在", evidence: ["終端と非終端が混在"], issues: [1, 2] },
      ],
      outcome: {
        kind: "action",
        params: { action: "checks を引き直させる" },
        target: { representative: 3, members: [3] },
        evidence: {
          progress: "提出中",
          runtime: "待機",
          capacity: "あり",
          ledger: "進行中",
          why: "実行中の checks が 1 つも無く、緑でもない",
        },
      },
    };
    const board = toBoard(input({ decision, observations: [observation({ issue: 3 })] }));
    expect(board["conflicts"]).toEqual(decision.conflicts);
    expect(board["tick"]).toEqual({
      outcome: "action",
      why: "実行中の checks が 1 つも無く、緑でもない",
      action: { name: "checks を引き直させる", target: 3, members: [3] },
    });
  });

  test("観測から決まる humanTodo をテンプレで出す", () => {
    const parked = observation({ issue: 8, ledger: present("退避先") });
    const waiting = observation({
      issue: 9,
      waitRecord: wait.waiting,
    });
    const view: BoardView = {
      ...emptyView(),
      wait: new Map([[9, { question: "戻し先はどれか", since: "2026-08-14T00:00:00Z" }]]),
    };
    const decision: Decision = {
      conflicts: [{ reason: "観測できない", evidence: ["本文が無い"], issues: [9] }],
      outcome: { kind: "idle" },
    };
    const todos = toBoard(input({ observations: [parked, waiting], view, decision }))[
      "humanTodo"
    ] as { kind: string; title: string; unblocks: string; since?: string }[];
    expect(todos.map((t) => t.kind)).toEqual(["conflict", "waiting", "parked"]);
    expect(todos[1]?.unblocks).toBe("戻し先はどれか");
    expect(todos[1]?.since).toBe("2026-08-14T00:00:00Z");
    expect(todos[2]?.title).toBe("退避先 1 件");
  });

  test("overlay の行は観測分の後ろへ足す。完成済み JSON は編集しない", () => {
    const board = toBoard(
      input({
        overlay: {
          humanTodo: [
            {
              title: "pane が拒否した",
              detail: "agent_not_ready",
              unblocks: "herdr が grok を検出する",
              issues: [],
              kind: "env",
            },
          ],
          notes: { "1": "手で足したメモ" },
        },
      }),
    );
    const todos = board["humanTodo"] as { kind: string }[];
    expect(todos.at(-1)?.kind).toBe("env");
    const issues = board["issues"] as { note?: string }[];
    expect(issues[0]?.note).toBe("手で足したメモ");
  });

  test("題が無ければ番号だけを置く。発明しない", () => {
    const issues = toBoard(input())["issues"] as { title: string }[];
    expect(issues[0]?.title).toBe("#1");
  });

  test("write lease は保持の述語から復元する", () => {
    const o = observation({
      issue: 4,
      ledger: present("進行中"),
      claimBranchExists: present(true),
      planCommentExists: present(true),
      surfaces: [
        {
          name: "acme/control",
          usesPr: true,
          aheadOfIntegration: present(true),
          dirty: present(false),
          hasCheckout: present(true),
          terminal: present(false),
          landable: present(false),
          liveCheckoutHealthy: present(true),
        },
      ],
      session: session.running,
    });
    const leases = toBoard(input({ observations: [o] }))["leases"] as {
      write: { holder: number }[];
    };
    expect(leases.write.map((l) => l.holder)).toEqual([4]);
  });
});
