// commit gate が test へ渡す環境。
//
// **hook には GIT_DIR が入っている。**そのまま `bun test` へ渡すと、sandbox repo へ
// `git -C <tmp> config user.email ...` を撃つ test の書き込み先が、-C を付けても
// この repo の .git/config になる。一度当たると以後の commit の author が入れ替わり、
// **`git log` を見るまで気づけない**。
//
// checker を PATH で差し替えて、hook が実際に渡した環境を読む。

import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";

const ROOT = new URL("..", import.meta.url).pathname;
const HOOK = `${ROOT}.githooks/pre-commit`;

/** hook が呼ぶ bun を差し替える。`bun test` のときだけ受け取った GIT_* を書き出す。 */
function stubBun(dir: string, record: string): string {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "bun");
  writeFileSync(
    stub,
    `#!/bin/sh
if [ "$1" = test ]; then
  printf 'ran\\n' >"${record}"
  env | grep '^GIT_' >>"${record}"
fi
exit 0
`,
  );
  chmodSync(stub, 0o755);
  return bin;
}

async function runHook(): Promise<string> {
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
    return readFileSync(record, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("commit gate は GIT_* を落としてから test を起動する", async () => {
  const recorded = await runHook();
  // **「呼ばれなかった」を緑にしない。**stub に届いていなければ環境も見えない
  expect(recorded.split("\n")[0]).toBe("ran");
  expect(recorded.split("\n").filter((l) => l.startsWith("GIT_"))).toEqual([]);
});
