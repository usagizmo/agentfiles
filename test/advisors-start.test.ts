import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

test.each([
  { errors: ["timeout"], starts: 1, sleeps: 0 },
  { errors: ["agent_pane_busy", "timeout"], starts: 2, sleeps: 1 },
])(
  "起動失敗 $errors は準備待ちだけ再試行する",
  async ({ errors, starts, sleeps }) => {
    const dir = await mkdtemp(join(tmpdir(), "advisors-start-"));
    try {
      await Bun.write(join(dir, "errors.json"), JSON.stringify(errors));
      await Bun.write(join(dir, "prompt"), "Review the files without changing them.\n");
      await Bun.write(
        join(dir, "herdr"),
        `#!/usr/bin/env python3
import json, pathlib, sys
root = pathlib.Path(__file__).parent
args = sys.argv[1:]
def count(name):
    path = root / name
    value = int(path.read_text()) + 1 if path.exists() else 1
    path.write_text(str(value))
    return value
if args[:2] == ['pane', 'current']:
    result = {'pane': {'agent': 'codex'}}
elif args[:2] == ['tab', 'create']:
    result = {'tab': {'tab_id': 'test-tab'}, 'root_pane': {'pane_id': 'test-left'}}
elif args[:2] == ['pane', 'split']:
    result = {'pane': {'pane_id': 'test-right'}}
elif args[:2] == ['agent', 'start']:
    kind = args[args.index('--kind') + 1]
    attempt = count(kind + '.starts')
    if kind == 'cursor':
        errors = json.loads((root / 'errors.json').read_text())
        code = errors[min(attempt - 1, len(errors) - 1)]
        print(json.dumps({'error': {'code': code}}), file=sys.stderr)
        sys.exit(1)
    result = {}
elif args[:2] == ['agent', 'prompt']:
    count(args[2].split('-')[1] + '.prompts')
    result = {}
elif args[:2] == ['agent', 'wait']:
    result = {}
else:
    raise SystemExit('Unexpected command: ' + repr(args))
print(json.dumps({'result': result}))
`,
      );
      await Bun.write(
        join(dir, "sleep"),
        `#!/usr/bin/env python3
import pathlib
path = pathlib.Path(__file__).parent / 'sleeps'
path.write_text(str(int(path.read_text()) + 1 if path.exists() else 1))
`,
      );
      await chmod(join(dir, "herdr"), 0o755);
      await chmod(join(dir, "sleep"), 0o755);
      const proc = Bun.spawn(
        [
          "sh",
          new URL("../agents/skills/consult/scripts/advisors.sh", import.meta.url).pathname,
          "start",
          join(dir, "prompt"),
        ],
        {
          env: {
            ...process.env,
            PATH: `${dir}:${process.env["PATH"]}`,
            TMPDIR: dir,
            HERDR_ENV: "1",
            HERDR_WORKSPACE_ID: "test-workspace",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const run = stdout.trim();
      expect(await readFile(join(run, "claude/start.rc"), "utf8")).toBe("0\n");
      expect(await readFile(join(run, "cursor/start.rc"), "utf8")).toBe("1\n");
      expect(await readFile(join(dir, "claude.prompts"), "utf8")).toBe("1");
      expect(await Bun.file(join(dir, "cursor.prompts")).exists()).toBe(false);
      expect(Number(await readFile(join(dir, "cursor.starts"), "utf8"))).toBe(starts);
      const sleepFile = Bun.file(join(dir, "sleeps"));
      expect((await sleepFile.exists()) ? Number(await sleepFile.text()) : 0).toBe(sleeps);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  15_000,
);
