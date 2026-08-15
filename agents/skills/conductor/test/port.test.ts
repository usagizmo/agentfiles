// `watch.sh` へ渡す引数を固定する。
//
// **渡し漏れは観測の穴になる。**面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として
// 数えられ、`--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない
// （実際にその形で、kernel が一度も end-to-end で動いていなかった）。

import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig, resolveSurfaces } from "../src/config.ts";
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
    { name: "acme/control", usesPr: true, integrationRef: "origin/main" },
    { name: "acme/skills", usesPr: false, integrationRef: "main" },
  ],
  sessionsCmd: "list-sessions",
  workspacesCmd: "list-workspaces",
  executors: { refine: "claude", resolve: "grok" },
};

const PATHS = new Map([
  ["acme/control", "/w/control"],
  ["acme/skills", "/w/skills"],
]);

const argsOf = (input: typeof raw, paths: ReadonlyMap<string, string> = PATHS) => {
  const config = parseConfig(input);
  return snapshotArgs(config, resolveSurfaces(config.surfaces, paths), "/s", "/tmp/snap");
};

const args = () => argsOf(raw);

/** `--x v` の v を引く。 */
const valuesOf = (flag: string) =>
  args().flatMap((a, i) => (a === flag ? [args()[i + 1] ?? ""] : []));

describe("watch.sh の引数", () => {
  test("watch.sh は bash で起動する（shebang は spawn では使われない）", () => {
    expect(args()[0]).toBe("bash");
  });

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

  test("制御面の origin/<branch> を --default-branch に渡す", () => {
    expect(valuesOf("--default-branch")).toEqual(["main"]);
  });

  test("制御面以外の着地面を 1 つも落とさない", () => {
    const declared = parseConfig(raw).surfaces.slice(1);
    expect(valuesOf("--landing")).toHaveLength(declared.length);
  });

  test("checkout は最後に置く（`:` を含む path が通る）", () => {
    const a = argsOf(
      raw,
      new Map([
        ["acme/control", "/w/control"],
        ["acme/skills", "/w/a:b"],
      ]),
    );
    expect(a[a.indexOf("--landing") + 1]).toBe("acme/skills:main:/w/a:b");
  });
});

describe("checkout path の解決", () => {
  test("面が 1 つでも欠けたら止まる（観測の穴になる）", () => {
    const config = parseConfig(raw);
    expect(() =>
      resolveSurfaces(config.surfaces, new Map([["acme/control", "/w/control"]])),
    ).toThrow("acme/skills");
  });

  test("空文字は渡していないものとして扱う", () => {
    const config = parseConfig(raw);
    expect(() =>
      resolveSurfaces(
        config.surfaces,
        new Map([
          ["acme/control", "/w/control"],
          ["acme/skills", ""],
        ]),
      ),
    ).toThrow("acme/skills");
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

describe("実行器の起動", () => {
  // **何で起こすかは配線**（`~/.agents/AGENTS.md`「意味と手順は共通、起動・配線は個別」）。
  // 共通 skill が harness を名指しすると、project ごとに変えられず実験もできない。
  test("工程ごとに別の実行器を指定できる", () => {
    const config = parseConfig(raw);
    expect(config.executors.refine).toBe("claude");
    expect(config.executors.resolve).toBe("grok");
  });

  test("executors が無ければ止まる", () => {
    const { executors: _drop, ...without } = raw;
    expect(() => parseConfig(without)).toThrow(ConfigError);
  });

  test("工程が 1 つでも欠けたら止まる", () => {
    expect(() => parseConfig({ ...raw, executors: { refine: "claude" } })).toThrow(ConfigError);
  });

  test("空文字なら止まる（既定へ倒さない）", () => {
    expect(() => parseConfig({ ...raw, executors: { ...raw.executors, resolve: "" } })).toThrow(
      ConfigError,
    );
  });
});
