// commit gate が各段へ渡す環境。
//
// **hook には GIT_DIR が入っている。**そのまま `bun test` へ渡すと、sandbox repo へ
// `git -C <tmp> config user.email ...` を撃つ test の書き込み先が、-C を付けても
// この repo の .git/config になる。一度当たると以後の commit の author が入れ替わり、
// **`git log` を見るまで気づけない**。
//
// **落とす位置も固定する。**lint-staged より前で落とすと、partial commit
// （`git commit -- <path>`）の一時 index を見失い、整形結果が commit されない。
//
// 実行器を PATH で差し替えて、hook が各段へ実際に渡した環境を読む。

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const HOOK = `${ROOT}.githooks/pre-commit`;

/** hook が呼ぶ bun を差し替え、段ごとに受け取った GIT_* を書き出す。 */
function stubBun(dir: string, record: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "bun");
  writeFileSync(
    stub,
    `#!/bin/sh
stage=$1
[ "$stage" = run ] && stage=$2
printf 'ran\\n' >"${record}.$stage"
env | grep '^GIT_' >>"${record}.$stage"
exit 0
`,
  );
  chmodSync(stub, 0o755);
  return bin;
}

type Stage = { ran: boolean; gitVars: string[] };

async function runHook(): Promise<Record<string, Stage>> {
  const dir = mkdtempSync(join(tmpdir(), "pre-commit-"));
  try {
    const record = join(dir, "record");
    const bin = stubBun(dir, record);
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const isolated = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    };
    const init = Bun.spawn(["git", "init", "-q", repo], { env: isolated });
    await init.exited;

    // git が pre-commit を呼ぶときと同じ形。GIT_DIR は hook の既定の入力。
    const p = Bun.spawn(["bash", HOOK], {
      cwd: repo,
      env: {
        ...isolated,
        PATH: `${bin}:${process.env["PATH"]}`,
        HOME: dir,
        GIT_DIR: join(repo, ".git"),
        GIT_INDEX_FILE: join(repo, ".git/index"),
        GIT_PREFIX: "",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    await p.exited;

    const stages: Record<string, Stage> = {};
    for (const stage of ["lint-staged", "typecheck", "test"]) {
      const path = `${record}.${stage}`;
      const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
      stages[stage] = {
        ran: lines[0] === "ran",
        gitVars: lines.filter((l) => l.startsWith("GIT_")).map((l) => l.split("=")[0] ?? ""),
      };
    }
    return stages;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("commit gate は GIT_* を落としてから test を起動する", async () => {
  const stages = await runHook();
  // **「呼ばれなかった」を緑にしない。**stub に届いていなければ環境も見えない
  expect(stages["test"]?.ran).toBe(true);
  expect(stages["test"]?.gitVars).toEqual([]);
});

test("落とすのは lint-staged より後（一時 index を見失わない）", async () => {
  const stages = await runHook();
  expect(stages["lint-staged"]?.ran).toBe(true);
  expect(stages["lint-staged"]?.gitVars).toContain("GIT_INDEX_FILE");
});
