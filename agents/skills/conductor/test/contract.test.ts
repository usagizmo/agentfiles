// Issue 契約の充足判定。**見出しが在り、直下に中身があること**までを固定する。
// 項目の質は測らない（そこは工程の責任）。

import { describe, expect, test } from "bun:test";
import { CONTRACT_HEADINGS, issueContractComplete, missingContractItems } from "../src/contract.ts";
import { entryBlockRecord } from "../src/records.ts";
import { present } from "../src/types.ts";

const full = CONTRACT_HEADINGS.map((h) => `${h}\n\n中身\n`).join("\n");

/** `references/issue-contract.md` の項目表から、見出しの列だけを取る。 */
const headingsInSsot = async (): Promise<string[]> => {
  const text = await Bun.file(new URL("../references/issue-contract.md", import.meta.url)).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .map((cell) => /^`(## .+)`$/.exec(cell)?.[1])
    .filter((h) => h !== undefined);
};

describe("見出しの字面", () => {
  // **字面が契約の実体**なので、書く側と読む側が同じ 1 つの表を見ていなければならない。
  // 実測で `## 目的` と `## 目的と期待する結果` が食い違い、**契約が永久に不足**と判定された。
  test("読む側の一覧が SSOT の項目表と一致する", async () => {
    expect(CONTRACT_HEADINGS.map(String)).toEqual(await headingsInSsot());
  });
});

describe("契約の充足", () => {
  test("6 つの見出しに中身があれば揃っている", () => {
    expect(issueContractComplete(full)).toEqual(present(true));
  });

  test("見出しが 1 つでも欠ければ不足（不足項目がそのまま取れる）", () => {
    const without = full.replace("## 非目標\n\n中身\n", "");
    expect(missingContractItems(without)).toEqual(["## 非目標"]);
    expect(issueContractComplete(without)).toEqual(present(false));
  });

  test("見出しはあるが中身が空なら不足", () => {
    const empty = full.replace("## リスク\n\n中身\n", "## リスク\n\n");
    expect(missingContractItems(empty)).toEqual(["## リスク"]);
  });

  test("言い換えた見出しは当たらない（完全一致で引く）", () => {
    const renamed = full.replace("## 受入条件", "## 受け入れ条件");
    expect(missingContractItems(renamed)).toEqual(["## 受入条件"]);
  });

  test("先頭区画の宣言は契約の項目に数えない", () => {
    const withHead = `Depends on #12\nLands in example/repo\n\n${full}`;
    expect(issueContractComplete(withHead)).toEqual(present(true));
  });
});

describe("入場を止める宣言", () => {
  const wrap = (yaml: string) =>
    `<!-- entry-block -->\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\n<!-- /entry-block -->`;

  test("理由つきの宣言を読める", () => {
    const r = entryBlockRecord(wrap("issues: [12]\nreason: 資源キーの体系ごと入れ替える"));
    expect(r.kind).toBe("present");
  });

  test("理由が空なら壊れている（無いとは読まない）", () => {
    expect(entryBlockRecord(wrap("issues: [12]\nreason: ")).kind).toBe("invalid");
  });

  test("宣言が無ければ absent", () => {
    expect(entryBlockRecord("本文だけ").kind).toBe("absent");
  });
});
