// audit-skills.sh の統合 smoke test。強調の判定そのものは check-emphasis.test.ts。
//
// ここで押さえるのは **sh 側の配線**: 検出が VIOLATION として出るか、道具が無いときに
// 黙らず SKIP を出すか、SUMMARY が数を持つか。**「違反 0」と「検査していない」を
// 取り違えると gate が素通りする**ので、そこを実際に走らせて確かめる。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const AUDIT = `${ROOT}agents/skills/docs/scripts/audit-skills.sh`;
const fixture = (name: string) => `${ROOT}test/fixtures/${name}`;

type Env = Record<string, string | undefined>;

function withoutGitEnv(base: Env = process.env): Env {
  const env: Env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  return env;
}

function isolatedGitEnv(base: Env = process.env): Env {
  return {
    ...withoutGitEnv(base),
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
}

async function audit(root: string, env: Env = {}, args: string[] = []) {
  const p = Bun.spawn(["sh", AUDIT, root, ...args], {
    cwd: ROOT,
    env: isolatedGitEnv({ ...process.env, ...env }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("壊れた強調を VIOLATION emphasis として出す", async () => {
  const { stdout, exitCode } = await audit(fixture("emphasis-broken"));
  expect(stdout).toContain("VIOLATION\temphasis");
  expect(stdout).toContain("sample/SKILL.md:");
  expect(exitCode).toBe(1);
});

test("壊れていなければ emphasis の VIOLATION は出ない", async () => {
  const { stdout } = await audit(fixture("emphasis-clean"));
  expect(stdout).not.toContain("VIOLATION\temphasis");
});

test("SUMMARY は violations / reviews / skips を持つ", async () => {
  const { stdout } = await audit(fixture("emphasis-clean"));
  const line = stdout.split("\n").find((l) => l.startsWith("SUMMARY"));
  expect(line).toBeDefined();
  expect(line).toMatch(/violations=\d+\treviews=\d+\tskips=\d+$/);
});

test("bun が無ければ黙らず SKIP を出す", async () => {
  // PATH を絞って bun だけ落とす（sh / awk / grep は残す）
  const { stdout } = await audit(fixture("emphasis-broken"), { PATH: "/usr/bin:/bin" });
  expect(stdout).toContain("SKIP\temphasis");
  expect(stdout).toMatch(/skips=[1-9]/);
});

test("skills root が無ければ検査せずに落ちる（緑に見せない）", async () => {
  const { stdout, exitCode } = await audit(fixture("does-not-exist"));
  expect(stdout).not.toContain("SUMMARY");
  expect(exitCode).toBe(2);
});

// --- sibling: shared が bare 名で挙げる兄弟 -------------------------------
// fixture は 2 skill が同じ shared を張り、辞書順で後ろの skill だけ兄弟を張っていない木。
// **代表 1 件へ畳んだ一覧を回す実装では violations=0 で通る。**

test("兄弟を張り忘れた skill を VIOLATION sibling として出す", async () => {
  const { stdout, exitCode } = await audit(fixture("sibling-missing/skills"));
  expect(stdout).toContain("VIOLATION\tsibling\tzzz/references/alpha.md\tsibling=beta.md");
  expect(exitCode).toBe(1);
});

test("兄弟を張っている skill は sibling に出ない", async () => {
  const { stdout } = await audit(fixture("sibling-missing/skills"));
  // 検査が走らなくても not.toContain は通るので、同じ実行に positive anchor を置く
  expect(stdout).toContain("VIOLATION\tsibling\tzzz/references/alpha.md");
  expect(stdout).not.toContain("sibling\taaa/references/alpha.md");
});

// 引用元が `shared/queue/` か universal かで直す先が変わる。3 分岐すべてを踏む。
test("queue の兄弟は member なら VIOLATION、非 member なら REVIEW", async () => {
  const { stdout } = await audit(fixture("sibling-queue/skills"));
  expect(stdout).toContain("VIOLATION\tsibling\tconductor/references/host.md\tsibling=qq.md");
  expect(stdout).toContain("REVIEW\tsibling\taaa/references/host.md\tsibling=qq.md");
});

test("universal shared が queue の兄弟を挙げたら member でも REVIEW", async () => {
  const { stdout } = await audit(fixture("sibling-queue/skills"));
  expect(stdout).toContain("REVIEW\tsibling\tconductor/references/uni.md\tsibling=qq.md");
  expect(stdout).toContain("REVIEW\tsibling\taaa/references/uni.md\tsibling=qq.md");
});

// --- fence / 引用 --------------------------------------------------------
// fixture は fence（入れ子つき）と引用の中に skill 名・.md・節見出しを置き、
// **どちらの外にも行番号つきで検出できる違反を 1 件ずつ**置いた木。
// 正例は行番号の保存と入れ子 fence の開閉を、負例は 4 検査の無視を押さえる。

test("fence と引用の中は layer / ref / ref-heading / sibling に出ない", async () => {
  const { stdout, exitCode } = await audit(fixture("fence-quote/skills"));
  expect(stdout).toContain("VIOLATION\tref\taaa/SKILL.md:17\tmissing=missing/gone.md");
  expect(stdout).toContain("VIOLATION\tref\taaa/references/host.md:14\tmissing=nope/none.md");
  expect(stdout).not.toContain("VIOLATION\tlayer");
  expect(stdout).not.toContain("VIOLATION\tref-heading");
  expect(stdout).not.toContain("VIOLATION\tsibling");
  expect(stdout).not.toContain("REVIEW\tref");
  expect(exitCode).toBe(1);
});

// --- checker の異常系（EMPHASIS_TS で差し替える） -------------------------
// **「落ちた」と「違反なし」を取り違えないこと**が要点。緑で通ると検査が消える。

const checker = (name: string): Env => ({ EMPHASIS_TS: `${ROOT}test/fixtures/checker/${name}.ts` });

test("checker が出力なしで失敗したら audit ごと落ちる", async () => {
  const { stdout, exitCode } = await audit(fixture("emphasis-clean"), checker("silent-fail"));
  expect(exitCode).toBe(2);
  expect(stdout).not.toContain("SUMMARY");
});

test("契約に無い exit code でも audit ごと落ちる", async () => {
  const { stdout, exitCode } = await audit(fixture("emphasis-clean"), checker("unexpected-code"));
  expect(exitCode).toBe(2);
  expect(stdout).not.toContain("SUMMARY");
});

test("依存が無い（exit 2）は SKIP として通す", async () => {
  const { stdout } = await audit(fixture("emphasis-clean"), checker("no-dep"));
  expect(stdout).toContain("SKIP\temphasis");
  expect(stdout).toMatch(/skips=[1-9]/);
});

// --- owned: gitignore された skill を棚卸しから外す ----------------------
// 祖先の .git を拾わないよう、独立した git repo を /tmp に作る。

const derivedViolations = (stdout: string) =>
  stdout
    .split("\n")
    .filter((l: string) => l.startsWith("VIOLATION\tderived"))
    .sort();

async function git(args: string[], cwd: string) {
  const p = Bun.spawn(["git", ...args], {
    cwd,
    env: isolatedGitEnv(),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${stderr || stdout}`);
  }
  return stdout;
}

function writeLayerReadme(dir: string, skills: string[]) {
  const cells = skills.map((s: string) => `\`${s}\``).join(" ");
  writeFileSync(
    join(dir, "agents/docs/README.md"),
    `# docs\n\n## 層構造\n\n| 層 | skills |\n| --- | --- |\n| leaf | ${cells} |\n\n## 次\n`,
  );
}

function writeSkill(dir: string, name: string) {
  mkdirSync(join(dir, "agents/skills", name), { recursive: true });
  writeFileSync(join(dir, "agents/skills", name, "SKILL.md"), `# ${name}\n`);
}

async function ownedRepo({ table, extras = [] }: { table: string[]; extras?: string[] }) {
  const dir = mkdtempSync(join(tmpdir(), "audit-owned-"));
  mkdirSync(join(dir, "agents/docs"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "/agents/skills/ghost/\n");
  writeSkill(dir, "owned");
  writeLayerReadme(dir, table);
  for (const name of extras) writeSkill(dir, name);
  await git(["init"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "test"], dir);
  await git(["add", ".gitignore", "agents/skills/owned", "agents/docs/README.md"], dir);
  await git(["commit", "-m", "init"], dir);
  return dir;
}

test("gitignore された skill の有無で derived の VIOLATION が変わらない", async () => {
  const absent = await ownedRepo({ table: ["owned"] });
  const present = await ownedRepo({ table: ["owned"], extras: ["ghost"] });
  try {
    const a = await audit(join(absent, "agents/skills"));
    const b = await audit(join(present, "agents/skills"));
    expect(derivedViolations(a.stdout)).toEqual(derivedViolations(b.stdout));
    expect(derivedViolations(b.stdout)).toEqual([]);
  } finally {
    rmSync(absent, { recursive: true, force: true });
    rmSync(present, { recursive: true, force: true });
  }
});

test("gitignore された名前を層表に戻すと derived が落ちる", async () => {
  const dir = await ownedRepo({ table: ["owned", "ghost"], extras: ["ghost"] });
  try {
    const { stdout, exitCode } = await audit(join(dir, "agents/skills"));
    expect(stdout).toContain(
      "VIOLATION\tderived\tdocs/README.md\tnote=層構造の ghost を所有していない",
    );
    expect(exitCode).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// characterization: 層表と所有 skill の双方向。所有フィルタを外しても同じ入力で落ちる
test("tracked な skill が層表に無いと derived が落ちる", async () => {
  const dir = await ownedRepo({ table: [] });
  try {
    const { stdout, exitCode } = await audit(join(dir, "agents/skills"));
    expect(stdout).toContain(
      "VIOLATION\tderived\tdocs/README.md\tnote=skill owned が層構造の節に無い",
    );
    expect(exitCode).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// characterization: 層表と所有 skill の双方向。所有フィルタを外しても同じ入力で落ちる
test("層表の余分なエントリは derived が落ちる", async () => {
  const dir = await ownedRepo({ table: ["owned", "extra"] });
  try {
    const { stdout, exitCode } = await audit(join(dir, "agents/skills"));
    expect(stdout).toContain(
      "VIOLATION\tderived\tdocs/README.md\tnote=層構造の extra を所有していない",
    );
    expect(exitCode).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gitignore された skill の shared コピーは VIOLATION に出ない", async () => {
  const dir = await ownedRepo({ table: ["owned"], extras: ["ghost"] });
  try {
    mkdirSync(join(dir, "agents/shared"), { recursive: true });
    writeFileSync(join(dir, "agents/shared/host.md"), "# host\n");
    mkdirSync(join(dir, "agents/skills/ghost/references"), { recursive: true });
    writeFileSync(join(dir, "agents/skills/ghost/references/host.md"), "# copy\n");
    const { stdout } = await audit(join(dir, "agents/skills"));
    expect(stdout).not.toContain("VIOLATION\tshared\tghost/");
    expect(derivedViolations(stdout)).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repo が無いときは所有判定を SKIP する", async () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-norepo-"));
  try {
    writeSkill(dir, "owned");
    mkdirSync(join(dir, "agents/docs"), { recursive: true });
    writeLayerReadme(dir, ["owned"]);
    const { stdout } = await audit(join(dir, "agents/skills"));
    expect(stdout).toContain("SKIP\towned");
    expect(stdout).toMatch(/skips=[1-9]/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repo が無いときは所有判定不能として成功終了しない", async () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-norepo-fail-"));
  try {
    writeSkill(dir, "owned");
    mkdirSync(join(dir, "agents/docs"), { recursive: true });
    writeLayerReadme(dir, ["owned"]);
    const { stdout, exitCode } = await audit(join(dir, "agents/skills"));
    expect(stdout).toContain("SKIP\towned");
    expect(exitCode).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const refLines = (stdout: string) =>
  stdout
    .split("\n")
    .filter((l: string) => l.startsWith("VIOLATION\tref\t") || l.startsWith("REVIEW\tref\t"))
    .sort();

test("所有外 skill を先頭にする参照はディスク有無で色が変わらない", async () => {
  const absent = await ownedRepo({ table: ["owned"], extras: ["ghost"] });
  const present = await ownedRepo({ table: ["owned"], extras: ["ghost"] });
  try {
    writeFileSync(join(absent, "agents/skills/owned/SKILL.md"), "# owned\n\n`ghost/gone.md`\n");
    writeFileSync(join(present, "agents/skills/owned/SKILL.md"), "# owned\n\n`ghost/gone.md`\n");
    writeFileSync(join(present, "agents/skills/ghost/gone.md"), "# gone\n");
    const a = await audit(join(absent, "agents/skills"));
    const b = await audit(join(present, "agents/skills"));
    expect(refLines(a.stdout)).toEqual(refLines(b.stdout));
  } finally {
    rmSync(absent, { recursive: true, force: true });
    rmSync(present, { recursive: true, force: true });
  }
});

async function skillRepo(skills: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "audit-skills-"));
  mkdirSync(join(dir, "agents/docs"), { recursive: true });
  writeFileSync(join(dir, ".gitignore"), "\n");
  for (const [name, body] of Object.entries(skills)) {
    mkdirSync(join(dir, "agents/skills", name), { recursive: true });
    writeFileSync(join(dir, "agents/skills", name, "SKILL.md"), body);
  }
  writeLayerReadme(dir, Object.keys(skills));
  await git(["init"], dir);
  await git(["config", "user.email", "test@example.com"], dir);
  await git(["config", "user.name", "test"], dir);
  await git(["add", "."], dir);
  await git(["commit", "-m", "init"], dir);
  return dir;
}

test("peer の所有名を同じ層以下へ名指ししたら layer が赤", async () => {
  const inspect = await skillRepo({ local: "# local\n\n`resolve`\n" });
  const peer = await skillRepo({ resolve: "# resolve\n" });
  try {
    const { stdout, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(stdout).toContain("VIOLATION\tlayer\tlocal/SKILL.md:");
    expect(stdout).toContain("names=resolve");
    expect(exitCode).toBe(1);
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});

test("invocation 形は先頭 / を剥がした skill 名と同じ語", async () => {
  const inspect = await skillRepo({ local: "# local\n\n`/pr`\n" });
  const peer = await skillRepo({ pr: "# pr\n" });
  try {
    const { stdout, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(stdout).toContain("VIOLATION\tlayer\tlocal/SKILL.md:");
    expect(stdout).toContain("names=pr");
    expect(exitCode).toBe(1);
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});

test("skill-project が本体より上を名指ししたら layer が赤", async () => {
  const inspect = await skillRepo({ "resolve-project": "# resolve-project\n\n`conductor`\n" });
  const peer = await skillRepo({ conductor: "# conductor\n" });
  try {
    const { stdout, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(stdout).toContain("VIOLATION\tlayer\tresolve-project/SKILL.md:");
    expect(stdout).toContain("names=conductor");
    expect(exitCode).toBe(1);
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});

test("検査 root と peer で同じ skill 名があるときは検査ごと落ちる", async () => {
  const inspect = await skillRepo({ foo: "# foo\n" });
  const peer = await skillRepo({ foo: "# foo\n" });
  try {
    const { stdout, stderr, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).not.toContain("SUMMARY");
    expect(stderr).toContain("同じ skill 名");
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});

test("peer root が無いときは検査ごと落ちる", async () => {
  const inspect = await skillRepo({ local: "# local\n" });
  try {
    const { stdout, stderr, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(inspect, "missing-peer"),
    ]);
    expect(exitCode).toBe(2);
    expect(stdout).not.toContain("SUMMARY");
    expect(stderr).toContain("--peer が実在しない");
  } finally {
    rmSync(inspect, { recursive: true, force: true });
  }
});

test("検査 root がスクリプトと異なり peer が無いとき layer は SKIP で成功終了しない", async () => {
  const inspect = await skillRepo({ local: "# local\n" });
  try {
    const { stdout, exitCode } = await audit(join(inspect, "agents/skills"));
    expect(stdout).toContain("SKIP\tlayer");
    expect(exitCode).toBe(2);
  } finally {
    rmSync(inspect, { recursive: true, force: true });
  }
});

test("docs-project は本体の免除を引き継ぐ", async () => {
  const inspect = await skillRepo({
    "docs-project": "# docs-project\n\n`docs`\n\n`resolve`\n",
  });
  const peer = await skillRepo({ resolve: "# resolve\n" });
  try {
    const { stdout } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(stdout).not.toContain("VIOLATION\tlayer");
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});

test("peer の本文は検査対象に入らない", async () => {
  const inspect = await skillRepo({ local: "# local\n" });
  const peer = await skillRepo({ resolve: "# resolve\n\n**壊れた強調\n" });
  try {
    const { stdout, exitCode } = await audit(join(inspect, "agents/skills"), {}, [
      "--peer",
      join(peer, "agents/skills"),
    ]);
    expect(stdout).not.toContain("VIOLATION\temphasis");
    expect(stdout).not.toContain("resolve/SKILL.md");
    expect(exitCode).toBe(0);
  } finally {
    rmSync(inspect, { recursive: true, force: true });
    rmSync(peer, { recursive: true, force: true });
  }
});
