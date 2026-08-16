// `watch.sh` へ渡す引数を固定する。
//
// **渡し漏れは観測の穴になる。**面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として
// 数えられ、`--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ConfigError, extractHarnessCmd, parseConfig, resolveSurfaces } from "../src/config.ts";
import { readFileSync } from "node:fs";
import { createPort, snapshotArgs } from "../src/port.ts";
import { present } from "../src/types.ts";

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
    { name: "acme/control", usesPr: true, countsCapacity: true, integrationRef: "origin/main" },
    { name: "acme/skills", usesPr: false, countsCapacity: false, integrationRef: "main" },
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

const harnessMd = () => readFileSync(join(import.meta.dir, "../references/harness.md"), "utf8");

describe("設定の fail-closed", () => {
  test("面の名前が重複したら止まる", () => {
    expect(() =>
      parseConfig({
        ...raw,
        surfaces: [raw.surfaces[0], { ...raw.surfaces[1], name: "acme/control" }],
      }),
    ).toThrow("name が重複");
  });

  test("sessionsCmd を省略したら harness.md の code block を使う", () => {
    const { sessionsCmd: _drop, ...without } = raw;
    expect(parseConfig(without).sessionsCmd).toBe(extractHarnessCmd(harnessMd(), "sessions-cmd"));
  });

  test("workspacesCmd を省略したら harness.md の code block を使う", () => {
    const { workspacesCmd: _drop, ...without } = raw;
    expect(parseConfig(without).workspacesCmd).toBe(
      extractHarnessCmd(harnessMd(), "workspaces-cmd"),
    );
  });

  test("sessionsCmd が空文字なら止まる", () => {
    expect(() => parseConfig({ ...raw, sessionsCmd: "" })).toThrow("sessionsCmd");
  });

  test("workspacesCmd が空文字なら止まる", () => {
    expect(() => parseConfig({ ...raw, workspacesCmd: "" })).toThrow("workspacesCmd");
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

const markFromExactFiles = async (
  scriptsDir: string,
  issueBody: string,
  waitRecord: string | null,
): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "cycle-mark-exact-"));
  try {
    const bodyPath = join(dir, "body");
    await writeFile(bodyPath, issueBody);
    const argv = [
      "python3",
      `${scriptsDir}/cycle-mark.py`,
      "--ledger",
      "未計画",
      "--issue-body",
      `1:${bodyPath}`,
    ];
    if (waitRecord === null) {
      argv.push("--no-wait-record");
    } else {
      const waitPath = join(dir, "wait");
      await writeFile(waitPath, waitRecord);
      argv.push("--wait-record", waitPath);
    }
    const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (code !== 0) throw new Error(`cycle-mark.py が ${String(code)}: ${err}`);
    return out.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

describe("cycleMark の入力 file", () => {
  const scriptsDir = join(import.meta.dir, "../scripts");
  const portOf = () => {
    const config = parseConfig(raw);
    return createPort({
      config,
      surfaces: resolveSurfaces(config.surfaces, PATHS),
      scriptsDir,
      snapshotPath: "/tmp/snap",
    });
  };

  test("受け取った文字列を足しも落としもせず file に書く", async () => {
    // **本文が改行で終わる**のが本物の Issues API の形。末尾に 1 byte 足すと指紋が変わる。
    const body = "本文が改行で終わる\n";
    const wait = "state: waiting\nreason: 確認\n";
    const got = await portOf().cycleMark({
      issue: 1,
      ledger: "未計画",
      progress: "未着手",
      surfaces: [],
      planComment: null,
      waitRecord: wait,
      issueBodies: [{ issue: 1, body }],
      occupied: [],
    });
    const want = await markFromExactFiles(scriptsDir, body, wait);
    expect(got).toEqual(present(want));
  });

  test("正規化した値と違う bytes を書くと指紋が一致しない", async () => {
    const body = "本文が改行で終わる\n";
    const got = await portOf().cycleMark({
      issue: 1,
      ledger: "未計画",
      progress: "未着手",
      surfaces: [],
      planComment: null,
      waitRecord: null,
      issueBodies: [{ issue: 1, body }],
      occupied: [],
    });
    const extraNl = await markFromExactFiles(scriptsDir, `${body}\n`, null);
    expect(got).not.toEqual(present(extraNl));
  });
});
