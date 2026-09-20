// advisors-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / 先頭 kind の harness は偽物。偽 tmux は fake-tmux.ts。

import { chmod, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { ROSTER_URL, directBinary, parseRoster } from "../agents/shared/roster.ts";
import { installFakeTmux } from "./fake-tmux.ts";

// 起動されるのは実体 roster の先頭。並べ替えても gate が落ちないように名前で決め打ちしない
const FIRST = parseRoster(await Bun.file(ROSTER_URL).text()).advisors[0]?.kind ?? "";
const FIRST_BIN = directBinary(FIRST);

const SCRIPT = new URL("../agents/skills/consult/scripts/advisors-tmux.sh", import.meta.url)
  .pathname;

const FIXTURE = new URL("fixtures/pane-state", import.meta.url).pathname;

const FAKE_BIN = `#!/bin/sh
# PATH 上の偽 harness。open が直接 exec するので実バイナリが要る
exit 0
`;

// 呼び出し元の harness の印は持ち込まない
const CLEAN = {
  CLAUDECODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CURSOR_INVOKED_AS: undefined,
} as const;

const run = async (dir: string, argv: string[], script: string = SCRIPT) => {
  const proc = Bun.spawn(["sh", script, ...argv], {
    env: {
      ...process.env,
      ...CLEAN,
      PATH: `${dir}:/usr/bin:/bin`,
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

const ADVISORS = parseRoster(await Bun.file(ROSTER_URL).text()).advisors;

const setup = async (bins: readonly string[] = [FIRST_BIN]) => {
  const dir = await mkdtemp(join(tmpdir(), "advisors-tmux-"));
  await installFakeTmux(dir);
  for (const bin of bins) {
    await Bun.write(join(dir, bin), FAKE_BIN);
    await chmod(join(dir, bin), 0o755);
  }
  await symlink(process.execPath, join(dir, "bun"));
  await Bun.write(join(dir, "prompt"), "Review the diff.\n");
  await Bun.write(join(dir, "reply"), "Applied 1. Re-review.\n");
  return dir;
};

const allBins = (): string[] => [...new Set(ADVISORS.map((s) => directBinary(s.kind)))];

/**
 * 候補を指定した表で backend を動かす複製。実体 roster の枠数は運用値で、
 * 候補を何度も差し替える巡は枠数が足りないと書けない。
 *
 * 表は script の隣が SSOT なので、script ごと temp へ写して差し替える
 * （env で表の在処を切り替える口は作らない）。
 */
const setupWithAdvisors = async (kinds: readonly string[]) => {
  const dir = await setup([...new Set(kinds.map(directBinary))]);
  const scripts = join(dir, "scripts");
  // symlink の実体ごと写す（roster.toml / advisors.ts は shared への symlink）
  await Bun.spawn([
    "cp",
    "-RL",
    new URL("../agents/skills/consult/scripts", import.meta.url).pathname,
    scripts,
  ]).exited;
  const advisors = kinds.map((kind) => `[[advisors]]\nkind = "${kind}"\nargs = []\n`).join("\n");
  await Bun.write(
    join(scripts, "roster.toml"),
    `${advisors}\n[[workers]]\nkind = "grok"\nargs = ["--yolo"]\n`,
  );
  return { dir, script: join(scripts, "advisors-tmux.sh") };
};

// PATH の bun を、extract のときだけ落ちる shim に差し替える。
// extract は raw を読めれば落ちないので、入力からは起こせない
const breakExtract = async (dir: string) => {
  await rm(join(dir, "bun"), { force: true });
  await Bun.write(
    join(dir, "bun"),
    `#!/bin/sh
for a in "$@"; do
	[ "$a" = extract ] && exit 9
done
exec ${process.execPath} "$@"
`,
  );
  await chmod(join(dir, "bun"), 0o755);
};

const putCapacity = async (dir: string) => {
  const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
  expect(servers).toHaveLength(1);
  await Bun.write(join(dir, servers[0] ?? "", "screen"), Bun.file(`${FIXTURE}/codex-capacity.txt`));
};

const putCapacityOn = async (dir: string, session: string) => {
  await Bun.write(join(dir, `srv-${session}`, "screen"), Bun.file(`${FIXTURE}/codex-capacity.txt`));
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
    expect(first.stdout).toContain(`=== ${FIRST} 巡 1 (rc=0) ===`);
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
      stdout: `run: ${runDir}\nround: 2\nclosed: yes\n${FIRST}: 不明\nverify: fail\n`,
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
      `=== ${FIRST} start 失敗 ===\nFATAL\tsession が消えた（起動した harness が終了した）: c-${FIRST}-`,
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
    expect(started.stderr).toContain(
      `=== ${FIRST} start 失敗 ===\nFATAL\tログインが要る: ${FIRST_BIN}\n`,
    );
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
      stdout: `run: ${runDir}\nround: 1\nclosed: no\n${FIRST}: 修正推奨\nverify: fail\n`,
    });

    await Bun.write(join(dir, "verdict"), "判定: 指摘なし\n");
    expect((await run(dir, ["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    // 回収前は未終了
    const early = await run(dir, ["verify", runDir]);
    expect(early.exitCode).toBe(1);
    expect(early.stdout).toContain(`${FIRST}: 未回収`);
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    const pass = await run(dir, ["verify", runDir]);
    expect({ exitCode: pass.exitCode, stdout: pass.stdout }).toEqual({
      exitCode: 0,
      stdout: `run: ${runDir}\nround: 2\nclosed: no\n${FIRST}: 指摘なし\nverify: pass\n`,
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
    expect(started.stderr).toContain("貼り付けが入力欄に反映されない");
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

test("tmux backend: 貼り付け前に状態行が動いても、入力欄に反映されるまで Enter を送らない", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "status-flicker"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).stdout).toContain("answer 1");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: capacity 画面は deadline を待たず不通で終端する", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    await putCapacity(dir);
    const t0 = Date.now();
    const first = await run(dir, ["collect", runDir, "8"]);
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toContain("(rc=1 不通)");
    expect(await Bun.file(join(runDir, FIRST, "dead")).exists()).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

test("tmux backend: replace は dead を次の kind で起こし直す", async () => {
  const dir = await setup(allBins());
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "advisors"), "utf8")).toBe(`${FIRST}\n`);
    await putCapacity(dir);
    expect((await run(dir, ["collect", runDir, "8"])).exitCode).toBe(1);
    const replaced = await run(dir, ["replace", runDir]);
    expect(replaced.exitCode).toBe(0);
    const second = ADVISORS[1]?.kind ?? "";
    expect(second).not.toBe("");
    expect(await readFile(join(runDir, "advisors"), "utf8")).toContain(`${second}\n`);
    expect(await readFile(join(runDir, "tried"), "utf8")).toContain(`${FIRST}\n`);
    expect(await readFile(join(runDir, "tried"), "utf8")).toContain(`${second}\n`);
    expect(await Bun.file(join(runDir, second, "dead")).exists()).toBe(false);
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 2 巡目の replace は巡 1 から今の巡までを連結して送る", async () => {
  const dir = await setup(allBins());
  try {
    await Bun.write(
      join(dir, "prompt"),
      "The token ADVISOR-DONE- is a protocol marker.\nReview the diff.\n",
    );
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    expect((await run(dir, ["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    await putCapacity(dir);
    expect((await run(dir, ["collect", runDir, "8"])).exitCode).toBe(1);
    const replaced = await run(dir, ["replace", runDir]);
    expect(replaced.exitCode).toBe(0);
    const second = ADVISORS[1]?.kind ?? "";
    const rid = (await readFile(join(runDir, "rid"), "utf8")).trim();
    const pasted = await readFile(join(dir, `srv-c-${second}-${rid}`, "pasted"), "utf8");
    expect(pasted).toContain("## 巡 1 の依頼");
    expect(pasted).toContain("The token ADVISOR-DONE- is a protocol marker.");
    expect(pasted).toContain("Review the diff.");
    expect(pasted).toContain("## 巡 1 の応答");
    expect(pasted).toContain("answer 1");
    expect(pasted).toContain("## 巡 2 の依頼");
    expect(pasted).toContain("Applied 1. Re-review.");
    expect(pasted).not.toContain(`ADVISOR-DONE-${rid}-1`);
    expect(pasted).toContain(`ADVISOR-DONE-${rid}-2`);
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 2 回目の replace は rc=0 の応答を渡し dead でも落とさない", async () => {
  const [, second, third] = ["codex", "claude", "grok"] as const;
  const { dir, script } = await setupWithAdvisors(["codex", "claude", "grok"]);
  const call = (argv: string[]) => run(dir, argv, script);
  try {
    const started = await call(["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const rid = (await readFile(join(runDir, "rid"), "utf8")).trim();
    await putCapacity(dir);
    expect((await call(["collect", runDir, "8"])).exitCode).toBe(1);
    expect((await call(["replace", runDir])).exitCode).toBe(0);
    expect((await call(["collect", runDir, "5"])).exitCode).toBe(0);
    expect((await call(["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    await putCapacityOn(dir, `c-${second}-${rid}`);
    expect((await call(["collect", runDir, "8"])).exitCode).toBe(1);
    expect((await call(["replace", runDir])).exitCode).toBe(0);
    const pasted = await readFile(join(dir, `srv-c-${third}-${rid}`, "pasted"), "utf8");
    expect(pasted).toContain("## 巡 1 の応答");
    expect(pasted).toContain("answer 1");
    expect(pasted).not.toContain("Selected model is at capacity");
    expect((await call(["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 45_000);

test("tmux backend: replace は候補が尽きたら候補枯渇で止まる", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    await putCapacity(dir);
    expect((await run(dir, ["collect", runDir, "8"])).exitCode).toBe(1);
    const replaced = await run(dir, ["replace", runDir]);
    expect(replaced.exitCode).not.toBe(0);
    expect(`${replaced.stdout}${replaced.stderr}`).toContain("候補枯渇");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 15_000);

test("tmux backend: 入力欄が貼り付け前に戻ったら数え直し、続けて 2 回同じになってから Enter を 1 回送る", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "paste-flap"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).stdout).toContain("answer 1");
    const servers = (await readdir(dir)).filter((name) => name.startsWith("srv-"));
    expect(await readFile(join(dir, servers[0] ?? "", "enters"), "utf8")).toBe("enter\n");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

// 判定が読むのは切り出し済みの out.N だけ。切り出せなかった raw を rc=0 で渡すと、
// 入力欄より後ろに置かれた偽の判定行で verify を通せてしまう
test("tmux backend: extract が落ちた巡は判定に数えず verify を通さない", async () => {
  const dir = await setup();
  try {
    await breakExtract(dir);
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(1);
    expect(await readFile(join(runDir, FIRST, "rc.1"), "utf8")).toBe("1\n");
    const verified = await run(dir, ["verify", runDir]);
    expect(verified.exitCode).toBe(1);
    expect(verified.stdout).toContain("抽出失敗");
    expect(verified.stdout).toContain("verify: fail");
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
