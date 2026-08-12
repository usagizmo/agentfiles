// `watch.sh` へ渡す引数を固定する。
//
// **渡し漏れは観測の穴になる。**面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として
// 数えられ、`--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない
// （実際にその形で、kernel が一度も end-to-end で動いていなかった）。

import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config.ts";
import { snapshotArgs } from "../src/port.ts";

const raw = {
  ghRepo: "acme/control",
  projectOrg: "acme",
  projectNumber: 7,
  statusField: "Status",
  statusMap: {
    Backlog: "未計画",
    Ready: "計画済み",
    "In progress": "進行中",
    Done: "完了",
    Shelved: "退避先",
  },
  surfaces: [
    { name: "acme/control", usesPr: true, repoPath: "/w/control", integrationRef: "origin/main" },
    { name: "acme/skills", usesPr: false, repoPath: "/w/skills", integrationRef: "main" },
  ],
  sessionsCmd: "list-sessions",
  workspacesCmd: "list-workspaces",
};

const args = () => snapshotArgs(parseConfig(raw), "/s", "/tmp/snap");

/** `--x v` の v を引く。 */
const valuesOf = (flag: string) =>
  args().flatMap((a, i) => (a === flag ? [args()[i + 1] ?? ""] : []));

describe("watch.sh の引数", () => {
  test("watch.sh が要求する option をすべて渡す", () => {
    for (const flag of [
      "--snapshot",
      "--repo",
      "--gh-repo",
      "--project-org",
      "--project-number",
      "--status-field",
      "--sessions-cmd",
      "--workspaces-cmd",
    ]) {
      expect(args()).toContain(flag);
    }
  });

  test("制御面は --repo で渡し、--landing に重ねない", () => {
    expect(valuesOf("--repo")).toEqual(["/w/control"]);
    expect(valuesOf("--landing")).toEqual(["acme/skills:main:/w/skills"]);
  });

  test("制御面以外の着地面を 1 つも落とさない", () => {
    const declared = parseConfig(raw).surfaces.slice(1);
    expect(valuesOf("--landing")).toHaveLength(declared.length);
  });

  test("checkout は最後に置く（`:` を含む path が通る）", () => {
    const withColon = {
      ...raw,
      surfaces: [
        raw.surfaces[0],
        { name: "acme/skills", usesPr: false, repoPath: "/w/a:b", integrationRef: "main" },
      ],
    };
    const a = snapshotArgs(parseConfig(withColon), "/s", "/tmp/snap");
    expect(a[a.indexOf("--landing") + 1]).toBe("acme/skills:main:/w/a:b");
  });
});

describe("設定の fail-closed", () => {
  test("sessionsCmd が無ければ止まる", () => {
    const { sessionsCmd: _drop, ...without } = raw;
    expect(() => parseConfig(without)).toThrow("sessionsCmd");
  });

  test("workspacesCmd が無ければ止まる", () => {
    const { workspacesCmd: _drop, ...without } = raw;
    expect(() => parseConfig(without)).toThrow("workspacesCmd");
  });
});
