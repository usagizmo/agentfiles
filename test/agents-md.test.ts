// 共通 instructions の長さ。
//
// **grok は 1 ファイル 10,000 文字で切る**（`~/.grok/README.md` の AGENTS.md 節）。
// 超過は警告にしか出ないので、**切られたことに気づけない** —— 後半の規約だけが
// 静かに効かなくなる。上限そのものは harness 固有だが、当たると全 harness で
// 中身が食い違うので、共通側の制約として検査する。
//
// **文字数で数える。**grok の上限は文字であってバイトではない（日本語で 3 倍ずれる）。

import { expect, test } from "bun:test";

const CAP = 10_000;

const chars = async (path: string) =>
  [...(await Bun.file(new URL(path, import.meta.url)).text())].length;

test("共通 AGENTS.md は grok の上限を超えない", async () => {
  expect(await chars("../agents/AGENTS.md")).toBeLessThanOrEqual(CAP);
});

test("上限に対する余裕を報告する（半分を超えたら削る合図）", async () => {
  const n = await chars("../agents/AGENTS.md");
  // 失敗させない。**近づいたことを可視化するためだけ**の行なので、閾値で落とすと
  // 「規約を足せない」に化ける。落とすのは上の 1 本だけ。
  if (n > CAP / 2) console.debug(`agents/AGENTS.md: ${n} / ${CAP} 文字`);
  expect(n).toBeGreaterThan(0);
});
