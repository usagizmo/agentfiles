// snapshot の decode 境界。**「値が無い」と「読めなかった」と「節が欠けている」を分ける**
// ことだけを見る。ここで畳むと、その観測だけで進む遷移が永久に起きない。

import { describe, expect, test } from "bun:test";
import {
  SNAPSHOT_SCHEMA,
  SnapshotDecodeError,
  issues,
  landingTips,
  liveCheckouts,
  localBranches,
  parseSnapshot,
  projectStatus,
  pullRequests,
  worktrees,
} from "../src/decode.ts";

const SNAP = `--- schema ---
${SNAPSHOT_SCHEMA}
--- default ---
abc123
--- landing tips ---
control origin/main def456
skills refs/heads/main 789abc
--- landing local branches ---
control feat/1-x abcdef
--- live checkout (面 branch dirty(0/1/-) ahead behind) ---
skills main 0 0 3
--- remote branches ---
origin/main
origin/feat/1-x
--- worktrees (面 dirty(0/1/-) head path) ---
control 1 abcdef /tmp/wt/feat-1-x
skills - abcdef /tmp/wt/skills  1-x
--- sessions ---
resolve-1 working
--- workspaces ---
ws-1 /tmp/wt/feat-1-x
--- project status (board order) ---
1 12 進行中
2 34 計画済み
3 56 In progress
--- issues ---
12 open 2026-08-12T00:00:00Z alice
34 closed 2026-08-11T00:00:00Z
--- recent issue comments ---
999 2026-08-12T00:00:00Z claim,plan
--- PRs ---
7 feat/12-x OPEN draft=false checks=SUCCESS@2026-08-12T00:00:00Z@lint
8 scratch OPEN draft=true checks=untracked
`;

describe("節の切り分け", () => {
  test("全節が揃っていれば読める", () => {
    expect(() => parseSnapshot(SNAP)).not.toThrow();
  });

  test("節が欠けていたら投げる（「値が無い」と読まない）", () => {
    const without = SNAP.replace(/--- workspaces ---\nws-1 \/tmp\/wt\/feat-1-x\n/, "");
    expect(() => parseSnapshot(without)).toThrow(SnapshotDecodeError);
  });

  test("版数が違えば投げる", () => {
    expect(() => parseSnapshot(SNAP.replace(`\n${SNAPSHOT_SCHEMA}\n`, "\n99\n"))).toThrow(
      SnapshotDecodeError,
    );
  });

  test("未知の節は黙って捨てない", () => {
    expect(() => parseSnapshot(`${SNAP}--- 新しい観測 ---\nx\n`)).toThrow(SnapshotDecodeError);
  });

  test("同じ節が 2 度出たら投げる（どちらを拾うか決まらない）", () => {
    expect(() => parseSnapshot(`${SNAP}--- default ---\nzzz\n`)).toThrow(SnapshotDecodeError);
  });
});

describe("行の decode", () => {
  const snap = parseSnapshot(SNAP);

  test("worktrees の dirty は 0 / 1 / - の 3 値のまま残る", () => {
    expect(worktrees(snap)).toEqual([
      { surface: "control", dirty: true, head: "abcdef", path: "/tmp/wt/feat-1-x" },
      // **path は末尾の残余をそのまま残す**（空白を詰め直すと、`workspaces` 節との
      // 突き合わせが外れて、生きている worktree が `prunable` に化ける）。
      { surface: "skills", dirty: "unreadable", head: "abcdef", path: "/tmp/wt/skills  1-x" },
    ]);
  });

  test("dirty が 0 / 1 / - 以外なら投げる", () => {
    expect(() =>
      worktrees(parseSnapshot(SNAP.replace("control 1 abcdef", "control x abcdef"))),
    ).toThrow(SnapshotDecodeError);
  });

  test("live checkout の dirty / behind を読む", () => {
    expect(liveCheckouts(snap)).toEqual([{ surface: "skills", dirty: false, behind: 3 }]);
  });

  test("project status はボード順を index として保つ", () => {
    expect(projectStatus(snap)).toEqual([
      { boardOrder: 1, issue: 12, status: "進行中" },
      { boardOrder: 2, issue: 34, status: "計画済み" },
      // **Status 名は空白を含む**（`In progress` / `In review`）。先頭語で切ると
      // 対応表に無い値へ化け、claim した課題が構造的に一度も読めなくなる。
      { boardOrder: 3, issue: 56, status: "In progress" },
    ]);
  });

  test("issues の state が open / closed 以外なら投げる", () => {
    expect(() => issues(parseSnapshot(SNAP.replace("12 open ", "12 merged ")))).toThrow(
      SnapshotDecodeError,
    );
  });

  test("assignee が空でも欠損にしない", () => {
    expect(issues(snap)).toEqual([
      { issue: 12, open: true, updatedAt: "2026-08-12T00:00:00Z", assignees: ["alice"] },
      { issue: 34, open: false, updatedAt: "2026-08-11T00:00:00Z", assignees: [] },
    ]);
  });

  test("untracked な PR の checks を「無し」へ畳まない", () => {
    expect(pullRequests(snap)).toEqual([
      {
        number: 7,
        headRef: "feat/12-x",
        draft: false,
        checks: [{ status: "SUCCESS", at: "2026-08-12T00:00:00Z", name: "lint" }],
      },
      { number: 8, headRef: "scratch", draft: true, checks: "untracked" },
    ]);
  });

  test("IN_PROGRESS と空白を含む name を落とさない", () => {
    const pending = SNAP.replace(
      "checks=SUCCESS@2026-08-12T00:00:00Z@lint",
      "checks=IN_PROGRESS@2026-08-12T01:00:00Z@Root gate (drift)|SKIPPED@@Preview DB",
    );
    expect(pullRequests(parseSnapshot(pending))[0]?.checks).toEqual([
      { status: "IN_PROGRESS", at: "2026-08-12T01:00:00Z", name: "Root gate (drift)" },
      { status: "SKIPPED", at: "", name: "Preview DB" },
    ]);
  });

  test("checks=none は空配列（無いことと untracked を混ぜない）", () => {
    const none = SNAP.replace("checks=SUCCESS@2026-08-12T00:00:00Z@lint", "checks=none");
    expect(pullRequests(parseSnapshot(none))[0]?.checks).toEqual([]);
  });

  test("旧形式の checks=SUCCESS,SKIPPED は投げて、空へ畳まない", () => {
    const old = SNAP.replace("checks=SUCCESS@2026-08-12T00:00:00Z@lint", "checks=SUCCESS,SKIPPED");
    expect(() => pullRequests(parseSnapshot(old))).toThrow(SnapshotDecodeError);
  });

  test("統合先の tip を面ごとに引ける", () => {
    expect(landingTips(snap).get("skills")).toBe("789abc");
  });

  test("ローカル branch の tip を面ごとに引ける", () => {
    expect(localBranches(snap)).toEqual([
      { surface: "control", branch: "feat/1-x", sha: "abcdef" },
    ]);
  });

  test("面が読めない `- -` を branch として残さない", () => {
    const unknown = SNAP.replace("control feat/1-x abcdef", "control - -");
    expect(localBranches(parseSnapshot(unknown))).toEqual([]);
  });
});
