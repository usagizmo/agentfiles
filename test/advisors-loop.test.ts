// advisors.sh の巡（start → collect → ask → collect → close）。
// herdr は偽物で、prompt で受けた marker を画面へ積む。画面は巡をまたいで残る。

import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const SCRIPT = new URL("../agents/skills/consult/scripts/advisors.sh", import.meta.url).pathname;

const FAKE_HERDR = `#!/usr/bin/env python3
import json, pathlib, re, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
def bump(name):
    path = root / name
    value = int(path.read_text()) + 1 if path.exists() else 1
    path.write_text(str(value))
    return value
status = (root / 'status').read_text().strip() if (root / 'status').exists() else 'idle'
if args[:2] == ['pane', 'current']:
    result = {'pane': {'agent': 'codex'}}
elif args[:2] == ['tab', 'create']:
    result = {'tab': {'tab_id': 'test-tab'}, 'root_pane': {'pane_id': 'test-left'}}
elif args[:2] == ['tab', 'close']:
    bump('tab.closes')
    result = {}
elif args[:2] == ['pane', 'split']:
    result = {'pane': {'pane_id': 'test-right'}}
elif args[:2] == ['agent', 'start']:
    kind = args[args.index('--kind') + 1]
    if kind == 'grok':
        print(json.dumps({'error': {'code': 'timeout'}}), file=sys.stderr)
        sys.exit(1)
    result = {}
elif args[:2] == ['agent', 'prompt']:
    kind = args[2].split('-')[1]
    n = bump(kind + '.prompts')
    prompt_path = args[3].strip().splitlines()[-1]
    marker = re.search(r'(ADVISOR-DONE-[a-z0-9]+-\\d+)', pathlib.Path(prompt_path).read_text()).group(1)
    screen = root / (kind + '.screen')
    prev = screen.read_text() if screen.exists() else ''
    line = 'answer %d' % n if status == 'idle' else 'waiting for approval'
    tail = ('\\n' + marker + '\\n') if status == 'idle' else '\\n'
    screen.write_text(prev + line + tail)
    result = {}
elif args[:2] == ['agent', 'wait']:
    if '--until' in args and args[args.index('--until') + 1] == 'working' and len(args) < 8:
        print(json.dumps({'error': {'code': 'timeout'}}), file=sys.stderr)
        sys.exit(1)
    result = {'agent': {'agent_status': status}}
elif args[:2] == ['agent', 'read']:
    kind = args[2].split('-')[1]
    screen = root / (kind + '.screen')
    sys.stdout.write(screen.read_text() if screen.exists() else '')
    sys.exit(0)
else:
    raise SystemExit('Unexpected command: ' + repr(args))
print(json.dumps({'result': result}))
`;

const run = async (dir: string, argv: string[]) => {
  const proc = Bun.spawn(["sh", SCRIPT, ...argv], {
    env: {
      ...process.env,
      PATH: `${dir}:${process.env["PATH"]}`,
      TMPDIR: dir,
      HERDR_ENV: "1",
      HERDR_WORKSPACE_ID: "test-workspace",
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
  const dir = await mkdtemp(join(tmpdir(), "advisors-loop-"));
  await Bun.write(join(dir, "herdr"), FAKE_HERDR);
  await Bun.write(join(dir, "prompt"), "Review the diff.\n");
  await Bun.write(join(dir, "reply"), "Applied 1, rejected 2. Re-review.\n");
  await chmod(join(dir, "herdr"), 0o755);
  return dir;
};

test("巡をまたいで同じ agent に送り、出力は今の巡だけを返す", async () => {
  const dir = await setup();
  try {
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect({ exitCode: started.exitCode, stderr: started.stderr }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const runDir = started.stdout.trim();
    expect(await readFile(join(runDir, "round"), "utf8")).toBe("1\n");

    const tooEarly = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect(tooEarly.exitCode).toBe(2);
    expect(tooEarly.stderr).toContain("未回収");

    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("=== claude 巡 1 (rc=0) ===");
    expect(first.stdout).toContain("=== grok 巡 1 (rc=1 不在) ===");
    expect(await readFile(join(runDir, "claude/out.1"), "utf8")).toContain("answer 1");

    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect({ exitCode: asked.exitCode, stdout: asked.stdout }).toEqual({
      exitCode: 0,
      stdout: "2\n",
    });
    expect(await readFile(join(dir, "claude.prompts"), "utf8")).toBe("2");
    expect(await Bun.file(join(dir, "grok.prompts")).exists()).toBe(false);

    const second = await run(dir, ["collect", runDir, "5"]);
    expect(second.exitCode).toBe(0);
    const out2 = await readFile(join(runDir, "claude/out.2"), "utf8");
    expect(out2).toContain("answer 2");
    expect(out2).not.toContain("answer 1");
    expect(await Bun.file(join(dir, "tab.closes")).exists()).toBe(false);

    const closed = await run(dir, ["close", runDir]);
    expect(closed.exitCode).toBe(0);
    expect(await readFile(join(dir, "tab.closes"), "utf8")).toBe("1");
    const afterClose = await run(dir, ["collect", runDir, "5"]);
    expect(afterClose.exitCode).toBe(2);
    expect(afterClose.stderr).toContain("close 済み");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);

test("blocked はその巡で終端し、次の巡へ送らない", async () => {
  const dir = await setup();
  try {
    await Bun.write(join(dir, "status"), "blocked\n");
    const started = await run(dir, ["start", join(dir, "prompt")]);
    expect(started.exitCode).toBe(0);
    const runDir = started.stdout.trim();
    const first = await run(dir, ["collect", runDir, "5"]);
    expect(first.exitCode).toBe(1);
    expect(first.stdout).toContain("=== claude 巡 1 (rc=1 blocked) ===");
    expect(await Bun.file(join(runDir, "claude/dead")).exists()).toBe(true);
    const asked = await run(dir, ["ask", runDir, join(dir, "reply")]);
    expect(asked.exitCode).toBe(2);
    expect(asked.stderr).toContain("生きている advisor が無い");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
