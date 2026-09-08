// `watch.sh` へ渡す引数を固定する。
//
// **渡し漏れは観測の穴になる。**面を 1 つ落とすとそこで書き進んでいる課題が成果ゼロの周として
// 数えられ、`--sessions-cmd` / `--workspaces-cmd` を落とすと usage error で 1 度も観測できない。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  ConfigError,
  extractHarnessCmd,
  parseConfig,
  loadExecutors,
  parseExecutors,
  resolveSurfaces,
} from "../src/config.ts";
import { createPort, snapshotArgs } from "../src/port.ts";
import { parseRosterToml } from "../src/roster.ts";
import { present } from "../src/types.ts";
import type { Observed } from "../src/types.ts";

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
  const config = parseConfig(input, HARNESS_MD);
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
    const declared = parseConfig(raw, HARNESS_MD).surfaces.slice(1);
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
    const config = parseConfig(raw, HARNESS_MD);
    expect(() =>
      resolveSurfaces(config.surfaces, new Map([["acme/control", "/w/control"]])),
    ).toThrow("acme/skills");
  });

  test("空文字は渡していないものとして扱う", () => {
    const config = parseConfig(raw, HARNESS_MD);
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

const HARNESS_MD = await Bun.file(join(import.meta.dir, "../references/harness.md")).text();
const SKILL_MD = await Bun.file(join(import.meta.dir, "../SKILL.md")).text();

describe("設定の fail-closed", () => {
  test("面の名前が重複したら止まる", () => {
    expect(() =>
      parseConfig(
        {
          ...raw,
          surfaces: [raw.surfaces[0], { ...raw.surfaces[1], name: "acme/control" }],
        },
        HARNESS_MD,
      ),
    ).toThrow("name が重複");
  });

  test("sessionsCmd を省略したら harness.md の code block を使う", () => {
    const { sessionsCmd: _drop, ...without } = raw;
    const cmd = parseConfig(without, HARNESS_MD).sessionsCmd;
    expect(cmd).toBe(extractHarnessCmd(HARNESS_MD, "sessions-cmd"));
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
    expect(parseConfig(without, HARNESS_MD).workspacesCmd).toBe(
      extractHarnessCmd(HARNESS_MD, "workspaces-cmd"),
    );
  });

  test("sessionsCmd が空文字なら止まる", () => {
    expect(() => parseConfig({ ...raw, sessionsCmd: "" }, HARNESS_MD)).toThrow("sessionsCmd");
  });

  test("workspacesCmd が空文字なら止まる", () => {
    expect(() => parseConfig({ ...raw, workspacesCmd: "" }, HARNESS_MD)).toThrow("workspacesCmd");
  });
});

describe("leftover 判定", () => {
  const sessionsCmd = () => extractHarnessCmd(HARNESS_MD, "sessions-cmd");

  const leftoverPredicate = (cmd: string): string => {
    const start = cmd.indexOf("    still=0\n");
    const needle = 'if [ "$still" = 1 ] && [ "$ended" = 1 ]; then leftover=leftover; fi';
    const end = cmd.indexOf(needle);
    if (start < 0 || end < 0) throw new Error("leftover 判定が sessions-cmd から切れない");
    return cmd.slice(start, end + needle.length);
  };

  const runLeftover = async (snippet: string, visible: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "leftover-"));
    try {
      const snippetPath = join(dir, "snippet");
      const visiblePath = join(dir, "visible");
      const scriptPath = join(dir, "run.sh");
      await Bun.write(snippetPath, snippet);
      await Bun.write(visiblePath, visible);
      await Bun.write(
        scriptPath,
        [
          'snippet=$(cat "$1"; printf x); snippet=${snippet%x}',
          'visible=$(cat "$2"; printf x); visible=${visible%x}',
          "leftover=-",
          leftoverPredicate(sessionsCmd()),
          "printf '%s\\n' \"$leftover\"",
          "",
        ].join("\n"),
      );
      const proc = Bun.spawn(["bash", scriptPath, snippetPath, visiblePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`leftover 判定が ${String(code)}: ${err}`);
      return out.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const chrome = "1 command still running";
  const ended = "Worked for 44s";
  const blanks = (n: number) => Array.from({ length: n }, () => "").join("\n");
  const dump = (...lines: string[]) => `${lines.join("\n")}\n`;

  test("still は detection 40 行。visible は行数で切らない。連言を落とさない", () => {
    const cmd = sessionsCmd();
    expect(cmd).toContain("--source detection --lines 40");
    expect(cmd).toContain("--source visible --format text");
    expect(cmd).not.toMatch(/--source visible --lines/);
    expect(cmd).toContain('if [ "$still" = 1 ] && [ "$ended" = 1 ]; then leftover=leftover; fi');
  });

  test("契約表に turn 終了と背景残存の区別がある", () => {
    expect(HARNESS_MD).toContain("turn の終了を背景作業の残存と区別して観測できる");
  });

  test("終了行は末尾側 leftover chrome より前で最も近いものを見る", () => {
    expect(HARNESS_MD).toContain("末尾側の leftover chrome");
    expect(HARNESS_MD).not.toContain("終了行は detection の末尾だけを見る");
    expect(HARNESS_MD).not.toContain("末尾以外は見ない");
  });

  test("終了行が dump 末尾から外れ、chrome とのあいだが空行だけなら leftover", async () => {
    expect(
      await runLeftover(dump(chrome), dump(ended, blanks(35), chrome, "composer", "footer")),
    ).toBe("leftover");
  });

  test("終了行と leftover chrome のあいだに空でない内容があれば leftover にしない", async () => {
    expect(await runLeftover(dump(chrome), dump(ended, "assistant text", chrome))).toBe("-");
  });

  test("leftover chrome が複数あるときは末尾側を見る", async () => {
    expect(await runLeftover(dump(chrome), dump(chrome, ended, blanks(35), chrome, "footer"))).toBe(
      "leftover",
    );
  });

  test("信号が無い working は leftover にしない", async () => {
    expect(await runLeftover(dump("thinking"), dump("thinking", "footer"))).toBe("-");
  });

  test("still だけなら leftover にしない", async () => {
    expect(await runLeftover(dump(chrome), dump("thinking", chrome))).toBe("-");
  });

  test("ended だけなら leftover にしない", async () => {
    expect(await runLeftover(dump("thinking"), dump(ended, blanks(2), chrome))).toBe("-");
  });

  test("終了行が chrome の直前にあれば leftover のまま", async () => {
    expect(await runLeftover(dump(chrome), dump(ended, chrome))).toBe("leftover");
  });
});

describe("card 判定", () => {
  const sessionsCmd = () => extractHarnessCmd(HARNESS_MD, "sessions-cmd");

  const cardPredicate = (cmd: string): string => {
    const start = cmd.indexOf('if [ "$owned" = 1 ] && { [ "$status" = "idle" ]');
    const needle = "      card=card\n    fi\n  fi";
    const end = cmd.indexOf(needle, start);
    if (start < 0 || end < 0) throw new Error("card 判定が sessions-cmd から切れない");
    return cmd.slice(start, end + needle.length);
  };

  const runCard = async (status: string, visible: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "card-"));
    try {
      const visiblePath = join(dir, "visible");
      const scriptPath = join(dir, "run.sh");
      await Bun.write(visiblePath, visible);
      await Bun.write(
        scriptPath,
        [
          `status=${JSON.stringify(status)}`,
          "owned=1",
          "card=-",
          'visible=$(cat "$1"; printf x); visible=${visible%x}',
          cardPredicate(sessionsCmd()),
          "printf '%s\\n' \"$card\"",
          "",
        ].join("\n"),
      );
      const proc = Bun.spawn(["bash", scriptPath, visiblePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`card 判定が ${String(code)}: ${err}`);
      return out.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const dump = (...lines: string[]) => `${lines.join("\n")}\n`;
  const cursorFooter = "↑/↓ option · ←/→ question · Space select · Enter next/submit · Esc to skip";

  test("idle/done の所有だけ visible を読む。card 欄は全行", () => {
    const cmd = sessionsCmd();
    expect(cmd).toContain(
      'printf \'%s %s %s %s %s\\n\' "$name" "$status" "$leftover" "$refused" "$card"',
    );
    expect(cmd).toContain(
      'printf \'%s %s %s %s %s %s %s\\n\' "$name" "$status" "$leftover" "$refused" "$card" "$ws" "$cwd"',
    );
    expect(cmd).toContain('[ "$status" = "idle" ] || [ "$status" = "done" ]');
    expect(cmd).not.toContain("Question 1 of 1");
  });

  test("Cursor 質問カードの末尾 footer なら card", async () => {
    expect(
      await runCard("done", dump("Issue #1208 の意図確認", "Question 1 of 1", cursorFooter)),
    ).toBe("card");
  });

  test("見出し単独では card にしない", async () => {
    expect(await runCard("done", dump("Issue #1208 の意図確認", "Question 1 of 1"))).toBe("-");
  });

  test("composer 表の復帰も送らない末行なら card", async () => {
    expect(await runCard("idle", dump("body", "Tab:next answer"))).toBe("card");
    expect(await runCard("done", dump("body", "Esc:scrollback"))).toBe("card");
    expect(await runCard("idle", dump("body", "Tab/Space: question"))).toBe("card");
  });

  test("scrollback フォーカスは card にしない", async () => {
    expect(await runCard("done", dump("body", "Space:prompt"))).toBe("-");
    expect(await runCard("idle", dump("body", "j/k:nav"))).toBe("-");
  });

  test("working では card を付けない", async () => {
    expect(await runCard("working", dump(cursorFooter))).toBe("-");
  });
});

describe("subagent 判定", () => {
  const sessionsCmd = () => extractHarnessCmd(HARNESS_MD, "sessions-cmd");

  const subagentPredicate = (cmd: string): string => {
    const start = cmd.indexOf("  subagent_re=");
    const needle = "then leftover=subagent; fi";
    const end = cmd.indexOf(needle);
    if (start < 0 || end < 0) throw new Error("subagent 判定が sessions-cmd から切れない");
    return cmd.slice(start, end + needle.length);
  };

  const runSubagent = async (snippet: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "subagent-"));
    try {
      const snippetPath = join(dir, "snippet");
      const scriptPath = join(dir, "run.sh");
      await Bun.write(snippetPath, snippet);
      await Bun.write(
        scriptPath,
        [
          'snippet=$(cat "$1"; printf x); snippet=${snippet%x}',
          "leftover=-",
          subagentPredicate(sessionsCmd()),
          "printf '%s\\n' \"$leftover\"",
          "",
        ].join("\n"),
      );
      const proc = Bun.spawn(["bash", scriptPath, snippetPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`subagent 判定が ${String(code)}: ${err}`);
      return out.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const activityPredicate = (cmd: string): string => {
    const start = cmd.indexOf("  subagent_re=");
    const needle = "then leftover=leftover; fi\n  fi";
    const end = cmd.indexOf(needle);
    if (start < 0 || end < 0)
      throw new Error("subagent と leftover の連塊が sessions-cmd から切れない");
    return cmd.slice(start, end + needle.length);
  };

  const runActivity = async (snippet: string, visible: string): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "activity-"));
    try {
      const snippetPath = join(dir, "snippet");
      const visiblePath = join(dir, "visible");
      const scriptPath = join(dir, "run.sh");
      await Bun.write(snippetPath, snippet);
      await Bun.write(visiblePath, visible);
      await Bun.write(
        scriptPath,
        [
          'snippet=$(cat "$1"; printf x); snippet=${snippet%x}',
          'visible=$(cat "$2"; printf x); visible=${visible%x}',
          "leftover=-",
          "status=working",
          activityPredicate(sessionsCmd()),
          "printf '%s\\n' \"$leftover\"",
          "",
        ].join("\n"),
      );
      const proc = Bun.spawn(["bash", scriptPath, snippetPath, visiblePath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, out, err] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      if (code !== 0) throw new Error(`activity 判定が ${String(code)}: ${err}`);
      return out.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  const dump = (...lines: string[]) => `${lines.join("\n")}\n`;
  const subagentLine = "○ 1 subagent still running · send a message to interrupt";
  const leftoverChrome = "1 command still running";

  test("leftover 位置のトークンに subagent がある", () => {
    const cmd = sessionsCmd();
    expect(cmd).toContain("leftover=subagent");
    expect(cmd).toContain("subagents? still running");
    expect(cmd).toContain("send a message to interrupt");
    expect(cmd).toContain('if [ "$leftover" = "leftover" ] || [ "$leftover" = "subagent" ]');
  });

  test("同一行の 2 断片なら subagent。interrupt 単独では引かない", async () => {
    expect(await runSubagent(dump(subagentLine))).toBe("subagent");
    expect(await runSubagent(dump("send a message to interrupt"))).toBe("-");
    expect(await runSubagent(dump("1 subagent still running"))).toBe("-");
    expect(await runSubagent(dump("1 subagent still running", "send a message to interrupt"))).toBe(
      "-",
    );
  });

  test("subagent は leftover より先。working + leftover chrome でも leftover にしない", async () => {
    const ended = "Worked for 44s";
    expect(await runActivity(dump(subagentLine, leftoverChrome), dump(ended, leftoverChrome))).toBe(
      "subagent",
    );
    expect(await runActivity(dump(leftoverChrome), dump(ended, leftoverChrome))).toBe("leftover");
  });
});

describe("既に working への agent prompt", () => {
  test("確認は agent_prompted。seq 非変化を失敗にしない", () => {
    const md = HARNESS_MD;
    expect(md).toContain("agent_prompted");
    expect(md).not.toContain("state_change_seq` が動いたことを確認する。動かなければ失敗");
  });

  test("張り直しと実行器だけ止めるの seq 確認は残る", () => {
    const md = HARNESS_MD;
    expect(md).toMatch(/実行器だけ止める[\s\S]*state_change_seq/);
    expect(md).toMatch(/失われた resolve を張り直す[\s\S]*state_change_seq/);
  });
});

const composerSection = () => {
  const md = HARNESS_MD;
  const start = md.indexOf("### composer の受け入れ");
  const end = md.indexOf("### 失われた resolve を張り直す");
  return md.slice(start, end);
};

describe("composer が受け付ける状態での agent prompt", () => {
  test("契約表に受け付ける状態で submit できたことの観測がある", () => {
    expect(HARNESS_MD).toContain("composer が受け付ける状態で submit できたことを観測できる");
  });

  test("前段は visible のフッターで、入力欄は見ない", () => {
    const md = HARNESS_MD;
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
    for (const surface of [
      "Tab:next answer",
      "Esc:scrollback",
      "Tab/Space: question",
      "↑/↓ option",
      "Esc to skip",
    ]) {
      const at = md.indexOf(surface);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(resume);
    }
    expect(md).toContain("見出し（`Question 1 of 1`）単独では引かない");
  });

  test("chrome が読めない、または表に無い字面は fail-open", () => {
    expect(HARNESS_MD).toMatch(/表に無い字面[\s\S]*fail-open/);
  });

  test("leftover 成功は受け付ける状態での agent_prompted", () => {
    expect(HARNESS_MD).toMatch(/受け付ける状態での `agent_prompted`/);
  });

  test("送れなかった周は成功でも失敗でもない", () => {
    expect(HARNESS_MD).toContain("成功でも失敗でもない");
  });

  test("戻れず送れなかった周は retry に数えない", () => {
    expect(SKILL_MD).toMatch(/retry に数え\*\*ない\*\*/);
    expect(SKILL_MD).toMatch(/送れなかった周は実行していない/);
    expect(SKILL_MD).toContain("composer の受け入れ");
  });

  test("live chrome が残る stalled は張り直しに当てない", () => {
    const md = HARNESS_MD;
    expect(md).toMatch(/live な composer \/ nav chrome[\s\S]*張り直しに当てない/);
  });

  test("張り直しの agent prompt も同じ前段を通す", () => {
    expect(HARNESS_MD).toMatch(/張り直しの `agent prompt` も同じ/);
  });

  test("Workspace Trust は [a] と spinner の 2 行。見出し必須ではない", () => {
    const md = composerSection();
    expect(md).toContain("[a] Trust this workspace");
    expect(md).toContain("Trusting workspace");
    expect(md).toMatch(/見出し必須/);
    expect(md).toMatch(/表の Trust の行があるあいだは `agent prompt` を送らない/);
    expect(md).not.toMatch(/Workspace Trust Required` と `\[a\] Trust this workspace`/);
  });

  test("[q] Quit は Trust の行にしない", () => {
    const md = composerSection();
    expect(md).toMatch(/\[q\] Quit[\s\S]*行にしない/);
  });

  test("Trust の [a] があるとき send-keys a は 1 回。再観測は 3 回まで。残るなら Conflict", () => {
    const md = composerSection();
    expect(md).toMatch(/send-keys <名前> a/);
    expect(md).toMatch(/1 回/);
    expect(md).toMatch(/3 回まで/);
    expect(md).toMatch(/残るなら Conflict/);
  });

  test("Trusting workspace は [a] が無いときだけ送らない。spinner だけは送れなかった周", () => {
    const md = composerSection();
    expect(md).toMatch(/Trusting workspace[\s\S]*送ら/);
    expect(md).toMatch(/spinner[\s\S]*送れなかった周|[a][\s\S]*が無い[\s\S]*送れなかった周/);
  });

  test("Trust 行は送らない行の後、fail-open の前。scrollback 復帰の順序には載せない", () => {
    const md = composerSection();
    const trust = md.indexOf("| `[a] Trust this workspace`");
    const failOpen = md.indexOf("表に無い字面");
    expect(trust).toBeGreaterThanOrEqual(0);
    expect(failOpen).toBeGreaterThan(trust);
    for (const surface of ["Tab:next answer", "Esc:scrollback", "Tab/Space: question"]) {
      const at = md.indexOf(surface);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThan(trust);
    }
  });

  test("idle から起こす成功は until working だけ。agent_prompted かつ idle は成功にしない", () => {
    const md = composerSection();
    expect(md).toMatch(/idle[\s\S]*`--wait --until working`/);
    expect(md).toMatch(/`agent_prompted` かつ idle は成功にしない/);
  });

  test("until working の timeout 直後に visible を読み、Trust 面なら送れなかった周", () => {
    const md = HARNESS_MD;
    expect(md).toMatch(/timeout[\s\S]*visible/);
    expect(md).toMatch(/Trust[\s\S]*送れなかった周/);
  });

  test("composer 表の Conflict は送れなかった周ではない", () => {
    expect(SKILL_MD).toMatch(/composer 表が Conflict[\s\S]*送れなかった周ではない/);
    expect(HARNESS_MD).toMatch(/表が Conflict と書いた周は送れなかった周ではない/);
  });

  test("send-keys の例外は composer の受け入れ表が定めるキー。表に submit キーを置かない", () => {
    expect(HARNESS_MD).toMatch(/例外は「composer の受け入れ」表が定めるキー/);
    const md = composerSection();
    expect(md).toMatch(/表に `enter` \/ `ctrl\+enter` を置か/);
    expect(md).not.toMatch(/send-keys <名前> enter/);
    expect(md).not.toMatch(/send-keys <名前> ctrl\+enter/);
  });
});

describe("実行器", () => {
  const executors = {
    refine: { kind: "claude", args: [] as const },
    resolve: { kind: "grok", args: ["--model", "x"] as const },
  };

  test("工程ごとに kind と args を読む", () => {
    expect(parseExecutors(executors)).toEqual({
      refine: { kind: "claude", args: [] },
      resolve: { kind: "grok", args: ["--model", "x"] },
    });
  });

  test("工程が 1 つでも欠けたら止まる", () => {
    expect(() => parseExecutors({ refine: executors.refine })).toThrow("resolve");
  });

  test("kind が空なら止まる（既定へ倒さない）", () => {
    expect(() => parseExecutors({ ...executors, resolve: { kind: "", args: [] } })).toThrow(
      ConfigError,
    );
  });

  test("args の空要素は止まる", () => {
    expect(() => parseExecutors({ ...executors, resolve: { kind: "grok", args: [""] } })).toThrow(
      "args",
    );
  });

  test("実行器以外のキーは止まる", () => {
    expect(() => parseExecutors({ ...executors, ghRepo: "acme/control" })).toThrow("ghRepo");
  });

  test("tracked の executors は未知として止まる", () => {
    expect(() =>
      parseConfig({ ...raw, executors: { refine: "claude", resolve: "grok" } }, HARNESS_MD),
    ).toThrow("executors");
  });

  test("tracked の未知キーは止まる", () => {
    expect(() => parseConfig({ ...raw, extra: 1 }, HARNESS_MD)).toThrow("未知");
  });
});

describe("実行器の TOML", () => {
  const body = `
advisors = []
# kind は herdr agent start --kind
[executors.refine]
kind = "claude"
args = []

[executors.resolve]
kind = "grok"
# モデル・effort は kind ごとに違う
args = ["--model", "x # not a comment"]
`;

  test("コメントを読んで args の文字列は残す", () => {
    expect(parseExecutors(parseRosterToml(body).executors)).toEqual({
      refine: { kind: "claude", args: [] },
      resolve: { kind: "grok", args: ["--model", "x # not a comment"] },
    });
  });
});

describe("実行器の読み込み", () => {
  test("roster.toml は既定の在処で読める", async () => {
    const loaded = await loadExecutors();
    expect(loaded.refine.kind).not.toBe("");
    expect(loaded.resolve.kind).not.toBe("");
  });

  test("file が無ければ在処と必要なキーを出して止まる", async () => {
    const dir = await mkdtemp(join(tmpdir(), "executors-"));
    const missing = join(dir, "roster.toml");
    await expect(loadExecutors(missing)).rejects.toThrow(missing);
    await expect(loadExecutors(missing)).rejects.toThrow("必要なキー");
  });

  test("壊れていれば在処を出して止まる", async () => {
    const dir = await mkdtemp(join(tmpdir(), "executors-"));
    const broken = join(dir, "roster.toml");
    await Bun.write(broken, "= not toml");
    await expect(loadExecutors(broken)).rejects.toThrow(broken);
  });

  test("executors が無ければ止まる", async () => {
    const dir = await mkdtemp(join(tmpdir(), "executors-"));
    const path = join(dir, "roster.toml");
    await Bun.write(path, '[[advisors]]\nkind = "claude"\nargs = []\n');
    await expect(loadExecutors(path)).rejects.toThrow("executors");
  });

  test("トップレベルの未知キーは止まる", async () => {
    const dir = await mkdtemp(join(tmpdir(), "executors-"));
    const path = join(dir, "roster.toml");
    await Bun.write(path, 'advisors = []\n[executor.refine]\nkind = "claude"\nargs = []\n');
    await expect(loadExecutors(path)).rejects.toThrow("executor");
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
    await Bun.write(bodyPath, issueBody);
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
      await Bun.write(waitPath, waitRecord);
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
    const config = parseConfig(raw, HARNESS_MD);
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

const truncatedGh = `#!/bin/sh
set -eu
include=0
paginate=0
path=""
for a in "$@"; do
  case $a in
    --include|-i) include=1 ;;
    --paginate) paginate=1 ;;
    repos/*) path=$a ;;
  esac
done
issues='[{"number":1,"body":"one"}]'
comments='[{"id":1,"issue_url":"https://api.github.com/repos/acme/control/issues/1","body":"<!-- plan -->\\n","created_at":"2000-01-01T00:00:00Z"}]'
prs='[{"number":9,"merged_at":null,"state":"open","head":{"ref":"fix/1-x"}}]'
body=$issues
case $path in
  */issues/comments*) body=$comments ;;
  */pulls*) body=$prs ;;
  */issues*) body=$issues ;;
  *) echo "fake gh: unexpected path: $path ($*)" >&2; exit 1 ;;
esac
if [ "$include" = 1 ]; then
  printf 'HTTP/2.0 200 OK\\nLink: <https://api.github.com/%s&page=2>; rel="next", <https://api.github.com/%s&page=3>; rel="last"\\nContent-Type: application/json\\n\\n%s\\n' "$path" "$path" "$body"
  exit 0
fi
printf '%s\\n' "$body"
`;

const completeGh = `#!/bin/sh
set -eu
include=0
path=""
for a in "$@"; do
  case $a in
    --include|-i) include=1 ;;
    --paginate) ;;
    repos/*) path=$a ;;
  esac
done
issues='[{"number":1,"body":"one"},{"number":2,"body":"two"}]'
comments='[{"id":1,"issue_url":"https://api.github.com/repos/acme/control/issues/1","body":"<!-- plan -->\\n","created_at":"2000-01-01T00:00:00Z"}]'
prs='[{"number":9,"merged_at":null,"state":"open","head":{"ref":"fix/1-x"}}]'
body=$issues
case $path in
  */issues/comments*) body=$comments ;;
  */pulls*) body=$prs ;;
  */issues*) body=$issues ;;
  *) echo "fake gh: unexpected path: $path ($*)" >&2; exit 1 ;;
