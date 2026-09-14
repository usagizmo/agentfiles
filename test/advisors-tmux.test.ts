// advisors-tmux.sh の巡（start → collect → ask → collect → close）。
// tmux / claude / codex は偽物。paste で marker を画面へ積む。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/consult/scripts/advisors-tmux.sh", import.meta.url)
  .pathname;

const FAKE_TMUX = `#!/usr/bin/env python3
import pathlib, re, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
if args[:1] == ["-L"]:
    args = args[2:]

def session_dir(name: str) -> pathlib.Path:
    d = root / ("sess-" + name)
    d.mkdir(exist_ok=True)
    return d

def target_session(token: str) -> str:
    # -t =name / -t %pane-id
    t = token[1:] if token[:1] in ("=", "%") else token
    return t.split(":", 1)[0]

if not args:
    raise SystemExit("tmux: no args")

if args[0] == "list-panes":
    # 本物は pane id を返す。固定 target へ戻す回帰を落とす
    sys.stdout.write("%" + target_session(args[args.index("-t") + 1]) + "\\n")
    raise SystemExit(0)

if args[0] == "has-session":
    name = target_session(args[args.index("-t") + 1])
    raise SystemExit(0 if (root / ("sess-" + name)).exists() else 1)

if args[0] == "new-session":
    name = args[args.index("-s") + 1]
    # die: 起動した harness が即座に終了し、session が残らない
    if (root / "die").exists():
        raise SystemExit(0)
    d = session_dir(name)
    (d / "screen").write_text("❯ \\n")
    raise SystemExit(0)

if args[0] == "send-keys":
    raise SystemExit(0)

if args[0] == "load-buffer":
    b = args[args.index("-b") + 1]
    path = args[-1]
    (root / ("buf-" + b)).write_text(pathlib.Path(path).read_text())
    raise SystemExit(0)

if args[0] == "paste-buffer":
    # -p / -d は本番と同じく受け取る（無視）
    b = args[args.index("-b") + 1]
    name = target_session(args[args.index("-t") + 1])
    d = session_dir(name)
    prompt_path = (root / ("buf-" + b)).read_text()
    # load-buffer は file 内容を入れた。advisors-tmux は file パスではなく内容を load する
    text = prompt_path
    marker_m = re.search(r"(ADVISOR-DONE-[a-z0-9]+-\\d+)", text)
    marker = marker_m.group(1) if marker_m else "NO-MARKER"
    n = int((d / "prompts").read_text()) + 1 if (d / "prompts").exists() else 1
    (d / "prompts").write_text(str(n))
    prev = (d / "screen").read_text() if (d / "screen").exists() else ""
    verdict = (root / "verdict").read_text() if (root / "verdict").exists() else ""
    line = "answer %d\\n%s%s\\n❯ \\n" % (n, verdict, marker)
    (d / "screen").write_text(prev + line)
    raise SystemExit(0)

if args[0] == "delete-buffer":
    raise SystemExit(0)

if args[0] == "capture-pane":
    name = target_session(args[args.index("-t") + 1])
    d = session_dir(name)
    sys.stdout.write((d / "screen").read_text() if (d / "screen").exists() else "")
    raise SystemExit(0)

if args[0] == "kill-session":
    name = target_session(args[args.index("-t") + 1])
    d = root / ("sess-" + name)
    if d.exists():
        for p in d.iterdir():
            p.unlink()
        d.rmdir()
        bump = root / "kills"
        bump.write_text(str(int(bump.read_text()) + 1 if bump.exists() else 1))
    raise SystemExit(0)

raise SystemExit("Unexpected tmux: " + repr(args))
`;

const FAKE_BIN = `#!/bin/sh
# PATH 上の偽 claude / 偽 codex。create が直接 exec するので実バイナリが要る
exit 0
`;

