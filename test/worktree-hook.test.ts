// harnesses/claude/hooks/worktree.ts を scratch repo で直接呼ぶ。
// HOME と XDG_STATE_HOME を tmp に向け、実機の ~/claude-worktrees と記録を汚さない。origin は tmp の bare repo。

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../harnesses/claude/hooks/worktree.ts");

let tmp = "";

beforeEach(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "worktree-hook-")));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const env = () => {
  const e: { [key: string]: string } = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_")) e[k] = v;
  }
  return {
    ...e,
    HOME: join(tmp, "home"),
    XDG_STATE_HOME: join(tmp, "state"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.invalid",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.invalid",
  };
};

const sh = async (cwd: string, ...args: string[]) => {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { env: env(), stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (code !== 0) throw new Error(`git ${args.join(" ")}: ${err}`);
  return out.trim();
};

const hook = async (sub: string, input: object) => {
  const p = Bun.spawn(["bun", SCRIPT, sub], {
    env: env(),
    stdin: new Blob([JSON.stringify(input)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
};

// main checkout を作る。remote を付けると bare の origin に main を push する。
const repo = async (name: string, remote: boolean) => {
  const dir = join(tmp, "src", name);
  await Bun.write(join(dir, "README"), "x\n");
  await sh(dir, "init", "-q", "-b", "main");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-q", "-m", "init");
  if (remote) {
    const origin = join(tmp, "origin", `${name}.git`);
    await sh(tmp, "init", "-q", "--bare", "-b", "main", origin);
    await sh(dir, "remote", "add", "origin", origin);
    await sh(dir, "push", "-q", "origin", "main");
  }
  return dir;
};

const wtPath = (repoName: string, name: string) =>
  join(tmp, "home/claude-worktrees", repoName, name);
const records = () => {
  const dir = join(tmp, "state/agentfiles/claude-worktrees");
  return existsSync(dir) ? readdirSync(dir) : [];
};
const hasBranch = async (dir: string, branch: string) =>
  (await sh(dir, "branch", "--list", branch)) !== "";

const commitIn = async (dir: string, file: string) => {
  await Bun.write(join(dir, file), "y\n");
  await sh(dir, "add", "-A");
  await sh(dir, "commit", "-q", "-m", file);
};

test("create: 同じ name の 2 回目は同じ path を返し、stdout は path 1 行だけ", async () => {
  const dir = await repo("app", false);
  const first = await hook("create", { name: "x", cwd: dir });
  const second = await hook("create", { name: "x", cwd: dir });
  expect(first.code).toBe(0);
  expect(second.code).toBe(0);
  expect(first.stdout).toBe(`${wtPath("app", "x")}\n`);
  expect(second.stdout).toBe(first.stdout);
});

test("create: dir が消えた登録が残る path は再利用せず非 0", async () => {
  const dir = await repo("app", false);
  await hook("create", { name: "x", cwd: dir });
  await rm(wtPath("app", "x"), { recursive: true, force: true });
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(r.stdout).toBe("");
  expect(r.stderr).toContain("git worktree prune");
});

test("create: path が存在して未登録なら非 0", async () => {
  const dir = await repo("app", false);
  await Bun.write(join(wtPath("app", "x"), "stray"), "");
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(r.stdout).toBe("");
});

test("create: remote 無し repo は HEAD を base にする", async () => {
  const dir = await repo("app", false);
  await commitIn(dir, "second");
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).toBe(0);
  expect(await sh(wtPath("app", "x"), "rev-parse", "HEAD")).toBe(
    await sh(dir, "rev-parse", "HEAD"),
  );
  expect(await sh(wtPath("app", "x"), "branch", "--show-current")).toBe("worktree-x");
});

test("create: remote ありは origin の既定 branch を base にし、fetch 失敗は非 0", async () => {
  const dir = await repo("app", true);
  await commitIn(dir, "local-only");
  const ok = await hook("create", { name: "x", cwd: dir });
  expect(ok.code).toBe(0);
  expect(await sh(wtPath("app", "x"), "rev-parse", "HEAD")).toBe(
    await sh(dir, "rev-parse", "origin/main"),
  );

  await rm(join(tmp, "origin"), { recursive: true, force: true });
  const ng = await hook("create", { name: "y", cwd: dir });
  expect(ng.code).not.toBe(0);
  expect(existsSync(wtPath("app", "y"))).toBe(false);
});

test("create: 同名の branch が既にあれば非 0 で、その branch を消さない", async () => {
  const dir = await repo("app", false);
  await sh(dir, "branch", "worktree-x");
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(r.stdout).toBe("");
  expect(await hasBranch(dir, "worktree-x")).toBe(true);
  expect(existsSync(wtPath("app", "x"))).toBe(false);
});

test("create: name が 1 段の dir 名でなければ非 0 で、root の外に何も作らない", async () => {
  const dir = await repo("app", false);
  for (const name of ["../escape", "a/b", ".."]) {
    const r = await hook("create", { name, cwd: dir });
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe("");
  }
  expect(existsSync(join(tmp, "home/claude-worktrees/escape"))).toBe(false);
  expect(await sh(dir, "branch", "--list", "worktree-*")).toBe("");
});

test("create: remote はあるが origin が無ければ非 0", async () => {
  const dir = await repo("app", false);
  await sh(dir, "remote", "add", "upstream", join(tmp, "nowhere.git"));
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(r.stderr).toContain("origin が無い");
  expect(existsSync(wtPath("app", "x"))).toBe(false);
  expect(await hasBranch(dir, "worktree-x")).toBe(false);
});

test("create: 記録を書けなければ非 0 で、path も branch も残らない", async () => {
  const dir = await repo("app", false);
  // state の置き場をファイルで塞ぎ、記録の mkdir を落とす。
  await Bun.write(join(tmp, "state/agentfiles"), "");
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(existsSync(wtPath("app", "x"))).toBe(false);
  expect(await hasBranch(dir, "worktree-x")).toBe(false);
});

test("create: post-checkout が非 0 なら非 0 で、path も branch も記録も残らない", async () => {
  const dir = await repo("app", false);
  const hooks = join(tmp, "githooks");
  await Bun.write(join(hooks, "post-checkout"), "#!/bin/sh\nexit 1\n");
  await Bun.spawn(["chmod", "+x", join(hooks, "post-checkout")]).exited;
  await sh(dir, "config", "core.hooksPath", hooks);
  const r = await hook("create", { name: "x", cwd: dir });
  expect(r.code).not.toBe(0);
  expect(existsSync(wtPath("app", "x"))).toBe(false);
  expect(await hasBranch(dir, "worktree-x")).toBe(false);
  expect(records()).toEqual([]);
});

test("create: 同時 5 本起動で全件成功し、name ごとに path と branch が 1 本。post-checkout は直列にならない", async () => {
  const dir = await repo("app", true);
  const hooks = join(tmp, "githooks");
  await Bun.write(join(hooks, "post-checkout"), "#!/bin/sh\nsleep 2\n");
  await Bun.spawn(["chmod", "+x", join(hooks, "post-checkout")]).exited;
  await sh(dir, "config", "core.hooksPath", hooks);
  const started = Date.now();
  const names = ["a", "b", "c", "d", "e"];
  const rs = await Promise.all(names.map((name) => hook("create", { name, cwd: dir })));
  expect(rs.map((r) => r.code)).toEqual([0, 0, 0, 0, 0]);
  expect(rs.map((r) => r.stdout)).toEqual(names.map((n) => `${wtPath("app", n)}\n`));
  for (const n of names) expect(await hasBranch(dir, `worktree-${n}`)).toBe(true);
  expect(records().length).toBe(5);
  // 直列なら 5 本 × 2 秒を下回らない。
  expect(Date.now() - started).toBeLessThan(8000);
});

test("remove: 変更ゼロと origin で merge 済みは branch が消え、未 merge は残る", async () => {
  const dir = await repo("app", true);
  for (const n of ["zero", "merged", "open"]) await hook("create", { name: n, cwd: dir });
  await commitIn(wtPath("app", "merged"), "m");
  await sh(wtPath("app", "merged"), "push", "-q", "origin", "worktree-merged:main");
  await commitIn(wtPath("app", "open"), "o");

  for (const n of ["zero", "merged", "open"]) {
    expect((await hook("remove", { worktree_path: wtPath("app", n) })).code).toBe(0);
    expect(existsSync(wtPath("app", n))).toBe(false);
  }
  expect(await hasBranch(dir, "worktree-zero")).toBe(false);
  expect(await hasBranch(dir, "worktree-merged")).toBe(false);
  expect(await hasBranch(dir, "worktree-open")).toBe(true);
  expect(records()).toEqual([]);
});

test("remove: 2 つの repo の同名 foo を remove しても判定が混ざらない", async () => {
  const one = await repo("one", true);
  const two = await repo("two", true);
  await hook("create", { name: "foo", cwd: one });
  await hook("create", { name: "foo", cwd: two });
  await commitIn(wtPath("two", "foo"), "t");

  expect((await hook("remove", { worktree_path: wtPath("one", "foo") })).code).toBe(0);
  expect(await hasBranch(one, "worktree-foo")).toBe(false);
  expect(existsSync(wtPath("two", "foo"))).toBe(true);

  expect((await hook("remove", { worktree_path: wtPath("two", "foo") })).code).toBe(0);
  expect(await hasBranch(two, "worktree-foo")).toBe(true);
});

test("remove: 手で消して同じ path に別 branch で作り直した worktree は消さない", async () => {
  const dir = await repo("app", false);
  await hook("create", { name: "x", cwd: dir });
  await sh(dir, "worktree", "remove", "--force", wtPath("app", "x"));
  await sh(dir, "worktree", "add", "-q", "-b", "other", wtPath("app", "x"));

  expect((await hook("remove", { worktree_path: wtPath("app", "x") })).code).toBe(0);
  expect(existsSync(wtPath("app", "x"))).toBe(true);
  expect(await hasBranch(dir, "other")).toBe(true);
  expect(records()).toEqual([]);
});

test("remove: hook が作っていない worktree を再利用しても、remove は worktree と branch に触らない", async () => {
  const dir = await repo("app", true);
  await sh(dir, "worktree", "add", "-q", "-b", "mine", wtPath("app", "x"));
  await sh(dir, "push", "-q", "origin", "mine:main");
  await Bun.write(join(wtPath("app", "x"), "wip"), "w\n");

  const c = await hook("create", { name: "x", cwd: dir });
  expect(c.stdout).toBe(`${wtPath("app", "x")}\n`);
  expect(records()).toEqual([]);
  expect((await hook("remove", { worktree_path: wtPath("app", "x") })).code).toBe(0);
  expect(existsSync(join(wtPath("app", "x"), "wip"))).toBe(true);
  expect(await hasBranch(dir, "mine")).toBe(true);
});

test("subagent-stop: 変更なしは回収し、変更ありは残す。cwd は repo 外でも別 worktree でも判定に使わない", async () => {
  const dir = await repo("app", false);
  for (const n of ["agent-clean", "agent-dirty", "agent-ahead"]) {
    await hook("create", { name: n, cwd: dir });
  }
  await Bun.write(join(wtPath("app", "agent-dirty"), "new"), "z\n");
  await commitIn(wtPath("app", "agent-ahead"), "a");

  // 変更ありの subagent が変更なしの別 worktree に cd していても、そちらを消さない。
  const cdOther = await hook("subagent-stop", {
    agent_id: "dirty",
    cwd: wtPath("app", "agent-clean"),
  });
  expect(cdOther.code).toBe(0);
  expect(existsSync(wtPath("app", "agent-clean"))).toBe(true);
  expect(existsSync(wtPath("app", "agent-dirty"))).toBe(true);

  expect((await hook("subagent-stop", { agent_id: "ahead", cwd: tmp })).code).toBe(0);
  expect(existsSync(wtPath("app", "agent-ahead"))).toBe(true);
  expect(await hasBranch(dir, "worktree-agent-ahead")).toBe(true);

  // cwd が repo 外でも記録から引いて回収する。
  expect((await hook("subagent-stop", { agent_id: "clean", cwd: tmp })).code).toBe(0);
  expect(existsSync(wtPath("app", "agent-clean"))).toBe(false);
  expect(await hasBranch(dir, "worktree-agent-clean")).toBe(false);
  expect(records().length).toBe(2);

  const unknown = await hook("subagent-stop", { agent_id: "none", cwd: tmp });
  expect(unknown).toEqual({ stdout: "", stderr: "", code: 0 });
  expect((await hook("subagent-stop", {})).code).toBe(0);
});
