// audit-skills.sh の emphasis 統合の smoke test。判定そのものは check-emphasis.test.mjs。
//
// ここで押さえるのは **sh 側の配線**: 検出が VIOLATION として出るか、道具が無いときに
// 黙らず SKIP を出すか、SUMMARY が数を持つか。**「違反 0」と「検査していない」を
// 取り違えると gate が素通りする**ので、そこを実際に走らせて確かめる。

import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const AUDIT = `${ROOT}agents/skills/docs/scripts/audit-skills.sh`;
const fixture = (name) => `${ROOT}test/fixtures/${name}`;

async function audit(root, env = {}) {
  const p = Bun.spawn(["sh", AUDIT, root], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return { stdout, exitCode };
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
  expect(stdout).toContain("skips=1");
});

test("skills root が無ければ検査せずに落ちる（緑に見せない）", async () => {
  const { stdout, exitCode } = await audit(fixture("does-not-exist"));
  expect(stdout).not.toContain("SUMMARY");
  expect(exitCode).toBe(2);
});

// --- checker の異常系（EMPHASIS_JS で差し替える） -------------------------
// **「落ちた」と「違反なし」を取り違えないこと**が要点。緑で通ると検査が消える。

const checker = (name) => ({ EMPHASIS_JS: `${ROOT}test/fixtures/checker/${name}.mjs` });

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
  expect(stdout).toContain("skips=1");
});