// 呼び出し元の env（自分の印・自己 kind）は持ち込まない。持ち込むと観測と申告が食い違う
const CLEAN = {
  CLAUDECODE: undefined,
  CLAUDE_CODE_ENTRYPOINT: undefined,
  CURSOR_INVOKED_AS: undefined,
  CONSULT_SELF_KIND: undefined,
} as const;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      ...CLEAN,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
      CONSULT_SELF_KIND: "cursor",
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
  await Bun.write(join(dir, "tmux"), FAKE_TMUX);
  await Bun.write(join(dir, "claude"), FAKE_BIN);
  await Bun.write(join(dir, "codex"), FAKE_BIN);
  await Bun.write(join(dir, "prompt"), "Review the diff.\n");
  await Bun.write(join(dir, "reply"), "Applied 1. Re-review.\n");
  await chmod(join(dir, "tmux"), 0o755);
  await chmod(join(dir, "claude"), 0o755);
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
    expect(first.stdout).toContain("=== claude 巡 1 (rc=0) ===");
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
    const after = await run(dir, ["collect", runDir, "5"]);
    expect(after.exitCode).toBe(2);
    expect(after.stderr).toContain("close 済み");

    // 判定行の無い巡は証跡にならない。close 済みでも読める
    const unverified = await run(dir, ["verify", runDir]);
    expect({ exitCode: unverified.exitCode, stdout: unverified.stdout }).toEqual({
      exitCode: 1,
      stdout: `run: ${runDir}\nround: 2\nclosed: yes\nclaude: 不明\ncodex: 不明\nverify: fail\n`,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: 1 つも起こせなければ各 agent の log 末尾を出す", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "die"), "");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(2);
    expect(started.stderr).toContain("=== claude start 失敗 ===\nFATAL\tsession が無い: c-claude-");
    expect(started.stderr).toContain("wait-ready に失敗（TUI 未準備）\n=== codex start 失敗 ===");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: verify は今の巡の全員が「指摘なし」のときだけ通る", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "verdict"), "判定: 修正推奨\n");
    const runDir = (await run(dir, ["start", join(dir, "prompt")])).stdout.trim();
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    const fix = await run(dir, ["verify", runDir]);
    expect({ exitCode: fix.exitCode, stdout: fix.stdout }).toEqual({
      exitCode: 1,
      stdout: `run: ${runDir}\nround: 1\nclosed: no\nclaude: 修正推奨\ncodex: 修正推奨\nverify: fail\n`,
    });

    await Bun.write(join(dir, "verdict"), "判定: 指摘なし\n");
    expect((await run(dir, ["ask", runDir, join(dir, "reply")])).exitCode).toBe(0);
    // 回収前は未終了
    const early = await run(dir, ["verify", runDir]);
    expect(early.exitCode).toBe(1);
    expect(early.stdout).toContain("claude: 未回収");
    expect((await run(dir, ["collect", runDir, "5"])).exitCode).toBe(0);
    const pass = await run(dir, ["verify", runDir]);
    expect({ exitCode: pass.exitCode, stdout: pass.stdout }).toEqual({
      exitCode: 0,
      stdout: `run: ${runDir}\nround: 2\nclosed: no\nclaude: 指摘なし\ncodex: 指摘なし\nverify: pass\n`,
    });
    expect((await run(dir, ["close", runDir])).exitCode).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("tmux backend: CONSULT_SELF_KIND 無しは start できない", async () => {
  const dir = await setup();
  try {
    const proc = Bun.spawn(["sh", SCRIPT, "start", join(dir, "prompt")], {
      env: { ...process.env, ...CLEAN, PATH: `${dir}:${process.env["PATH"]}`, TMPDIR: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(2);
    expect(stderr).toContain("CONSULT_SELF_KIND が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tmux backend: env の印と食い違う自己 kind は start できない", async () => {
  const dir = await setup();
  try {
    const proc = Bun.spawn(["sh", SCRIPT, "start", join(dir, "prompt")], {
      env: {
        ...process.env,
        ...CLEAN,
        PATH: `${dir}:${process.env["PATH"]}`,
        TMPDIR: dir,
        CLAUDECODE: "1",
        CONSULT_SELF_KIND: "cursor",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(2);
    expect(stderr).toContain("申告 cursor / 観測 claude");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
