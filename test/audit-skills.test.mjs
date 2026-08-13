// audit-skills.sh の統合 smoke test。強調の判定そのものは check-emphasis.test.mjs。
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