esac
if [ "$include" = 1 ]; then
  printf 'HTTP/2.0 200 OK\\nContent-Type: application/json\\n\\n%s\\n' "$body"
  exit 0
fi
printf '%s\\n' "$body"
`;

const withFakeGh = async (script: string, fn: () => Promise<void>) => {
  const dir = await mkdtemp(join(tmpdir(), "gh-"));
  const prev = process.env["PATH"];
  try {
    const bin = join(dir, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), script, { mode: 0o755 }); // Bun.write は mode を持たない
    process.env["PATH"] = `${bin}:${prev ?? ""}`;
    await fn();
  } finally {
    if (prev === undefined) delete process.env["PATH"];
    else process.env["PATH"] = prev;
    await rm(dir, { recursive: true, force: true });
  }
};

const portOf = () => {
  const config = parseConfig(raw, HARNESS_MD);
  return createPort({
    config,
    surfaces: resolveSurfaces(config.surfaces, PATHS),
    scriptsDir: join(import.meta.dir, "../scripts"),
    snapshotPath: "/tmp/snap",
  });
};

const reasons = <T>(map: ReadonlyMap<number, Observed<T>>, numbers: readonly number[]) =>
  numbers.map((n) => {
    const got = map.get(n);
    if (got === undefined) return "missing";
    if (got.kind === "unobservable") return got.reason;
    return got.kind;
  });

describe("REST 一覧の打ち切り", () => {
  test("短い Issue 一覧は渡された番号のすべてが同じ観測失敗である", async () => {
    await withFakeGh(truncatedGh, async () => {
      const map = await portOf().issueBodies([1, 2, 3]);
      const got = reasons(map, [1, 2, 3]);
      expect(got[0]).not.toBe("present");
      expect(new Set(got).size).toBe(1);
      expect(got[0]).not.toBe("Issue 一覧に居ない");
    });
  });

  test("件数照合が通ったあと、一覧に無い番号だけが個別の欠落である", async () => {
    await withFakeGh(completeGh, async () => {
      const map = await portOf().issueBodies([1, 2, 3]);
      expect(map.get(1)).toEqual(present("one"));
      expect(map.get(2)).toEqual(present("two"));
      expect(map.get(3)?.kind).toBe("unobservable");
      expect(map.get(3)).toEqual(
        expect.objectContaining({ kind: "unobservable", reason: "Issue 一覧に居ない" }),
      );
    });
  });

  test("短いコメント一覧は固定 marker を欠落として読まない", async () => {
    await withFakeGh(truncatedGh, async () => {
      const map = await portOf().issueComments([1, 2]);
      const got = reasons(map, [1, 2]);
      expect(got[0]).not.toBe("present");
      expect(new Set(got).size).toBe(1);
    });
  });

  test("短い PR 一覧は PR を読めない", async () => {
    await withFakeGh(truncatedGh, async () => {
      const facts = await portOf().issueFacts(1);
      expect(facts.prMerged.kind).toBe("unobservable");
    });
  });
});
