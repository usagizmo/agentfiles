// advisors-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / codex は偽物。偽 tmux は fake-tmux.ts。

import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { installFakeTmux } from "./fake-tmux.ts";

const SCRIPT = new URL("../agents/skills/consult/scripts/advisors-tmux.sh", import.meta.url)
  .pathname;

const FIXTURE = new URL("fixtures/pane-state", import.meta.url).pathname;

const FAKE_BIN = `#!/bin/sh
# PATH 上の偽 codex。open が直接 exec するので実バイナリが要る
exit 0
`;

// 呼び出し元の harness の印は持ち込まない
const CLEAN = {
  CLAUDECODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CURSOR_INVOKED_AS: undefined,
} as const;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      ...CLEAN,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
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
  const dir = await mkdtemp(join(tmpdir(), "advisors-tmux-"));
  await installFakeTmux(dir);
  await Bun.write(join(dir, "codex"), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Review the diff.\n");
  await Bun.write(join(dir, "reply"), "Applied 1. Re-review.\n");
  await chmod(join(dir, "codex"), 0o755);
  return dir;
};

test("tmux backend: 巡をまたいで送り、close で session を破棄する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect({ exitCode: started.exitCode, stderr: started.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "backend"), "utf8")).toBe("tmux\n");
    expect(await readFile(join(runDir, "round"), "utf8")).toBe("1\n");

    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("=== codex 巡 1 (rc=0) ===");
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
    // close は session ごとの server を残さない（buffer も server と一緒に消える）
    expect((await readdir(dir)).filter((name) => name.startsWith("srv-"))).toEqual([]);
    const after = await run(dir, ["collect", runDir, "5"]);
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toContain("close 済み");

    // 判定行の無い巡は証跡にならない。close 済みでも読める
    const unverified = await run(dir, ["verify", runDir]);
    expect({ exitCode: unverified.exitCode, stdout: unverified.stdout }).toEqual({
      exitCode: 1,
      stdout: `run: ${runDir}\nround: 2\nclosed: yes\ncodex: 不明\nverify: fail\n`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 起こせなければ agent の log 末尾を出す", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "die"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain(
      "=== codex start 失敗 ===\nFATAL\tsession が消えた（起動した harness が終了した）: c-codex-",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: ログイン待ちの agent は log に理由を残して起こせなかった扱いにする", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "login"), Bun.file(`${FIXTURE}/login-cursor`));
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("=== codex start 失敗 ===\nFATAL\tログインが要る: codex\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: verify は今の巡が「指摘なし」のときだけ通る", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "verdict"), "判定: 修正推奨\n");
    const runDir = (await run(dir, ["start", join(dir, "prompt")])).stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    const fix = await run(dir, ["verify", runDir]);
    expect({ exitCode: fix.exitCode, stdout: fix.stdout }).toEqual({
      exitCode: 1,
      stdout: `run: ${runDir}\nround: 1\nclosed: no\ncodex: 修正推奨\nverify: fail\n`,
    });

    await Bun.write(join(dir, "verdict"), "判定: 指摘なし\n");
    expect((await run(dir, ["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    // 回収前は未終了
    const early = await run(dir, ["verify", runDir]);
    expect(early.exitCode).toBe(1);
    expect(early.stdout).toContain("codex: 未回収");
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    const pass = await run(dir, ["verify", runDir]);
    expect({ exitCode: pass.exitCode, stdout: pass.stdout }).toEqual({
      exitCode: 0,
      stdout: `run: ${runDir}\nround: 2\nclosed: no\ncodex: 指摘なし\nverify: pass\n`,
    });
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: paste は反映を待ってから Enter を 1 回送る（反映前の Enter は落ちる）", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "slow-paste"), "3\n");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("answer 1");
    expect((await run(dir, ["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    expect((await run(dir, ["collect", runDir, "5"])).stdout).toContain("answer 2");
    const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
    expect(servers).toHaveLength(1);
    expect(await readFile(join(dir, servers[0] ?? "", "enters"), "utf8")).toBe("enter\nenter\n");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 反映後に落ちた Enter は 1 回だけ送り直す", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "drop-enter"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).stdout).toContain("answer 1");
    const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
    expect(await readFile(join(dir, servers[0] ?? "", "enters"), "utf8")).toBe("enter\nenter\n");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 貼り付けが反映されなければ Enter を送らず start を止める", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "slow-paste"), "999\n");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("貼り付けが画面に反映されない");
    const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
    for (const srv of servers) {
      expect(await Bun.file(join(dir, srv, "enters")).exists()).toBe(false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 送信後の画面を読めなければ Enter を送り直さず start を止める", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "capture-fail-after-enter"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("送信後の画面を読めない");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: Enter を送り直しても入力欄に残るなら start を止める", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "drop-enter-always"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("送信されない（入力欄に残っている）");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
