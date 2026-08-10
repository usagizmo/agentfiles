// conductor の起床監視が「前回」をどこに置いているかの回帰テスト。
//
// **押さえるのは 1 点** —— baseline は watcher が起動時に取り直すものではなく、**tick が
// action を決めるのに使った観測**であること。取り直す実装だと、tick の観測から watcher の
// 起動までの隙間に入った遷移が baseline に吸われ、fallback まで誰にも見えない（実測で
// 30 分の停止が 2 回）。
//
// **修正前に落ちることを実測してある。**旧実装では 4 件とも fail（mode を持たないので
// `unknown option: --baseline`）。窓そのものも同じ shim で再現した —— 状態を "done" へ変えてから
// 旧 watch.sh を起こすと、`--max 6 --interval 1` でも差分は 1 度も出ず、6 秒後の
// `no change for 6s (fallback wake)` だけが出る。
//
// gh / git は PATH shim で偽装する（本物を呼ぶと network と checkout に依存して測れない）。
// 状態の変化は `--sessions-cmd` に渡す file の中身で作る —— そこは元から注入点なので、
// 偽装を増やさずに「窓に入った遷移」を再現できる。

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const WATCH = `${ROOT}agents/skills/conductor/scripts/watch.sh`;
const SHIM = `${ROOT}test/fixtures/watch-baseline/bin`;

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "watch-baseline-"));
  const state = join(dir, "state");
  writeFileSync(state, "resolve-1 working\n");
  return { dir, state, snapshot: join(dir, "snapshot") };
}

async function watch(args, { state }) {
  const p = Bun.spawn(
    [
      "bash",
      WATCH,
      ...args,
      "--repo",
      "/fake/repo",
      "--gh-repo",
      "o/r",
      "--project-org",
      "o",
      "--project-number",
      "7",
      "--status-field",
      "Status",
      "--sessions-cmd",
      `cat ${state}`,
      "--workspaces-cmd",
      "echo ws-1 /fake/wt",
      "--deadline",
      "20",
    ],
    {
      cwd: ROOT,
      env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}` },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("tick が観測した後・watcher を張る前に起きた変化を、fallback を待たずに差分へ出す", async () => {
  const box = sandbox();

  const snap = await watch(["--snapshot", box.snapshot], box);
  expect(snap.exitCode).toBe(0);
  expect(readFileSync(box.snapshot, "utf8")).toContain("resolve-1 working");

  // ここが窓。tick は "working" を見て action を決め、watcher を張る前に "done" へ落ちた
  writeFileSync(box.state, "resolve-1 done\n");

  const started = Date.now();
  const run = await watch(["--baseline", box.snapshot, "--interval", "1", "--max", "30"], box);
  const elapsed = Date.now() - started;

  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("state changed");
  expect(run.stdout).toContain("resolve-1 done");
  expect(run.stdout).not.toContain("fallback wake");
  // fallback（30s）に頼らず最初のラウンドで出る
  expect(elapsed).toBeLessThan(15_000);
}, 40_000);

test("渡した観測から何も動いていなければ、fallback まで起こさない", async () => {
  const box = sandbox();

  const snap = await watch(["--snapshot", box.snapshot], box);
  expect(snap.exitCode).toBe(0);

  const run = await watch(["--baseline", box.snapshot, "--interval", "1", "--max", "3"], box);
  expect(run.exitCode).toBe(0);
  expect(run.stdout).toContain("fallback wake");
  expect(run.stdout).not.toContain("state changed");
}, 20_000);

test("baseline を渡さずに監視は始められない", async () => {
  const box = sandbox();

  const none = await watch([], box);
  expect(none.exitCode).toBe(2);
  expect(none.stderr).toContain("one of --snapshot / --baseline is required");

  const both = await watch(["--snapshot", box.snapshot, "--baseline", box.snapshot], box);
  expect(both.exitCode).toBe(2);
  expect(both.stderr).toContain("exclusive");
});

test("観測に失敗しても、既存の snapshot を壊さない", async () => {
  const box = sandbox();

  const ok = await watch(["--snapshot", box.snapshot], box);
  expect(ok.exitCode).toBe(0);
  const kept = readFileSync(box.snapshot, "utf8");

  // 注入したコマンドが落ちる = 観測の失敗。**壊すと、観測できなかった tick が
  // 渡せる baseline を失い、誰も conductor を起こせなくなる**（起床漏れが最も重い障害）
  const broken = { ...box, state: "/dev/null; false" };
  const failed = await watch(["--snapshot", box.snapshot], broken);
  expect(failed.exitCode).toBe(1);
  expect(readFileSync(box.snapshot, "utf8")).toBe(kept);
});

test("呼び出し側へ渡せなかった観測は、置いてある snapshot を置き換えない", async () => {
  const box = sandbox();

  const ok = await watch(["--snapshot", box.snapshot], box);
  expect(ok.exitCode).toBe(0);
  const kept = readFileSync(box.snapshot, "utf8");

  // stdout を閉じてから起動する = 受け取り側が居ない。**置き換わると、誰も評価していない
  // 観測が「直前に成功した snapshot」として baseline に渡り、そこまでの遷移が吸われる**
  writeFileSync(box.state, "resolve-1 done\n");
  const cmd =
    `exec 1>&-; exec bash '${WATCH}' --snapshot '${box.snapshot}'` +
    ` --repo /fake/repo --gh-repo o/r --project-org o --project-number 7 --status-field Status` +
    ` --sessions-cmd "cat '${box.state}'" --workspaces-cmd 'echo ws-1 /fake/wt' --deadline 20`;
  const p = Bun.spawn(["bash", "-c", cmd], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(p.stderr).text(), p.exited]);

  expect(exitCode).toBe(1);
  expect(stderr).toContain("failed to hand the snapshot to the caller");
  expect(readFileSync(box.snapshot, "utf8")).toBe(kept);
});

test("値の無い option は、観測の失敗と区別できる終了コードで落ちる", async () => {
  // `--snapshot` に値が無い。**exit 1 に落ちると「観測できなかった」と読まれる**
  const p = Bun.spawn(["bash", WATCH, "--snapshot"], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${SHIM}:${process.env.PATH}` },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(p.stderr).text(), p.exited]);
  expect(exitCode).toBe(2);
  expect(stderr).toContain("missing value for --snapshot");
});

test("読めない baseline は自分で取り直さず起動を止める", async () => {
  const box = sandbox();

  const missing = await watch(["--baseline", join(box.dir, "nope")], box);
  expect(missing.exitCode).toBe(2);
  expect(missing.stderr).toContain("baseline not found");

  const empty = join(box.dir, "empty");
  writeFileSync(empty, "");
  const blank = await watch(["--baseline", empty], box);
  expect(blank.exitCode).toBe(2);
  expect(blank.stderr).toContain("baseline is empty");
});
