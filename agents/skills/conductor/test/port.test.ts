// `watch.sh` へ渡す引数を固定する。
//
// **渡し漏れは観測の穴になる。**面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として
// 数えられ、`--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない。

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  extractHarnessCmd,
  parseConfig,
  parseWiring,
  resolveSurfaces,
} from "../src/config.ts";
import { parseJsonc } from "../src/jsonc.ts";
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
const skillMd = () => readFileSync(join(import.meta.dir, "../SKILL.md"), "utf8");

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
    const cmd = parseConfig(without).sessionsCmd;
    expect(cmd).toBe(extractHarnessCmd(harnessMd(), "sessions-cmd"));
    expect(cmd).toContain("leftover=leftover");
    expect(cmd).toContain("refused=refused");
    expect(cmd).toContain("refused=-");
    expect(cmd).not.toContain("select(.name != null)");
    expect(cmd).toContain("occupancy-unreadable");
    expect(cmd).toContain("herdr pane list");
    expect(cmd).not.toContain("workspace list");
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

describe("既に working への agent prompt", () => {
  test("確認は agent_prompted。seq 非変化を失敗にしない", () => {
    const md = harnessMd();
    expect(md).toContain("agent_prompted");
    expect(md).not.toContain("state_change_seq` が動いたことを確認する。動かなければ失敗");
  });

  test("張り直しと実行器だけ止めるの seq 確認は残る", () => {
    const md = harnessMd();
    expect(md).toMatch(/実行器だけ止める[\s\S]*state_change_seq/);
    expect(md).toMatch(/失われた resolve を張り直す[\s\S]*state_change_seq/);
  });
});

const composerSection = () => {
  const md = harnessMd();
  const start = md.indexOf("### composer の受け入れ");
  const end = md.indexOf("### 失われた resolve を張り直す");
  return md.slice(start, end);
};

describe("composer が受け付ける状態での agent prompt", () => {
  test("契約表に受け付ける状態で submit できたことの観測がある", () => {
    expect(harnessMd()).toContain("composer が受け付ける状態で submit できたことを観測できる");
  });

  test("前段は visible のフッターで、入力欄は見ない", () => {
    const md = harnessMd();
    expect(md).toMatch(/agent read[\s\S]*--source visible/);
    expect(md).toContain("Space:prompt");
    expect(md).toContain("j/k:nav");
    expect(md).toContain("Tab/Space: question");
  });

  test("Tab は使わない。復帰は space", () => {
    const md = composerSection();
    expect(md).toMatch(/Tab は使わ/);
    expect(md).toMatch(/send-keys <名前> space/);
  });

  test("質問カードへ park しているあいだは送らない", () => {
    expect(composerSection()).toMatch(/Tab\/Space: question[\s\S]*送ら/);
  });

  test("質問カードがキーボードを持っているあいだは送らない", () => {
    expect(composerSection()).toMatch(
      /Tab:next answer[\s\S]*質問カードがキーボードを持つ[\s\S]*送ら/,
    );
  });

  test("Esc:scrollback は送らない。復帰のキーにしない", () => {
    const md = composerSection();
    expect(md).toMatch(/Esc:scrollback[\s\S]*ブロッキングカードがキーボードを持つ[\s\S]*送ら/);
    expect(md).toMatch(/`Space:prompt` または `j\/k:nav`/);
    expect(md).not.toMatch(/Esc:scrollback` または/);
    expect(md).not.toMatch(/または `Esc:scrollback/);
  });

  test("送らない字面は scrollback 復帰より先に並ぶ", () => {
    const md = composerSection();
    const resume = md.indexOf("Space:prompt");
    expect(resume).toBeGreaterThanOrEqual(0);
    for (const surface of ["Tab:next answer", "Esc:scrollback", "Tab/Space: question"]) {
      const at = md.indexOf(surface);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(resume);
    }
  });

  test("chrome が読めない、または表に無い字面は fail-open", () => {
    expect(harnessMd()).toMatch(/表に無い字面[\s\S]*fail-open/);
  });

  test("leftover 成功は受け付ける状態での agent_prompted", () => {
    expect(harnessMd()).toMatch(/受け付ける状態での `agent_prompted`/);
  });

  test("送れなかった周は成功でも失敗でもない", () => {
    expect(harnessMd()).toContain("成功でも失敗でもない");
  });

  test("戻れず送れなかった周は retry に数えない", () => {
    expect(skillMd()).toMatch(/retry に数え\*\*ない\*\*/);
    expect(skillMd()).toContain(
      "送れなかった周（質問カードがキーボードを持つ、ブロッキングカードがキーボードを持つ、質問カードへ park、scrollback から戻れなかった）は実行していない",
    );
  });

  test("live chrome が残る stalled は張り直しに当てない", () => {
    const md = harnessMd();
    expect(md).toMatch(/live な composer \/ nav chrome[\s\S]*張り直しに当てない/);
  });

  test("張り直しの agent prompt も同じ前段を通す", () => {
    expect(harnessMd()).toMatch(/張り直しの `agent prompt` も同じ/);
  });
});

describe("実行器の配線", () => {
  const wiring = {
    refine: { kind: "claude", args: [] as const },
    resolve: { kind: "grok", args: ["--model", "x"] as const },
  };

  test("工程ごとに kind と args を読む", () => {
    expect(parseWiring(wiring)).toEqual({
      refine: { kind: "claude", args: [] },
      resolve: { kind: "grok", args: ["--model", "x"] },
    });
  });

  test("工程が 1 つでも欠けたら止まる", () => {
    expect(() => parseWiring({ refine: wiring.refine })).toThrow("resolve");
  });

  test("kind が空なら止まる（既定へ倒さない）", () => {
    expect(() => parseWiring({ ...wiring, resolve: { kind: "", args: [] } })).toThrow(ConfigError);
  });

  test("args の空要素は止まる", () => {
    expect(() => parseWiring({ ...wiring, resolve: { kind: "grok", args: [""] } })).toThrow("args");
  });

  test("配線以外のキーは止まる", () => {
    expect(() => parseWiring({ ...wiring, ghRepo: "acme/control" })).toThrow("ghRepo");
  });

  test("tracked の executors は未知として止まる", () => {
    expect(() => parseConfig({ ...raw, executors: { refine: "claude", resolve: "grok" } })).toThrow(
      "executors",
    );
  });

  test("tracked の未知キーは止まる", () => {
    expect(() => parseConfig({ ...raw, extra: 1 })).toThrow("未知");
  });
});

describe("配線の JSONC", () => {
  const body = `{
    // kind は herdr agent start --kind
    "refine": { "kind": "claude", "args": [] },
    "resolve": {
      "kind": "grok",
      /* モデル・effort は kind ごとに違う */
      "args": ["--model", "x // not a comment"],
    },
  }`;

  test("コメントと末尾カンマを読んで args の文字列は残す", () => {
    expect(parseWiring(parseJsonc(body))).toEqual({
      refine: { kind: "claude", args: [] },
      resolve: { kind: "grok", args: ["--model", "x // not a comment"] },
    });
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
