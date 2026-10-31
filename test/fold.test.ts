import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FOLD = join(import.meta.dir, "../agents/skills/commit/scripts/fold.sh");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function env(): Record<string, string> {
  const e: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) e[k] = v;
  }
  return {
    ...e,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
}

function run(cwd: string, cmd: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(cmd, { cwd, env: env(), stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: `${p.stdout.toString()}${p.stderr.toString()}` };
}

function git(cwd: string, ...args: string[]): string {
  const r = run(cwd, ["git", "-c", "core.hooksPath=/dev/null", ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.out}`);
  return r.out.trim();
}

/** origin に 1 commit を push 済みの clone。 */
function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "fold-"));
  dirs.push(root);
  git(root, "init", "-q", "--bare", "-b", "main", "o.git");
  git(root, "init", "-q", "-b", "main", "r");
  const r = join(root, "r");
  git(r, "remote", "add", "origin", "../o.git");
  writeFileSync(join(r, "f"), "a\n");
  git(r, "add", "f");
  git(r, "commit", "-qm", "a");
  git(r, "push", "-q", "origin", "main");
  return r;
}

function commit(r: string, line: string, message: string): void {
  writeFileSync(join(r, "f"), `${readFileSync(join(r, "f"), "utf8")}${line}\n`);
  git(r, "commit", "-qam", message);
}

test("remote に無い commit と staged を、最も古い commit の message で 1 つに畳む", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  commit(r, "c", "c fix");
  writeFileSync(join(r, "f"), "a\nb\nc\nd\n");
  git(r, "add", "f");
  writeFileSync(join(r, "g"), "untracked\n");

  const res = run(r, ["bash", FOLD, "origin/main"]);
  expect(res.code).toBe(0);
  expect(git(r, "log", "--format=%s")).toBe("✨ b\na");
  expect(git(r, "show", "HEAD:f")).toBe("a\nb\nc\nd");
  expect(git(r, "status", "--porcelain")).toBe("?? g");
});

test("remote に在る commit は畳まない", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  git(r, "push", "-q", "origin", "main");
  const head = git(r, "rev-parse", "HEAD");

  const res = run(r, ["bash", FOLD, "HEAD~1"]);
  expect(res.code).toBe(1);
  expect(res.out).toContain("他の ref から到達できる");
  expect(git(r, "rev-parse", "HEAD")).toBe(head);
});

test("範囲に merge commit があれば畳まない", () => {
  const r = repo();
  git(r, "switch", "-qc", "side");
  commit(r, "s", "side");
  git(r, "switch", "-q", "main");
  writeFileSync(join(r, "h"), "h\n");
  git(r, "add", "h");
  git(r, "commit", "-qm", "main");
  git(r, "merge", "-q", "--no-edit", "side");
  const head = git(r, "rev-parse", "HEAD");

  const res = run(r, ["bash", FOLD, "origin/main"]);
  expect(res.code).toBe(1);
  expect(res.out).toContain("merge commit");
  expect(git(r, "rev-parse", "HEAD")).toBe(head);
});

test("commit が失敗したら HEAD を戻し、staged を保つ", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  const head = git(r, "rev-parse", "HEAD");
  writeFileSync(join(r, "f"), "a\nb\nc\n");
  git(r, "add", "f");
  const hooks = join(r, "..", "hooks");
  mkdirSync(hooks);
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
  git(r, "config", "core.hooksPath", hooks);

  const res = run(r, ["bash", FOLD, "origin/main"]);
  expect(res.code).toBe(1);
  expect(res.out).toContain("HEAD と staged を戻した");
  expect(git(r, "rev-parse", "HEAD")).toBe(head);
  expect(git(r, "diff", "--cached")).toContain("+c");
  expect(git(r, "diff", "--cached", "--name-only")).toBe("f");
});

test("hook が index を変えて commit に失敗しても、staged を元に戻す", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  writeFileSync(join(r, "f"), "a\nb\nc\n");
  git(r, "add", "f");
  const hooks = join(r, "..", "hooks");
  mkdirSync(hooks);
  writeFileSync(join(r, "n"), "new\n");
  git(r, "add", "--intent-to-add", "n");
  writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\necho x > junk && git add junk n\nexit 1\n");
  chmodSync(join(hooks, "pre-commit"), 0o755);
  git(r, "config", "core.hooksPath", hooks);

  expect(run(r, ["bash", FOLD, "origin/main"]).code).toBe(1);
  expect(git(r, "diff", "--cached", "--name-only")).toBe("f");
  // intent-to-add のまま戻れば、n の中身は staged でなく working tree 側の差分に出る。
  expect(git(r, "diff", "--", "n")).toContain("+new");
});

test("別の branch から到達できる commit は畳まない", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  git(r, "branch", "other");
  commit(r, "c", "c");
  const head = git(r, "rev-parse", "HEAD");

  const res = run(r, ["bash", FOLD, "origin/main"]);
  expect(res.code).toBe(1);
  expect(git(r, "rev-parse", "HEAD")).toBe(head);
  expect(run(r, ["bash", FOLD, "other"]).code).toBe(0);
  expect(git(r, "log", "--format=%s", "-1")).toBe("c");
});

test("checkpoint の namespace から到達できても、公開の証拠にしない", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  git(r, "update-ref", "refs/checkpoints/x", "HEAD");
  expect(run(r, ["bash", FOLD, "origin/main"]).code).toBe(0);
});

test("detached HEAD では畳まない", () => {
  const r = repo();
  commit(r, "b", "✨ b");
  git(r, "switch", "-q", "--detach");
  expect(run(r, ["bash", FOLD, "origin/main"]).out).toContain("detached HEAD");
});
