// tracked な markdown に幅折り返しが無いことを bun test で止める。
// 判定そのものは check-hard-wrap.mjs。ここが見るのは実際の文書と fixture 自己検査。

import { expect, test } from "bun:test";
import {
  hardWrapLines,
  validateHardWrapFixtures,
} from "../agents/skills/docs/scripts/check-hard-wrap.mjs";

const ROOT = new URL("..", import.meta.url).pathname;

const tracked = async () => {
  const p = Bun.spawn(["git", "ls-files", "*.md"], { cwd: ROOT, stdout: "pipe" });
  const out = await new Response(p.stdout).text();
  await p.exited;
  return out.split("\n").filter((f) => f && !f.startsWith("test/fixtures/"));
};

test("幅折り返しの検出軸と正例・負例が欠けたら落ちる", () => {
  expect(validateHardWrapFixtures()).toEqual([]);
});

test("tracked な markdown に文末以外の継続行が無い", async () => {
  const found = [];
  for (const file of await tracked()) {
    const raw = await Bun.file(`${ROOT}${file}`).text();
    const src = raw.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?(?:\r?\n)?---[ \t]*(?:\r?\n|$)/, "");
    const shift =
      raw.length === src.length ? 0 : raw.slice(0, raw.length - src.length).split("\n").length - 1;
    for (const l of hardWrapLines(src)) {
      found.push(`${file}:${l.no + shift}  ${l.text.trim().slice(0, 60)}`);
    }
  }
  expect(found).toEqual([]);
});

test("検査の対象が空のまま緑にならない", async () => {
  expect((await tracked()).length).toBeGreaterThan(0);
});
