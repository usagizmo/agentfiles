// grokbot-report の送信前の拒否条件と、送る JSON の形。
// 実際の送信は外部 service なので、HOME（env の在処）と PATH の curl を差し替える。

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../harnesses/claude/bin/grokbot-report");

// 受け取った引数を 1 行ずつ残し、-o の先へ FAKE_BODY を書き、FAKE_CODE を返す。
const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$@" > "$HOME/curl.args"
while [ $# -gt 0 ]; do
  if [ "$1" = "-o" ]; then printf '%s' "$FAKE_BODY" > "$2"; fi
  shift
done
printf '%s' "$FAKE_CODE"
`;

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "grokbot-report-"));
  await Bun.write(
    join(home, ".config/grokbot/ccd-webhook.env"),
    "WEBHOOK_URL=https://desk.example.invalid/hook\nWEBHOOK_KEY=test-key\n",
  );
  await Bun.write(join(home, "bin/curl"), FAKE_CURL);
  await Bun.spawn(["chmod", "+x", join(home, "bin/curl")]).exited;
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

const run = async (args: string[], stdin = "", code = "200") => {
  const p = Bun.spawn([SCRIPT, ...args], {
    env: {
      HOME: home,
      PATH: `${join(home, "bin")}:${process.env["PATH"] ?? ""}`,
      FAKE_CODE: code,
      FAKE_BODY: "desk says no",
    },
    stdin: new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const argsFile = Bun.file(join(home, "curl.args"));
  const curlArgs = (await argsFile.exists()) ? (await argsFile.text()).split("\n") : null;
  return { exit, out, err, curlArgs };
};

const sentJson = (curlArgs: string[]) => {
  const i = curlArgs.indexOf("--data");
  return JSON.parse(curlArgs[i + 1] ?? "") as Record<string, string>;
};

test("-h / --help は使い方を出して 0 で終わり、送らない", async () => {
  for (const flag of ["-h", "--help"]) {
    const r = await run([flag]);
    expect(r.exit).toBe(0);
    expect(r.out).toContain("使い方: grokbot-report");
    expect(r.curlArgs).toBeNull();
  }
});

test("件名が無い・空・- 始まり、本文が空白だけのときは非ゼロで終わり、送らない", async () => {
  const cases: [string[], string][] = [
    [[], "本文"],
    [[""], "本文"],
    [["-x"], "本文"],
    [["-"], "本文"],
    [["--help-me", "本文"], ""],
    [["件名"], ""],
    [["件名"], " \n\t\n"],
    [["件名", ""], "標準入力は読まない"],
    [["件名", "  \n"], ""],
  ];
  for (const [args, stdin] of cases) {
    const r = await run(args, stdin);
    expect({ args, exit: r.exit }).toEqual({ args, exit: 2 });
    expect(r.err).toContain("grokbot-report:");
    expect(r.curlArgs).toBeNull();
  }
});

test("本文は引数か標準入力から取り、件名と送信元のホスト名を JSON で送る", async () => {
  const host = (await new Response(Bun.spawn(["hostname", "-s"]).stdout).text()).trim();
  for (const [args, stdin] of [
    [["件名", "本文"], ""],
    [["件名"], "本文"],
  ] as const) {
    const r = await run([...args], stdin);
    expect(r.exit).toBe(0);
    expect(r.out).toBe("HTTP 200\n");
    expect(r.curlArgs).toContain("https://desk.example.invalid/hook");
    expect(r.curlArgs).toContain("Authorization: Bearer test-key");
    expect(sentJson(r.curlArgs ?? [])).toEqual({
      source: `ccd@${host}`,
      title: "件名",
      text: "本文",
    });
  }
});

test("HTTP 300 以上はレスポンスを出して失敗する", async () => {
  const r = await run(["件名", "本文"], "", "500");
  expect(r.exit).toBe(1);
  expect(r.out).toBe("HTTP 500\ndesk says no");
});
