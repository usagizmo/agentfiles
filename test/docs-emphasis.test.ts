// tracked な markdown 全部に強調の検査を当てる。**gate に載せるのはここ。**
//
// 判定そのものは check-emphasis.test.ts、audit-skills.sh との統合は audit-skills.test.ts。
// ここが見るのは**実際の文書**で、他の 2 つは fixture しか見ない。
//
// **docs skill の品質パスに任せない。**あちらは工程が呼んだときにしか走らないので、
// 文書を直して commit する経路には掛からない。commit gate は `bun test` しか回さない。

import { expect, test } from "bun:test";
import {
  brokenLines,
  validateEmphasisFixtures,
} from "../agents/skills/docs/scripts/check-emphasis.ts";

const ROOT = new URL("..", import.meta.url).pathname;

const tracked = async () => {
  const p = Bun.spawn(["git", "ls-files", "*.md"], { cwd: ROOT, stdout: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  // **fixture は意図的に壊してある**（検査が落ちることを確かめる入力）。
  return out.split("\n").filter((f) => f && !f.startsWith("test/fixtures/"));
};

test("強調の検出軸と正例・負例が欠けたら落ちる", () => {
  expect(validateEmphasisFixtures()).toEqual([]);
});

test("tracked な markdown に壊れた強調が無い", async () => {
  const found = [];
  for (const file of await tracked()) {
    const src = await Bun.file(`${ROOT}${file}`).text();
    for (const l of brokenLines(src)) found.push(`${file}:${l.no}  ${l.text.trim().slice(0, 60)}`);
  }
  expect(found).toEqual([]);
});

test("検査の対象が空のまま緑にならない", async () => {
  expect((await tracked()).length).toBeGreaterThan(0);
});
