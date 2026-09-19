// worker-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux と実行器は偽物。偽 tmux は fake-tmux.ts。
// kind は roster の既定 worker から引く（表の中身をテストに写さない）。

import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ROSTER_URL, parseRoster, selectWorker } from "../agents/shared/roster.ts";
import { installFakeTmux } from "./fake-tmux.ts";

const SCRIPT = new URL("../agents/skills/dispatch/scripts/worker-tmux.sh", import.meta.url)
  .pathname;

const FIXTURE = new URL("fixtures/pane-state", import.meta.url).pathname;

const FAKE_BIN = `#!/bin/sh\nexit 0\n`;

const KIND = selectWorker(parseRoster(await Bun.file(ROSTER_URL).text()).workers).kind;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
      // 呼び出し元の指名を持ち込まない（既定 worker の選出を見るテスト）
      DISPATCH_KIND: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
};

const setup = async () => {
  const dir = await mkdtemp(join(tmpdir(), "worker-tmux-"));
  await installFakeTmux(dir);
  await Bun.write(join(dir, KIND), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Implement the fix.\n");
  await Bun.write(join(dir, "reply"), "Continue with tests.\n");
  await chmod(join(dir, KIND), 0o755);
  return dir;
};

test("dispatch tmux: 起こせなければ log 末尾を出す", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "die"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain(
      `(log の末尾)\nFATAL\tsession が消えた（起動した harness が終了した）: d-${KIND}-`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: ログイン待ちなら理由を出して起動を止める", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "login"), Bun.file(`${FIXTURE}/login-cursor`));
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain(`FATAL\tログインが要る: ${KIND}\n`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: 巡をまたいで送り、close で session を破棄する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect({ exitCode: started.exitCode, stderr: started.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "backend"), "utf8")).toBe("tmux\n");
    expect(await readFile(join(runDir, "layer"), "utf8")).toBe("dispatch\n");
    expect(await readFile(join(runDir, "worker"), "utf8")).toBe(`${KIND}\n`);

    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain(KIND);
    expect(first.stdout).toContain("answer 1");

    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect({ exitCode: asked.exitCode, stdout: asked.stdout }).toEqual({
      exitCode: 0,
      stdout: "2\n",
    });

    const second = await run(dir, ["collect", runDir, "5"]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("answer 2");

    const closed = await run(dir, ["close", runDir]);
    expect(closed.exitCode).toBe(0);
    expect(await readFile(join(dir, "kills"), "utf8")).toMatch(/^[1-9]/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: 入力待ちで marker が無ければ collect が終端にし、ask できない", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "no-marker"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "2"]);
    expect(first.stdout).toContain("(rc=1 marker 無し)");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(true);
    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect(asked.exitCode).toBe(2);
    expect(asked.stderr).toContain("worker は終端している");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: deadline で入力待ちでも、読み直して marker があれば完走", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "late-marker"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "0"]);
    expect(first.stdout).toContain("(rc=0)");
    expect(first.stdout).toContain("answer 1");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(false);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: deadline の再読込が失敗したら終端にせず timeout", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "no-marker"), "");
    await Bun.write(join(dir, "history-fail-after-first"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "0"]);
    expect(first.stdout).toContain("(rc=1 timeout)");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(false);
    expect(await Bun.file(join(runDir, "rc.1")).exists()).toBe(false);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: 画面が動かず処理中でもなければ deadline を待たず停滞で戻る", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "prompt-stall"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const t0 = Date.now();
    const first = await run(dir, ["collect", runDir, "20", "2"]);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(first.stdout).toContain("(rc=1 停滞)");
    expect(first.stdout).toContain("Allow this command?");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(false);
    expect(await Bun.file(join(runDir, "rc.1")).exists()).toBe(false);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: 画面が動かなくても作業中なら停滞にせず deadline まで待つ", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "working-stall"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "5", "2"]);
    expect(first.stdout).toContain("(rc=1 timeout)");
    expect(first.stdout).not.toContain("停滞");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(false);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("dispatch tmux: capacity 画面は deadline を待たず不通で終端する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
    expect(servers).toHaveLength(1);
    await Bun.write(
      join(dir, servers[0] ?? "", "screen"),
      Bun.file(`${FIXTURE}/codex-capacity.txt`),
    );
    const t0 = Date.now();
    const first = await run(dir, ["collect", runDir, "8", "8"]);
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toContain("(rc=1 不通)");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(true);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

test("dispatch tmux: 停滞秒が deadline より短くても、入力待ちで marker が無ければ終端する", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "no-marker"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "20", "2"]);
    expect(first.stdout).toContain("(rc=1 marker 無し)");
    expect(await Bun.file(join(runDir, "dead")).exists()).toBe(true);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
