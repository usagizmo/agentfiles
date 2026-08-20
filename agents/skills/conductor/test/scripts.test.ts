// script の自前テストを `bun test` から回す。
//
// **置いてあるだけのテストは何も守らない。**`scripts/cycle-mark.test.py` は commit gate にも
// package scripts にも載っておらず、誰も回していなかった。gate が回すのは `bun test` だけなので、
// ここから呼ぶ形にして 1 つの入口へ寄せる。
//
// **道具が無いことを skip にしない。**指紋は `python3` が、観測は `bash` が無いと成立しない
// （どちらも SKILL.md が前提にしている）。無い環境で緑にすると、走らない検査が緑のまま増える。

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const SCRIPTS = join(import.meta.dir, "../scripts");

const run = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { cwd: SCRIPTS, stdout: "pipe", stderr: "pipe" });
  const [code, out, err] = await Promise.all([
    p.exited,
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code, output: `${out}${err}` };
};

describe("scripts の自前テスト", () => {
  test("watch.sh の終了コード契約", async () => {
    const { code, output } = await run(["sh", "watch.test.sh"]);
    expect(output).toContain("0 fail");
    expect(code).toBe(0);
  });

  // 175 件が git を temp dir で回すので十数秒かかる。**件数を削って速くしない** ——
  // 分離と不変性の検査はどれも 1 つの成分を落とす変異を止めている。
  test("cycle-mark.py の符号化", async () => {
    const { code, output } = await run(["python3", "cycle-mark.test.py"]);
    expect(code === 0 ? "" : output).toBe("");
  }, 60_000);

  test("ensure-integration-ref.sh の述語", async () => {
    const { code, output } = await run(["sh", "ensure-integration-ref.test.sh"]);
    expect(code === 0 ? "" : output).toBe("");
  });

  test("`*.test.*` を持つ script は全部ここから回している", () => {
    // **一覧を数え上げない。**足した検査が呼ばれないまま残る経路を塞ぐ。
    const declared = new Set([
      "watch.test.sh",
      "cycle-mark.test.py",
      "ensure-integration-ref.test.sh",
    ]);
    const found = readdirSync(SCRIPTS).filter((f) => /\.test\.[a-z]+$/.test(f));
    expect([...found].sort()).toEqual([...declared].sort());
  });
});
